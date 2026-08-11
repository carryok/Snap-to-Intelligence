"""
Person C — Backend API.

One endpoint that matters: POST /api/scan (image in, product profile out).
Everything else exists to make integration and demo day survivable.

Run:  uvicorn main:app --reload --port 8000   (from the /backend folder)
"""

import os
import pathlib
import shutil
import tempfile

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

import adapters
import assemble
import mock_store

load_dotenv()

ROOT = pathlib.Path(__file__).resolve().parent.parent
UPLOADS_DIR = pathlib.Path(__file__).resolve().parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}

app = FastAPI(title="Snap-to-Intelligence API", version="1.0")

# Permissive CORS: the Vite proxy handles dev, but this keeps a built bundle
# opened from any origin working on demo day.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _json(envelope: dict, http_status: int = 200) -> JSONResponse:
    """
    Every response — success or failure — is the same envelope shape.
    That's what lets the frontend have exactly one response handler.
    """
    return JSONResponse(status_code=http_status, content=envelope)


@app.get("/api/health")
def health():
    """Readiness at a glance. Saves an hour of guessing on integration day."""
    return {
        "status": "up",
        "gemini_api_key": bool(os.environ.get("GEMINI_API_KEY")),
        "gemini_model": os.environ.get("GEMINI_MODEL", "gemini-flash-lite-latest"),
        "extraction_module": adapters.extraction_available(),
        "enrichment_module": adapters.enrichment_available(),
        "mocks_loaded": mock_store.count(),
        "mocks_dir": str(mock_store.MOCKS_DIR),
    }


@app.get("/api/mocks")
def list_mocks():
    """Person B owns these files; we only read them."""
    return {"mocks": mock_store.summaries(), "available": mock_store.available()}


@app.get("/api/mocks/{mock_id}")
def get_mock(mock_id: str):
    envelope = mock_store.get(mock_id)
    if envelope is None:
        return _json(assemble.failed(f"No mock named '{mock_id}'."), 404)
    return _json(envelope)


@app.get("/api/uploads/{filename}")
def get_upload(filename: str):
    """Serve the uploaded photo back for the side-by-side view."""
    safe = pathlib.Path(filename).name  # strip any traversal attempt
    path = UPLOADS_DIR / safe
    if not path.is_file():
        return _json(assemble.failed("Image not found."), 404)
    return FileResponse(path)


def _validate(image: UploadFile) -> str | None:
    """Returns an error message, or None when the upload is acceptable."""
    if not image or not image.filename:
        return "No image was uploaded."
    ext = pathlib.Path(image.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        return f"Unsupported file type '{ext or 'unknown'}'. Use JPG, PNG, or WebP."
    if image.content_type and image.content_type not in ALLOWED_CONTENT_TYPES:
        return f"Unsupported file type '{image.content_type}'. Use JPG, PNG, or WebP."
    return None


@app.post("/api/scan")
async def scan(image: UploadFile = File(None), mode: str = Form("auto")):
    """
    The endpoint. mode:
      auto         — extraction, then enrichment if Person B's module is present
      extract_only — extraction only (fast path / integration debugging)
      mock         — return one of Person B's mock profiles, zero API calls
    """
    if mode == "mock":
        envelope = mock_store.first()
        if envelope is None:
            return _json(
                assemble.failed(
                    "No mock profiles found. Person B's files go in /shared/mocks/."
                ),
                503,
            )
        return _json(envelope)

    error = _validate(image)
    if error:
        return _json(assemble.failed(error), 400)

    contents = await image.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        return _json(assemble.failed("Image is larger than 10 MB."), 400)
    if not contents:
        return _json(assemble.failed("Uploaded image was empty."), 400)

    profile_id = assemble.new_profile_id()
    ext = pathlib.Path(image.filename).suffix.lower()

    # Person A's extract_from_image() takes a PATH (it calls genai.upload_file),
    # so the upload has to hit disk before we can call it.
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        # Keep a copy so the results view can show the photo beside the profile.
        stored_name = f"{profile_id}{ext}"
        shutil.copyfile(tmp_path, UPLOADS_DIR / stored_name)
        image_url = f"/api/uploads/{stored_name}"

        extraction = adapters.run_extraction(tmp_path)

        # Hard failure only when there is nothing at all to show.
        if not extraction.get("extracted_fields"):
            message = extraction.get("error") or "Couldn't read any details from this image."
            http_status = 502 if extraction.get("error") else 200
            if http_status == 200:
                # Readable request, unreadable label — that's a partial, not an error,
                # so the UI can still show the photo and the guidance state.
                envelope = assemble.build_envelope(
                    extraction, None, profile_id, image.filename, image_url
                )
                return _json(envelope)
            return _json(assemble.failed(message), http_status)

        enriched = None if mode == "extract_only" else adapters.run_enrichment(extraction)

        envelope = assemble.build_envelope(
            extraction, enriched, profile_id, image.filename, image_url
        )
        return _json(envelope)

    except Exception as e:
        return _json(assemble.failed(f"Unexpected server error: {e}"), 500)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


@app.on_event("startup")
def startup_report():
    print("\n  Snap-to-Intelligence API")
    print("  " + "-" * 42)
    print(f"  GEMINI_API_KEY present ...... {'yes' if os.environ.get('GEMINI_API_KEY') else 'NO'}")
    print(f"  extraction module .......... {'ok' if adapters.extraction_available() else 'NOT FOUND'}")
    print(f"  enrichment module .......... {'ok' if adapters.enrichment_available() else 'NOT FOUND (stage will be skipped)'}")
    print(f"  mocks loaded ............... {mock_store.count()}")
    print("  " + "-" * 42 + "\n")
