import json
import pytest
import responses as rsps
from routes.certificates import PROFILE_ID as TENANT_PROFILE_ID
from routes.ownership import get_business_units

DIGICERT_BASE = 'https://demo.one.digicert.com'
PROFILE_ID = '2f2afae4-78b6-4c4c-a00b-f1434183eae0'

@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    import routes.owner_store
    monkeypatch.setattr(routes.owner_store, 'DB_PATH', str(tmp_path / 'test.db'))
    routes.owner_store.init_db()


MOCK_PROFILE = {
    'id': PROFILE_ID,
    'name': 'baber private cert',
    'status': 'Active',
    'business_unit_id': 'BU-1',
    'business_unit_name': 'Default Business Unit',
    'key_escrow_policy': {'key_escrow_enabled': False},
    'private_key_attributes': {'key_size': '2048'},
}

MOCK_CERT = {
    'serial_number': 'CERT-SERIAL-001',
    'common_name': 'test.example.com',
    'status': 'issued',
    'valid_till': '2026-10-11T00:00:00.000Z',
    'issued_on': '2026-10-06T00:00:00.000Z',
    'profile': {'id': PROFILE_ID, 'name': 'baber private cert'},
    'business_unit': {'id': 'BU-1', 'name': 'Default Business Unit'},
    'seat': {'seat_id': 'user@saviynt.com', 'user_name': 'Baber Amin'},
    'tags': [],
    'san': {'dns_names': ['test.example.com']},
}


@rsps.activate
def test_list_profiles(client):
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/profile', json=[MOCK_PROFILE], status=200)
    resp = client.get('/api/profiles')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data[0]['name'] == 'baber private cert'
    assert rsps.calls[0].request.headers['x-api-key'] == 'test-api-key'


@rsps.activate
def test_get_profile(client):
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/profile/{PROFILE_ID}', json=MOCK_PROFILE, status=200)
    resp = client.get(f'/api/profiles/{PROFILE_ID}')
    assert resp.status_code == 200
    assert resp.get_json()['id'] == PROFILE_ID


@rsps.activate
def test_list_certificates_returns_a_plain_list(client):
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate-search', json={'items': [MOCK_CERT], 'total': 1}, status=200)
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate-search', json={'items': [], 'total': 0}, status=200)
    resp = client.get('/api/certificates')
    assert resp.status_code == 200
    data = resp.get_json()
    assert [c['serial_number'] for c in data] == ['CERT-SERIAL-001']
    assert rsps.calls[0].request.headers['x-api-key'] == 'test-api-key'


@rsps.activate
def test_list_certificates_also_pulls_our_profile_without_duplicates(client):
    extra = {**MOCK_CERT, 'serial_number': 'PROFILE-ONLY'}
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate-search', json={'items': [MOCK_CERT]}, status=200)
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate-search', json={'items': [MOCK_CERT, extra]}, status=200)
    serials = [c['serial_number'] for c in client.get('/api/certificates').get_json()]
    assert serials == ['CERT-SERIAL-001', 'PROFILE-ONLY']
    assert 'profile_id=' + TENANT_PROFILE_ID in rsps.calls[1].request.url


@rsps.activate
def test_get_certificate(client):
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate/CERT-SERIAL-001', json=MOCK_CERT, status=200)
    resp = client.get('/api/certificates/CERT-SERIAL-001')
    assert resp.status_code == 200
    assert resp.get_json()['common_name'] == 'test.example.com'


@rsps.activate
def test_digicert_error_is_proxied(client):
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate-search', json={'message': 'Unauthorized'}, status=401)
    resp = client.get('/api/certificates')
    assert resp.status_code == 401
    assert resp.get_json()['message'] == 'Unauthorized'


@rsps.activate
def test_issue_certificate(client):
    new_cert = {**MOCK_CERT, 'serial_number': 'NEW-SERIAL-002'}
    rsps.add(rsps.POST, f'{DIGICERT_BASE}/mpki/api/v1/certificate', json=new_cert, status=201)

    resp = client.post('/api/certificates/issue', json={'common_name': 'test.example.com'})
    assert resp.status_code == 201
    data = resp.get_json()
    assert data['serial_number'] == 'NEW-SERIAL-002'
    assert data['private_key'].startswith('-----BEGIN')

    sent = rsps.calls[0].request
    body = json.loads(sent.body)
    assert body['profile'] == {'id': TENANT_PROFILE_ID}
    assert body['seat'] == {'seat_id': 'test.example.com'}
    assert body['attributes'] == {'subject.common_name': 'test.example.com'}
    assert 'BEGIN CERTIFICATE REQUEST' in body['csr']
    assert sent.headers['x-api-key'] == 'test-api-key'


@rsps.activate
def test_issue_requires_a_common_name(client):
    assert client.post('/api/certificates/issue', json={}).status_code == 400
    assert len(rsps.calls) == 0


@rsps.activate
def test_issue_into_a_business_unit_creates_the_seat_first_and_remembers_the_bu(client, tmp_db):
    new_cert = {**MOCK_CERT, 'serial_number': 'NEW-SERIAL-003'}
    rsps.add(rsps.POST, f'{DIGICERT_BASE}/mpki/api/v1/seat', json={}, status=201)
    rsps.add(rsps.POST, f'{DIGICERT_BASE}/mpki/api/v1/certificate', json=new_cert, status=201)
    eng = next(b for b in get_business_units() if b['name'] == 'Engineering')

    resp = client.post('/api/certificates/issue', json={'common_name': 't.example.com', 'business_unit_id': eng['id']})
    assert resp.status_code == 201
    assert [c.request.url.rsplit('/', 1)[-1] for c in rsps.calls] == ['seat', 'certificate']
    # DigiCert files the cert under the profile's BU, so the intended BU is kept locally
    assert client.get('/api/bu-assignments').get_json() == {'NEW-SERIAL-003': {'id': eng['id'], 'name': 'Engineering'}}
