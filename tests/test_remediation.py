import responses as rsps
import json

DIGICERT_BASE = 'https://demo.one.digicert.com'
SERIAL = 'CERT-SERIAL-001'
PROFILE_ID = '2f2afae4-78b6-4c4c-a00b-f1434183eae0'

MOCK_OLD_CERT = {
    'serial_number': SERIAL,
    'common_name': 'test.example.com',
    'status': 'issued',
    'profile': {'id': PROFILE_ID, 'name': 'baber private cert'},
    'san': {'dns_names': ['test.example.com']},
}

MOCK_NEW_CERT = {
    'serial_number': 'NEW-SERIAL-999',
    'common_name': 'test.example.com',
    'status': 'issued',
    'profile': {'id': PROFILE_ID, 'name': 'baber private cert'},
    'san': {'dns_names': ['test.example.com']},
}


@rsps.activate
def test_revoke_certificate(client):
    rsps.add(rsps.POST, f'{DIGICERT_BASE}/mpki/api/v1/certificate/{SERIAL}/revocation', status=204)
    resp = client.post(f'/api/certificates/{SERIAL}/revoke', json={'reason': 'key_compromise'})
    assert resp.status_code == 200
    sent = rsps.calls[0].request
    body = json.loads(sent.body)
    assert body['reason'] == 'key_compromise'
    assert sent.headers['x-api-key'] == 'test-api-key'


@rsps.activate
def test_reissue_certificate_success(client):
    # GET old cert
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate/{SERIAL}', json=MOCK_OLD_CERT, status=200)
    # POST new cert enrollment
    rsps.add(rsps.POST, f'{DIGICERT_BASE}/mpki/api/v1/certificate', json=MOCK_NEW_CERT, status=201)
    # POST revoke old cert
    rsps.add(rsps.POST, f'{DIGICERT_BASE}/mpki/api/v1/certificate/{SERIAL}/revocation', status=204)

    resp = client.post(f'/api/certificates/{SERIAL}/reissue')
    assert resp.status_code == 201
    data = resp.get_json()
    assert data['serial_number'] == 'NEW-SERIAL-999'

    # Verify correct call order
    assert rsps.calls[0].request.method == 'GET'
    assert rsps.calls[1].request.method == 'POST'
    assert 'revocation' not in rsps.calls[1].request.url
    assert rsps.calls[2].request.method == 'POST'
    assert 'revocation' in rsps.calls[2].request.url

    # Verify new cert enrolled with same CN and SANs as old
    enroll_body = json.loads(rsps.calls[1].request.body)
    assert enroll_body['certificate']['common_name'] == 'test.example.com'
    assert enroll_body['certificate']['sans'] == {'dns_names': ['test.example.com']}


@rsps.activate
def test_reissue_revocation_failure_returns_207(client):
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate/{SERIAL}', json=MOCK_OLD_CERT, status=200)
    rsps.add(rsps.POST, f'{DIGICERT_BASE}/mpki/api/v1/certificate', json=MOCK_NEW_CERT, status=201)
    rsps.add(rsps.POST, f'{DIGICERT_BASE}/mpki/api/v1/certificate/{SERIAL}/revocation',
             json={'message': 'Already revoked'}, status=409)

    resp = client.post(f'/api/certificates/{SERIAL}/reissue')
    assert resp.status_code == 207
    data = resp.get_json()
    assert data['new_serial'] == 'NEW-SERIAL-999'
    assert 'error' in data


@rsps.activate
def test_cancel_certificate(client):
    rsps.add(rsps.DELETE, f'{DIGICERT_BASE}/mpki/api/v1/certificate/{SERIAL}', status=204)
    resp = client.post(f'/api/certificates/{SERIAL}/cancel')
    assert resp.status_code == 200
    assert rsps.calls[0].request.method == 'DELETE'
    assert rsps.calls[0].request.headers['x-api-key'] == 'test-api-key'
