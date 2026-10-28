# cert-gov-demo

A proof-of-concept integration between **Saviynt Zuma** and **DigiCert Trust Lifecycle Manager (MPKI)**. It shows certificate governance by exception: certificates are approved automatically by rule, and only the exceptions reach a person, with the reason and a recommended owner backed by evidence.

## What it does

| Feature | Description |
|---|---|
| **Certificate Inventory** | The complete tenant inventory. Browse, filter (status, BU, CA, owner), issue, revoke, reissue, and assign owners |
| **Overview** | Live KPIs: active certs, ownership coverage, expiry windows, open findings by severity |
| **Findings** | Detects expiring, unowned, weak-key, long-lived, and quantum-unsafe certificates; reviewer status is saved |
| **Exceptions** | Rules auto-approve healthy certs; everything else lands in a queue with the rule and reason. Shows what was auto-handled and why, and lets you edit the rules with an impact preview. Filter by CA |
| **Owner recommendation** | For certs issued by your own CA, suggests an owner from the business unit, the name, and who owns the neighboring certs, and shows the evidence. Self-signed and external certs get no recommendation |

## Prerequisites

- **Python 3.11+**
- **Node.js 18+**
- A **DigiCert demo tenant API key** — log into [demo.one.digicert.com](https://demo.one.digicert.com), go to **Account → API Tokens**, and generate one

## Setup

```bash
# 1. Clone the repo
git clone https://github.com/baberamin/cert-gov-demo.git
cd cert-gov-demo

# 2. Add your API key
cp .env.example .env
# Open .env and replace 'your-api-key-here' with your DigiCert API token

# 3. Install dependencies and build the frontend
make setup

# 4. Start the app
make run
```

Then open **http://127.0.0.1:5001** in your browser. (Port 5001 because macOS AirPlay Receiver holds 5000.)

## Running the demo

The script is [cert-gov demo talk track.md](cert-gov%20demo%20talk%20track.md). Before each run:

```bash
make demo-reset ARGS=--dry-run   # preview what a reset would change
make demo-reset                  # reset
```

A reset makes sure the demo certificates exist (issuing any that are missing from the tenant CA), clears Exceptions decisions and finding statuses, restores the default rules, and resets the owners of the demo certificates. It never writes ownership to DigiCert, never revokes anything, and leaves other certificates' owners alone. If the app is already running, give it about 30 seconds to pick up new certificates.

## Design choices

- **Ownership lives in Saviynt, not DigiCert.** Owners are stored locally and never written to the DigiCert seat. That is the layer Zuma adds on top of the CA.
- **The system only auto-approves.** It never revokes or reassigns on its own; only people do.
- **No guessing.** A certificate not issued by your CA has no issuer-side evidence, so no owner is suggested.
- **The inventory is complete.** Every page of the tenant is fetched (in parallel, cached for 30 seconds).

More detail, DigiCert API findings, and known limitations are in [STATUS.md](STATUS.md).

## Parked: access review campaigns

The Exceptions page replaced Campaigns in the sidebar. The campaigns feature still exists and works; it is only unlinked.

- **Backend:** `routes/campaigns.py` and `tests/test_campaigns.py`, still registered in `app.py`.
- **Frontend:** `frontend/src/pages/CampaignsPage.tsx`, still routed at `/campaigns` in `frontend/src/App.tsx`. It is reachable by URL.

To bring it back, add `{ label: 'Campaigns', to: '/campaigns' }` to `navItems` in `frontend/src/components/Sidebar.tsx`, then run `make setup`. To remove it for good, delete those files and their lines in `app.py` and `App.tsx`.

## Running tests

```bash
make test
```

Seven older tests in `test_certificates.py`, `test_ownership.py`, and `test_remediation.py` currently fail. They predate later changes and assert old response shapes; all newer tests pass. Details are in STATUS.md.

## Tech stack

- **Backend:** Flask, SQLite, DigiCert MPKI REST API
- **Frontend:** React 18, TypeScript, Tailwind CSS, Vite
- **Tests:** pytest + responses (HTTP mocking)
