# Governance: Risk & Compliance Posture + Access Review Campaigns

**Goal:** Add two governance capabilities to the Saviynt Zuma × DigiCert POC — (A) a live risk/findings layer computed from real cert data, and (B) a campaign-based access review workflow — both persisted in the Zuma proxy layer (Flask + SQLite).

**Architecture:** The Flask proxy is the Zuma middle tier. DigiCert owns cert lifecycle; Zuma owns governance metadata (findings, campaigns, decisions) that DigiCert has no concept of. All new data is SQLite-backed on the proxy. The React SPA fetches from proxy endpoints only.

**Tech Stack:** Flask, SQLite, React 18, Tailwind CSS, existing component library (`PageHeader`, `Chip`, `SidePanel`, `KpiCard`, `Sidebar`), existing table/filter/panel patterns from `InventoryPage.tsx`.

---

## Feature A: Risk & Compliance Posture

### Overview

On every Findings page load, the frontend calls `GET /api/findings`. The backend fetches the full cert inventory (reusing existing `_fetch_all_certs` pagination), computes findings, upserts them into a `findings` SQLite table (preserving any existing `status` value so in-review/resolved decisions survive the recompute), deletes findings for certs that no longer qualify, and returns the full list. The Overview page calls `GET /api/overview` for live KPI counts.

### Finding Types

| `finding_type` | `severity` | Trigger |
|---|---|---|
| `expiring_soon` | `critical` | `expires_in_days <= 30` |
| `expiring_soon` | `high` | `31 <= expires_in_days <= 60` |
| `expiring_soon` | `medium` | `61 <= expires_in_days <= 90` |
| `unowned` | `high` | Active cert (`status == 'issued'`), no `seat.seat_name` and no local owner assignment |
| `weak_key` | `critical` | `key_size` present and `int(key_size) < 2048` |
| `long_lived` | `medium` | `valid_from` and `valid_to` span > 365 days |
| `quantum_unsafe` | `low` | `quantum_safe == false` (field present and explicitly false) |

Finding ID: `"{serial_number}:{finding_type}:{severity}"` — unique per cert+type+severity combination.

### SQLite Schema

```sql
CREATE TABLE IF NOT EXISTS findings (
    id          TEXT PRIMARY KEY,
    serial_number TEXT NOT NULL,
    common_name TEXT,
    finding_type TEXT NOT NULL,
    severity    TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open',
    detail      TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
```

`status` values: `open` | `in-review` | `resolved`. Status is preserved across recomputes — only reset to `open` if the finding disappears and reappears.

### Backend: `routes/findings.py`

**`GET /api/findings`**
1. Fetch all active certs via `_fetch_all_certs` (imported from `routes.certificates`)
2. Fetch local owner assignments via `_get_owners()` (from `owner_store`)
3. Compute the set of current findings (list of dicts with id, serial, type, severity, detail)
4. Load existing findings from SQLite
5. Upsert each new finding (preserve `status` and `created_at` if id already exists)
6. Delete findings whose id is not in the current computed set
7. Return all remaining findings ordered by severity (`critical` → `high` → `medium` → `low`), then `created_at` desc

**`GET /api/overview`**
Returns a single JSON object:
```json
{
  "total_active": 42,
  "owned_pct": 71,
  "expiring_30": 3,
  "expiring_60": 7,
  "expiring_90": 12,
  "findings_critical": 2,
  "findings_high": 5,
  "findings_medium": 8,
  "findings_low": 14
}
```
Computed from the same cert scan + owner assignments, no findings table involved (keeps it fast and independent).

**`PATCH /api/findings/<finding_id>/status`**
Body: `{ "status": "in-review" | "resolved" | "open" }`. Updates `status` and `updated_at` in SQLite. Returns updated finding.

### Frontend Changes

**`OverviewPage.tsx`** — replace mock data:
- On mount: `GET /api/overview`
- KPI cards (reuse existing `KpiCard` component): Total Active Certs, Owned %, Expiring ≤30 days, Open Findings
- Secondary row: findings breakdown by severity using `Chip` color coding (red=critical, amber=high, blue=medium, gray=low)
- Remove mock widget imports (`KeyComplianceWidget`, `IssuanceVelocityWidget`, `PendingRemediationsWidget`)

**`FindingsPage.tsx`** — replace mock `FINDINGS` import:
- On mount: `GET /api/findings` → replaces `FINDINGS` constant; existing filter/table/detail panel structure unchanged
- Finding detail panel: add "View in Inventory" link (navigates to `/inventory` with serial pre-populated in search), and Revoke / Reissue buttons that call existing `revoke()` / `reissue()` from `api.ts`
- Status update: "Mark In Review" / "Mark Resolved" buttons call `PATCH /api/findings/:id/status`

**`api.ts`** additions:
```typescript
export interface Finding {
  id: string;
  serial_number: string;
  common_name: string | null;
  finding_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'in-review' | 'resolved';
  detail: string;
  created_at: string;
  updated_at: string;
}

export interface OverviewStats {
  total_active: number;
  owned_pct: number;
  expiring_30: number;
  expiring_60: number;
  expiring_90: number;
  findings_critical: number;
  findings_high: number;
  findings_medium: number;
  findings_low: number;
}

export async function fetchFindings(): Promise<Finding[]> { ... }
export async function fetchOverview(): Promise<OverviewStats> { ... }
export async function updateFindingStatus(id: string, status: string): Promise<Finding> { ... }
```

---

## Feature B: Access Review Campaigns

### Overview

Entirely Zuma-owned. A governance admin creates a campaign by naming it, optionally scoping it to a BU, and setting a deadline. On creation, the backend snapshots all matching active certs into `campaign_items`. The reviewer (admin doing the demo) works through each item, making one of three decisions: Approve (cert is fine, owner confirmed), Revoke (execute `PUT /revoke` against DigiCert), or Reassign Owner (update local SQLite + DigiCert seat). Campaign progress is tracked in SQLite.

### SQLite Schema

```sql
CREATE TABLE IF NOT EXISTS campaigns (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    scope_bu_id TEXT,
    deadline    TEXT,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TEXT NOT NULL
);
-- status: active | completed | cancelled

CREATE TABLE IF NOT EXISTS campaign_items (
    id            TEXT PRIMARY KEY,
    campaign_id   TEXT NOT NULL,
    serial_number TEXT NOT NULL,
    common_name   TEXT,
    owner         TEXT,
    bu_name       TEXT,
    valid_to      TEXT,
    decision      TEXT,
    new_owner     TEXT,
    new_owner_email TEXT,
    decided_at    TEXT,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);
-- id = campaign_id + ':' + serial_number
-- decision: NULL (pending) | 'approved' | 'revoked' | 'reassigned'
```

### Backend: `routes/campaigns.py`

**`POST /api/campaigns`**
Body: `{ "name": "...", "scope_bu_id": "...|null", "deadline": "YYYY-MM-DD|null" }`
1. Generate campaign UUID, insert into `campaigns`
2. Fetch all active certs (reuse `_fetch_all_certs`)
3. If `scope_bu_id`: filter by effective BU (merge DigiCert BU + local `bu_assignments`)
4. Fetch local owner assignments
5. Insert one `campaign_items` row per matching cert (snapshot: serial, common_name, effective owner, effective BU name, valid_to)
6. Return campaign object + item count

**`GET /api/campaigns`**
Returns list of campaigns with computed summary:
```json
[{
  "id": "...", "name": "...", "status": "active",
  "created_at": "...", "deadline": "...",
  "total": 12, "approved": 5, "revoked": 1, "reassigned": 2, "pending": 4
}]
```

**`GET /api/campaigns/<id>`**
Returns campaign object + all `campaign_items` for that campaign.

**`POST /api/campaigns/<id>/items/<serial>/decide`**
Body: `{ "decision": "approved" | "revoked" | "reassigned", "new_owner": "...", "new_owner_email": "..." }`
- If `revoked`: call `dc.put(f'/mpki/api/v1/certificate/{serial}/revoke', {'revocation_reason': 'SUPERSEDED'})`
- If `reassigned`: call `assignOwner(serial, new_owner, new_owner_email)` (reuse existing owner_store logic)
- Update `campaign_items` row: set `decision`, `new_owner`, `decided_at`
- If all items decided: update `campaigns.status` to `completed`
- Return updated item

**`PATCH /api/campaigns/<id>/status`**
Body: `{ "status": "cancelled" }` — allows admin to cancel an in-progress campaign.

### Frontend: `CampaignsPage.tsx` (new file)

**Campaign list view** (default):
- `PageHeader` with title "Access Review Campaigns" and "New Campaign" button (indigo, top-right — same pattern as "Issue Certificate" in InventoryPage)
- Table using same `bg-white rounded-xl border border-gray-200 shadow-sm` container as inventory
- Columns: Name | Scope | Created | Deadline | Progress | Status
- Progress: `X / N reviewed` with a thin progress bar (Tailwind `bg-indigo-600` fill on `bg-gray-200` track)
- Status chip using existing `Chip` component: active=blue, completed=green, cancelled=gray
- Click a row → campaign detail view (same page, conditional render — no new route needed)

**Campaign detail view** (shown when a campaign row is clicked):
- Back chevron + campaign name as `PageHeader`
- Summary bar: total | approved (green) | revoked (red) | reassigned (amber) | pending (gray) — using `Chip` components
- Same table container; columns: Common Name | BU | Owner | Expires | Decision
- Decision column: when `decision == null`, show three buttons inline — "Approve" (green outline), "Revoke" (red outline), "Reassign" (amber outline) — same button style as existing revoke/reissue buttons in InventoryPage
- Reassign opens an inline owner picker using the same searchable dropdown pattern from the cert detail panel
- Decided rows show the decision as a `Chip` (read-only) + decided timestamp

**"New Campaign" panel** (`SidePanel` component, same as existing side panels):
- Name field (text input, same `border border-gray-300 rounded-lg px-3 py-2` style)
- BU scope dropdown (same `<select>` pattern as inventory BU filter; "All Business Units" as default)
- Deadline date input (optional)
- Submit button: "Create Campaign" (indigo primary) — shows item count on success before closing

### Sidebar update (`Sidebar.tsx`)

Add "Campaigns" nav item between "Certificate Inventory" and "Findings":
```typescript
{ label: 'Campaigns', to: '/campaigns' }
```

### Router update (`App.tsx`)

Add route: `<Route path="/campaigns" element={<CampaignsPage />} />`

---

## UI/UX Constraints

- All new pages use `PageHeader`, `Chip`, `SidePanel` from existing components — no new components created
- Table containers: `bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden`
- Table headers: `bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3`
- Table rows: `hover:bg-gray-50 border-b border-gray-100 text-sm text-gray-700 px-4 py-3`
- Buttons: primary=`bg-indigo-600 text-white rounded-lg hover:bg-indigo-700`, danger=`border border-red-300 text-red-700 rounded-lg hover:bg-red-50`, default=`border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50`
- Loading state: same `<div className="text-center py-16 text-gray-400">Loading...</div>` pattern

---

## Implementation Order

1. **`routes/findings.py`** — backend findings computation + SQLite persistence
2. **`OverviewPage.tsx`** — wire to `/api/overview`
3. **`FindingsPage.tsx`** — wire to `/api/findings`, add status actions + cert link
4. **`routes/campaigns.py`** — backend campaign CRUD + decision execution
5. **`CampaignsPage.tsx`** — campaign list + detail + new campaign panel
6. **`Sidebar.tsx` + `App.tsx`** — add Campaigns route
