"""
Person C — Adapter layer.

This is the ONLY file that knows Person A's and Person B's real function
signatures. If either of them changes theirs, this file changes and nothing
else does.

Design rules:
  1. sys.path juggling lives here and nowhere else.
  2. A and B are imported LAZILY, inside the functions. A missing or broken
     module must degrade to a skipped stage, never prevent the server booting.
  3. Neither function ever raises. They return a dict (or None) so main.py has
     no try/except around pipeline calls.
"""

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXTRACTION_DIR = ROOT / "extraction"
ENRICHMENT_DIR = ROOT / "enrichment"

for _d in (EXTRACTION_DIR, ENRICHMENT_DIR):
    if _d.is_dir() and str(_d) not in sys.path:
        sys.path.insert(0, str(_d))


def extraction_available() -> bool:
    return (EXTRACTION_DIR / "gemini_extract.py").is_file()


def enrichment_available() -> bool:
    """Person B's entry point. Checked by name so /health can report it."""
    if not ENRICHMENT_DIR.is_dir():
        return False
    return any(
        (ENRICHMENT_DIR / name).is_file()
        for name in ("build_profile.py", "enrich.py", "main.py")
    )


def _import_enrichment_entry():
    """
    Person B's deliverable is `build_full_profile(a_output, enrichment_output)`.
    We don't know which module they'll put it in, so try the likely names.
    Returns the callable, or None.
    """
    for module_name in ("build_profile", "enrich", "main"):
        try:
            module = __import__(module_name)
        except Exception:
            continue
        fn = getattr(module, "build_full_profile", None)
        if callable(fn):
            return fn
    return None


def run_extraction(image_path: str) -> dict:
    """
    Call Person A's extract_from_image().

    Person A's function takes a FILESYSTEM PATH (it calls genai.upload_file),
    not bytes — main.py writes the upload to a temp file before calling this.

    If the primary Gemini path fails, automatically try Person A's Tesseract
    fallback. They built it for exactly the demo-day quota scenario, so wire it
    up rather than leaving it unused.

    Always returns a dict shaped like Person A's output. Never raises.
    """
    try:
        from gemini_extract import extract_from_image
    except Exception as e:
        return {
            "extracted_fields": [],
            "error": f"Extraction module unavailable: {e}",
        }

    try:
        result = extract_from_image(image_path)
    except Exception as e:
        result = {"extracted_fields": [], "error": f"Extraction crashed: {e}"}

    if not isinstance(result, dict):
        return {"extracted_fields": [], "error": "Extraction returned a non-dict"}

    # Primary path worked.
    if not result.get("error") and result.get("extracted_fields"):
        return result

    # Primary failed or came back empty — try the OCR fallback.
    try:
        from ocr_fallback import extract_via_ocr_fallback

        fallback = extract_via_ocr_fallback(image_path)
        if isinstance(fallback, dict) and not fallback.get("error") and fallback.get(
            "extracted_fields"
        ):
            fallback["used_fallback"] = True
            return fallback
    except Exception:
        pass  # fallback is best-effort; report the original error below

    return result


def run_enrichment(extraction_result: dict) -> dict | None:
    """
    Call Person B's build_full_profile().

    Returns their full profile dict, or None if enrichment is unavailable —
    which is the expected case until Person B lands. None means "stage skipped",
    and assemble.py fills the gap so the UI never sees a missing key.
    """
    fn = _import_enrichment_entry()
    if fn is None:
        return None

    try:
        result = fn(extraction_result, None)
    except TypeError:
        # Tolerate a single-argument signature.
        try:
            result = fn(extraction_result)
        except Exception:
            return None
    except Exception:
        return None

    return result if isinstance(result, dict) else None
