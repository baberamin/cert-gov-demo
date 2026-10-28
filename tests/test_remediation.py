import json
import responses as rsps
from routes.remediation import PROFILE_ID as TENANT_PROFILE_ID

DIGICERT_BASE = 'https://demo.one.digicert.com'
SERIAL = 'CERT-SERIAL-001'
REVOKE_URL = f'{DIGICERT_BASE}/mpki/api/v1/certificate/{SERIAL}/revoke'
CERT_URL = f'{DIGICERT_BASE}/mpki/api/v1/certificate'

MOCK_OLD_CERT = {
    'serial_number': SERIAL,
    'common_name': 'test.example.com',
    'status': 'issued',
}

MOCK_NEW_CERT = {
    'serial_number': 'NEW-SERIAL-999',
    'common_name': 'test.example.com',
    'status': 'issued',
}


def revoke_body():
    return json.loads(next(c for c in rsps.calls if c.request.method == 'PUT').request.body)


@rsps.activate
def test_revoke_certificate(client):
    rsps.add(rsps.PUT, REVOKE_URL, status=204)
    resp = client.post(f'/api/certificates/{SERIAL}/revoke', json={'reason': 'key_compromise'})
    assert resp.status_code == 200
    assert resp.get_json() == {'status': 'revoked', 'serial_number': SERIAL}
    assert revoke_body()['revocation_reason'] == 'KEY_COMPROMISE'  # DigiCert wants the upper-case enum
    assert rsps.calls[0].request.headers['x-api-key'] == 'test-api-key'


@rsps.activate
def test_revoke_maps_an_unknown_reason_to_unspecified(client):
    rsps.add(rsps.PUT, REVOKE_URL, status=204)
    assert client.post(f'/api/certificates/{SERIAL}/revoke', json={'reason': 'because'}).status_code == 200
    assert revoke_body()['revocation_reason'] == 'UNSPECIFIED'


@rsps.activate
def test_revoke_without_a_body_uses_unspecified(client):
    rsps.add(rsps.PUT, REVOKE_URL, status=204)
    assert client.post(f'/api/certificates/{SERIAL}/revoke').status_code == 200
    assert revoke_body()['revocation_reason'] == 'UNSPECIFIED'


def mock_reissue(revoke_status=204, revoke_json=None):
    rsps.add(rsps.GET, f'{CERT_URL}/{SERIAL}', json=MOCK_OLD_CERT, status=200)
    rsps.add(rsps.POST, CERT_URL, json=MOCK_NEW_CERT, status=201)
    rsps.add(rsps.PUT, REVOKE_URL, json=revoke_json, status=revoke_status)


@rsps.activate
def test_reissue_issues_a_fresh_cert_then_revokes_the_old_one(client):
    mock_reissue()
    resp = client.post(f'/api/certificates/{SERIAL}/reissue', json={})
    assert resp.status_code == 201
    assert resp.get_json()['serial_number'] == 'NEW-SERIAL-999'

    assert [c.request.method for c in rsps.calls] == ['GET', 'POST', 'PUT']
    assert rsps.calls[1].request.url == CERT_URL   # a fresh enrollment, not /renew (blocked until 30 days before expiry)
    assert 'revoke' in rsps.calls[2].request.url

    enroll = json.loads(rsps.calls[1].request.body)
    assert enroll['profile'] == {'id': TENANT_PROFILE_ID}
    assert enroll['seat'] == {'seat_id': 'test.example.com'}   # falls back to the common name when the cert has no seat
    assert enroll['attributes'] == {'subject.common_name': 'test.example.com'}
    assert 'BEGIN CERTIFICATE REQUEST' in enroll['csr']
    assert revoke_body()['revocation_reason'] == 'SUPERSEDED'


@rsps.activate
def test_reissue_reuses_the_old_certs_seat_and_name(client):
    old = {**MOCK_OLD_CERT, 'seat': {'seat_id': 'svc-1'}, 'subject': {'common_name': 'svc.example.com'}}
    rsps.add(rsps.GET, f'{CERT_URL}/{SERIAL}', json=old, status=200)
    rsps.add(rsps.POST, CERT_URL, json=MOCK_NEW_CERT, status=201)
    rsps.add(rsps.PUT, REVOKE_URL, status=204)
    client.post(f'/api/certificates/{SERIAL}/reissue', json={})
    enroll = json.loads(rsps.calls[1].request.body)
    assert enroll['seat'] == {'seat_id': 'svc-1'}
    assert enroll['attributes'] == {'subject.common_name': 'svc.example.com'}


@rsps.activate
def test_reissue_honours_the_requested_revocation_reason(client):
    mock_reissue()
    client.post(f'/api/certificates/{SERIAL}/reissue', json={'reason': 'key_compromise'})
    assert revoke_body()['revocation_reason'] == 'KEY_COMPROMISE'


@rsps.activate
def test_reissue_works_without_a_body(client):
    mock_reissue()
    assert client.post(f'/api/certificates/{SERIAL}/reissue').status_code == 201


@rsps.activate
def test_reissue_revocation_failure_returns_207(client):
    mock_reissue(revoke_status=409, revoke_json={'message': 'Already revoked'})
    resp = client.post(f'/api/certificates/{SERIAL}/reissue', json={})
    assert resp.status_code == 207
    data = resp.get_json()
    assert data['new_serial'] == 'NEW-SERIAL-999'
    assert 'error' in data


@rsps.activate
def test_cancel_is_not_supported_and_calls_nothing(client):
    resp = client.post(f'/api/certificates/{SERIAL}/cancel')
    assert resp.status_code == 501
    assert 'not supported' in resp.get_json()['error']
    assert len(rsps.calls) == 0
