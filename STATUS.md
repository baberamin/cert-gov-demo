# Saviynt Zuma × DigiCert MPKI — POC Status

**Branch:** `main` (local only — GitHub remote not yet configured)

---

## What This Is

A proof-of-concept integrating Saviynt's **Zuma** NHI governance platform with **DigiCert Trust Lifecycle Manager (MPKI)**. It demonstrates the NHI certificate lifecycle stories: inventory visibility, ownership assignment, issuance, and remediation (revoke / reissue / cancel).

The app is a **Flask API** (port 5000) serving a **React + Vite + Tailwind** SPA from `/static`. The React frontend is built with `npm run build` from `frontend/` — output lands in `static/`.

---

## How to Run

```bash
# Terminal 1 — Flask API
cd /Users/baber.amin/projects/digicert-poc
source .venv/bin/activate
python app.py                  # runs at http://127.0.0.1:5000

# Terminal 2 — Frontend dev (hot reload)
cd frontend
npm run dev                    # proxies /api/* to Flask at :5000

# OR: build once and serve through Flask
cd frontend && npm run build   # outputs to ../static/
# then just run Flask — it serves static/index.html for all non-API routes
```

---

## DigiCert Tenant Details

| Item | Value |
|---|---|
| Base URL | `https://demo.one.digicert.com` |
| API key | In `.env` as `DIGICERT_API_KEY` (never commit) |
| Profile | **GenPrivateCA** — `23d9643d-5be3-4e0c-9814-b6504ec6c251` |
| Profile auth | `rest_api` + `third_party_app` |
| Engineering BU UUID | `839315b4-fc5a-4d72-9537-b72746637433` |
| Account ID | Pulled dynamically from the Engineering BU at sync time |

### All 8 Demo BUs now exist in DigiCert (real UUIDs in `bu_ids.json`)

| BU Name | DigiCert UUID |
|---|---|
| Engineering | `839315b4-fc5a-4d72-9537-b72746637433` |
| DevOps & Infrastructure | `b5d741be-4882-4b1b-a7db-7d0e00bf45ed` |
| Finance & Accounting | `2a6bfcaa-c56c-4b73-8631-dd764d85e758` |
| Marketing & Growth | `771275a1-b544-4d46-8696-c2889a56addd` |
| Legal & Compliance | `1d76a7f6-2237-48eb-848f-2044f189d181` |
| Information Security | `77674c07-ec3f-4b7b-8f29-dbe3f54218c6` |
| Product Management | `458270f4-ccdb-4b20-bedc-c03a23c3b0d7` |
| Human Resources | `61442c07-8bbf-4f1f-9e47-cbae8f2b6c2d` |

### Critical DigiCert API Discoveries (from OpenAPI spec audit)

- **Certificate search is GET** with `limit` (max 100) and `offset` — NOT `page`/`per_page`. Adding unknown params acts as a filter.
- **Pagination:** Use `limit=100&offset=0`, increment offset while `has_more: true`. Backend now paginates up to 500 certs (5 pages).
- **BU is NOT set at enrollment** — `business_unit` field in `CertificateRequest` is invalid and silently ignored. BU is determined by the **seat's BU membership**.
- **Correct BU assignment flow:** Create/move the DigiCert seat into the target BU *before* enrolling the cert → cert inherits BU from seat.
- **`attributes` dotted-path** — We send `{"subject.common_name": value}`. Spec says nested `{subject: {common_name: value}}` but DigiCert accepts both. Left as-is.
- **Reissue endpoint** is `POST /mpki/api/v1/certificate/{serial}/renew` (not re-posting to `/certificate`).
- **Revoke** is `PUT /mpki/api/v1/certificate/{serial}/revoke` with `{revocation_reason: "..."}`.
- **Cancel** — no cancel endpoint exists for this profile. `DELETE /revoke` means *resume suspended*, not cancel. Backend returns 501.
- **`seat.user_name` does not exist** in DigiCert responses — the field is `seat_name`. Owner always comes from local SQLite or DigiCert seat write-back.
- **POST /business-unit requires `account.id`** — fetched from the Engineering BU at sync time.

### Seat = Owner in DigiCert's model

A DigiCert "seat" is a licensed identity slot:
- `seat_id` = the cert/service identifier (e.g. `svc-auth.internal`)
- `seat_name` = human-readable owner name
- `email` = owner email
- `business_unit_id` = which BU this seat belongs to

Assigning an owner in Saviynt → `PUT /mpki/api/v1/seat/{seat_id}` with `seat_name` + `email`.
Owner query → `GET /certificate-search?cert_owners=email`.

---

## File Structure

```
digicert-poc/
├── app.py                  # Flask factory, blueprint registration, error handlers
├── digicert_client.py      # Thin HTTP wrapper (get/post/put/delete) + API key header
├── .env                    # DIGICERT_API_KEY, DIGICERT_BASE_URL (not committed)
├── bu_ids.json             # Real DigiCert BU UUIDs (persisted after sync)
├── requirements.txt
├── routes/
│   ├── certificates.py     # /api/certificates (paginated), /api/certificates/issue, /api/profiles
│   ├── ownership.py        # /api/business-units, /api/business-units/sync, /api/seats
│   │                       # + ensure_seat_exists(), update_seat_owner() helpers
│   ├── remediation.py      # /api/certificates/<serial>/revoke|reissue|cancel
│   ├── owner_store.py      # /api/certificates/<serial>/assign-owner, /api/owner-assignments
│   │                       # writes back to DigiCert seat API on owner assignment
│   └── users.py            # /api/users (50 mock users across 5 depts, Marvel/Disney)
└── frontend/
    ├── src/
    │   ├── api.ts           # All fetch calls + Cert/BusinessUnit/User TypeScript interfaces
    │   ├── App.tsx          # Router shell (3 routes: /, /inventory, /findings)
    │   ├── pages/
    │   │   ├── InventoryPage.tsx   # Main page — table, filters, side panels
    │   │   ├── OverviewPage.tsx    # KPI dashboard (mock data)
    │   │   └── FindingsPage.tsx    # Findings/risk view (mock data)
    │   └── components/
    │       ├── Sidebar.tsx
    │       ├── SidePanel.tsx
    │       ├── Chip.tsx
    │       └── PageHeader.tsx
    └── vite.config.ts       # Proxy: /api/* → http://127.0.0.1:5000
```

---

## What Is Working

### Certificate Inventory (`/inventory`)
- Loads up to 500 certs via paginated `GET /certificate-search?limit=100&offset=N`
- Dual-request merge: default search + GenPrivateCA profile filter (merges by serial)
- **Filters — all local after load:**
  - **Search** — text match across `common_name`, `seat_id`, `subject.common_name`, `serial_number`, SAN DNS names; debounced `seat_id` query merges new certs without replacing state
  - **Status** — derived from DigiCert status values (`issued` → "Active", etc.)
  - **Business Unit** — all 8 BUs now have real DigiCert UUIDs; filter works for certs issued via our app
  - **CA** — derived from `ca_vendor ?? issuing_ca_name ?? ica.name ?? issuer.common_name`
  - **Owner** — from `seat.seat_name` (DigiCert) + local SQLite assignments
- **Table columns:** Common Name, CA Vendor, Business Unit, Owner, Status, Valid To, Valid From, Quantum Safe
- Pagination (20 / 50 / 100 rows)

### Issue Certificate Panel
- Fields: Common Name (required), Seat ID (optional, defaults to CN — reuses existing DigiCert seat), SAN DNS names, Business Unit, Owner, validity preview (5 days fixed by profile)
- Backend: before enrolling, creates/moves the DigiCert seat into the selected BU (`POST /seat`)
- Issued cert appears immediately at top of inventory (no refetch)
- Private key shown with Show/Hide toggle; user warned it is not persisted
- If owner selected at issuance: seat is updated with owner name/email in DigiCert

### Business Unit Sync
- **"Sync BUs" button** in inventory toolbar
- `POST /api/business-units/sync` → idempotent: fetches existing DigiCert BUs, creates any missing ones, saves real UUIDs to `bu_ids.json`
- All 8 demo BUs now exist in DigiCert with real UUIDs
- BU filter in inventory works for certs issued under these BUs

### Ownership Assignment
- "Assign Owner" panel with AI-style recommendation (matches by BU → department, substring match handles "DevOps & Infrastructure" → "DevOps" users)
- Confidence scoring: High (exact BU dept match), Medium (adjacent dept), Low (all users)
- Owner saved to local SQLite **and** written back to DigiCert via `PUT /seat/{seat_id}` with `seat_name` + `email`
- Owner visible immediately in inventory

### Remediation
- **Revoke** — `PUT /mpki/api/v1/certificate/{serial}/revoke` with reason; status updated in UI
- **Revoke & Reissue** — `POST /certificate/{serial}/renew` (correct renew endpoint) then revoke old cert
- **Cancel** — returns 501 (no cancel endpoint exists in DigiCert API for this profile)

---

## Key Architectural Decisions

### DigiCert Cert BU = Profile BU, Not Seat BU (confirmed empirically 2026-10-14)

When a cert is issued, DigiCert files it under the **profile's** business unit — not the seat's. Every cert issued with our "Private Server Certificate 199 Days" profile will appear under "Engineering" in DigiCert, regardless of which BU the seat belongs to.

**Evidence:** Cert with `seat_id = prod1.xyc.com` had its seat in Finance & Accounting but the cert showed `business_unit: Engineering`.

**Attempted fix:** Updating the profile's `allowed_list` via the DigiCert API (PUT `/mpki/api/v1/profile/{id}`) was investigated. The `allowed_list` field is not in the `PublicProfileRequest` schema (confirmed from OpenAPI spec) and only affects SSP/UI visibility, not cert BU assignment.

**Actual fix:** BU selection is tracked locally in SQLite (`bu_assignments` table). On inventory load, `GET /api/bu-assignments` overlays the local BU over DigiCert's `business_unit` field. The BU filter and detail panel both use the merged effective BU. New certs persist their BU to SQLite immediately after issuance.

**Implication for future work:** To truly enforce BU-scoped cert issuance in DigiCert, a separate profile per BU would be needed (each profile has one home BU). For the Saviynt NHI governance demo, local BU tracking is the right model anyway — Saviynt is the governance layer that owns BU attribution.

---

## Known Limitations / To-Do

- **GitHub remote not set up** — commits are local only.
- **Findings page** — mock data, not wired to DigiCert.
- **Overview / KPI dashboard** — mock data only.
- **BU filter for pre-existing certs** — only certs issued via our app (with seat in the right BU) filter correctly. Existing DigiCert tenant certs mostly show under Engineering.
- **Cancel not supported** — DigiCert has no cancel endpoint for GenPrivateCA pending requests; UI button shows error.
- **Search only finds loaded certs locally** — debounced seat_id search appends certs but there is no "load all" capability for very large tenants.
- **No ACME client** — DigiCert demo tenant supports ACME but not yet implemented.
- **Information Security / Product / HR BUs** have no users in the mock user table — recommendations for certs in those BUs fall to Low confidence.
