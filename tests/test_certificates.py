import responses as rsps
import json

DIGICERT_BASE = 'https://demo.one.digicert.com'
PROFILE_ID = '2f2afae4-78b6-4c4c-a00b-f1434183eae0'

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
def test_list_certificates(client):
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate-search', json={'items': [MOCK_CERT], 'total': 1}, status=200)
    resp = client.get('/api/certificates')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['items'][0]['serial_number'] == 'CERT-SERIAL-001'
    assert rsps.calls[0].request.headers['x-api-key'] == 'test-api-key'


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
def test_enroll_certificate(client):
    new_cert = {**MOCK_CERT, 'serial_number': 'NEW-SERIAL-002'}
    rsps.add(rsps.POST, f'{DIGICERT_BASE}/mpki/api/v1/certificate', json=new_cert, status=201)

    enroll_body = {
        'profile': {'id': PROFILE_ID},
        'certificate': {
            'common_name': 'test.example.com',
            'sans': {'dns_names': ['test.example.com']},
        }
    }
    resp = client.post('/api/certificates', json=enroll_body)
    assert resp.status_code == 201
    assert resp.get_json()['serial_number'] == 'NEW-SERIAL-002'

    sent = rsps.calls[0].request
    body = json.loads(sent.body)
    assert body['certificate']['common_name'] == 'test.example.com'
    assert sent.headers['x-api-key'] == 'test-api-key'
