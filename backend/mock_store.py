"""
Person C — Mock profile store.

Person B owns the mock JSON files in /shared/mocks/. This module just LOADS
them — it never authors them. Until those files land, every function here
degrades to empty and /api/scan?mode=mock reports that clearly rather than
inventing data.

Accepts either shape per file:
  - a full response envelope: {"status": ..., "profile": {...}}
  - a bare profile object:    {"profile_id": ..., "fields": [...]}
Both get normalized to an envelope on the way out.
"""

import json
import pathlib

MOCKS_DIR = pathlib.Path(__file__).resolve().parent.parent / "shared" / "mocks"


def _to_envelope(data: dict, mock_id: str) -> dict:
    if "profile" in data and "status" in data:
        envelope = data
    elif "profile" in data:
        envelope = {"status": "ok", "profile": data["profile"], "error": None}
    else:
        envelope = {"status": "ok", "profile": data, "error": None}

    profile = envelope.get("profile")
    if isinstance(profile, dict):
        profile.setdefault("profile_id", mock_id)
    envelope["mock_id"] = mock_id
    return envelope


def available() -> bool:
    return MOCKS_DIR.is_dir() and any(MOCKS_DIR.glob("*.json"))


def list_ids() -> list[str]:
    if not MOCKS_DIR.is_dir():
        return []
    return sorted(p.stem for p in MOCKS_DIR.glob("*.json"))


def summaries() -> list[dict]:
    """Lightweight list for the frontend's sample picker."""
    out = []
    for mock_id in list_ids():
        envelope = get(mock_id)
        if not envelope:
            continue
        profile = envelope.get("profile") or {}
        identity = profile.get("identity") or {}
        completeness = profile.get("completeness") or {}
        out.append(
            {
                "id": mock_id,
                "brand": identity.get("brand"),
                "model_number": identity.get("model_number"),
                "status": envelope.get("status"),
                "score": completeness.get("score"),
                "field_count": len(profile.get("fields") or []),
            }
        )
    return out


def get(mock_id: str) -> dict | None:
    path = MOCKS_DIR / f"{mock_id}.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        return {
            "status": "failed",
            "profile": None,
            "error": f"Mock '{mock_id}' is not valid JSON: {e}",
        }
    if not isinstance(data, dict):
        return {
            "status": "failed",
            "profile": None,
            "error": f"Mock '{mock_id}' is not a JSON object",
        }
    return _to_envelope(data, mock_id)


def first() -> dict | None:
    ids = list_ids()
    return get(ids[0]) if ids else None


def count() -> int:
    return len(list_ids())
