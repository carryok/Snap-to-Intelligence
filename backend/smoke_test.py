"""Smoke test for the backend. Run: python smoke_test.py"""
import io
import json
import sys

from fastapi.testclient import TestClient

import main

client = TestClient(main.app)
failures = []


def check(name, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {name}" + (f"  — {detail}" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def png_bytes():
    """Minimal valid 1x1 PNG."""
    import base64
    return base64.b64decode(
        b"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )


print("\n=== /api/health ===")
r = client.get("/api/health")
check("health returns 200", r.status_code == 200, str(r.status_code))
health = r.json()
print("  " + json.dumps(health, indent=2).replace("\n", "\n  "))
check("reports extraction module", health.get("extraction_module") is True)
check("reports enrichment absent", health.get("enrichment_module") is False)

print("\n=== /api/mocks (Person B's files, expected absent for now) ===")
r = client.get("/api/mocks")
check("mocks endpoint returns 200", r.status_code == 200)
check("degrades to empty list", r.json().get("mocks") == [])

print("\n=== mode=mock with no mock files ===")
r = client.post("/api/scan", files={"image": ("x.png", png_bytes(), "image/png")}, data={"mode": "mock"})
check("returns 503 not a crash", r.status_code == 503, str(r.status_code))
check("envelope shape intact", set(r.json()) >= {"status", "profile", "error"})
check("status is failed", r.json()["status"] == "failed")
print("  error message: " + str(r.json()["error"]))

print("\n=== validation: wrong file type ===")
r = client.post("/api/scan", files={"image": ("notes.txt", b"hello", "text/plain")}, data={"mode": "auto"})
check("rejects with 400", r.status_code == 400, str(r.status_code))
check("envelope shape intact", set(r.json()) >= {"status", "profile", "error"})
print("  error message: " + str(r.json()["error"]))

print("\n=== validation: empty file ===")
r = client.post("/api/scan", files={"image": ("x.png", b"", "image/png")}, data={"mode": "auto"})
check("rejects empty upload", r.status_code == 400, str(r.status_code))

print("\n=== real scan with no API key (degraded path) ===")
r = client.post("/api/scan", files={"image": ("x.png", png_bytes(), "image/png")}, data={"mode": "extract_only"})
check("never 500s", r.status_code in (200, 502), str(r.status_code))
body = r.json()
check("envelope shape intact", set(body) >= {"status", "profile", "error"})
print(f"  status={body['status']}  error={str(body['error'])[:110]}")

print("\n=== assemble.build_envelope with synthetic Person A output ===")
import assemble

fake_a = {
    "extracted_fields": [
        {"field_name": "brand", "value": "Siemens", "raw_value": "Siemens",
         "source_type": "label", "source_reference": "photo label",
         "confidence": 0.94, "conflicting_values": []},
        {"field_name": "rated_voltage", "value": "48V", "raw_value": "48V",
         "source_type": "label", "source_reference": "photo label",
         "confidence": 0.72, "conflicting_values": []},
        {"field_name": None, "value": "junk", "raw_value": "junk",
         "source_type": "label", "source_reference": "x",
         "confidence": 0.5, "conflicting_values": []},
    ],
    "image_quality_flag": "clear",
    "overall_extraction_confidence": 0.88,
    "error": None,
}
env = assemble.build_envelope(fake_a, None, "abc123", "breaker.jpg", "/api/uploads/abc123.jpg")
p = env["profile"]
check("drops nameless field", len(p["fields"]) == 2, f"got {len(p['fields'])}")
check("status is partial (no enrichment)", env["status"] == "partial")
check("enrichment marked skipped", p["stages"]["enrichment"] == "skipped")
check("identity.brand populated", p["identity"]["brand"] == "Siemens")
check("completeness computed", 0 <= p["completeness"]["score"] <= 100)
check("missing_fields populated", len(p["completeness"]["missing_fields"]) > 0)
check("confidence bands counted", p["confidence_summary"]["high"] == 1 and p["confidence_summary"]["medium"] == 1)
check("warning present", any("Enrichment" in w for w in p["warnings"]))
print(f"  score={p['completeness']['score']}%  fields={len(p['fields'])}  bands={p['confidence_summary']}")

print("\n=== dedupe: B enriches a field A already found ===")
fake_b = {
    "fields": [
        {"field_name": "rated_voltage", "value": "50 V", "raw_value": "50V",
         "source_type": "distributor", "source_reference": "https://d.example/p/1",
         "confidence": 0.71, "conflicting_values": []},
        {"field_name": "ip_rating", "value": "IP54", "raw_value": "IP54",
         "source_type": "manufacturer_site", "source_reference": "https://m.example/x",
         "confidence": 0.9, "conflicting_values": []},
    ],
    "completeness": {"score": 65, "fields_filled": 11, "expected_fields": 17, "missing_fields": ["weight"]},
    "identity": {"category": "circuit_breaker"},
}
env2 = assemble.build_envelope(fake_a, fake_b, "def456", "breaker.jpg", None)
p2 = env2["profile"]
names = [f["field_name"] for f in p2["fields"]]
check("no duplicate rows", len(names) == len(set(names)), str(names))
check("status now ok", env2["status"] == "ok")
check("enrichment marked ok", p2["stages"]["enrichment"] == "ok")
check("B's completeness wins", p2["completeness"]["score"] == 65)
check("B's category merged", p2["identity"]["category"] == "circuit_breaker")

voltage = next(f for f in p2["fields"] if f["field_name"] == "rated_voltage")
check("label beats distributor", voltage["value"] == "48V", str(voltage["value"]))
check("loser kept as conflict", len(voltage["conflicting_values"]) == 1)
check("conflict value recorded", voltage["conflicting_values"][0]["value"] == "50 V")
print(f"  rated_voltage = {voltage['value']} (conflict: {voltage['conflicting_values'][0]['value']} from {voltage['conflicting_values'][0]['source_type']})")

print("\n" + "=" * 52)
if failures:
    print(f"  {len(failures)} FAILURE(S): {', '.join(failures)}")
    sys.exit(1)
print("  All backend checks passed.")
