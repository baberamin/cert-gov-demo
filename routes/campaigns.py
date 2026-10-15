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
