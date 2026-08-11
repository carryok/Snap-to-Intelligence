"""
Person C — Envelope assembly.

Takes Person A's raw extraction output (and Person B's enrichment output when
it exists) and produces the single response envelope the frontend consumes.

The important property: this module ALWAYS produces a complete, valid envelope.
When Person B is absent it computes stand-in completeness and confidence itself,
so the UI never has to handle a missing key. When B lands, their values win.
"""

import uuid
from datetime import datetime, timezone

SCHEMA_VERSION = "1.0"

# Confidence band thresholds. These MUST match frontend/src/lib/confidence.js.
BAND_HIGH = 0.85
BAND_MEDIUM = 0.60

# Authority ranking, lowest number = most authoritative.
SOURCE_AUTHORITY = {
    "label": 1,
    "manufacturer_site": 2,
    "datasheet_pdf": 3,
    "distributor": 4,
    "generic_web": 5,
    "inferred": 6,
}

IDENTITY_FIELDS = ("brand", "model_number", "serial_number")

# Stand-in expected-field list used only until Person B ships the real,
# category-aware version. Deliberately generic industrial-product fields.
DEFAULT_EXPECTED_FIELDS = [
    "brand",
    "model_number",
    "serial_number",
    "rated_voltage",
    "rated_current",
    "power_rating",
    "frequency",
    "phase",
    "ip_rating",
    "operating_temperature",
    "dimensions",
    "weight",
    "material",
    "certifications",
    "enclosure_type",
    "mounting_type",
    "country_of_origin",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def band(confidence: float) -> str:
    if confidence >= BAND_HIGH:
        return "high"
    if confidence >= BAND_MEDIUM:
        return "medium"
    return "low"


def _clamp01(value, default=0.5) -> float:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, f))


def normalize_field(raw: dict) -> dict | None:
    """
    Coerce whatever A or B hands us into a valid field object.

    Anything without a field_name is dropped — a nameless row can't be rendered
    and is more likely a bug than data worth showing.
    """
    if not isinstance(raw, dict):
        return None

    field_name = raw.get("field_name")
    if not field_name or not str(field_name).strip():
        return None

    value = raw.get("value", raw.get("raw_value"))
    raw_value = raw.get("raw_value", value)

    source_type = raw.get("source_type") or "label"
    if source_type not in SOURCE_AUTHORITY:
        source_type = "generic_web"

    conflicts = []
    for c in raw.get("conflicting_values") or []:
        if not isinstance(c, dict):
            continue
        c_type = c.get("source_type") or "generic_web"
        if c_type not in SOURCE_AUTHORITY:
            c_type = "generic_web"
        conflicts.append(
            {
                "value": c.get("value"),
                "source_type": c_type,
                "source_reference": c.get("source_reference") or "",
                "confidence": _clamp01(c.get("confidence"), 0.5),
            }
        )

    field = {
        "field_name": str(field_name).strip(),
        "value": value,
        "raw_value": raw_value,
        "source_type": source_type,
        "source_reference": raw.get("source_reference") or "photo label",
        "confidence": _clamp01(raw.get("confidence"), 0.5),
        "conflicting_values": conflicts,
    }

    # Optional enrichment-only keys — carried through when present, never invented.
    for optional in ("display_name", "unit", "normalized_value"):
        if raw.get(optional) is not None:
            field[optional] = raw[optional]

    return field


def _dedupe(fields: list[dict]) -> list[dict]:
    """
    One row per field_name. When A and B both produce a field, keep the more
    authoritative source; on a tie keep the higher confidence. The loser is
    folded into conflicting_values rather than dropped — never silently discard.
    """
    by_name: dict[str, dict] = {}

    for field in fields:
        name = field["field_name"]
        existing = by_name.get(name)
        if existing is None:
            by_name[name] = field
            continue

        new_rank = SOURCE_AUTHORITY.get(field["source_type"], 9)
        old_rank = SOURCE_AUTHORITY.get(existing["source_type"], 9)

        if (new_rank, -field["confidence"]) < (old_rank, -existing["confidence"]):
            winner, loser = field, existing
        else:
            winner, loser = existing, field

        # Only record the loser as a conflict if it actually disagrees.
        if str(loser.get("value")) != str(winner.get("value")):
            winner.setdefault("conflicting_values", []).append(
                {
                    "value": loser.get("value"),
                    "source_type": loser["source_type"],
                    "source_reference": loser["source_reference"],
                    "confidence": loser["confidence"],
                }
            )
        by_name[name] = winner

    return list(by_name.values())


def _identity_from_fields(fields: list[dict]) -> dict:
    identity = {"brand": None, "model_number": None, "serial_number": None, "category": None}
    for field in fields:
        if field["field_name"] in IDENTITY_FIELDS:
            identity[field["field_name"]] = field.get("value")
    return identity


def _completeness(fields: list[dict], expected: list[str] | None = None) -> dict:
    expected = expected or DEFAULT_EXPECTED_FIELDS
    present = {f["field_name"] for f in fields if f.get("value") not in (None, "")}
    missing = [name for name in expected if name not in present]
    filled = len(expected) - len(missing)
    score = round(filled / len(expected) * 100) if expected else 0
    return {
        "score": score,
        "fields_filled": filled,
        "expected_fields": len(expected),
        "missing_fields": missing,
    }


def _confidence_summary(fields: list[dict]) -> dict:
    counts = {"high": 0, "medium": 0, "low": 0}
    for field in fields:
        counts[band(field["confidence"])] += 1
    overall = (
        round(sum(f["confidence"] for f in fields) / len(fields), 3) if fields else 0.0
    )
    return {"overall": overall, **counts}


def build_envelope(
    extraction: dict,
    enriched: dict | None,
    profile_id: str,
    filename: str,
    image_url: str | None = None,
) -> dict:
    """
    Build the response envelope.

    extraction — Person A's raw output (required)
    enriched   — Person B's full profile, or None when the stage was skipped
    """
    warnings: list[str] = []

    # --- fields ------------------------------------------------------------
    raw_fields = list(extraction.get("extracted_fields") or [])
    enrichment_ok = False

    if enriched:
        b_fields = enriched.get("fields") or enriched.get("extracted_fields") or []
        if b_fields:
            raw_fields = raw_fields + list(b_fields)
            enrichment_ok = True

    fields = [f for f in (normalize_field(r) for r in raw_fields) if f]
    fields = _dedupe(fields)

    # --- completeness ------------------------------------------------------
    if enrichment_ok and isinstance(enriched.get("completeness"), dict):
        completeness = enriched["completeness"]
        completeness.setdefault("missing_fields", [])
    else:
        completeness = _completeness(fields)

    # --- identity ----------------------------------------------------------
    identity = _identity_from_fields(fields)
    if enrichment_ok and isinstance(enriched.get("identity"), dict):
        for key, val in enriched["identity"].items():
            if val:
                identity[key] = val

    # --- status ------------------------------------------------------------
    if not enrichment_ok:
        warnings.append("Enrichment unavailable — showing label data only.")

    if extraction.get("used_fallback"):
        warnings.append("Primary vision model unavailable — used OCR fallback.")

    summary = _confidence_summary(fields)
    if fields and summary["overall"] < 0.5:
        warnings.append("Low confidence across most fields — review before use.")

    status = "ok" if (enrichment_ok and fields) else "partial"
    if not fields:
        status = "partial"
        warnings.insert(0, "No readable fields found in this image.")

    profile = {
        "schema_version": SCHEMA_VERSION,
        "profile_id": profile_id,
        "created_at": _now_iso(),
        "image": {
            "filename": filename,
            "url": image_url,
            "quality_flag": extraction.get("image_quality_flag") or "unknown",
        },
        "identity": identity,
        "fields": fields,
        "completeness": completeness,
        "confidence_summary": summary,
        "stages": {
            "extraction": "ok" if fields else "failed",
            "enrichment": "ok" if enrichment_ok else "skipped",
        },
        "warnings": warnings,
        "error": extraction.get("error"),
    }

    return {"status": status, "profile": profile, "error": None}


def ok(profile: dict) -> dict:
    return {"status": profile.get("_status", "ok"), "profile": profile, "error": None}


# Technical failure signatures → the sentence a person in front of the screen
# actually needs. Ordered: first match wins, so put the specific ones first.
ERROR_HINTS = (
    (
        ("no api_key", "adc found", "google_api_key", "api key not valid", "api_key_invalid"),
        "Extraction isn't configured yet — GEMINI_API_KEY is missing from backend/.env.",
    ),
    (
        ("quota", "rate limit", "resource_exhausted", "429"),
        "Extraction is rate-limited right now. Give it a moment, or open a sample profile.",
    ),
    (
        ("deadline", "timed out", "timeout"),
        "Extraction took too long to answer. Try again.",
    ),
    (
        ("getaddrinfo", "connection", "unreachable", "ssl", "dns"),
        "Couldn't reach the extraction service — check the network.",
    ),
    (
        ("tesseract",),
        "The OCR fallback isn't installed, so there was no second attempt at this image.",
    ),
)


def humanize_error(raw: str) -> tuple[str, str | None]:
    """
    Split a failure into (what the user reads, what the developer reads).

    Person A's SDK raises multi-line setup instructions. Those are genuinely
    useful — to whoever is running the server, not to whoever is watching the
    demo. So the sentence goes on screen and the raw text rides along in
    error_detail, where the UI keeps it behind a disclosure.
    """
    if not raw:
        return "Something went wrong before the label could be read.", None

    lowered = raw.lower()
    for needles, message in ERROR_HINTS:
        if any(needle in lowered for needle in needles):
            return message, raw

    # No known signature. A short single-line message is already fine to show;
    # a wrapped SDK dump is not.
    collapsed = " ".join(raw.split())
    if len(collapsed) > 160 or "\n" in raw:
        return "Extraction failed before it could read the label.", raw
    return collapsed, None


def failed(message: str, detail: str | None = None) -> dict:
    human, auto_detail = humanize_error(message)
    return {
        "status": "failed",
        "profile": None,
        "error": human,
        "error_detail": detail or auto_detail,
    }


def new_profile_id() -> str:
    return uuid.uuid4().hex[:12]
