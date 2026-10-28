import sqlite3
import os
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request
import digicert_client as dc
from routes.certificates import fetch_inventory

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


def _sync_findings(certs):
    """Recompute findings from certs, upsert them (keeping reviewer status), and return all rows."""

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
    return rows


@findings_bp.route('/api/findings')
def list_findings():
    return jsonify(_sync_findings(fetch_inventory()))


@findings_bp.route('/api/overview')
def get_overview():
    certs = fetch_inventory()
    _sync_findings(certs)

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
