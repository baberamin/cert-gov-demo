# cert-gov-demo

A proof-of-concept integration between **Saviynt Zuma** and **DigiCert Trust Lifecycle Manager (MPKI)** that demonstrates live certificate governance — risk posture, security findings, and access review campaigns.

## What it does

| Feature | Description |
|---|---|
| **Certificate Inventory** | Browse, filter, revoke, and reissue certificates from your DigiCert tenant |
| **Risk & Findings** | Automatically detects expiring, unowned, weak-key, long-lived, and quantum-unsafe certificates |
| **Overview Dashboard** | Live KPIs — active cert count, ownership coverage, expiry windows, open findings by severity |
| **Access Review Campaigns** | Create point-in-time snapshots of active certs; reviewers approve, revoke, or reassign each one |

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

Then open **http://127.0.0.1:5000** in your browser.

## Running tests

```bash
make test
```

## Tech stack

- **Backend:** Flask, SQLite, DigiCert MPKI REST API
- **Frontend:** React 18, TypeScript, Tailwind CSS, Vite
- **Tests:** pytest + responses (HTTP mocking)
