# DigiCert Zuma POC — Design Spec
Date: 2026-10-06

## Overview

A proof-of-concept application that demonstrates Saviynt Zuma's ability to ingest data from and execute lifecycle actions against the DigiCert Trust Lifecycle Manager (MPKI) API. The POC uses a dummy Zuma frontend as a stand-in for the real Zuma product.

Two user stories are implemented end-to-end:
- **Story 2:** Business Unit & Ownership Mapping — ingest certificate ownership, BU assignments, and custom tags from DigiCert
- **Story 6:** Automated Certificate Remediation & Re-issuance — revoke, revoke-and-replace, and cancel certificates via DigiCert lifecycle APIs

## Tech Stack

- **Frontend:** Plain HTML/CSS/JavaScript (no framework)
- **Backend:** Python (Flask) — serves static files and proxies all DigiCert API calls
- **Visual style:** Dark enterprise theme, sidebar navigation
- **Test tenant:** `https://demo.one.digicert.com/mpki/`
- **Auth:** `x-api-key` header injected server-side from environment variable; never exposed to the browser

## Project Structure

```
digicert-poc/
├── app.py                  # Flask entry point — serves static files + mounts API routes
├── requirements.txt
├── .env                    # DIGICERT_API_KEY, DIGICERT_BASE_URL (not committed)
├── routes/
│   ├── certificates.py     # /api/certificates, /api/certificates/<id>
│   ├── ownership.py        # /api/business-units, /api/business-units/<id>, /api/seats
│   └── remediation.py      # /api/certificates/<id>/revoke, /api/certificates/<id>/reissue, /api/certificates/<id>/cancel
└── static/
    ├── index.html          # App shell — sidebar nav + content pane
    ├── css/
    │   └── styles.css      # Dark enterprise theme
    └── js/
        ├── api.js          # Fetch wrapper for all /api/* calls
        ├── ownership.js    # Story 2 view logic
        └── remediation.js  # Story 6 view logic
```

## Backend API Routes

All routes are served by Flask. The API key is read from the environment and injected as `x-api-key` on every proxied request.

| Flask Route | Method | DigiCert Endpoint | Purpose |
|---|---|---|---|
| `/api/profiles` | GET | `/mpki/api/v1/profile` | List certificate profiles |
| `/api/profiles/<id>` | GET | `/mpki/api/v1/profile/<id>` | Profile detail (enrollment field requirements) |
| `/api/certificates` | GET | `/mpki/api/v1/certificate` | List all certificates |
| `/api/certificates` | POST | `/mpki/api/v1/certificate` | Enroll a new certificate |
| `/api/certificates/<id>` | GET | `/mpki/api/v1/certificate/<id>` | Certificate detail (owner, tags, BU, key metadata) |
| `/api/certificates/<id>/revoke` | POST | `/mpki/api/v1/certificate/<id>/revocation` | Revoke with reason code |
| `/api/certificates/<id>/reissue` | POST | Enroll new + revoke old (two sequential DigiCert calls) | Revoke-and-replace |
| `/api/certificates/<id>/cancel` | POST | `/mpki/api/v1/certificate/<id>` (exact cancel verb TBD — verify during implementation; may be DELETE or a status patch) | Cancel pending issuance (circuit breaker) |
| `/api/business-units` | GET | `/mpki/api/v1/business-unit` | List all business units |
| `/api/business-units/<id>` | GET | `/mpki/api/v1/business-unit/<id>` | BU detail + members |
| `/api/seats` | GET | `/mpki/api/v1/seat` | List users/owners for ownership mapping |

Additional routes can be added as needed without structural changes.

## Frontend Views

### Sidebar Navigation
Persistent left sidebar with two entries:
- **Ownership** (default landing view)
- **Remediation**

### Ownership View (Story 2)
- Certificate table with columns: Common Name, Business Unit, Owner, Tags, Status, Expiry
- Filter by Business Unit (dropdown)
- Click a row → inline detail panel below the table showing: issuer, key type, escrow status, environment tag, full owner metadata
- Unassigned/orphaned certificates highlighted in the table (no BU or owner)

### Remediation View (Story 6)
- Certificate table with columns: Common Name, Profile, Status, Expiry, Actions
- Actions column shows contextual buttons based on certificate status:
  - **Active/Expiring:** `Revoke` | `Revoke & Replace`
  - **Pending:** `Cancel`
  - **Revoked:** no actions (row dimmed)
- Revoke action opens a modal with revocation reason selection: Key Compromise, Cessation of Operation, Superseded, Unspecified
- After any action, the affected row updates inline (no page reload)

## Data Flow

1. Browser loads `index.html` from Flask at `/`
2. JS calls `/api/*` endpoints on Flask (same origin — no CORS headers needed)
3. Flask injects `x-api-key` and forwards requests to DigiCert MPKI
4. DigiCert response is passed back to the browser as-is
5. JS renders the response into the table and detail panel

### Revoke & Replace (two-step)
The `/api/certificates/<id>/reissue` route executes two sequential DigiCert calls server-side:
1. Enroll a new certificate using the same profile, CN, and SANs as the original
2. Revoke the old certificate

If step 2 fails, the backend returns an error that includes the new certificate's serial number so the UI can surface it to the user.

## Error Handling

- DigiCert API errors (4xx/5xx) are surfaced as a red status banner above the table — no page crash
- Network/timeout errors show the same banner with the raw error message (useful for debugging in a POC context)
- No automatic retries — fail fast and surface the DigiCert error directly

## Out of Scope

- Stories 3 (Agent/Sensor Health) and 5 (Runaway Issuance Detection) — excluded due to lack of audit logs and sensor data in the test environment
- Authentication/login UI — API key is configured at the server level
- Pagination — the test tenant has a small number of certificates; pagination can be added later
- Production hardening, rate limiting, or persistent storage
