# Person C — Implementation & Design Spec

**Snap-to-Intelligence** · Frontend (React) + Backend Integration + Demo
Branch: `person-c-frontend`

This document is the build spec for everything Person C owns. It covers the data
contract, the API, the backend orchestration layer, the React architecture, the
visual design system, and the day-by-day plan through demo day.

> **Doc location note:** this lives in `/frontend` because that's Person C's folder
> per the roadmap, but it also specifies the backend (which will live at `/backend`)
> and the demo. Person A keeps their docs in `/extraction`; same convention.

---

## 0. Status snapshot (as of writing)

| Piece | Owner | State |
|---|---|---|
| `/extraction` | Person A | **Done.** `extract_from_image()` works, tested on 11 images, ~75–78% field accuracy, documented in `FINDINGS.md` |
| `/enrichment` | Person B | **Empty.** Nothing committed yet |
| `/frontend` | Person C | **Vite + React 19 starter template only.** `App.jsx` is still the boilerplate counter page |
| `/shared` | Team (Day 0) | **Does not exist.** No `schema.json`, no mocks |
| `/backend` | Person C | Not created yet |

Two things follow from this that shape the whole plan:

1. **The Day 0 deliverable was skipped.** There is no locked schema and no mock
   JSONs. The roadmap's entire "nobody blocks anybody" premise rests on those
   files. Section 2 resolves this — and resolves it *without* asking Person A to
   change any code.
2. **Person A is ahead, Person B is behind.** The backend must therefore be built
   so that it produces a useful, demo-able profile with **extraction only**, and
   treats enrichment as an additive layer that can arrive late (Section 4.4).

---

## 1. Scope

### What I own

- The entire React frontend (upload → processing → results → error states)
- The backend API (`/backend`, FastAPI) — the only thing that talks to both A and B
- The adapter layer that normalizes A's and B's outputs into one contract
- Mock data + mock mode, so the whole stack runs with zero API keys
- Integration on Days 12–13
- The live demo

### What I do not own

- Prompt engineering or extraction accuracy → Person A
- Web search, source fetching, unit normalization, conflict resolution, the
  authoritative completeness score → Person B

### What I own that isn't obviously mine

- **The schema.** It is a shared artifact, but it is *consumed* by the UI, so I
  write it and get the other two to sign off (Section 2).
- **Graceful degradation.** When A returns an error or B isn't ready, the decision
  about what the user sees is a UI decision.

---

## 2. Resolving the missing Day 0 contract

The schema was never written down, but it **already exists implicitly** — Person A's
`gemini_extract.py` emits a specific shape, and the roadmap names the fields Person B
must add. So the schema is not a design exercise; it is an act of writing down what
is already true and filling the gap for B.

**Governing rule: the schema is retro-fitted to Person A's actual output.** Every
field A currently emits is required; everything the UI additionally wants is
*optional with a frontend fallback*. Net effect: **Person A ships unchanged.**

Action, first thing:

1. Create `/shared/schema.json` with the contract in Section 3.
2. Ask Person B for `/shared/mocks/*.json` against that schema (Section 10) — they
   own those files; this scope reads them and never writes one.
3. Post the contract to the team, get an explicit "yes" from A and B, then freeze it.

---

## 3. The data contract

### 3.1 The field object — the core type of the entire app

Every extracted or enriched attribute is one of these. The UI renders a list of
them and nothing else. Getting this right is 80% of the integration.

```jsonc
{
  "field_name":       "rated_voltage",        // REQUIRED. snake_case, stable key
  "display_name":     "Rated Voltage",        // optional — UI derives from field_name if absent
  "value":            "48 V",                 // REQUIRED. display-ready, normalized by B
  "raw_value":        "48V",                  // REQUIRED. exactly as extracted, never rewritten
  "unit":             "V",                    // optional — B fills
  "normalized_value": 48,                     // optional — numeric, B fills, for future compare/filter
  "source_type":      "label",                // REQUIRED. enum below
  "source_reference": "photo label",          // REQUIRED. URL, doc name, or the literal "photo label"
  "confidence":       0.94,                   // REQUIRED. 0.0–1.0
  "conflicting_values": [                     // REQUIRED. [] when no conflict
    {
      "value": "50 V",
      "source_type": "distributor",
      "source_reference": "https://distributor.example/p/123",
      "confidence": 0.71
    }
  ]
}
```

`source_type` enum, ordered by authority (Person B's ranking from the roadmap):

| `source_type` | Authority | UI label | Who emits it |
|---|---|---|---|
| `label` | 1 (highest — it's on the physical unit) | On the label | Person A |
| `manufacturer_site` | 2 | Manufacturer | Person B |
| `datasheet_pdf` | 3 | Datasheet | Person B |
| `distributor` | 4 | Distributor | Person B |
| `generic_web` | 5 | Web | Person B |
| `inferred` | 6 (lowest) | Inferred | Person B |

The frontend must treat any unrecognized `source_type` as `generic_web` rather than
crashing — cheap insurance against a late enum addition.

`review_status` (`"unreviewed" | "approved" | "edited"`) is **client-side only**. It
never comes from the backend and is never sent back. It exists purely for the
optional human-review touch (Section 9.5).

### 3.2 The product profile envelope

What `POST /scan` returns.

```jsonc
{
  "schema_version": "1.0",
  "profile_id": "b2f1...",                  // uuid4, generated by backend
  "created_at": "2026-08-11T14:03:22Z",

  "image": {
    "filename": "breaker_01.jpg",
    "url": "/uploads/b2f1.jpg",             // backend-served, for the side-by-side view
    "quality_flag": "clear"                 // clear | blurry | partially_obscured | glare | unknown
  },

  "identity": {                             // convenience mirror for the header — always also present in fields[]
    "brand": "Siemens",
    "model_number": "3VA1112-4EE32-0AA0",
    "serial_number": null,
    "category": "circuit_breaker"           // B may set; null if unknown
  },

  "fields": [ /* field objects, Section 3.1 */ ],

  "completeness": {
    "score": 82,                            // 0–100 integer
    "fields_filled": 14,
    "expected_fields": 17,
    "missing_fields": ["ip_rating", "operating_temperature", "weight"]
  },

  "confidence_summary": {
    "overall": 0.81,
    "high": 9, "medium": 4, "low": 1
  },

  "stages": {                               // which parts of the pipeline actually ran
    "extraction": "ok",                     // ok | failed | skipped
    "enrichment": "skipped"                 // ok | failed | skipped
  },

  "warnings": [
    "Enrichment unavailable — showing label-only data."
  ],

  "error": null                             // string when status === "failed"
}
```

Wrapped in a response envelope:

```jsonc
{
  "status": "ok",        // ok | partial | failed
  "profile": { /* above, or null when failed */ },
  "error": null,         // string when failed — written for a human
  "error_detail": null   // string when failed and a raw cause exists
}
```

`error` and `error_detail` are two audiences, not one message split in two.
`error` is the sentence shown on screen: it names what broke and what to do about
it. `error_detail` is whatever the failing library actually said, verbatim, and
lives behind a collapsed "Technical details" toggle.

The split exists because the raw text is genuinely unusable on screen — an
unconfigured key surfaces as a four-line Google SDK message about
`genai.configure(api_key=...)` and ADC OAuth, which tells a demo audience nothing
and reads as a crash. `humanize_error()` in `assemble.py` pattern-matches the
causes worth naming (missing key, quota, network, timeout, unreadable image) and
passes anything unrecognised through unchanged, so a new failure mode degrades to
today's behaviour rather than to a wrong guess. Messages that were already written
for a person — the upload validators, for instance — match nothing and are
forwarded as-is with `error_detail: null`, which is what suppresses the toggle.

- `ok` — extraction and enrichment both succeeded
- `partial` — profile is usable but incomplete (enrichment failed/skipped, or
  extraction returned very few fields). **The UI renders it normally, plus a banner.**
- `failed` — no usable profile. `profile` is null.

### 3.3 Mapping Person A's real output in

Person A returns:

```python
{
  "extracted_fields": [ {field_name, value, raw_value, source_type,
                         source_reference, confidence, conflicting_values} ],
  "image_quality_flag": "clear",
  "overall_extraction_confidence": 0.88,
  "extracted_at": "...",
  "error": None
}
```

Every object in `extracted_fields` is **already a valid field object** — A sets
`source_type: "label"`, `source_reference: "photo label"`, and
`conflicting_values: []`. The gaps and their handling:

| Gap | Handling | Where |
|---|---|---|
| No `display_name` | Derive: `rated_voltage` → "Rated Voltage" | Frontend `prettifyFieldName()` |
| No `unit` / `normalized_value` | Leave undefined; UI shows `value` verbatim | — |
| `source_reference` is `"photo label"`, not a URL | Expand panel renders non-URL refs as plain text, not a link | Frontend `SourceLine` |
| Units inconsistent across images ("460 V" vs "460") — documented in A's `FINDINGS.md` | Person B's normalizer fixes it. Until B exists, the UI shows the raw string. Do not paper over it in the frontend. | — |

**Three concrete integration landmines in A's code — handle these in the adapter, not by asking A to change:**

1. **`extract_from_image(image_path)` takes a filesystem path, not bytes.** It calls
   `genai.upload_file(image_path)`. The backend receives an `UploadFile`, so it must
   **write to a temp file first** and pass the path.
2. **The module configures Gemini at import time** (`load_dotenv()` +
   `genai.configure()` at module scope). A missing `GEMINI_API_KEY` fails at import,
   not at call time — so validate env vars on server startup and fail loudly there.
3. **`genai.upload_file` is a network round-trip before generation even starts.**
   Budget several seconds. This drives the processing-screen design (Section 9.2).

### 3.4 What Person B must return

B's `build_full_profile(person_a_output, enrichment_output)` returns the full
profile object (Section 3.2). Specifically B owns:

- Appending enriched field objects with real `source_type` / `source_reference`
- Populating `unit` and `normalized_value`, and rewriting `value` to normalized form
  (**never** touching `raw_value`)
- Populating `conflicting_values` on conflicted fields
- `completeness` (score, counts, `missing_fields`)
- `identity.category`

Until B exists, the backend synthesizes these itself (Section 6.4) so the UI never
sees a missing key.

---

## 4. API contract

Base URL in dev: `http://localhost:8000`

### 4.1 Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/scan` | The one that matters. Image in → profile out |
| `GET` | `/health` | Readiness: which stages are wired, is the API key present |
| `GET` | `/mocks` | List available mock profiles (dev/demo fallback) |
| `GET` | `/mocks/{id}` | Return one mock profile — the demo safety net |
| `GET` | `/uploads/{file}` | Serve the uploaded image back for the side-by-side view |

### 4.2 `POST /scan`

Request: `multipart/form-data`

| Part | Type | Required | Notes |
|---|---|---|---|
| `image` | file | yes | jpg/png/webp, ≤ 10 MB |
| `mode` | string | no | `auto` (default), `mock`, `extract_only` |

`mode` is a **demo control**, and it is the single most valuable thing in this API.
`mock` returns a canned profile without touching any external API — that is the
stage-failure escape hatch on demo day.

Response: the envelope from Section 3.2.

### 4.3 Error taxonomy

| Condition | HTTP | `status` | What the UI shows |
|---|---|---|---|
| Success, both stages | 200 | `ok` | Results |
| Enrichment failed/skipped | 200 | `partial` | Results + amber banner |
| Extraction returned 0 fields | 200 | `partial` | "Couldn't read this label" empty state |
| No file / wrong type / too large | 400 | `failed` | Inline upload error, stay on upload screen |
| Gemini quota (429) after retries | 502 | `failed` | "Service busy — try again or use a sample" |
| Anything else | 500 | `failed` | Generic failure + retry |

**Every response — success or failure — is this same JSON envelope.** No bare HTML
error pages, no unwrapped exceptions. That means the frontend has exactly one
response handler and zero status-code branching in components.

### 4.4 Degraded modes (this is the point of the design)

The pipeline is three independent stages, and the profile is **valid at every
stopping point**:

```
extraction ok + enrichment ok       → status ok,      full profile
extraction ok + enrichment missing  → status partial, label-only profile + warning
extraction ok + enrichment errored  → status partial, label-only profile + warning
extraction failed                   → status failed,  error state
mode=mock                           → status ok,      canned profile
```

Because Person B hasn't started, **the app runs in the second row today** and still
demos well. Enrichment is strictly additive. This is not a compromise — it is what
lets me build and demo the whole product before B lands.

---

## 5. Architecture

### 5.1 Flow

```
┌──────────────┐   multipart POST /scan    ┌─────────────────────────────┐
│   Browser    │ ────────────────────────► │   FastAPI  (/backend)       │
│   React SPA  │ ◄──────────────────────── │                             │
└──────────────┘   profile envelope JSON   │  1. validate + save temp    │
                                           │  2. adapters.run_extraction │
                                           │  3. adapters.run_enrichment │
                                           │  4. assemble + score        │
                                           └──────────┬──────────────────┘
                                                      │
                                      ┌───────────────┴───────────────┐
                                      ▼                               ▼
                        ┌───────────────────────┐      ┌────────────────────────┐
                        │ /extraction (Person A)│      │ /enrichment (Person B) │
                        │ extract_from_image()  │      │ build_full_profile()   │
                        │   → Gemini Vision     │      │   → search + fetch +   │
                        │   → Tesseract fallback│      │     LLM + normalize    │
                        └───────────────────────┘      └────────────────────────┘
```

**The adapter layer is the load-bearing idea.** `backend/adapters.py` is the only
file that knows A's and B's real signatures. If either changes theirs, one file
changes. Nothing in the frontend and nothing in `main.py` moves.

### 5.2 Repo layout (what I add)

```
/shared
  schema.json                  # the locked contract
  mocks/                       # Person B's files — read, never written here
    profile_01_breaker.json
    ...
/backend
  main.py                      # FastAPI app, routes, CORS
  adapters.py                  # ONLY file importing A and B
  assemble.py                  # envelope building, fallback scoring
  mock_store.py                # loads /shared/mocks
  requirements.txt
  .env.example
/frontend
  src/
    api/
      client.js                # fetch wrapper, one response handler
      useScan.js               # the state machine hook
    components/
      UploadPanel.jsx
      ProcessingView.jsx
      ProfileView.jsx
      IdentityHeader.jsx
      CompletenessMeter.jsx
      FieldList.jsx
      FieldRow.jsx
      FieldDetail.jsx
      ConfidenceBadge.jsx
      SourceTag.jsx
      MissingFields.jsx
      StatusBanner.jsx
      ErrorView.jsx
    lib/
      confidence.js            # banding thresholds — ONE source of truth
      fields.js                # prettify, sort, group
      constants.js
    styles/
      tokens.css               # design tokens
      app.css
    App.jsx
    main.jsx
```

### 5.3 Dev topology

- Vite dev server on `:5173`, FastAPI on `:8000`.
- Use **Vite's proxy**, not CORS-in-the-browser, for dev — fewer moving parts:

```js
// vite.config.js
server: { proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } } }
```

Frontend calls `/api/scan`. Also enable permissive CORS on FastAPI anyway, so that
opening the built bundle from a different origin during the demo doesn't break.

---

## 6. Backend implementation

### 6.1 Dependencies

`backend/requirements.txt`:

```
fastapi
uvicorn[standard]
python-multipart      # REQUIRED for file upload — easy to forget, fails at runtime
python-dotenv
-r ../extraction/requirements.txt
```

Run: `uvicorn main:app --reload --port 8000`

### 6.2 `adapters.py` — the isolation layer

Responsibilities, in order:

1. Put `/extraction` and `/enrichment` on `sys.path` (**this hack lives here and
   nowhere else**).
2. Import A and B **lazily inside the functions**, so a missing/broken module
   degrades to a skipped stage instead of preventing the server from booting.
3. Normalize both outputs to the contract.

```python
# backend/adapters.py  (structure, not final code)
import sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "extraction"))
sys.path.insert(0, str(ROOT / "enrichment"))

def run_extraction(image_path: str) -> dict:
    """Returns A's dict. Never raises — always returns a dict with an 'error' key."""
    try:
        from gemini_extract import extract_from_image
        result = extract_from_image(image_path)
    except Exception as e:
        return {"extracted_fields": [], "error": f"extraction unavailable: {e}"}

    if result.get("error"):                      # try the OCR fallback path
        try:
            from ocr_fallback import extract_via_ocr_fallback
            fb = extract_via_ocr_fallback(image_path)
            if not fb.get("error"):
                return fb
        except Exception:
            pass
    return result

def run_enrichment(extraction_result: dict) -> dict | None:
    """Returns B's full profile, or None if B isn't available yet."""
    try:
        from build_profile import build_full_profile
    except Exception:
        return None                              # B not built — the expected case today
    try:
        return build_full_profile(extraction_result, None)
    except Exception:
        return None
```

Note the automatic Gemini → Tesseract fallback. Person A built `ocr_fallback.py`
specifically for the demo-day quota scenario; wiring it here means it actually gets
used instead of sitting unused.

### 6.3 `main.py` — the `/scan` route

```python
@app.post("/scan")
async def scan(image: UploadFile = File(...), mode: str = Form("auto")):
    if mode == "mock":
        return ok(mock_store.random_profile())

    validate(image)                                  # type + size → 400 on failure

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(await image.read())                # A needs a PATH, not bytes
        tmp_path = tmp.name

    persist_for_display(tmp_path, profile_id)        # copy to /uploads for side-by-side

    extraction = adapters.run_extraction(tmp_path)
    if extraction.get("error") and not extraction.get("extracted_fields"):
        return failed(extraction["error"], http=502)

    enriched = None if mode == "extract_only" else adapters.run_enrichment(extraction)
    return assemble.build_envelope(extraction, enriched, profile_id, image.filename)
```

### 6.4 `assemble.py` — fallbacks when B is absent

When `run_enrichment` returns `None`, the backend must still produce a complete
envelope. It computes:

- **`completeness`** — against a static `EXPECTED_FIELDS_BY_CATEGORY` map in
  `/shared/schema.json`, defaulting to a generic industrial-product list of ~17
  fields. `score = round(fields_filled / expected_fields * 100)`.
  Person B owns the authoritative version; this is the stand-in.
- **`missing_fields`** — expected minus present.
- **`confidence_summary`** — counted from field confidences using the *same*
  thresholds as the frontend (Section 8.2). Keep the numbers in `/shared/schema.json`
  so the two implementations can't drift.
- **`identity`** — pulled from the `brand` / `model_number` / `serial_number` fields.
- **`warnings`** — `["Enrichment unavailable — showing label-only data."]`
- **`stages.enrichment`** — `"skipped"`
- **`status`** — `"partial"`

When B does land, this code path stops running. Nothing else changes.

### 6.5 Startup checks

On boot, log a readiness table and expose it at `/health`:

```
GEMINI_API_KEY present ......... yes
extraction module .............. ok
enrichment module .............. NOT FOUND (stage will be skipped)
tesseract binary ............... ok
mocks loaded ................... 6 (from /shared/mocks)
```

The mock count is whatever Person B has dropped in `/shared/mocks` at boot — zero is
a valid reading, not an error.

Ten minutes of work that removes the entire class of "why is it returning nothing"
debugging on integration day.

---

## 7. Frontend architecture

### 7.1 App state machine

One `useScan()` hook owns all of it. No global state library — the app has one
screen's worth of state.

```
        ┌──────────────────────────────────────────────┐
        ▼                                              │
     ┌──────┐  file chosen   ┌──────────┐  submit  ┌────────────┐
     │ idle │ ─────────────► │ previewing│ ───────► │ processing │
     └──────┘                └──────────┘          └─────┬──────┘
        ▲                          │                     │
        │                          │ clear               │
        │                          ▼                     │
        │                       ┌──────┐                 │
        │                       │ idle │                 │
        │                       └──────┘                 │
        │                                    ┌───────────┼───────────┐
        │                                    ▼           ▼           ▼
        │                              ┌─────────┐ ┌─────────┐ ┌────────┐
        └───── "scan another" ──────── │ results │ │ partial │ │ error  │
                                       └─────────┘ └─────────┘ └────────┘
```

`processing` additionally tracks a **stage** (`uploading` → `reading label` →
`enriching`) — timer-driven, not server-driven (Section 9.2).

```js
const {
  status,        // idle | previewing | processing | results | error
  stage,         // uploading | extracting | enriching
  file, previewUrl,
  profile, envelopeStatus, warnings, error,
  selectFile, clearFile, scan, reset, loadMock
} = useScan()
```

### 7.2 Component tree

```
App
├── Header                     (title, mock toggle in dev)
├── UploadPanel                status: idle | previewing
│   ├── DropZone               drag/drop + click + capture="environment"
│   └── PreviewCard            thumbnail, filename, size, Scan / Clear
├── ProcessingView             status: processing
│   └── StageList              3 stages, checked as they pass
├── ProfileView                status: results
│   ├── StatusBanner           only when envelopeStatus === 'partial'
│   ├── IdentityHeader         brand · model · serial · image thumb
│   ├── CompletenessMeter      hero figure + meter + counts
│   ├── FieldList
│   │   └── FieldRow ×N        ← FieldDetail expands beneath
│   │       ├── ConfidenceBadge
│   │       ├── SourceTag
│   │       └── FieldDetail    raw_value, source ref, conflicts, approve/edit
│   └── MissingFields
└── ErrorView                  status: error
```

### 7.3 Component contracts

| Component | Props | Responsibility | Notes |
|---|---|---|---|
| `UploadPanel` | `file, previewUrl, onSelect, onClear, onScan, error` | File choice + validation | Client-side check of type/size **before** upload — instant feedback, saves a round trip |
| `ProcessingView` | `stage, elapsed` | Communicate progress honestly | Never a bare spinner (Section 9.2) |
| `IdentityHeader` | `identity, image` | Brand / model / serial + thumbnail | Model number in `tabular-nums` — it's an alphanumeric code and A's `FINDINGS.md` documents O↔0 confusion, so legibility matters |
| `CompletenessMeter` | `completeness` | Hero figure + meter | Section 8.3 |
| `FieldList` | `fields` | Sort, group, render | Sort order in Section 7.5 |
| `FieldRow` | `field, expanded, onToggle, onApprove, onEdit` | One field, collapsed | Whole row is the toggle target; `aria-expanded` |
| `ConfidenceBadge` | `confidence, size` | Colour + icon + text | Section 8.2 |
| `SourceTag` | `sourceType` | Where the value came from | Neutral chip, never a status colour |
| `FieldDetail` | `field` | `raw_value`, source ref, conflicts | Link only if the ref is a URL |
| `MissingFields` | `missingFields` | What we *don't* know | Visually distinct, clearly not a failure |
| `StatusBanner` | `warnings` | Degraded-mode notice | Amber, dismissible, non-blocking |
| `ErrorView` | `error, onRetry, onLoadMock` | Recovery | Always offers a sample profile as a way forward |

### 7.4 Data layer

`api/client.js` — a single `scanImage(file, mode)`:

```js
export async function scanImage(file, mode = 'auto') {
  const body = new FormData()
  body.append('image', file)
  body.append('mode', mode)
  const res = await fetch('/api/scan', { method: 'POST', body })
  const json = await res.json().catch(() => ({
    status: 'failed', profile: null, error: 'Server returned an unreadable response.'
  }))
  return json                       // envelope in, envelope out — no throwing
}
```

Because the backend returns the same envelope for every status code, **there is no
try/catch and no `res.ok` branching anywhere in the components.** That single
decision removes most error-handling code from the UI.

### 7.5 Utilities (`lib/`)

**`confidence.js`** — the only place thresholds are written:

```js
export const BANDS = { HIGH: 0.85, MEDIUM: 0.60 }

export function band(c) {
  if (c >= BANDS.HIGH)   return 'high'
  if (c >= BANDS.MEDIUM) return 'medium'
  return 'low'
}
```

**`fields.js`**:

```js
prettifyFieldName('rated_voltage')  // → 'Rated Voltage'
                                    // with an OVERRIDES map for acronyms:
                                    // ip_rating → 'IP Rating', hp → 'HP'
isUrl(ref)                          // decides link vs plain text in FieldDetail
sortFields(fields)                  // identity first, then conflicts, then
                                    // ascending confidence, then alphabetical
```

**Sort order rationale:** identity fields first because that's what a human looks
for; then conflicted fields; then *lowest confidence first*. Person A's `FINDINGS.md`
concludes that confidence is a triage signal for human review — so the UI should
surface what needs checking, not bury it below the stuff that's already fine.

---

## 8. Visual design system

### 8.1 Tokens (`styles/tokens.css`)

Plain CSS custom properties. **No Tailwind, no UI library** — nothing is installed
today, and a hackathon demo does not need a build-step dependency it can't debug at
2am. Everything below is one file.

```css
:root {
  color-scheme: light;

  /* surfaces & ink */
  --surface-1:      #fcfcfb;   /* cards */
  --surface-page:   #f9f9f7;   /* page plane */
  --text-primary:   #0b0b0b;
  --text-secondary: #52514e;
  --text-muted:     #898781;
  --hairline:       #e1e0d9;
  --border:         rgba(11,11,11,0.10);

  /* status — FIXED, never themed, never reused for anything decorative */
  --status-good:     #0ca30c;
  --status-warning:  #fab219;
  --status-critical: #d03b3b;

  /* accent (links, primary button) */
  --accent:         #2a78d6;

  /* type */
  --font: system-ui, -apple-system, "Segoe UI", sans-serif;

  /* space — 4px base */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px;

  --radius:    10px;
  --radius-sm: 6px;
}

@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --surface-1: #1a1a19; --surface-page: #0d0d0d;
    --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #898781;
    --hairline: #2c2c2a; --border: rgba(255,255,255,0.10);
    --accent: #3987e5;
    /* status colours are deliberately unchanged — all four clear 3:1 on dark */
  }
}
```

Dark mode is a stretch goal, not Day 1. But defining the tokens now costs nothing
and means enabling it later is one media query rather than a refactor.

### 8.2 Confidence badge

Three states, mapped to the reserved status palette:

| Band | Range | Colour | Icon | Text |
|---|---|---|---|---|
| High | `≥ 0.85` | `--status-good` | ● filled circle | `High · 94%` |
| Medium | `0.60 – 0.84` | `--status-warning` | ▲ triangle | `Medium · 72%` |
| Low | `< 0.60` | `--status-critical` | ◆ diamond | `Low · 41%` |

**Four rules, all non-negotiable:**

1. **Colour never carries the meaning alone.** Every badge shows a shape *and* a word.
   Red/amber/green is the most common colourblind failure in dashboards, and a judge
   may well be red-green colourblind.
2. **Distinct shapes, not three copies of the same dot.** The shape is a real second
   channel only if the shapes differ.
3. **The text is an ink token, never the status colour.** `--status-warning` at
   `#fab219` is 1.79:1 on the light surface — illegible as text. The badge is a
   *tinted pill* (`color-mix(in oklab, <status> 12%, var(--surface-1))`) with a
   solid-coloured glyph and `--text-primary` label.
4. **Never say "verified."** Say "High confidence." Person A's `FINDINGS.md`
   documents a case where the model returned 1.0 confidence on an illegible serial
   number. The UI must not promise correctness the pipeline can't deliver — and
   framing confidence as *triage* rather than *proof* is a stronger pitch anyway.

### 8.3 Completeness meter

**Form decision: a meter, not a gauge and not a donut.** The data is a single ratio
against a limit (fields filled / fields expected). A radial gauge spends a lot of
pixels to encode one number less precisely, and a 2-slice donut is the classic
anti-pattern. A horizontal meter with a hero figure reads instantly and is honest.

```
┌──────────────────────────────────────────────────────────┐
│  Profile completeness                                     │
│                                                           │
│   82%          ████████████████████████░░░░░░░            │
│   ↑ hero                                                  │
│   14 of 17 expected fields · 3 missing                    │
└──────────────────────────────────────────────────────────┘
```

Spec:

| Element | Value |
|---|---|
| Hero figure | ≥ 48px, semibold, system sans, **proportional figures** (not `tabular-nums` — it looks loose at display size). Exactly one hero per view. |
| Track height | 12px, fully rounded ends |
| Fill | severity-coloured by band; 4px rounded data-end; anchored at the left baseline |
| Track colour | a lighter step of the fill's own ramp: `color-mix(in oklab, var(--meter-fill) 16%, var(--surface-1))` — so the state reads across the whole bar |
| Sub-label | `--text-secondary`, "14 of 17 expected fields · 3 missing" |
| Transition | fill width animates 400ms `ease-out` on mount — the one piece of motion in the app |

Fill colour by band (fill carries severity):

| Score | Fill |
|---|---|
| ≥ 80 | `--status-good` |
| 50 – 79 | `--status-warning` |
| < 50 | `--status-critical` |

No border around the fill — the rounded end and the tinted track do the separating.

### 8.4 Field row and expand panel

Collapsed (the default, and 90% of what a judge sees):

```
┌──────────────────────────────────────────────────────────────────┐
│  Rated Voltage            48 V        ● High · 94%   [On the label] ▸│
├──────────────────────────────────────────────────────────────────┤
│  Rated Current            3150 A      ▲ Medium · 72% [Datasheet]   ▸│
├──────────────────────────────────────────────────────────────────┤
│  IP Rating                IP54  ⚠2    ◆ Low · 41%    [Distributor] ▸│
└──────────────────────────────────────────────────────────────────┘
```

- Rows separated by a 1px `--hairline`, not boxes. Less ink, easier scanning.
- `⚠2` appears only when `conflicting_values.length > 0` — the count of alternates.
- The whole row is the click target, min-height 48px (thumb-friendly).

Expanded:

```
│  ▾ Rated Voltage          48 V        ● High · 94%   [On the label]  │
│    ┌──────────────────────────────────────────────────────────────┐ │
│    │ As printed on label:  "48V"                                  │ │
│    │ Source:               Manufacturer datasheet ↗               │ │
│    │                                                              │ │
│    │ Conflicting values found:                                    │ │
│    │   50 V   Distributor listing ↗          ▲ Medium · 71%       │ │
│    │                                                              │ │
│    │                              [ Approve ]  [ Edit value ]     │ │
│    └──────────────────────────────────────────────────────────────┘ │
```

- **`raw_value` is always shown, even when identical to `value`.** The whole
  traceability pitch is "you can see exactly what was on the label" — hiding it when
  it happens to match undercuts that.
- `source_reference` renders as a link only when `isUrl()` passes. Person A's refs
  are the literal string `"photo label"`, so this branch fires on day one.
- Conflicts are listed, never discarded — matches Person B's contract, and it's the
  single most convincing thing in the demo.

### 8.5 Layout & responsive

- Single column, `max-width: 880px`, centred. This is a phone-first product — a
  wide dashboard grid would be dishonest about the use case.
- ≥ 900px: optional two-column split, photo left (sticky) / profile right. This is
  the "before/after" view the roadmap flags as a strong visual for judges. Build it
  Day 8 **only if Days 1–7 are done.**
- < 600px: single column, image collapses to a 64px thumbnail in the header.
- Touch targets ≥ 44px throughout.

### 8.6 Accessibility rules

- Status colour + shape + text, always (Section 8.2).
- `ProcessingView` uses `aria-live="polite"` so stage changes are announced.
- Expandable rows are `<button>` with `aria-expanded` / `aria-controls`, keyboard
  operable, visible focus ring.
- The completeness meter carries `role="meter"` with `aria-valuenow/min/max` and an
  `aria-label`; the visible sub-label is the text alternative.
- Every image has a real `alt`; the uploaded photo's alt is the filename.

---

## 9. Screen-by-screen

### 9.1 Upload

Single centred card. Large drop zone with a camera icon.

- `<input type="file" accept="image/*" capture="environment">` — on a phone, that
  opens the camera directly. Worth having for the live demo.
- Drag-and-drop, click-to-browse, and paste (`onPaste` from clipboard) all wired.
- Client-side validation before upload: type in {jpg, png, webp}, size ≤ 10 MB.
- Below the drop zone: **"Or try a sample"** — 3 thumbnails from Person A's
  `test_images/`. This is the demo safety net and also makes the app self-explanatory
  to a judge who walks up to it cold.

### 9.2 Processing

**Not a spinner.** Realistic latency is 5–20s for extraction (a Gemini file upload
*plus* a generate call) and potentially 10–30s more for enrichment (search + fetch
2–3 pages + an LLM call). A bare spinner for 40 seconds reads as "it's broken."

```
        ┌────────────────────────────────┐
        │   [thumbnail of your photo]    │
        │                                │
        │   ✓  Uploading image           │
        │   ◐  Reading label             │
        │   ○  Enriching from sources    │
        │                                │
        │   Usually takes 10–30 seconds  │
        └────────────────────────────────┘
```

- Stages advance on a timer (not from the server) — a real progress channel would
  need SSE/websockets, which is not worth the complexity here. The timing is tuned to
  observed latency; if the response arrives early, jump straight to results.
- Show the user's own photo throughout. It confirms the right image was picked and
  makes the wait feel shorter.
- After 45s, add "Still working — the model is being slow." After 90s, offer cancel.

### 9.3 Results

Order top to bottom:

1. `StatusBanner` (only when `partial`)
2. `IdentityHeader` — brand, model, serial, thumbnail
3. `CompletenessMeter` — the hero figure
4. `FieldList` — sorted per Section 7.5
5. `MissingFields`
6. "Scan another" button

**Missing fields get real estate, deliberately.** Rendered as neutral chips under a
"Not found" heading with the line *"These are expected for this product category but
weren't on the label or in any source we checked."* Knowing what you don't know is
part of the product's value, and showing it is more credible than hiding it.

### 9.4 Edge states

| Case | Trigger | UI |
|---|---|---|
| Enrichment skipped | `stages.enrichment !== 'ok'` | Amber banner: "Showing label data only — enrichment unavailable." Everything else renders normally |
| Nothing readable | `fields.length === 0` | Empty state, the photo, "We couldn't read any details from this image", tips (get closer, avoid glare, hold steady), **Try again** + **Use a sample** |
| Broadly low confidence | `confidence_summary.overall < 0.5` | Banner above the meter: "Low confidence across most fields — review before use." Not an error; the data still shows |
| Blurry / glare | `image.quality_flag !== 'clear'` | Small chip beside the thumbnail: "Image quality: blurry". Explains low confidence rather than leaving the user to guess |
| Quota exhausted | 502 | "The vision service is busy." Two buttons: **Retry** and **Use a sample profile** |
| Network down | fetch rejects | Same shape as above, different copy |

Every failure state offers a route forward. None is a dead end — on stage, a dead
end is the demo ending.

### 9.5 Review & edit (optional — Day 10, only if ahead)

Per-field **Approve** and **Edit value** in the expand panel. Approved fields get a
subtle check on the row; edited fields show "edited" and keep `raw_value` visible.
State is client-side only, never persisted.

This is small to build and it directly answers the question `FINDINGS.md` raises —
the model is sometimes confidently wrong, so a human confirmation step is the honest
product answer. Worth 45 minutes if they're available; cut it without regret if not.

---

## 10. Mock data strategy

**Person B owns the mock files. Person C never writes one.** They land in
`/shared/mocks/*.json`; `backend/mock_store.py` reads that directory at startup and
serves whatever is there. Nothing in this scope authors, seeds, or vendors a copy.

That split is deliberate: the mocks double as Person B's enrichment fixtures, so a
second hand-written set on the frontend side would drift the moment B tunes a
confidence score, and the demo would be showing numbers no longer produced by the
pipeline.

What Person C guarantees instead:

- **The directory can be empty.** `mock_store.py` treats zero files as a normal
  state — `/api/mocks` returns `{mocks: [], available: false}` and the UI hides the
  sample-profile row rather than rendering a broken one.
- **Any valid profile renders.** The UI is driven by the envelope's shape, not by
  known ids, so a mock added an hour before the demo needs no frontend change.
- **Filenames are the ids.** `profile_01_breaker.json` → `GET /api/mocks/profile_01_breaker`.
  No registry to keep in sync.

Coverage worth requesting from Person B, since each one exercises a distinct UI
path that is otherwise untested:

| Profile | What it exercises in the UI |
|---|---|
| Happy path, high confidence, 90+ score | The baseline everyone sees first |
| Dense label, 20+ fields | List density and scrolling |
| 3 conflicting fields across sources | The provenance panel — the money shot |
| Low completeness (~35%) | Long `missing_fields` list, "Not found" block |
| Mostly low confidence, `quality_flag: "blurry"` | Warning banner + review filter |
| 2 fields, `status: partial` | Degraded mode with enrichment empty |
| Non-Latin `raw_value` | Text overflow in the detail panel |
| `status: failed`, `profile: null` | `ErrorView` with a recovery path |

Every mock should validate against `/shared/schema.json` (Section 3) — that schema
is the same contract the live pipeline fills, which is what keeps mock mode and real
mode indistinguishable to the UI.

Dev toggle: `VITE_USE_MOCKS=true` makes `client.js` hit `/api/mocks/*` for every
scan, so the frontend demos end-to-end with extraction and enrichment switched off.

---

## 11. Build plan

Roadmap days, adjusted for the actual state (A done, B not started, no `/shared`).

### Day 1 — Contract + skeleton

- [ ] Write `/shared/schema.json`; get explicit sign-off from A and B; **freeze it**
- [ ] Request the first 3 mocks from Person B (happy, conflicts, failure) — until
      they land, develop against an inline fixture, not a checked-in file
- [ ] Strip the Vite boilerplate out of `App.jsx`; add `tokens.css`
- [ ] `useScan()` state machine with a hardcoded fixture — full flow, no styling

**Done when:** click "scan" → fake delay → mock profile renders as unstyled text.
The whole app's control flow is proven on day one.

### Day 2–3 — Upload flow

- [ ] `UploadPanel`: drop zone, click, paste, `capture="environment"`
- [ ] Client-side validation + inline errors
- [ ] `PreviewCard` with thumbnail
- [ ] `ProcessingView` with staged progress
- [ ] Sample picker, driven by whatever `/api/mocks` currently lists

### Day 4–6 — The profile view (the core of the product)

- [ ] `IdentityHeader`
- [ ] `CompletenessMeter` to spec (Section 8.3)
- [ ] `ConfidenceBadge` + `confidence.js`
- [ ] `FieldRow` collapsed, `FieldDetail` expanded
- [ ] Conflicting values rendering
- [ ] `SourceTag`
- [ ] `MissingFields`
- [ ] `fields.js` (prettify + sort)

**Done when:** every mock Person B has delivered renders correctly, including the
ugly ones.

### Day 7 — Backend

- [ ] `/backend` scaffold, FastAPI, CORS, Vite proxy
- [ ] `POST /scan` returning a mock — wire the real network path end to end
- [ ] `/health`, `/mocks`, `/uploads`
- [ ] `adapters.py` + `assemble.py` written against A's **real** signature
- [ ] **Call Person A's `extract_from_image` for real, today.** A is finished — there
      is no reason to wait until Day 12 to find out how it behaves over HTTP.

Doing the real extraction wiring on Day 7 instead of Day 12 is the single highest-value
deviation from the roadmap. It converts integration day from discovery into confirmation.

### Day 8–9 — Polish

- [ ] Responsive down to 360px
- [ ] Two-column photo/profile split at ≥900px
- [ ] Loading and error visuals
- [ ] Focus rings, `aria-*`, keyboard pass
- [ ] Empty and low-confidence states

### Day 10 — Edge states + optional review

- [ ] All edge cases from Section 9.4, forced via mocks
- [ ] Approve/Edit if time allows

### Day 11 — Freeze + demo script

- [ ] Feature freeze
- [ ] Demo narrative (Section 13)
- [ ] Production build test (`npm run build && npm run preview`)

---

## 12. Integration (Days 12–13)

Order matters — one variable at a time:

1. **A alone.** Real image → `/scan` with `mode=extract_only`. Confirm the UI renders
   a label-only profile. (Should already pass from Day 7.)
2. **B standalone.** Feed B a saved A output as a JSON file; confirm B's return
   validates against `/shared/schema.json` **before** wiring it into the server.
3. **A → B chained.** Full pipeline. Watch for:
   - Field name collisions between A and B (same spec, different `field_name`) —
     resolve by having B merge into A's key, never duplicate the row
   - B rewriting `value` but clobbering `raw_value` — a contract violation, catch it
   - Total latency; if > 60s, run enrichment on the top-N fields only
4. **Full test set.** All of A's test images through the live app.
5. **Measure end-to-end**, not per component. That's the number to quote.

**Integration debug tooling** — build these on Day 7, not Day 12:
`/health` for stage readiness, and a `?debug=1` query param that renders the raw
envelope JSON below the profile. Both take minutes and save hours.

---

## 13. Demo script

**Framing (1 sentence):** *"Snap a photo of any industrial nameplate and get a
complete, sourced product profile — with every field traceable back to where it came
from."*

**Run of show (~3 min):**

1. **Problem, 15s.** A nameplate photo on screen. "Someone types this into a
   spreadsheet by hand today, and half the specs aren't even on the label."
2. **Live scan, 45s.** Photograph a real object. Talk through the staged progress —
   the wait becomes part of the story rather than dead air.
3. **The profile, 60s.** Completeness score first. Then expand a high-confidence
   field — "this came off the label, here's exactly what was printed." Then expand
   the **conflicting** field — "two sources disagreed; we kept the manufacturer's
   value and we kept the receipt on the other one." *This is the moment that wins it.*
4. **Missing fields, 15s.** "It also tells you what it doesn't know."
5. **Numbers, 20s.** ~75–78% field-level accuracy across 11 real nameplates, plus
   the end-to-end number from Day 12.
6. **Honesty beat, 15s.** "The model is sometimes confidently wrong — we found a case
   where it read an illegible serial at full confidence. That's why confidence drives
   review triage instead of being presented as proof." Judges reward this.
7. **Impact, 20s.** Manual entry time → seconds; every field traceable to a source.

**Safety net, non-negotiable:**

- Backup video of a successful full run, recorded Day 14
- `mode=mock` reachable in one click if any API fails on stage
- The 3 demo objects pre-tested that morning on the actual demo network
- Hotspot as wifi backup

### Failure playbook

| If this happens on stage | Do this |
|---|---|
| Scan takes > 45s | Keep narrating the pipeline stages — the UI is designed for exactly this |
| Extraction fails | Click "Use a sample" — recover in one click, no dead air |
| Wifi dies | Switch to hotspot; if that fails, play the backup video |
| Bad extraction on the live object | Lean in: "this is the O-vs-0 confusion we documented — and it's why there's a review step" |

---

## 14. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Person B doesn't finish | Medium | High | Enrichment is strictly additive. The app is complete and demo-able without it (Section 4.4) |
| Gemini daily quota hit mid-demo | Medium | High | `ocr_fallback` auto-wired in `adapters.py`; `mode=mock`; second API key on a second Google account |
| Latency > 60s end to end | Medium | Medium | Staged progress UI; `extract_only` fast path; cap enrichment fetches at 2 pages |
| Field-name collisions A vs B | High | Medium | B merges into A's `field_name`, never appends a duplicate row. Agree this **before** Day 12 |
| Schema drift after freeze | Medium | High | `/shared/schema.json` is the single source of truth; mocks validate against it; changes need a team sync |
| Frontend blocked on backend | Low | Medium | `VITE_USE_MOCKS=true` runs the whole UI with the server off |
| Confident-but-wrong extraction shown as fact | High | High (credibility) | Never the word "verified"; confidence framed as triage; `raw_value` always visible |

---

## 15. Definition of done

**Contract**
- [ ] `/shared/schema.json` exists, is signed off by A and B, and is frozen
- [ ] Person B's mocks exist in `/shared/mocks/` and validate against it

**Backend**
- [ ] `POST /scan` returns the envelope for every outcome, including failures
- [ ] Works with extraction only (enrichment absent) — no crashes, no missing keys
- [ ] `mode=mock` works with zero API keys
- [ ] OCR fallback fires automatically when Gemini fails
- [ ] `/health` reports stage readiness

**Frontend**
- [ ] Full flow works against mocks with the backend switched off
- [ ] Full flow works against the live backend
- [ ] Every delivered mock renders correctly, including conflicts and the failure case
- [ ] Every edge state in Section 9.4 has been seen with my own eyes
- [ ] Confidence never communicated by colour alone
- [ ] Keyboard navigable; visible focus; meter and live regions labelled
- [ ] Usable at 360px width
- [ ] `npm run build` succeeds and the preview build works

**Demo**
- [ ] 3 objects pre-tested on the demo network
- [ ] Backup video recorded
- [ ] Rehearsed twice, timed
- [ ] Failure playbook practised at least once
