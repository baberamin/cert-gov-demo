# Governance: Risk & Compliance Posture + Access Review Campaigns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live risk findings (computed from DigiCert cert data, persisted in SQLite) and a campaign-based access review workflow to the Saviynt Zuma × DigiCert POC.

**Architecture:** Flask proxy is the Zuma middle tier. `routes/findings.py` computes findings on every page load, upserts to SQLite (preserving reviewer decisions), and serves them via REST. `routes/campaigns.py` owns campaign lifecycle entirely in SQLite — admin creates campaigns (snapshots active certs), reviewer makes approve/revoke/reassign decisions, DigiCert API is called for revoke/reassign execution. React SPA fetches from proxy only. All new pages reuse existing `PageHeader`, `Chip`, `SidePanel`, `KpiCard` components and InventoryPage table/button CSS patterns.

**Tech Stack:** Flask, SQLite, `responses` (test mocking), React 18, TypeScript, Tailwind CSS, React Router v6.

---

## File Map

**Create:**
- `routes/findings.py` — finding computation, SQLite upsert/delete, three endpoints
- `routes/campaigns.py` — campaign CRUD, item snapshot, decision execution
- `tests/test_findings.py` — pytest tests for findings endpoints
- `tests/test_campaigns.py` — pytest tests for campaign endpoints
- `frontend/src/pages/CampaignsPage.tsx` — campaign list + detail + new-campaign panel

**Modify:**
- `app.py` — register two new blueprints + call their init functions
- `frontend/src/api.ts` — add Finding, OverviewStats, Campaign, CampaignItem types + fetch functions
- `frontend/src/pages/OverviewPage.tsx` — replace mock KPIs with live `/api/overview` data
- `frontend/src/pages/FindingsPage.tsx` — replace mock data with live `/api/findings`, add status persistence
- `frontend/src/components/Sidebar.tsx` — add Campaigns nav item
- `frontend/src/App.tsx` — add Campaigns route

---

## Part A: Risk & Compliance Posture

---

### Task 1: Backend — `routes/findings.py`

**Files:**
- Create: `routes/findings.py`
- Create: `tests/test_findings.py`

Context: `_fetch_all_certs` and `PROFILE_ID` are importable from `routes.certificates`. The shared SQLite DB is at `owner_assignments.db` in the project root (same file used by `routes/owner_store.py`). DB_PATH is a module-level variable so tests can monkeypatch it.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_findings.py`:

```python
import responses as rsps
import pytest

DIGICERT_BASE = 'https://demo.one.digicert.com'

CERT_EXPIRING = {
    'serial_number': 'EXPIRING-001',
    'common_name': 'expiring.example.com',
    'status': 'issued',
    'expires_in_days': 15,
    'valid_from': '2026-01-01T00:00:00Z',
    'valid_to': '2026-11-15T00:00:00Z',
    'seat': {'seat_name': 'Alice'},
    'quantum_safe': True,
}

CERT_UNOWNED = {
    'serial_number': 'UNOWNED-002',
    'common_name': 'unowned.example.com',
    'status': 'issued',
    'expires_in_days': 120,
    'valid_from': '2025-01-01T00:00:00Z',
    'valid_to': '2027-01-01T00:00:00Z',
    'seat': {},
    'quantum_safe': True,
}

CERT_WEAK_KEY = {
    'serial_number': 'WEAKKEY-003',
    'common_name': 'weakkey.example.com',
    'status': 'issued',
    'expires_in_days': 200,
    'valid_from': '2026-01-01T00:00:00Z',
    'valid_to': '2026-11-01T00:00:00Z',
    'key_size': '1024',
    'seat': {'seat_name': 'Bob'},
    'quantum_safe': True,
}


@pytest.fixture(autouse=True)
def tmp_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / 'test.db')
    import routes.findings
    import routes.owner_store
    monkeypatch.setattr(routes.findings, 'DB_PATH', db_path)
    monkeypatch.setattr(routes.owner_store, 'DB_PATH', db_path)
    routes.owner_store.init_db()
    routes.findings.init_findings_db()


def _mock_cert_search(certs):
    """Add two cert-search mocks: one default, one profile-filtered (empty)."""
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate-search',
             json={'certificates': certs, 'has_more': False})
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate-search',
             json={'certificates': [], 'has_more': False})


@rsps.activate
def test_expiring_cert_creates_critical_finding(client):
    _mock_cert_search([CERT_EXPIRING])
    resp = client.get('/api/findings')
    assert resp.status_code == 200
    findings = resp.get_json()
    expiring = [f for f in findings if f['finding_type'] == 'expiring_soon']
    assert len(expiring) == 1
    assert expiring[0]['severity'] == 'critical'
    assert expiring[0]['serial_number'] == 'EXPIRING-001'
    assert expiring[0]['status'] == 'open'


@rsps.activate
def test_unowned_cert_creates_high_finding(client):
    _mock_cert_search([CERT_UNOWNED])
    resp = client.get('/api/findings')
    assert resp.status_code == 200
    unowned = [f for f in resp.get_json() if f['finding_type'] == 'unowned']
    assert len(unowned) == 1
    assert unowned[0]['severity'] == 'high'


@rsps.activate
def test_weak_key_creates_critical_finding(client):
    _mock_cert_search([CERT_WEAK_KEY])
    resp = client.get('/api/findings')
    assert resp.status_code == 200
    weak = [f for f in resp.get_json() if f['finding_type'] == 'weak_key']
    assert len(weak) == 1
    assert weak[0]['severity'] == 'critical'


@rsps.activate
def test_status_preserved_on_refresh(client):
    _mock_cert_search([CERT_EXPIRING])
    client.get('/api/findings')  # create finding

    finding_id = 'EXPIRING-001:expiring_soon:critical'
    resp = client.patch(f'/api/findings/{finding_id}/status', json={'status': 'in-review'})
    assert resp.status_code == 200
    assert resp.get_json()['status'] == 'in-review'

    # Second page load — status must survive
    _mock_cert_search([CERT_EXPIRING])
    resp2 = client.get('/api/findings')
    expiring = [f for f in resp2.get_json() if f['finding_type'] == 'expiring_soon']
    assert expiring[0]['status'] == 'in-review'


@rsps.activate
def test_stale_finding_deleted_when_cert_no_longer_qualifies(client):
    _mock_cert_search([CERT_EXPIRING])
    client.get('/api/findings')

    # Now cert expires in 200 days — no longer expiring_soon
    cert_healed = {**CERT_EXPIRING, 'expires_in_days': 200}
    _mock_cert_search([cert_healed])
    resp = client.get('/api/findings')
    expiring = [f for f in resp.get_json() if f['finding_type'] == 'expiring_soon']
    assert len(expiring) == 0


@rsps.activate
def test_overview_returns_correct_kpis(client):
    _mock_cert_search([CERT_EXPIRING, CERT_UNOWNED])
    resp = client.get('/api/overview')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['total_active'] == 2
    assert data['expiring_30'] == 1
    assert 'owned_pct' in data
    assert 'findings_critical' in data


@rsps.activate
def test_patch_finding_status_invalid_value(client):
    _mock_cert_search([CERT_EXPIRING])
    client.get('/api/findings')
    resp = client.patch('/api/findings/EXPIRING-001:expiring_soon:critical/status',
                        json={'status': 'banana'})
    assert resp.status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/baber.amin/projects/digicert-poc
source .venv/bin/activate
pytest tests/test_findings.py -v
```

Expected: `ModuleNotFoundError: No module named 'routes.findings'`

- [ ] **Step 3: Create `routes/findings.py`**

```python
import sqlite3
import os
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request
import digicert_client as dc
from routes.certificates import _fetch_all_certs, PROFILE_ID

findings_bp = Blueprint('findings', __name__)

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'owner_assignments.db')

SEVERITY_ORDER = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3}


def init_findings_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS findings (
                id            TEXT PRIMARY KEY,
                serial_number TEXT NOT NULL,
                common_name   TEXT,
                finding_type  TEXT NOT NULL,
                severity      TEXT NOT NULL,
                status        TEXT NOT NULL DEFAULT 'open',
                detail        TEXT,
                created_at    TEXT NOT NULL,
                updated_at    TEXT NOT NULL
            )
        ''')
        conn.commit()


def _db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _cert_cn(cert):
    return (
        (cert.get('subject') or {}).get('common_name')
        or cert.get('common_name')
        or (cert.get('seat') or {}).get('seat_id')
    )


def _compute_findings(certs, owner_map):
    """Return list of finding dicts computed from certs + owner_map."""
    findings = []
    for cert in certs:
        serial = cert.get('serial_number')
        if not serial:
            continue
        cn = _cert_cn(cert)
        is_active = cert.get('status') in ('issued', 'active')

        if is_active:
            try:
                d = int(cert.get('expires_in_days') or 9999)
                if d <= 30:
                    sev = 'critical'
                elif d <= 60:
                    sev = 'high'
                elif d <= 90:
                    sev = 'medium'
                else:
                    sev = None
                if sev:
                    vt = (cert.get('valid_to') or '')[:10]
                    findings.append({
                        'id': f'{serial}:expiring_soon:{sev}',
                        'serial_number': serial,
                        'common_name': cn,
                        'finding_type': 'expiring_soon',
                        'severity': sev,
                        'detail': f'Expires in {d} days (on {vt}).',
                    })
            except (TypeError, ValueError):
                pass

        if is_active:
            seat_name = (cert.get('seat') or {}).get('seat_name')
            if not seat_name and not owner_map.get(serial):
                findings.append({
                    'id': f'{serial}:unowned:high',
                    'serial_number': serial,
                    'common_name': cn,
                    'finding_type': 'unowned',
                    'severity': 'high',
                    'detail': 'No owner assigned in DigiCert or local store.',
                })

        try:
            ks = int(cert.get('key_size') or 0)
            if 0 < ks < 2048:
                findings.append({
                    'id': f'{serial}:weak_key:critical',
                    'serial_number': serial,
                    'common_name': cn,
                    'finding_type': 'weak_key',
                    'severity': 'critical',
                    'detail': f'Key size {ks} bits is below the 2048-bit minimum.',
                })
        except (TypeError, ValueError):
            pass

        vf_raw = cert.get('valid_from')
        vt_raw = cert.get('valid_to')
        if vf_raw and vt_raw:
            try:
                vf = datetime.fromisoformat(vf_raw.replace('Z', '+00:00'))
                vt = datetime.fromisoformat(vt_raw.replace('Z', '+00:00'))
                if (vt - vf).days > 365:
                    findings.append({
                        'id': f'{serial}:long_lived:medium',
                        'serial_number': serial,
                        'common_name': cn,
                        'finding_type': 'long_lived',
                        'severity': 'medium',
                        'detail': f'Validity span {(vt - vf).days} days exceeds 365-day limit.',
                    })
            except (TypeError, ValueError):
                pass

        if cert.get('quantum_safe') is False:
            findings.append({
                'id': f'{serial}:quantum_unsafe:low',
                'serial_number': serial,
                'common_name': cn,
                'finding_type': 'quantum_unsafe',
                'severity': 'low',
                'detail': 'Certificate uses a quantum-vulnerable algorithm.',
            })

    return findings


def _fetch_certs_all():
    certs = _fetch_all_certs({})
    try:
        profile_certs = _fetch_all_certs({'profile_id': PROFILE_ID})
        seen = {c.get('serial_number') for c in certs}
        certs += [c for c in profile_certs if c.get('serial_number') not in seen]
    except Exception:
        pass
    return certs


@findings_bp.route('/api/findings')
def list_findings():
    certs = _fetch_certs_all()

    with _db() as conn:
        owner_map = {r['serial_number']: r['owner_name']
                     for r in conn.execute('SELECT serial_number, owner_name FROM owner_assignments').fetchall()}

    computed = _compute_findings(certs, owner_map)
    computed_ids = {f['id'] for f in computed}
    now = datetime.now(timezone.utc).isoformat()

    with _db() as conn:
        existing = {r['id']: dict(r) for r in conn.execute('SELECT * FROM findings').fetchall()}
        for fid in list(existing):
            if fid not in computed_ids:
                conn.execute('DELETE FROM findings WHERE id=?', (fid,))
        for f in computed:
            if f['id'] in existing:
                conn.execute(
                    'UPDATE findings SET common_name=?, detail=?, updated_at=? WHERE id=?',
                    (f['common_name'], f['detail'], now, f['id']),
                )
            else:
                conn.execute(
                    'INSERT INTO findings (id, serial_number, common_name, finding_type, severity, status, detail, created_at, updated_at) '
                    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    (f['id'], f['serial_number'], f['common_name'], f['finding_type'],
                     f['severity'], 'open', f['detail'], now, now),
                )
        conn.commit()
        rows = [dict(r) for r in conn.execute('SELECT * FROM findings').fetchall()]

    rows.sort(key=lambda x: (SEVERITY_ORDER.get(x['severity'], 99), x['created_at']))
    return jsonify(rows)


@findings_bp.route('/api/overview')
def get_overview():
    certs = _fetch_certs_all()

    with _db() as conn:
        owner_map = {r['serial_number']: r['owner_name']
                     for r in conn.execute('SELECT serial_number, owner_name FROM owner_assignments').fetchall()}

    active = [c for c in certs if c.get('status') in ('issued', 'active')]
    total = len(active)
    owned = sum(
        1 for c in active
        if (c.get('seat') or {}).get('seat_name') or owner_map.get(c.get('serial_number'))
    )
    owned_pct = round(owned / total * 100) if total else 0

    e30 = e60 = e90 = 0
    for c in active:
        try:
            d = int(c.get('expires_in_days') or 9999)
            if d <= 30:
                e30 += 1
            elif d <= 60:
                e60 += 1
            elif d <= 90:
                e90 += 1
        except (TypeError, ValueError):
            pass

    with _db() as conn:
        sev = {r['severity']: r['cnt'] for r in conn.execute(
            "SELECT severity, COUNT(*) as cnt FROM findings WHERE status != 'resolved' GROUP BY severity"
        ).fetchall()}

    return jsonify({
        'total_active': total,
        'owned_pct': owned_pct,
        'expiring_30': e30,
        'expiring_60': e60,
        'expiring_90': e90,
        'findings_critical': sev.get('critical', 0),
        'findings_high': sev.get('high', 0),
        'findings_medium': sev.get('medium', 0),
        'findings_low': sev.get('low', 0),
    })


@findings_bp.route('/api/findings/<finding_id>/status', methods=['PATCH'])
def update_finding_status(finding_id):
    status = (request.get_json() or {}).get('status', '').strip()
    if status not in ('open', 'in-review', 'resolved'):
        return jsonify({'error': 'status must be open, in-review, or resolved'}), 400
    now = datetime.now(timezone.utc).isoformat()
    with _db() as conn:
        conn.execute('UPDATE findings SET status=?, updated_at=? WHERE id=?', (status, now, finding_id))
        conn.commit()
        row = conn.execute('SELECT * FROM findings WHERE id=?', (finding_id,)).fetchone()
    if not row:
        return jsonify({'error': 'not found'}), 404
    return jsonify(dict(row))
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
pytest tests/test_findings.py -v
```

Expected: 8 tests PASSED

- [ ] **Step 5: Commit**

```bash
git add routes/findings.py tests/test_findings.py
git commit -m "feat: findings computation + SQLite persistence + overview KPIs"
```

---

### Task 2: Register findings blueprint in `app.py`

**Files:**
- Modify: `app.py`

- [ ] **Step 1: Update `app.py`**

Add after the `from routes.users import users_bp` line:

```python
    from routes.findings import findings_bp, init_findings_db
```

Add after `app.register_blueprint(users_bp)`:

```python
    app.register_blueprint(findings_bp)
    init_findings_db()
```

The complete imports + register block in `create_app()` becomes:

```python
    from routes.certificates import certificates_bp
    from routes.ownership import ownership_bp
    from routes.remediation import remediation_bp
    from routes.owner_store import owner_store_bp, init_db
    from routes.users import users_bp
    from routes.findings import findings_bp, init_findings_db

    app.register_blueprint(certificates_bp)
    app.register_blueprint(ownership_bp)
    app.register_blueprint(remediation_bp)
    app.register_blueprint(owner_store_bp)
    app.register_blueprint(users_bp)
    app.register_blueprint(findings_bp)
    init_db()
    init_findings_db()
```

- [ ] **Step 2: Smoke test**

```bash
cd /Users/baber.amin/projects/digicert-poc
source .venv/bin/activate
python -c "from app import create_app; app = create_app(); print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add app.py
git commit -m "feat: register findings blueprint in app"
```

---

### Task 3: Add Finding/OverviewStats types + fetch functions to `api.ts`

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Append to `frontend/src/api.ts`**

Add after the last export in the file (after line 116):

```typescript
export interface Finding {
  id: string;
  serial_number: string;
  common_name: string | null;
  finding_type: 'expiring_soon' | 'unowned' | 'weak_key' | 'long_lived' | 'quantum_unsafe';
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

export async function fetchFindings(): Promise<Finding[]> {
  const res = await fetch('/api/findings');
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchOverview(): Promise<OverviewStats> {
  const res = await fetch('/api/overview');
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateFindingStatus(
  id: string,
  status: 'open' | 'in-review' | 'resolved',
): Promise<Finding> {
  const res = await fetch(`/api/findings/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/baber.amin/projects/digicert-poc/frontend
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat: Finding and OverviewStats types + fetch functions"
```

---

### Task 4: Rewrite `OverviewPage.tsx` with live data

**Files:**
- Modify: `frontend/src/pages/OverviewPage.tsx`

- [ ] **Step 1: Replace `OverviewPage.tsx` entirely**

```tsx
import { useState, useEffect } from 'react';
import { PageHeader } from '../components/PageHeader';
import { KpiCard } from '../components/KpiCard';
import { Chip } from '../components/Chip';
import { fetchOverview } from '../api';
import type { OverviewStats } from '../api';

export function OverviewPage() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchOverview()
      .then(setStats)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-16 text-gray-400">Loading...</div>;
  if (error) return <div className="text-center py-16 text-red-500">{error}</div>;
  if (!stats) return null;

  const openFindings = stats.findings_critical + stats.findings_high + stats.findings_medium + stats.findings_low;

  const kpis = [
    {
      title: 'Active Certificates',
      value: String(stats.total_active),
      trend: '',
      direction: 'neutral' as const,
      timeframe: 'total active',
    },
    {
      title: 'Ownership Coverage',
      value: `${stats.owned_pct}%`,
      trend: '',
      direction: stats.owned_pct >= 80 ? 'positive' as const : 'negative' as const,
      timeframe: 'of active certs',
    },
    {
      title: 'Expiring ≤ 30 days',
      value: String(stats.expiring_30),
      trend: '',
      direction: stats.expiring_30 > 0 ? 'negative' as const : 'neutral' as const,
      timeframe: 'need rotation',
    },
    {
      title: 'Open Findings',
      value: String(openFindings),
      trend: '',
      direction: (stats.findings_critical + stats.findings_high) > 0 ? 'negative' as const : 'neutral' as const,
      timeframe: 'across all severities',
    },
  ];

  return (
    <div>
      <PageHeader title="Certificates" subtitle="DigiCert Trust Lifecycle Manager — ACME Corp" />

      <div className="grid grid-cols-4 gap-4 mb-6">
        {kpis.map(kpi => (
          <KpiCard key={kpi.title} {...kpi} />
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Findings Breakdown</h3>
        <div className="grid grid-cols-4 gap-4 mb-4">
          {([
            { label: 'Critical', value: stats.findings_critical, color: 'red' as const },
            { label: 'High',     value: stats.findings_high,     color: 'amber' as const },
            { label: 'Medium',   value: stats.findings_medium,   color: 'blue' as const },
            { label: 'Low',      value: stats.findings_low,      color: 'gray' as const },
          ]).map(({ label, value, color }) => (
            <div key={label} className="text-center">
              <p className="text-3xl font-bold text-gray-900 mb-2">{value}</p>
              <Chip label={label} color={color} />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 text-sm text-gray-600">
          <div>Expiring in 31–60 days: <span className="font-semibold">{stats.expiring_60}</span></div>
          <div>Expiring in 61–90 days: <span className="font-semibold">{stats.expiring_90}</span></div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/baber.amin/projects/digicert-poc/frontend
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/OverviewPage.tsx
git commit -m "feat: wire OverviewPage to live /api/overview data"
```

---

### Task 5: Rewrite `FindingsPage.tsx` with live findings API

**Files:**
- Modify: `frontend/src/pages/FindingsPage.tsx`

Context: The existing page uses `FINDINGS` from `mockData.ts` and a `Finding` type from the same file. We replace both with the `Finding` type from `api.ts` and a `fetchFindings()` call. The table structure, filter dropdowns, and `SidePanel` layout are preserved. `markInReview` / `markResolved` now call the API and update the `findings` array in state (no separate `localStatus` map needed).

- [ ] **Step 1: Replace `FindingsPage.tsx` entirely**

```tsx
import { useState, useEffect } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Chip } from '../components/Chip';
import { SidePanel } from '../components/SidePanel';
import { fetchFindings, updateFindingStatus, revoke } from '../api';
import type { Finding } from '../api';

const FINDING_LABELS: Record<string, string> = {
  expiring_soon:  'Certificate Expiring Soon',
  unowned:        'Unowned Certificate',
  weak_key:       'Weak Key Size',
  long_lived:     'Long-Lived Certificate',
  quantum_unsafe: 'Quantum-Unsafe Algorithm',
};

const FINDING_CATEGORIES: Record<string, string> = {
  expiring_soon:  'Expiry Risk',
  unowned:        'Ownership',
  weak_key:       'Key Compliance',
  long_lived:     'Expiry Risk',
  quantum_unsafe: 'Quantum Safety',
};

const FINDING_REMEDIATION: Record<string, string> = {
  expiring_soon:  'Revoke and reissue the certificate to extend its validity period.',
  unowned:        'Assign an owner via the Certificate Inventory Assign Owner action.',
  weak_key:       'Revoke and reissue with a minimum 2048-bit RSA or 256-bit EC key.',
  long_lived:     'Consider revoking and reissuing with a validity period ≤ 365 days.',
  quantum_unsafe: 'Plan migration to a quantum-safe algorithm when available in the profile.',
};

const TYPE_OPTIONS = Object.entries(FINDING_LABELS).map(([value, label]) => ({ value, label }));
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const STATUSES = ['open', 'in-review', 'resolved'];
const ALL = '';

function severityColor(s: string): 'red' | 'amber' | 'blue' | 'gray' {
  if (s === 'critical') return 'red';
  if (s === 'high') return 'amber';
  if (s === 'medium') return 'blue';
  return 'gray';
}

function statusColor(s: string): 'red' | 'amber' | 'green' | 'gray' {
  if (s === 'open') return 'red';
  if (s === 'in-review') return 'amber';
  if (s === 'resolved') return 'green';
  return 'gray';
}

function statusLabel(s: string) {
  return ({ open: 'Open', 'in-review': 'In Review', resolved: 'Resolved' } as Record<string, string>)[s] ?? s;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function FindingsPage() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [sevFilter, setSevFilter] = useState(ALL);
  const [stFilter, setStFilter] = useState(ALL);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [revokeMsg, setRevokeMsg] = useState('');

  useEffect(() => {
    fetchFindings().then(setFindings).finally(() => setLoading(false));
  }, []);

  async function markStatus(id: string, status: Finding['status']) {
    try {
      const updated = await updateFindingStatus(id, status);
      setFindings(prev => prev.map(f => f.id === id ? updated : f));
      if (selected?.id === id) setSelected(updated);
    } catch { /* silent */ }
  }

  async function handleRevoke(serial: string) {
    setRevokeMsg('Revoking...');
    try {
      await revoke(serial, 'KEY_COMPROMISE');
      setRevokeMsg('Revoked. Refresh page to update findings.');
    } catch {
      setRevokeMsg('Revoke failed.');
    }
  }

  const filtered = findings.filter(f => {
    if (typeFilter && f.finding_type !== typeFilter) return false;
    if (sevFilter && f.severity !== sevFilter) return false;
    if (stFilter && f.status !== stFilter) return false;
    return true;
  });

  const panelFooter = selected ? (
    <>
      {selected.status === 'open' && (
        <button
          onClick={() => markStatus(selected.id, 'in-review')}
          className="flex-1 px-4 py-2 text-sm border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 transition-colors"
        >
          Mark In Review
        </button>
      )}
      {(selected.status === 'open' || selected.status === 'in-review') && (
        <button
          onClick={() => markStatus(selected.id, 'resolved')}
          className="flex-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
        >
          Mark Resolved
        </button>
      )}
      {selected.status === 'resolved' && <Chip label="Resolved" color="green" />}
    </>
  ) : undefined;

  if (loading) return <div className="text-center py-16 text-gray-400">Loading findings...</div>;

  return (
    <div>
      <PageHeader title="Findings" subtitle="Security findings from certificate posture analysis." />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">All Types</option>
          {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={sevFilter} onChange={e => setSevFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">All Severities</option>
          {SEVERITIES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <select value={stFilter} onChange={e => setStFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Finding</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Category</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Severity</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Affected Cert</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Detected</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">No findings match filters.</td>
              </tr>
            ) : filtered.map(f => (
              <tr key={f.id} onClick={() => { setSelected(f); setRevokeMsg(''); }}
                className={`border-b border-gray-100 cursor-pointer transition-colors ${selected?.id === f.id ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                <td className="px-4 py-3 font-medium text-gray-900">{FINDING_LABELS[f.finding_type] ?? f.finding_type}</td>
                <td className="px-4 py-3 text-gray-600">{FINDING_CATEGORIES[f.finding_type] ?? '—'}</td>
                <td className="px-4 py-3"><Chip label={f.severity.charAt(0).toUpperCase() + f.severity.slice(1)} color={severityColor(f.severity)} /></td>
                <td className="px-4 py-3 text-gray-600">{f.common_name ?? f.serial_number}</td>
                <td className="px-4 py-3 text-gray-600">{formatDate(f.created_at)}</td>
                <td className="px-4 py-3"><Chip label={statusLabel(f.status)} color={statusColor(f.status)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <SidePanel title="Finding Detail" onClose={() => setSelected(null)} footer={panelFooter}>
          <div className="mb-4">
            <h2 className="text-base font-semibold text-gray-900 mb-1">{FINDING_LABELS[selected.finding_type] ?? selected.finding_type}</h2>
            <div className="flex gap-2 mt-2">
              <Chip label={selected.severity.charAt(0).toUpperCase() + selected.severity.slice(1)} color={severityColor(selected.severity)} />
              <Chip label={statusLabel(selected.status)} color={statusColor(selected.status)} />
            </div>
          </div>
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs text-gray-400 mb-1">Description</p>
              <p className="text-gray-700">{selected.detail}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Category</p>
              <p className="text-gray-700">{FINDING_CATEGORIES[selected.finding_type] ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Affected Certificate</p>
              <p className="text-gray-700">{selected.common_name ?? selected.serial_number}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Detected</p>
              <p className="text-gray-700">{formatDate(selected.created_at)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Remediation</p>
              <p className="text-gray-700">{FINDING_REMEDIATION[selected.finding_type] ?? 'Review and take appropriate action.'}</p>
            </div>
            <div className="pt-2 border-t border-gray-100">
              <a href="/inventory" className="text-sm text-indigo-600 hover:text-indigo-800">
                View in Inventory →
              </a>
            </div>
            {(selected.finding_type === 'expiring_soon' || selected.finding_type === 'weak_key') && selected.status !== 'resolved' && (
              <div>
                <button
                  onClick={() => handleRevoke(selected.serial_number)}
                  className="w-full px-4 py-2 text-sm border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors"
                >
                  Revoke Certificate
                </button>
                {revokeMsg && <p className="text-xs text-gray-500 mt-1 text-center">{revokeMsg}</p>}
              </div>
            )}
          </div>
        </SidePanel>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/baber.amin/projects/digicert-poc/frontend
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/FindingsPage.tsx frontend/src/pages/OverviewPage.tsx
git commit -m "feat: wire FindingsPage and OverviewPage to live backend data"
```

---

## Part B: Access Review Campaigns

---

### Task 6: Backend — `routes/campaigns.py`

**Files:**
- Create: `routes/campaigns.py`
- Create: `tests/test_campaigns.py`

Context: `_fetch_all_certs` and `PROFILE_ID` imported from `routes.certificates`. `update_seat_owner` imported from `routes.ownership` (signature: `update_seat_owner(seat_id: str, seat_name: str = '', email: str = '') -> None`). Stores `seat_id` in snapshot so reassign decisions can write back to DigiCert seat.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_campaigns.py`:

```python
import responses as rsps
import pytest

DIGICERT_BASE = 'https://demo.one.digicert.com'

CERT_A = {
    'serial_number': 'CERT-AAA',
    'common_name': 'a.example.com',
    'status': 'issued',
    'expires_in_days': 100,
    'valid_to': '2027-01-01',
    'seat': {'seat_id': 'a.example.com', 'seat_name': 'Alice'},
    'business_unit': {'id': 'BU-ENG', 'name': 'Engineering'},
}

CERT_B = {
    'serial_number': 'CERT-BBB',
    'common_name': 'b.example.com',
    'status': 'issued',
    'expires_in_days': 200,
    'valid_to': '2027-06-01',
    'seat': {'seat_id': 'b.example.com', 'seat_name': ''},
    'business_unit': {'id': 'BU-FIN', 'name': 'Finance'},
}


@pytest.fixture(autouse=True)
def tmp_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / 'test.db')
    import routes.campaigns
    import routes.owner_store
    monkeypatch.setattr(routes.campaigns, 'DB_PATH', db_path)
    monkeypatch.setattr(routes.owner_store, 'DB_PATH', db_path)
    routes.owner_store.init_db()
    routes.campaigns.init_campaigns_db()


def _mock_cert_search(certs):
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate-search',
             json={'certificates': certs, 'has_more': False})
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate-search',
             json={'certificates': [], 'has_more': False})


@rsps.activate
def test_create_campaign_snapshots_active_certs(client):
    _mock_cert_search([CERT_A, CERT_B])
    resp = client.post('/api/campaigns', json={'name': 'Q4 Review'})
    assert resp.status_code == 201
    data = resp.get_json()
    assert data['name'] == 'Q4 Review'
    assert data['item_count'] == 2


@rsps.activate
def test_create_campaign_with_bu_scope(client):
    _mock_cert_search([CERT_A, CERT_B])
    resp = client.post('/api/campaigns', json={'name': 'Eng Review', 'scope_bu_id': 'BU-ENG'})
    assert resp.status_code == 201
    assert resp.get_json()['item_count'] == 1


@rsps.activate
def test_list_campaigns_includes_summary(client):
    _mock_cert_search([CERT_A, CERT_B])
    client.post('/api/campaigns', json={'name': 'Q4 Review'})
    resp = client.get('/api/campaigns')
    assert resp.status_code == 200
    campaigns = resp.get_json()
    assert len(campaigns) == 1
    assert campaigns[0]['total'] == 2
    assert campaigns[0]['pending'] == 2
    assert campaigns[0]['approved'] == 0


@rsps.activate
def test_get_campaign_detail_includes_items(client):
    _mock_cert_search([CERT_A])
    campaign_id = client.post('/api/campaigns', json={'name': 'Q4'}).get_json()['id']
    resp = client.get(f'/api/campaigns/{campaign_id}')
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data['items']) == 1
    assert data['items'][0]['serial_number'] == 'CERT-AAA'
    assert data['items'][0]['decision'] is None


@rsps.activate
def test_decide_approve_records_decision(client):
    _mock_cert_search([CERT_A])
    campaign_id = client.post('/api/campaigns', json={'name': 'Q4'}).get_json()['id']
    resp = client.post(f'/api/campaigns/{campaign_id}/items/CERT-AAA/decide',
                       json={'decision': 'approved'})
    assert resp.status_code == 200
    assert resp.get_json()['decision'] == 'approved'


@rsps.activate
def test_decide_revoke_calls_digicert(client):
    _mock_cert_search([CERT_A])
    rsps.add(rsps.PUT, f'{DIGICERT_BASE}/mpki/api/v1/certificate/CERT-AAA/revoke', status=204)
    campaign_id = client.post('/api/campaigns', json={'name': 'Q4'}).get_json()['id']
    resp = client.post(f'/api/campaigns/{campaign_id}/items/CERT-AAA/decide',
                       json={'decision': 'revoked'})
    assert resp.status_code == 200
    assert resp.get_json()['decision'] == 'revoked'
    assert any('revoke' in c.request.url for c in rsps.calls)


@rsps.activate
def test_all_decided_marks_campaign_completed(client):
    _mock_cert_search([CERT_A])
    campaign_id = client.post('/api/campaigns', json={'name': 'Q4'}).get_json()['id']
    client.post(f'/api/campaigns/{campaign_id}/items/CERT-AAA/decide',
                json={'decision': 'approved'})
    campaign = client.get(f'/api/campaigns/{campaign_id}').get_json()
    assert campaign['status'] == 'completed'


@rsps.activate
def test_create_campaign_missing_name_returns_400(client):
    resp = client.post('/api/campaigns', json={})
    assert resp.status_code == 400


def test_get_nonexistent_campaign_returns_404(client):
    resp = client.get('/api/campaigns/does-not-exist')
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pytest tests/test_campaigns.py -v
```

Expected: `ModuleNotFoundError: No module named 'routes.campaigns'`

- [ ] **Step 3: Create `routes/campaigns.py`**

```python
import sqlite3
import os
import uuid
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request
import digicert_client as dc
from routes.certificates import _fetch_all_certs, PROFILE_ID
from routes.ownership import update_seat_owner

campaigns_bp = Blueprint('campaigns', __name__)

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'owner_assignments.db')


def init_campaigns_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS campaigns (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                scope_bu_id TEXT,
                deadline    TEXT,
                status      TEXT NOT NULL DEFAULT 'active',
                created_at  TEXT NOT NULL
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS campaign_items (
                id              TEXT PRIMARY KEY,
                campaign_id     TEXT NOT NULL,
                serial_number   TEXT NOT NULL,
                common_name     TEXT,
                seat_id         TEXT,
                owner           TEXT,
                bu_name         TEXT,
                valid_to        TEXT,
                decision        TEXT,
                new_owner       TEXT,
                new_owner_email TEXT,
                decided_at      TEXT,
                FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
            )
        ''')
        conn.commit()


def _db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _fetch_certs_all():
    certs = _fetch_all_certs({})
    try:
        profile_certs = _fetch_all_certs({'profile_id': PROFILE_ID})
        seen = {c.get('serial_number') for c in certs}
        certs += [c for c in profile_certs if c.get('serial_number') not in seen]
    except Exception:
        pass
    return certs


def _campaign_summary(campaign_id, conn):
    rows = conn.execute('SELECT decision FROM campaign_items WHERE campaign_id=?', (campaign_id,)).fetchall()
    decisions = [r['decision'] for r in rows]
    return {
        'total':      len(decisions),
        'approved':   decisions.count('approved'),
        'revoked':    decisions.count('revoked'),
        'reassigned': decisions.count('reassigned'),
        'pending':    decisions.count(None),
    }


@campaigns_bp.route('/api/campaigns', methods=['POST'])
def create_campaign():
    body = request.get_json() or {}
    name = (body.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400

    scope_bu_id = body.get('scope_bu_id') or None
    deadline = body.get('deadline') or None

    certs = _fetch_certs_all()
    active = [c for c in certs if c.get('status') in ('issued', 'active')]

    # Load local BU overrides to apply scope filter correctly
    with _db() as conn:
        owner_map = {r['serial_number']: r['owner_name']
                     for r in conn.execute('SELECT serial_number, owner_name FROM owner_assignments').fetchall()}
        bu_map = {r['serial_number']: r['bu_id']
                  for r in conn.execute('SELECT serial_number, bu_id FROM bu_assignments').fetchall()}

    if scope_bu_id:
        def effective_bu(c):
            s = c.get('serial_number', '')
            return bu_map.get(s) or (c.get('business_unit') or {}).get('id')
        active = [c for c in active if effective_bu(c) == scope_bu_id]

    now = datetime.now(timezone.utc).isoformat()
    campaign_id = str(uuid.uuid4())

    with _db() as conn:
        conn.execute(
            'INSERT INTO campaigns (id, name, scope_bu_id, deadline, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            (campaign_id, name, scope_bu_id, deadline, 'active', now),
        )
        for cert in active:
            serial = cert.get('serial_number', '')
            cn = (
                (cert.get('subject') or {}).get('common_name')
                or cert.get('common_name')
                or (cert.get('seat') or {}).get('seat_id')
            )
            seat = cert.get('seat') or {}
            seat_id = seat.get('seat_id') or serial
            owner = seat.get('seat_name') or owner_map.get(serial) or ''
            bu_name = (cert.get('business_unit') or {}).get('name') or ''
            valid_to = (cert.get('valid_to') or '')[:10]
            conn.execute(
                'INSERT INTO campaign_items (id, campaign_id, serial_number, common_name, seat_id, owner, bu_name, valid_to) '
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                (f'{campaign_id}:{serial}', campaign_id, serial, cn, seat_id, owner, bu_name, valid_to),
            )
        conn.commit()

    return jsonify({'id': campaign_id, 'name': name, 'item_count': len(active)}), 201


@campaigns_bp.route('/api/campaigns')
def list_campaigns():
    with _db() as conn:
        campaigns = conn.execute('SELECT * FROM campaigns ORDER BY created_at DESC').fetchall()
        result = []
        for c in campaigns:
            d = dict(c)
            d.update(_campaign_summary(c['id'], conn))
            result.append(d)
    return jsonify(result)


@campaigns_bp.route('/api/campaigns/<campaign_id>')
def get_campaign(campaign_id):
    with _db() as conn:
        campaign = conn.execute('SELECT * FROM campaigns WHERE id=?', (campaign_id,)).fetchone()
        if not campaign:
            return jsonify({'error': 'not found'}), 404
        items = conn.execute('SELECT * FROM campaign_items WHERE campaign_id=?', (campaign_id,)).fetchall()
        summary = _campaign_summary(campaign_id, conn)
    d = dict(campaign)
    d.update(summary)
    d['items'] = [dict(i) for i in items]
    return jsonify(d)


@campaigns_bp.route('/api/campaigns/<campaign_id>/items/<serial>/decide', methods=['POST'])
def decide_item(campaign_id, serial):
    body = request.get_json() or {}
    decision = (body.get('decision') or '').strip()
    if decision not in ('approved', 'revoked', 'reassigned'):
        return jsonify({'error': 'decision must be approved, revoked, or reassigned'}), 400

    item_id = f'{campaign_id}:{serial}'
    with _db() as conn:
        item = conn.execute('SELECT * FROM campaign_items WHERE id=?', (item_id,)).fetchone()
    if not item:
        return jsonify({'error': 'not found'}), 404

    new_owner = (body.get('new_owner') or '').strip() or None
    new_owner_email = (body.get('new_owner_email') or '').strip() or None

    if decision == 'revoked':
        dc.put(f'/mpki/api/v1/certificate/{serial}/revoke', {'revocation_reason': 'SUPERSEDED'})

    elif decision == 'reassigned':
        if not new_owner:
            return jsonify({'error': 'new_owner is required for reassign'}), 400
        now = datetime.now(timezone.utc).isoformat()
        with _db() as conn:
            conn.execute(
                'INSERT OR REPLACE INTO owner_assignments (serial_number, owner_name, assigned_at) VALUES (?, ?, ?)',
                (serial, new_owner, now),
            )
            conn.commit()
        if item['seat_id']:
            update_seat_owner(item['seat_id'], seat_name=new_owner, email=new_owner_email or '')

    now = datetime.now(timezone.utc).isoformat()
    with _db() as conn:
        conn.execute(
            'UPDATE campaign_items SET decision=?, new_owner=?, new_owner_email=?, decided_at=? WHERE id=?',
            (decision, new_owner, new_owner_email, now, item_id),
        )
        pending = conn.execute(
            'SELECT COUNT(*) as cnt FROM campaign_items WHERE campaign_id=? AND decision IS NULL',
            (campaign_id,),
        ).fetchone()['cnt']
        if pending == 0:
            conn.execute("UPDATE campaigns SET status='completed' WHERE id=?", (campaign_id,))
        conn.commit()
        updated = conn.execute('SELECT * FROM campaign_items WHERE id=?', (item_id,)).fetchone()

    return jsonify(dict(updated))


@campaigns_bp.route('/api/campaigns/<campaign_id>/status', methods=['PATCH'])
def update_campaign_status(campaign_id):
    status = (request.get_json() or {}).get('status', '').strip()
    if status != 'cancelled':
        return jsonify({'error': 'status must be cancelled'}), 400
    with _db() as conn:
        conn.execute('UPDATE campaigns SET status=? WHERE id=?', (status, campaign_id))
        conn.commit()
        campaign = conn.execute('SELECT * FROM campaigns WHERE id=?', (campaign_id,)).fetchone()
    if not campaign:
        return jsonify({'error': 'not found'}), 404
    return jsonify(dict(campaign))
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
pytest tests/test_campaigns.py -v
```

Expected: 9 tests PASSED

- [ ] **Step 5: Commit**

```bash
git add routes/campaigns.py tests/test_campaigns.py
git commit -m "feat: campaigns CRUD + snapshot + approve/revoke/reassign decisions"
```

---

### Task 7: Register campaigns blueprint in `app.py`

**Files:**
- Modify: `app.py`

- [ ] **Step 1: Update `app.py`**

Add after the existing findings imports/registers block so the complete import+register block reads:

```python
    from routes.certificates import certificates_bp
    from routes.ownership import ownership_bp
    from routes.remediation import remediation_bp
    from routes.owner_store import owner_store_bp, init_db
    from routes.users import users_bp
    from routes.findings import findings_bp, init_findings_db
    from routes.campaigns import campaigns_bp, init_campaigns_db

    app.register_blueprint(certificates_bp)
    app.register_blueprint(ownership_bp)
    app.register_blueprint(remediation_bp)
    app.register_blueprint(owner_store_bp)
    app.register_blueprint(users_bp)
    app.register_blueprint(findings_bp)
    app.register_blueprint(campaigns_bp)
    init_db()
    init_findings_db()
    init_campaigns_db()
```

- [ ] **Step 2: Smoke test**

```bash
python -c "from app import create_app; app = create_app(); print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add app.py
git commit -m "feat: register campaigns blueprint in app"
```

---

### Task 8: Add Campaign types + fetch functions to `api.ts`

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Append to `frontend/src/api.ts`** (after the `updateFindingStatus` export)

```typescript
export interface CampaignItem {
  id: string;
  campaign_id: string;
  serial_number: string;
  common_name: string | null;
  seat_id: string | null;
  owner: string;
  bu_name: string;
  valid_to: string;
  decision: 'approved' | 'revoked' | 'reassigned' | null;
  new_owner: string | null;
  new_owner_email: string | null;
  decided_at: string | null;
}

export interface Campaign {
  id: string;
  name: string;
  scope_bu_id: string | null;
  deadline: string | null;
  status: 'active' | 'completed' | 'cancelled';
  created_at: string;
  total: number;
  approved: number;
  revoked: number;
  reassigned: number;
  pending: number;
}

export interface CampaignDetail extends Campaign {
  items: CampaignItem[];
}

export async function fetchCampaigns(): Promise<Campaign[]> {
  const res = await fetch('/api/campaigns');
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchCampaign(id: string): Promise<CampaignDetail> {
  const res = await fetch(`/api/campaigns/${id}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createCampaign(
  name: string,
  scope_bu_id?: string,
  deadline?: string,
): Promise<{ id: string; name: string; item_count: number }> {
  const res = await fetch('/api/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, scope_bu_id: scope_bu_id || null, deadline: deadline || null }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function decideCampaignItem(
  campaignId: string,
  serial: string,
  decision: 'approved' | 'revoked' | 'reassigned',
  new_owner?: string,
  new_owner_email?: string,
): Promise<CampaignItem> {
  const res = await fetch(`/api/campaigns/${campaignId}/items/${serial}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, new_owner, new_owner_email }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/baber.amin/projects/digicert-poc/frontend
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat: Campaign/CampaignItem/CampaignDetail types + fetch functions"
```

---

### Task 9: Create `CampaignsPage.tsx`

**Files:**
- Create: `frontend/src/pages/CampaignsPage.tsx`

Context: Two conditional views within the same page — list view (default) and detail view (when a campaign is clicked). "New Campaign" uses `SidePanel`. Decision buttons are inline per row. Reassign opens a `<select>` within the row — simple select avoids dropdown positioning complexity. All CSS follows InventoryPage patterns exactly.

- [ ] **Step 1: Create `frontend/src/pages/CampaignsPage.tsx`**

```tsx
import { useState, useEffect } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Chip } from '../components/Chip';
import { SidePanel } from '../components/SidePanel';
import {
  fetchCampaigns, fetchCampaign, createCampaign, decideCampaignItem,
  fetchBusinessUnits, fetchUsers,
} from '../api';
import type { Campaign, CampaignDetail, CampaignItem, BusinessUnit, User } from '../api';

function decisionColor(d: string | null): 'green' | 'red' | 'amber' | 'gray' {
  if (d === 'approved') return 'green';
  if (d === 'revoked') return 'red';
  if (d === 'reassigned') return 'amber';
  return 'gray';
}

function campaignStatusColor(s: string): 'blue' | 'green' | 'gray' {
  if (s === 'active') return 'blue';
  if (s === 'completed') return 'green';
  return 'gray';
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function ProgressBar({ total, pending }: { total: number; pending: number }) {
  const pct = total > 0 ? Math.round(((total - pending) / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-2 bg-indigo-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500">{total - pending}/{total}</span>
    </div>
  );
}

function DecisionButtons({
  item,
  users,
  onDecide,
}: {
  item: CampaignItem;
  users: User[];
  onDecide: (serial: string, decision: 'approved' | 'revoked' | 'reassigned', newOwner?: User) => void;
}) {
  const [reassigning, setReassigning] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');

  if (item.decision !== null) {
    return (
      <div className="flex items-center gap-2">
        <Chip label={item.decision.charAt(0).toUpperCase() + item.decision.slice(1)} color={decisionColor(item.decision)} />
        {item.new_owner && <span className="text-xs text-gray-500">→ {item.new_owner}</span>}
      </div>
    );
  }

  if (reassigning) {
    const selectedUser = users.find(u => u.id === selectedUserId) ?? null;
    return (
      <div className="flex items-center gap-2">
        <select
          value={selectedUserId}
          onChange={e => setSelectedUserId(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">Select user...</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <button
          disabled={!selectedUser}
          onClick={() => { if (selectedUser) { onDecide(item.serial_number, 'reassigned', selectedUser); setReassigning(false); } }}
          className="px-2 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-40"
        >
          Confirm
        </button>
        <button
          onClick={() => { setReassigning(false); setSelectedUserId(''); }}
          className="px-2 py-1 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-1.5">
      <button
        onClick={() => onDecide(item.serial_number, 'approved')}
        className="px-2.5 py-1 text-xs border border-green-300 text-green-700 rounded hover:bg-green-50"
      >
        Approve
      </button>
      <button
        onClick={() => onDecide(item.serial_number, 'revoked')}
        className="px-2.5 py-1 text-xs border border-red-300 text-red-700 rounded hover:bg-red-50"
      >
        Revoke
      </button>
      <button
        onClick={() => setReassigning(true)}
        className="px-2.5 py-1 text-xs border border-amber-300 text-amber-700 rounded hover:bg-amber-50"
      >
        Reassign
      </button>
    </div>
  );
}

export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [bus, setBus] = useState<BusinessUnit[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBuId, setNewBuId] = useState('');
  const [newDeadline, setNewDeadline] = useState('');
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState('');

  useEffect(() => {
    Promise.all([fetchCampaigns(), fetchBusinessUnits(), fetchUsers()])
      .then(([c, b, u]) => { setCampaigns(c); setBus(b); setUsers(u); })
      .finally(() => setLoading(false));
  }, []);

  async function openCampaign(c: Campaign) {
    const d = await fetchCampaign(c.id);
    setDetail(d);
  }

  async function handleDecide(
    serial: string,
    decision: 'approved' | 'revoked' | 'reassigned',
    newUser?: User,
  ) {
    if (!detail) return;
    try {
      const updated = await decideCampaignItem(
        detail.id, serial, decision,
        newUser?.name, newUser?.email,
      );
      setDetail(prev => {
        if (!prev) return prev;
        const items = prev.items.map((i: CampaignItem) => i.serial_number === serial ? updated : i);
        return {
          ...prev,
          items,
          approved:   items.filter((i: CampaignItem) => i.decision === 'approved').length,
          revoked:    items.filter((i: CampaignItem) => i.decision === 'revoked').length,
          reassigned: items.filter((i: CampaignItem) => i.decision === 'reassigned').length,
          pending:    items.filter((i: CampaignItem) => i.decision === null).length,
        };
      });
    } catch { /* silent */ }
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateMsg('');
    try {
      const result = await createCampaign(newName.trim(), newBuId || undefined, newDeadline || undefined);
      setCreateMsg(`Created with ${result.item_count} certificates.`);
      const refreshed = await fetchCampaigns();
      setCampaigns(refreshed);
      setNewName(''); setNewBuId(''); setNewDeadline('');
      setTimeout(() => { setShowNew(false); setCreateMsg(''); }, 1500);
    } catch {
      setCreateMsg('Failed to create campaign.');
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="text-center py-16 text-gray-400">Loading...</div>;

  // Detail view
  if (detail) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-1">
          <button onClick={() => setDetail(null)} className="text-sm text-gray-400 hover:text-gray-600">
            ← Campaigns
          </button>
        </div>
        <PageHeader
          title={detail.name}
          subtitle={`Created ${formatDate(detail.created_at)}${detail.deadline ? ` · Due ${formatDate(detail.deadline)}` : ''}`}
        />

        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-gray-500">{detail.total} certs</span>
          <Chip label={`${detail.approved} Approved`} color="green" />
          <Chip label={`${detail.revoked} Revoked`} color="red" />
          <Chip label={`${detail.reassigned} Reassigned`} color="amber" />
          <Chip label={`${detail.pending} Pending`} color="gray" />
          <div className="flex-1 mx-2 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-2 bg-indigo-600 rounded-full transition-all"
              style={{ width: `${detail.total > 0 ? Math.round(((detail.total - detail.pending) / detail.total) * 100) : 0}%` }}
            />
          </div>
          <Chip label={detail.status.charAt(0).toUpperCase() + detail.status.slice(1)} color={campaignStatusColor(detail.status)} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Common Name</th>
                <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">BU</th>
                <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Owner</th>
                <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Expires</th>
                <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Decision</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map(item => (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="px-4 py-3 font-medium text-gray-900">{item.common_name ?? item.serial_number}</td>
                  <td className="px-4 py-3 text-gray-600">{item.bu_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{item.owner || <span className="text-gray-400 italic text-xs">Unassigned</span>}</td>
                  <td className="px-4 py-3 text-gray-600">{item.valid_to || '—'}</td>
                  <td className="px-4 py-3">
                    <DecisionButtons item={item} users={users} onDecide={handleDecide} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <PageHeader title="Access Review Campaigns" subtitle="Periodic certification of certificate ownership and necessity." />
        <button
          onClick={() => setShowNew(true)}
          className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          New Campaign
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Name</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Scope</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Created</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Deadline</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Progress</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  No campaigns yet. Create one to get started.
                </td>
              </tr>
            ) : campaigns.map(c => {
              const scopeBu = bus.find(b => b.id === c.scope_bu_id);
              return (
                <tr
                  key={c.id}
                  onClick={() => openCampaign(c)}
                  className="border-b border-gray-100 cursor-pointer hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3 text-gray-600">{scopeBu?.name ?? 'All BUs'}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(c.created_at)}</td>
                  <td className="px-4 py-3 text-gray-600">{c.deadline ? formatDate(c.deadline) : '—'}</td>
                  <td className="px-4 py-3"><ProgressBar total={c.total} pending={c.pending} /></td>
                  <td className="px-4 py-3">
                    <Chip label={c.status.charAt(0).toUpperCase() + c.status.slice(1)} color={campaignStatusColor(c.status)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showNew && (
        <SidePanel
          title="New Campaign"
          onClose={() => { setShowNew(false); setCreateMsg(''); }}
          footer={
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {creating ? 'Creating...' : 'Create Campaign'}
            </button>
          }
        >
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Campaign Name *</label>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Q4 2026 NHI Review"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Scope — Business Unit</label>
              <select
                value={newBuId}
                onChange={e => setNewBuId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All Business Units</option>
                {bus.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Deadline (optional)</label>
              <input
                type="date"
                value={newDeadline}
                onChange={e => setNewDeadline(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {createMsg && (
              <p className={`text-sm ${createMsg.startsWith('Failed') ? 'text-red-600' : 'text-green-700'}`}>
                {createMsg}
              </p>
            )}
          </div>
        </SidePanel>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/baber.amin/projects/digicert-poc/frontend
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/CampaignsPage.tsx
git commit -m "feat: CampaignsPage with list, detail, new-campaign panel, and inline decisions"
```

---

### Task 10: Add Campaigns to Sidebar and Router

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Update `Sidebar.tsx`**

Change `navItems` to:

```typescript
const navItems = [
  { label: 'Overview', to: '/' },
  { label: 'Certificate Inventory', to: '/inventory' },
  { label: 'Campaigns', to: '/campaigns' },
  { label: 'Findings', to: '/findings' },
];
```

- [ ] **Step 2: Update `App.tsx`**

```tsx
import { Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { OverviewPage } from './pages/OverviewPage';
import { InventoryPage } from './pages/InventoryPage';
import { FindingsPage } from './pages/FindingsPage';
import { CampaignsPage } from './pages/CampaignsPage';

export default function App() {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="ml-56 flex-1 px-8 py-6">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/campaigns" element={<CampaignsPage />} />
          <Route path="/findings" element={<FindingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Type-check and build**

```bash
cd /Users/baber.amin/projects/digicert-poc/frontend
npx tsc --noEmit && npm run build
```

Expected: no errors, build succeeds

- [ ] **Step 4: Run full test suite**

```bash
cd /Users/baber.amin/projects/digicert-poc
source .venv/bin/activate
pytest tests/ -v
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/App.tsx static/
git commit -m "feat: add Campaigns nav link and route — governance features complete"
```
