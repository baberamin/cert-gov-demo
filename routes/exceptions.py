import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request
import digicert_client as dc
from routes.certificates import fetch_inventory
from routes.ownership import update_seat_owner
from routes.recommendations import recommend, peer_counter, cert_name
from routes.users import USERS

exceptions_bp = Blueprint('exceptions', __name__)

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'owner_assignments.db')

HUMAN_OUTCOMES = ('approved', 'revoked', 'reassigned')
AUTO_OUTCOMES = ('auto_approved', 'needs_review')

# Editable params per rule template. Every param is a non-negative integer.
TEMPLATES = {
    'unowned': {
        'description': 'Escalate certificates that have no owner in DigiCert or the local store.',
        'params': {},
    },
    'policy_violation': {
        'description': 'Escalate certificates with a weak key or an overly long validity span.',
        'params': {'min_key_size': 'Minimum key size (bits)', 'max_validity_days': 'Maximum validity (days)'},
    },
    'healthy_owned': {
        'description': 'Auto-approve owned certificates that meet every threshold below.',
        'params': {
            'min_key_size': 'Minimum key size (bits)',
            'max_validity_days': 'Maximum validity (days)',
            'min_days_to_expiry': 'Minimum days until expiry',
        },
    },
}

DEFAULT_RULES = [
    ('Unowned certificate', 'unowned', 'escalate', {}, 10),
    ('Policy violation', 'policy_violation', 'escalate', {'min_key_size': 2048, 'max_validity_days': 365}, 20),
    ('Healthy and owned', 'healthy_owned', 'auto_approve',
     {'min_key_size': 2048, 'max_validity_days': 365, 'min_days_to_expiry': 30}, 30),
]

_refresh_lock = threading.Lock()


def _db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_exceptions_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS rules (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                name     TEXT NOT NULL,
                template TEXT NOT NULL,
                outcome  TEXT NOT NULL,
                params   TEXT NOT NULL,
                enabled  INTEGER NOT NULL DEFAULT 1,
                priority INTEGER NOT NULL
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS decisions (
                serial_number   TEXT PRIMARY KEY,
                common_name     TEXT,
                seat_id         TEXT,
                owner           TEXT,
                bu_name         TEXT,
                valid_to        TEXT,
                expires_in_days INTEGER,
                outcome         TEXT NOT NULL,
                rule_id         INTEGER,
                rule_name       TEXT,
                rule_snapshot   TEXT,
                reason          TEXT,
                decided_by      TEXT NOT NULL,
                decided_at      TEXT NOT NULL,
                new_owner       TEXT,
                new_owner_email TEXT,
                recommendation  TEXT,
                ca_vendor       TEXT
            )
        ''')
        have = {r[1] for r in conn.execute('PRAGMA table_info(decisions)')}
        for column in ('recommendation', 'ca_vendor'):
            if column not in have:
                conn.execute(f'ALTER TABLE decisions ADD COLUMN {column} TEXT')
        if conn.execute('SELECT COUNT(*) FROM rules').fetchone()[0] == 0:
            for name, template, outcome, params, priority in DEFAULT_RULES:
                conn.execute(
                    'INSERT INTO rules (name, template, outcome, params, enabled, priority) VALUES (?, ?, ?, ?, 1, ?)',
                    (name, template, outcome, json.dumps(params), priority),
                )
        conn.commit()


def _rule_dict(row):
    d = dict(row)
    d['params'] = json.loads(d['params'])
    d['enabled'] = bool(d['enabled'])
    return d


def _load_rules(conn):
    rows = conn.execute('SELECT * FROM rules ORDER BY priority').fetchall()
    return [_rule_dict(r) for r in rows]


def _facts(cert, owner_map):
    serial = cert.get('serial_number')
    owner = (cert.get('seat') or {}).get('seat_name') or owner_map.get(serial) or ''
    try:
        key_size = int(cert.get('key_size') or 0) or None
    except (TypeError, ValueError):
        key_size = None
    validity_days = None
    try:
        vf = datetime.fromisoformat(cert['valid_from'].replace('Z', '+00:00'))
        vt = datetime.fromisoformat(cert['valid_to'].replace('Z', '+00:00'))
        validity_days = (vt - vf).days
    except (KeyError, AttributeError, TypeError, ValueError):
        pass
    try:
        days = int(cert.get('expires_in_days') or 9999)
    except (TypeError, ValueError):
        days = 9999
    return {'owner': owner, 'key_size': key_size, 'validity_days': validity_days, 'days': days}


def _violations(f, p):
    out = []
    if f['key_size'] is not None and f['key_size'] < p['min_key_size']:
        out.append(f"Key size {f['key_size']} bits is below the {p['min_key_size']}-bit minimum")
    if f['validity_days'] is not None and f['validity_days'] > p['max_validity_days']:
        out.append(f"Validity span {f['validity_days']} days exceeds the {p['max_validity_days']}-day limit")
    return out


def _healthy_failures(f, p):
    out = []
    if not f['owner']:
        out.append('No owner assigned')
    out += _violations(f, p)
    if f['days'] < p['min_days_to_expiry']:
        out.append(f"Expires in {f['days']} days (auto-approve requires at least {p['min_days_to_expiry']})")
    return out


def _healthy_reason(f, p):
    key = f"key {f['key_size']}-bit (min {p['min_key_size']})" if f['key_size'] else 'key size not reported'
    val = (f"validity {f['validity_days']} days (max {p['max_validity_days']})"
           if f['validity_days'] is not None else 'validity not reported')
    return f"Owner present; {key}; {val}; expires in {f['days']} days (min {p['min_days_to_expiry']})."


def _evaluate(facts, rules):
    """First enabled matching rule wins. No match means a human must look."""
    healthy = None
    for rule in rules:
        if not rule['enabled']:
            continue
        p, t = rule['params'], rule['template']
        if t == 'unowned' and not facts['owner']:
            return {'outcome': 'needs_review', 'rule': rule,
                    'reason': 'No owner assigned in DigiCert or the local store.'}
        if t == 'policy_violation':
            v = _violations(facts, p)
            if v:
                return {'outcome': 'needs_review', 'rule': rule, 'reason': '; '.join(v) + '.'}
        if t == 'healthy_owned':
            healthy = rule
            if not _healthy_failures(facts, p):
                return {'outcome': 'auto_approved', 'rule': rule, 'reason': _healthy_reason(facts, p)}
    if healthy:
        reason = '; '.join(_healthy_failures(facts, healthy['params'])) + '.'
    else:
        reason = 'No enabled rule approves this certificate.'
    return {'outcome': 'needs_review', 'rule': None, 'reason': reason}


def _snapshot(rule):
    if not rule:
        return None
    return json.dumps({k: rule[k] for k in ('id', 'name', 'template', 'outcome', 'params')})


def _active_with_facts(certs, owner_map):
    for cert in certs:
        if cert.get('status') in ('issued', 'active') and cert.get('serial_number'):
            yield cert, _facts(cert, owner_map)


def _refresh():
    certs = fetch_inventory()
    with _refresh_lock, _db() as conn:
        owner_map = {r['serial_number']: r['owner_name']
                     for r in conn.execute('SELECT serial_number, owner_name FROM owner_assignments').fetchall()}
        bu_map = {r['serial_number']: r['bu_name']
                  for r in conn.execute('SELECT serial_number, bu_name FROM bu_assignments').fetchall()}
        rules = _load_rules(conn)
        existing = {r['serial_number']: r for r in conn.execute('SELECT * FROM decisions').fetchall()}
        now = datetime.now(timezone.utc).isoformat()
        active = list(_active_with_facts(certs, owner_map))
        # DigiCert files app-issued certs under the profile's BU; the local overlay holds the intended one.
        bu_of = {c['serial_number']: bu_map.get(c['serial_number']) or (c.get('business_unit') or {}).get('name') or ''
                 for c, _ in active}
        info = {c['serial_number']: (bu_of[c['serial_number']], f['owner']) for c, f in active}
        seen = set()
        for cert, facts in active:
            serial = cert['serial_number']
            seen.add(serial)
            prev = existing.get(serial)
            if prev and prev['outcome'] in HUMAN_OUTCOMES:
                continue
            res = _evaluate(facts, rules)
            rule = res['rule']
            seat = cert.get('seat') or {}
            rec = None
            if res['outcome'] == 'needs_review':
                rec = json.dumps(recommend(cert, bu_of[serial], peer_counter(serial, bu_of[serial], info), USERS))
            row = (cert_name(cert), seat.get('seat_id') or serial, facts['owner'], bu_of[serial],
                   (cert.get('valid_to') or '')[:10], facts['days'],
                   res['outcome'], rule['id'] if rule else None, rule['name'] if rule else None,
                   _snapshot(rule), res['reason'], cert.get('ca_vendor') or '')
            unchanged = prev and (prev['outcome'], prev['rule_id'], prev['reason']) == (row[6], row[7], row[10])
            decided_at = prev['decided_at'] if unchanged else now
            conn.execute(
                'INSERT OR REPLACE INTO decisions (serial_number, common_name, seat_id, owner, bu_name, valid_to, '
                'expires_in_days, outcome, rule_id, rule_name, rule_snapshot, reason, ca_vendor, decided_by, '
                'decided_at, recommendation) '
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', ?, ?)",
                (serial, *row, decided_at, rec),
            )
        for serial, prev in existing.items():
            if serial not in seen and prev['outcome'] in AUTO_OUTCOMES:
                conn.execute('DELETE FROM decisions WHERE serial_number=?', (serial,))
        conn.commit()
    return certs


def _rows(outcome):
    with _db() as conn:
        rows = conn.execute(
            'SELECT * FROM decisions WHERE outcome=? ORDER BY expires_in_days, common_name', (outcome,)
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d['rule_snapshot'] = json.loads(d['rule_snapshot']) if d['rule_snapshot'] else None
        d['recommendation'] = json.loads(d['recommendation']) if d.get('recommendation') else None
        out.append(d)
    rank = {'High': 0, 'Medium': 1, 'Low': 2}
    out.sort(key=lambda d: rank.get((d['recommendation'] or {}).get('confidence'), 3))  # stable: keeps expiry order
    return out


@exceptions_bp.route('/api/exceptions')
def list_exceptions():
    _refresh()
    return jsonify(_rows('needs_review'))


@exceptions_bp.route('/api/exceptions/auto-handled')
def list_auto_handled():
    _refresh()
    return jsonify(_rows('auto_approved'))


@exceptions_bp.route('/api/exceptions/<serial>/decide', methods=['POST'])
def decide_exception(serial):
    body = request.get_json() or {}
    decision = (body.get('decision') or '').strip()
    if decision not in HUMAN_OUTCOMES:
        return jsonify({'error': 'decision must be approved, revoked, or reassigned'}), 400
    with _db() as conn:
        item = conn.execute('SELECT * FROM decisions WHERE serial_number=?', (serial,)).fetchone()
    if not item:
        return jsonify({'error': 'not found'}), 404
    if item['outcome'] != 'needs_review':
        return jsonify({'error': 'only certificates awaiting review can be decided'}), 409

    new_owner = (body.get('new_owner') or '').strip() or None
    new_owner_email = (body.get('new_owner_email') or '').strip() or None
    now = datetime.now(timezone.utc).isoformat()

    if decision == 'reassigned':
        if not new_owner:
            return jsonify({'error': 'new_owner is required for reassign'}), 400
        with _db() as conn:
            conn.execute(
                'INSERT OR REPLACE INTO owner_assignments (serial_number, owner_name, assigned_at) VALUES (?, ?, ?)',
                (serial, new_owner, now),
            )
            conn.commit()
        update_seat_owner(item['seat_id'], seat_name=new_owner, email=new_owner_email or '')
    elif decision == 'revoked':
        dc.put(f'/mpki/api/v1/certificate/{serial}/revoke', {'revocation_reason': 'SUPERSEDED'})

    with _db() as conn:
        conn.execute(
            'UPDATE decisions SET outcome=?, decided_by=?, decided_at=?, new_owner=?, new_owner_email=? '
            'WHERE serial_number=?',
            (decision, 'reviewer', now, new_owner, new_owner_email, serial),
        )
        conn.commit()
        row = conn.execute('SELECT * FROM decisions WHERE serial_number=?', (serial,)).fetchone()
    return jsonify(dict(row))


@exceptions_bp.route('/api/rules')
def list_rules():
    with _db() as conn:
        rules = _load_rules(conn)
    for r in rules:
        r['description'] = TEMPLATES[r['template']]['description']
        r['param_labels'] = TEMPLATES[r['template']]['params']
    return jsonify(rules)


def _proposed(rule, body):
    """Validate a rule edit; return (updated_rule, None) or (None, error_message)."""
    updated = {**rule, 'params': dict(rule['params'])}
    if 'params' in body:
        incoming = body['params']
        if not isinstance(incoming, dict):
            return None, 'params must be an object'
        for key, val in incoming.items():
            if key not in TEMPLATES[rule['template']]['params']:
                return None, f'unknown param: {key}'
            if isinstance(val, bool) or not isinstance(val, int) or val < 0:
                return None, f'{key} must be a non-negative integer'
            updated['params'][key] = val
    if 'enabled' in body:
        if not isinstance(body['enabled'], bool):
            return None, 'enabled must be true or false'
        updated['enabled'] = body['enabled']
    if 'params' not in body and 'enabled' not in body:
        return None, 'nothing to update'
    return updated, None


def _get_rule(conn, rule_id):
    row = conn.execute('SELECT * FROM rules WHERE id=?', (rule_id,)).fetchone()
    return _rule_dict(row) if row else None


@exceptions_bp.route('/api/rules/<int:rule_id>', methods=['PATCH'])
def update_rule(rule_id):
    with _db() as conn:
        rule = _get_rule(conn, rule_id)
        if not rule:
            return jsonify({'error': 'not found'}), 404
        updated, err = _proposed(rule, request.get_json() or {})
        if err:
            return jsonify({'error': err}), 400
        conn.execute('UPDATE rules SET params=?, enabled=? WHERE id=?',
                     (json.dumps(updated['params']), int(updated['enabled']), rule_id))
        conn.commit()
    return jsonify(updated)


@exceptions_bp.route('/api/rules/<int:rule_id>/preview', methods=['POST'])
def preview_rule(rule_id):
    with _db() as conn:
        rule = _get_rule(conn, rule_id)
        if not rule:
            return jsonify({'error': 'not found'}), 404
        current = _load_rules(conn)
        human = {r['serial_number'] for r in conn.execute(
            'SELECT serial_number FROM decisions WHERE outcome IN (?, ?, ?)', HUMAN_OUTCOMES).fetchall()}
        owner_map = {r['serial_number']: r['owner_name']
                     for r in conn.execute('SELECT serial_number, owner_name FROM owner_assignments').fetchall()}
    updated, err = _proposed(rule, request.get_json() or {})
    if err:
        return jsonify({'error': err}), 400
    proposed = [updated if r['id'] == rule_id else r for r in current]

    to_queue, to_auto, samples = 0, 0, []
    for cert, facts in _active_with_facts(fetch_inventory(), owner_map):
        serial = cert['serial_number']
        if serial in human:
            continue
        before, after = _evaluate(facts, current), _evaluate(facts, proposed)
        if before['outcome'] == after['outcome']:
            continue
        if after['outcome'] == 'needs_review':
            to_queue += 1
        else:
            to_auto += 1
        if len(samples) < 10:
            samples.append({'serial_number': serial, 'common_name': cert_name(cert),
                            'from': before['outcome'], 'to': after['outcome'], 'reason': after['reason']})
    return jsonify({'to_queue': to_queue, 'to_auto_approved': to_auto, 'samples': samples})
