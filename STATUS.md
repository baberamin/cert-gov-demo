# Saviynt Zuma × DigiCert MPKI — POC Status

**Repo:** https://github.com/baberamin/cert-gov-demo (`main`). Setup and demo steps are in `README.md`; the demo script is `cert-gov demo talk track.md`.

---

## What This Is

A proof-of-concept integrating Saviynt's **Zuma** NHI governance platform with **DigiCert Trust Lifecycle Manager (MPKI)**. It shows certificate governance by exception: certificates are approved automatically by rule, and only exceptions reach a person, with the reason, a recommended owner, and the evidence behind it. It also covers the basic lifecycle: inventory visibility, issuance, ownership, and remediation (revoke / reissue).

The app is a **Flask API** (port 5001) serving a **React + Vite + Tailwind** SPA from `/static`. The React frontend is built with `npm run build` from `frontend/` — output lands in `static/`, which is committed.

---

## How to Run

```bash
make setup                       # venv, pip install, npm install, build the frontend
make run                         # http://127.0.0.1:5001 (needs DIGICERT_API_KEY in .env)
make demo-reset                  # put the demo back to a known starting point (ARGS=--dry-run to preview)
make test                        # pytest
```

Hot-reload frontend development: run Flask (`make run`), then in `frontend/` run `npm run dev` (Vite proxies `/api/*` to `127.0.0.1:5001`).

Port 5001, not 5000: macOS AirPlay Receiver holds 5000.

---

## DigiCert Tenant Details

| Item | Value |
|---|---|
| Base URL | `https://demo.one.digicert.com` |
| API key | In `.env` as `DIGICERT_API_KEY` (never commit); each user brings their own |
| Profile | **Private Server Certificate 199 Days** — `85d4bc85-d567-4a3e-a832-dc1b770e1e52` (hard-coded as `PROFILE_ID` in `routes/certificates.py`) |
| Profile auth | `rest_api` + `third_party_app` |
| Engineering BU UUID | `839315b4-fc5a-4d72-9537-b72746637433` |
| Account ID | Pulled dynamically from the Engineering BU at sync time |

The profile's third-party auth is tied to the user who set it up, so certs issued by another person's API key are still issued under that identity. Cloning the profile per user is the proper fix and is not done yet.

### All 8 Demo BUs exist in DigiCert (real UUIDs in `bu_ids.json`)

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

### Critical DigiCert API Discoveries

- **Certificate search is GET** with `limit` (max 100) and `offset` — NOT `page`/`per_page`. Adding unknown params acts as a filter.
- **Pagination must be unbounded.** Increment offset while `has_more: true`. Expired certs sort first and the tenant holds hundreds, so any page cap silently hides active certs (an old 5-page cap hid ~230 of them). `_fetch_all_certs` fetches pages in parallel until DigiCert reports no more.
- **`common_name` is often null** for private-CA certs; the name is in `subject.common_name` or, failing that, the seat id.
- **Search results never include the seat owner's name** — `seat` contains only `seat_id`.
- **Seat read/update require a business unit** (`business_unit_id`) and seats are unique per BU, so two seats can share an identifier. An update without it returns HTTP 400.
- **BU is NOT set at enrollment** — `business_unit` in `CertificateRequest` is silently ignored. BU comes from the **seat's BU membership**, but DigiCert still files the cert under the *profile's* BU (see Architectural Decisions).
- **`attributes` dotted-path** — We send `{"subject.common_name": value}`. Spec says nested `{subject: {common_name: value}}` but DigiCert accepts both. Left as-is.
- **Reissue** is a fresh enrollment (`POST /mpki/api/v1/certificate`) followed by a revoke of the old cert. `/certificate/{serial}/renew` is not used: it is blocked until 30 days before expiry.
- **Revoke** is `PUT /mpki/api/v1/certificate/{serial}/revoke` with `{revocation_reason: "..."}`.
- **Cancel** — no cancel endpoint exists for this profile. `DELETE /revoke` means *resume suspended*, not cancel. Backend returns 501.
- **POST /business-unit requires `account.id`** — fetched from the Engineering BU at sync time.

### Seats and ownership

A DigiCert "seat" is a licensed identity slot (`seat_id`, `seat_name`, `email`, a BU). **Ownership is deliberately not written to DigiCert.** Owners live only in Saviynt's store (the local SQLite `owner_assignments` table). That is the value Zuma adds on top of the CA, and it is why people work from this UI. An earlier seat write-back never worked (DigiCert rejected it for the missing BU and the error was swallowed) and was removed.

---

## File Structure

```
digicert-poc/
├── app.py                  # Flask factory, blueprint registration, error handlers (port 5001)
├── digicert_client.py      # Thin HTTP wrapper (get/post/put/delete) + API key header; counts writes
├── Makefile                # setup, run, test, demo-reset
├── .env.example            # DIGICERT_API_KEY (copy to .env; .env is not committed)
├── bu_ids.json             # Real DigiCert BU UUIDs (persisted after sync)
├── requirements.txt
├── cert-gov demo talk track.md   # the demo script
├── routes/
│   ├── certificates.py     # /api/certificates (fully paginated), /issue, /api/profiles; fetch_inventory() shared cache
│   ├── ownership.py        # /api/business-units, /sync, /api/seats; ensure_seat_exists()
│   ├── remediation.py      # /api/certificates/<serial>/revoke|reissue|cancel
│   ├── owner_store.py      # /assign-owner, /api/owner-assignments, BU overlay (local SQLite)
│   ├── users.py            # /api/users (mock directory across 5 depts, Marvel/Disney)
│   ├── findings.py         # /api/findings (+ /status), /api/overview
│   ├── exceptions.py       # /api/exceptions, /auto-handled, /decide, /api/rules (+ /preview),
│   │                       #   /api/certificates/<serial>/recommendation
│   ├── recommendations.py  # evidence-based owner recommendation (pure logic)
│   └── campaigns.py        # access review campaigns (parked, still routed)
├── scripts/
│   └── reset_demo.py       # make demo-reset
├── tests/                  # pytest + responses
└── frontend/
    ├── src/
    │   ├── api.ts           # All fetch calls + TypeScript interfaces
    │   ├── App.tsx          # Routes: /, /inventory, /exceptions, /findings, /campaigns (unlinked)
    │   ├── pages/
    │   │   ├── OverviewPage.tsx     # Live KPIs
    │   │   ├── InventoryPage.tsx    # Table, filters, side panels, Assign Owner
    │   │   ├── ExceptionsPage.tsx   # Needs Attention / Auto-handled / Rules tabs, CA filter
    │   │   ├── FindingsPage.tsx     # Live findings with persisted status
    │   │   └── CampaignsPage.tsx    # Parked
    │   └── components/
    │       ├── OwnerRecommendation.tsx   # Shared recommendation card (Inventory panels)
    │       └── Sidebar, SidePanel, Chip, PageHeader, KpiCard
    └── vite.config.ts       # Proxy: /api/* → http://127.0.0.1:5001
```

Unused leftovers from the first iteration: `pages/IssueCertPage.tsx`, the three `*Widget.tsx` components, and `mockData.ts` (only the widgets import it).

---

## What Is Working

### Overview (`/`)
Live KPIs from `GET /api/overview`: active certificates, ownership coverage, certs expiring within 30 / 60 / 90 days, and open findings by severity. Findings are recomputed on every Overview load, so the counts are right even if the Findings page was never opened.

### Findings (`/findings`)
- Five detection rules computed on every load from the full inventory: expiring soon (30/60/90 days), unowned, weak key (< 2048 bits), long-lived (> 365 days), quantum-unsafe.
- Persisted in SQLite; the reviewer's status (open / in-review / resolved) survives recomputation, and findings that no longer apply are removed.
- Findings scan the full inventory including expired certs, so low-severity counts are large. That is intentional for now.

### Exceptions (`/exceptions`) — the main demo page
- **Rules** (`rules` table, three fixed templates with editable thresholds): *Unowned certificate* → needs review; *Policy violation* (weak key, long validity) → needs review; *Healthy and owned* → auto-approve. Rules run in priority order, first match wins, and no match means a person decides. The system only ever auto-approves; it never revokes or reassigns on its own.
- **Needs Attention** — certs no rule approved, each with the rule that sent it there and a plain-language reason, a suggested owner, and Approve / Revoke / Reassign. Revoke calls DigiCert; Approve and Reassign are local.
- **Auto-handled** — certs the system approved, with the rule and the reason (the audit trail). Click the rule to edit it.
- **Rules tab** — edit thresholds or disable a rule. **Preview impact** shows how many certs would move in or out of the queue before saving.
- **CA filter** — same CA values as Inventory (e.g. Saviynt, Dummy Certs Lab).
- Decisions live in the `decisions` table. Human decisions are sticky; automatic ones are recomputed on every load, so editing a rule or a cert drifting out of policy moves it between buckets.

### Owner recommendation
Shown in the Exceptions queue and in both Inventory owner panels (same code, `GET /api/certificates/<serial>/recommendation`).
- Only certs **issued by the tenant CA** (they carry a profile) are recommended. Self-signed and external certs get *No recommendation*, because there is no issuer-side evidence and a confident wrong guess is worse than none.
- Evidence: the BU (local overlay first), name hints (`NAME_HINTS` in `routes/recommendations.py`, whole-token matches), and who owns the other certs in the same BU.
- Confidence: **High** (a person from peer ownership, plus name agreement or 2+ peers), **Medium** (one peer, or a team that BU and name agree on), **Low** (team from one signal only), **None**. The evidence list is shown with every result.

### Certificate Inventory (`/inventory`)
- Loads the complete inventory (all pages, in parallel) and merges a second search on our profile (private-CA certs can be missed by the default scope), de-duplicated by serial.
- Filters, all local after load: search, status (default Active), Business Unit, CA, Owner. Pagination 20 / 50 / 100.
- **Issue Certificate** panel: Common Name, Seat ID (defaults to CN), SAN, BU, Owner; creates/moves the DigiCert seat into the selected BU before enrolling; private key shown once, not persisted.
- **Sync BUs** button: idempotent creation of the 8 demo BUs, UUIDs saved to `bu_ids.json`.
- **Assign Owner**: saved locally only; shows the recommendation with its evidence.
- **Remediation**: Revoke (reason is normalized to DigiCert's upper-case enum; unknown or missing means `UNSPECIFIED`); Revoke & Reissue (issue a fresh cert with the old cert's common name and seat, then revoke the old one; if the revoke fails the response is 207 with the new serial); Cancel returns 501.

### Campaigns (parked)
The earlier access-review campaign workflow still works at `/campaigns` but is no longer in the sidebar. See `README.md` for how to bring it back or remove it.

### Demo reset
`make demo-reset` (`scripts/reset_demo.py`): ensures the 10 demo certs exist (issuing missing ones from the tenant CA), then clears decisions and finding rows, restores default rules, and resets the demo certs' owners. Local only; never writes ownership to DigiCert or revokes anything; leaves other certs' owners alone.

### Performance
A full inventory pull is ~3 s (pages fetched in parallel). Overview, Findings, Campaigns and Exceptions share one cached inventory (30 s). `digicert_client` counts every write (even a failed one), and the cache drops itself when the count changes, so an app-initiated change is never hidden.

---

## Key Architectural Decisions

### Ownership is kept on our side only
Owners are stored in Saviynt's store and never pushed to DigiCert. It is the layer Zuma adds on top of the CA. Tests assert that assigning or reassigning an owner makes no DigiCert write.

### Governance by exception, not periodic campaigns
Periodic campaigns do not fit shrinking certificate lifetimes and agent workloads. The system certifies by default by rule and escalates only what no rule approves, with the reason and evidence.

### DigiCert cert BU = profile BU, not seat BU (confirmed empirically 2026-10-14)
DigiCert files every cert under the **profile's** business unit regardless of the seat's BU, so all certs from this profile show as "Engineering" in DigiCert. The intended BU is tracked locally in SQLite (`bu_assignments`) and overlaid on DigiCert's `business_unit` wherever BU is shown, filtered, or used for recommendations. Enforcing BU-scoped issuance in DigiCert would need one profile per BU; for a governance layer, owning BU attribution locally is the right model anyway.

---

## Known Limitations / To-Do

- **Reissue does not carry over SANs.** The replacement cert gets the old cert's common name and seat only.
- **Demo certs expire** (199-day profile, issued 2026-10-28); `make demo-reset` re-issues missing ones.
- **Shared tenant**: demo certs and the self-signed lab certs are real objects in the demo tenant. Do not use Revoke during a demo.
- **Cache staleness**: certs issued outside this app (another process, the DigiCert console) can take up to 30 s to appear in Overview, Findings, and Exceptions.
- **Findings include expired certs** (noise in low-severity counts).
- **Profile auth identity** — see Tenant Details.
- **Cancel not supported** — DigiCert has no cancel endpoint for this profile; the UI shows an error.
- **No ACME client** — the demo tenant supports ACME but it is not implemented.
- **Information Security / Product / HR BUs** have no users in the mock directory, so certs there get no team signal and no recommendation unless the name or peer owners provide one.
- **Unused leftovers** in the frontend (see File Structure).
