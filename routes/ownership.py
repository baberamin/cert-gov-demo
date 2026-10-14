import json
import os
import re
import requests as http_requests
from flask import Blueprint, jsonify, request
import digicert_client as dc

ownership_bp = Blueprint('ownership', __name__)

REAL_DEFAULT_BU_ID = '5045fe0a-7726-4ed1-ae3a-01757c30cb1d'  # Engineering (profile BU)

# Canonical demo BU list — Engineering maps to the known real ID; others are created on sync.
DEMO_BUS = [
    {'key': 'engineering', 'name': 'Engineering',            'default_id': '5045fe0a-7726-4ed1-ae3a-01757c30cb1d'},
    {'key': 'devops',      'name': 'DevOps & Infrastructure','default_id': None},
    {'key': 'finance',     'name': 'Finance & Accounting',   'default_id': None},
    {'key': 'marketing',   'name': 'Marketing & Growth',     'default_id': None},
    {'key': 'legal',       'name': 'Legal & Compliance',     'default_id': None},
    {'key': 'security',    'name': 'Information Security',   'default_id': None},
    {'key': 'product',     'name': 'Product Management',     'default_id': None},
    {'key': 'hr',          'name': 'Human Resources',        'default_id': None},
]

_BU_ID_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'bu_ids.json')
_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)


def _load_bu_ids() -> dict:
    try:
        with open(_BU_ID_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {'engineering': REAL_DEFAULT_BU_ID}


def _save_bu_ids(mapping: dict):
    with open(_BU_ID_FILE, 'w') as f:
        json.dump(mapping, f, indent=2)


def get_business_units() -> list[dict]:
    """Return demo BU list substituting real DigiCert IDs where known."""
    saved = _load_bu_ids()
    result = []
    for bu in DEMO_BUS:
        real_id = saved.get(bu['key']) or bu['default_id']
        result.append({'id': real_id or bu['key'], 'name': bu['name']})
    return result


def resolve_bu_id(bu_id: str) -> str:
    """Map any BU ID to a real DigiCert UUID, falling back to Engineering."""
    if _UUID_RE.match(bu_id):
        return bu_id
    # Try saved registry (key lookup for synthetic IDs like 'bu-devops')
    saved = _load_bu_ids()
    for key, real_id in saved.items():
        if bu_id == key or bu_id == f'bu-{key}':
            return real_id
    return REAL_DEFAULT_BU_ID


def ensure_seat_exists(seat_id: str, bu_id: str,
                       seat_name: str = '', email: str = '') -> None:
    """Create or move a DigiCert seat into the specified BU. Best-effort — never raises."""
    resolved = resolve_bu_id(bu_id)
    if not _UUID_RE.match(resolved):
        return

    payload = {
        'seat_id': seat_id,
        'business_unit_id': resolved,
        'seat_type': {'id': 'SERVER_SEAT'},
    }
    if seat_name:
        payload['seat_name'] = seat_name
    if email:
        payload['email'] = email

    try:
        dc.post('/mpki/api/v1/seat', payload)
    except http_requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 0
        if status in (409, 422):
            pass  # seat exists — inherit its current BU; don't move it
    except Exception:
        pass


def update_seat_owner(seat_id: str, seat_name: str = '', email: str = '') -> None:
    """Write owner info back to a DigiCert seat. Best-effort — never raises."""
    if not seat_id:
        return
    update = {'seat_type': {'id': 'SERVER_SEAT'}}
    if seat_name:
        update['seat_name'] = seat_name
    if email:
        update['email'] = email
    try:
        dc.put(f'/mpki/api/v1/seat/{seat_id}', update)
    except Exception:
        pass


@ownership_bp.route('/api/business-units')
def list_business_units():
    return jsonify(get_business_units())


@ownership_bp.route('/api/business-units/sync', methods=['POST'])
def sync_business_units():
    """
    Idempotent: fetch all DigiCert BUs, match by name, create any missing ones,
    persist real UUIDs to bu_ids.json.
    """
    try:
        data = dc.get('/mpki/api/v1/business-unit', params={'limit': 100})
        existing = data if isinstance(data, list) else data.get('items', data.get('business_units', []))
        existing_by_name = {b['name'].strip().lower(): b['id'] for b in existing}
    except Exception as e:
        return jsonify({'error': f'Failed to fetch DigiCert BUs: {e}'}), 502

    # POST /business-unit requires account.id — pull it from the known Engineering BU
    account_id = None
    try:
        eng = dc.get(f'/mpki/api/v1/business-unit/{REAL_DEFAULT_BU_ID}')
        account_id = (eng.get('account') or {}).get('id')
    except Exception:
        pass

    saved = _load_bu_ids()
    saved['engineering'] = '5045fe0a-7726-4ed1-ae3a-01757c30cb1d'

    results = []
    for bu in DEMO_BUS:
        if bu['key'] == 'engineering':
            results.append({'name': bu['name'], 'status': 'existing', 'id': '5045fe0a-7726-4ed1-ae3a-01757c30cb1d'})
            continue

        # Already have a real ID saved
        if bu['key'] in saved and _UUID_RE.match(saved[bu['key']]):
            results.append({'name': bu['name'], 'status': 'already_synced', 'id': saved[bu['key']]})
            continue

        # Exists in DigiCert by name
        existing_id = existing_by_name.get(bu['name'].strip().lower())
        if existing_id:
            saved[bu['key']] = existing_id
            results.append({'name': bu['name'], 'status': 'found', 'id': existing_id})
            continue

        # Create it in DigiCert
        create_body = {'name': bu['name']}
        if account_id:
            create_body['account'] = {'id': account_id}
        try:
            result = dc.post('/mpki/api/v1/business-unit', create_body)
            new_id = result.get('id') or (result.get('business_unit') or {}).get('id')
            if new_id:
                saved[bu['key']] = new_id
                results.append({'name': bu['name'], 'status': 'created', 'id': new_id})
            else:
                results.append({'name': bu['name'], 'status': 'created_no_id', 'response': result})
        except http_requests.HTTPError as e:
            body = ''
            try:
                body = e.response.json() if e.response is not None else ''
            except Exception:
                body = e.response.text if e.response is not None else ''
            results.append({'name': bu['name'], 'status': 'error',
                            'error': f'HTTP {e.response.status_code if e.response is not None else "?"}: {body}'})
        except Exception as e:
            results.append({'name': bu['name'], 'status': 'error', 'error': str(e)})

    _save_bu_ids(saved)
    return jsonify({'results': results, 'registry': saved})


@ownership_bp.route('/api/business-units/<bu_id>')
def get_business_unit(bu_id):
    return jsonify(dc.get(f'/mpki/api/v1/business-unit/{bu_id}'))


@ownership_bp.route('/api/seats')
def list_seats():
    return jsonify(dc.get('/mpki/api/v1/seat'))
