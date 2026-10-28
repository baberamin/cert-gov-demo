# cert-gov-demo

A proof-of-concept integration between **Saviynt Zuma** and **DigiCert Trust Lifecycle Manager (MPKI)** that demonstrates live certificate governance — risk posture, security findings, and access review campaigns.

## What it does

| Feature | Description |
|---|---|
| **Certificate Inventory** | Browse, filter, revoke, and reissue certificates from your DigiCert tenant |
| **Risk & Findings** | Automatically detects expiring, unowned, weak-key, long-lived, and quantum-unsafe certificates |
| **Overview Dashboard** | Live KPIs — active cert count, ownership coverage, expiry windows, open findings by severity |
| **Exceptions** | Rules auto-approve healthy certs; only exceptions reach a person. Shows what was auto-handled and why, and lets you edit the rules with an impact preview |

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

Then open **http://127.0.0.1:5001** in your browser.

## Resetting the demo

```bash
make demo-reset ARGS=--dry-run   # show what would change
make demo-reset                  # reset
```

This makes sure the demo certificates exist (issuing any that are missing from the tenant CA), clears Exceptions decisions and finding statuses, restores the default rules, and resets the owners of the demo certificates. It never writes ownership to DigiCert, never revokes anything, and leaves other certificates' owners alone. Run it before each demo.

## Parked: access review campaigns

The Exceptions page replaced Campaigns in the sidebar. The campaigns feature still exists and works; it is only unlinked.

- **Backend:** `routes/campaigns.py` and `tests/test_campaigns.py`, still registered in `app.py`.
- **Frontend:** `frontend/src/pages/CampaignsPage.tsx`, still routed at `/campaigns` in `frontend/src/App.tsx`. It is reachable by URL.

To bring it back, add `{ label: 'Campaigns', to: '/campaigns' }` to `navItems` in `frontend/src/components/Sidebar.tsx`, then run `make setup`. To remove it for good, delete those files and their lines in `app.py` and `App.tsx`.

## Running tests

```bash
make test
```

## Tech stack

- **Backend:** Flask, SQLite, DigiCert MPKI REST API
- **Frontend:** React 18, TypeScript, Tailwind CSS, Vite
- **Tests:** pytest + responses (HTTP mocking)
