# Saviynt Zuma × DigiCert MPKI — POC Status

**Last stable commit:** `ebb351a`  
**Branch:** `main` (local only — GitHub remote not yet configured)  
**To restore to this state:** `git reset --hard ebb351a`

---

## What This Is

A proof-of-concept integrating Saviynt's **Zuma** NHI governance platform with **DigiCert Trust Lifecycle Manager (MPKI)**. It demonstrates the NHI certificate lifecycle stories: inventory visibility, ownership assignment, issuance, and remediation (revoke / reissue / cancel).

The app is a **Flask API** (port 5000) serving a **React + Vite + Tailwind** SPA from `/static`. The React frontend is built with `npm run build` from `frontend/` — output lands in `static/`.

---

## How to Run

```bash
# Terminal 1 — Flask API
cd /Users/baber.amin/projects/digicert-poc
source .venv/bin/activate      # or: .venv/bin/python3 app.py
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
| Real BU UUID | `839315b4-fc5a-4d72-9537-b72746637433` (Engineering) |

### Critical DigiCert API Discoveries

- **`attributes` must not be empty** — every enrollment requires `{"subject.common_name": "<value>"}` (dotted-path format, not plain `"common_name"`).
- **GenPrivateCA issues empty-subject certs** — DigiCert returns `common_name: null` in all cert metadata for this profile. The CN the user enters is stored as the **seat_id**, not in the X.509 subject.
- **Certificate-search default scope** excludes GenPrivateCA / private-CA certs. The backend works around this by making two requests: one default + one filtered by `profile_id=PROFILE_ID`, then merging by serial number.
- **Pagination via `page=N`** does NOT work as expected on this tenant — adding `page=1` as a query param reduces results (DigiCert treats unknown params as filters). Do not add pagination params to the search request.
- **`per_page=200`** is also ignored. The default search returns ~20 certs. Larger result sets require the dual-request merge pattern above.

---

## File Structure

```
digicert-poc/
├── app.py                  # Flask factory, blueprint registration, error handlers
├── digicert_client.py      # Thin HTTP wrapper (get/post/put/delete) + API key header
├── .env                    # DIGICERT_API_KEY, DIGICERT_BASE_URL (not committed)
├── owner_assignments.db    # SQLite — local owner assignments (serial → owner name)
├── requirements.txt
├── routes/
│   ├── certificates.py     # /api/certificates, /api/certificates/issue, /api/profiles
│   ├── ownership.py        # /api/business-units, /api/seats + DEMO_BUSINESS_UNITS list
│   ├── remediation.py      # /api/certificates/<serial>/revoke|reissue|cancel
│   ├── owner_store.py      # /api/certificates/<serial>/assign-owner, /api/owner-assignments
│   └── users.py            # /api/users (mock user list for owner assignment UX)
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
    │       ├── SidePanel.tsx       # Slide-in panel shell used by all detail/action panels
    │       ├── Chip.tsx            # Status badge
    │       └── PageHeader.tsx
    └── vite.config.ts       # Proxy: /api/* → http://127.0.0.1:5000
```

---

## What Is Working

### Certificate Inventory (`/inventory`)
- Loads certs from DigiCert on page load (default search + GenPrivateCA profile merge)
- **Filters — all local, no extra API calls:**
  - **Search** — text match across `common_name`, `seat_id`, `subject.common_name`, `serial_number`, SAN DNS names; also fires a debounced `seat_id` query to DigiCert (500ms) and merges any new certs into the list without replacing existing ones
  - **Status** — derived from actual DigiCert status values in loaded data (`issued` → "Active", etc.)
  - **Business Unit** — shows preconfigured `DEMO_BUSINESS_UNITS` list; Engineering (real UUID) filters real DigiCert certs; synthetic BUs (DevOps, Finance, etc.) show 0 results (demo limitation)
  - **CA** — derived from `ca_vendor ?? issuing_ca_name ?? ica.name ?? issuer.common_name` across loaded certs
  - **Owner** — derived from `seat.user_name` (DigiCert) + local SQLite assignments
- **Table columns:** Common Name (falls back to seat_id for empty-CN certs), CA Vendor, Business Unit, Owner, Status, Valid To, Valid From, Quantum Safe
- Pagination (20 / 50 / 100 rows)

### Issue Certificate Panel
- Form: Common Name (required), SAN DNS names, Business Unit, Owner, validity preview (5 days — fixed by profile)
- Backend generates RSA-2048 key + CSR, enrolls via GenPrivateCA profile
- All BU selections (including synthetic demo IDs) resolve to the real DigiCert BU via `resolve_bu_id()`
- Issued cert appears **immediately** at top of inventory (no refetch needed) — built from POST response + selected BU
- Private key shown in panel with Show/Hide toggle; user is warned it is not persisted
- Empty CN display: uses the seat_id (= Common Name input) as the display name

### Ownership Assignment
- "Assign Owner" panel with AI-style recommendation engine (matches by business unit, adjacent depts, confidence score)
- Searchable user dropdown
- Owner saved to local SQLite (`owner_assignments.db`) — visible immediately in inventory
- DigiCert write-back not yet implemented (notice shown in panel)

### Remediation
- **Revoke** — PUT to DigiCert revoke endpoint with reason; cert status updated in UI
- **Revoke & Reissue** — issues new cert then revokes old
- **Cancel** — for pending certs

---

## Known Limitations / To-Do

- **BU filter — synthetic IDs don't match** — DevOps, Finance, etc. are demo-only IDs. All DigiCert certs map to Engineering (real UUID). Only Engineering filter shows results.
- **GitHub remote not set up** — commits are local only.
- **Findings page** — currently uses mock data, not wired to DigiCert.
- **Overview / KPI dashboard** — mock data only.
- **Reissue is partially broken** — the reissue endpoint tries to copy `common_name` from the old cert, but GenPrivateCA certs have `common_name: null`. Needs rework for empty-CN certs.
- **DigiCert write-back for owner assignment** — owner is saved locally but not synced to DigiCert's seat API.
- **Search only finds loaded certs locally** — the debounced seat_id search appends certs but there's no "load all" capability; certs from very large tenants may not all surface.
- **No ACME client** — discussed but not implemented; DigiCert demo tenant does support ACME.
