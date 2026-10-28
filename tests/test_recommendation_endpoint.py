import json
import sqlite3
import pytest
import responses as rsps

BASE = 'https://demo.one.digicert.com'


def tenant(serial, bu='Finance & Accounting', owner='', cn=None, status='issued'):
    return {'serial_number': serial, 'common_name': cn or f'{serial.lower()}.acme.com', 'status': status,
            'profile': {'id': 'p1', 'name': 'Private Server'}, 'issuing_ca_name': 'Saviynt Test ICA',
            'seat': {'seat_id': f'{serial}-seat', 'seat_name': owner}, 'business_unit': {'id': 'b', 'name': bu},
            'expires_in_days': 100}


SELF_SIGNED = {'serial_number': 'SELF-1', 'common_name': 'x.lab.local', 'status': 'issued', 'profile': None,
               'issuing_ca_name': 'x.lab.local', 'seat': {}, 'business_unit': {'id': 'b', 'name': 'Default Business Unit'}}


@pytest.fixture(autouse=True)
def tmp_db(tmp_path, monkeypatch):
    path = str(tmp_path / 'test.db')
    import routes.exceptions, routes.owner_store
    monkeypatch.setattr(routes.exceptions, 'DB_PATH', path)
    monkeypatch.setattr(routes.owner_store, 'DB_PATH', path)
    routes.owner_store.init_db()
    routes.exceptions.init_exceptions_db()


def mock_certs(certs):
    def cb(request):
        return (200, {}, json.dumps({'certificates': [] if 'profile_id' in request.url else certs, 'has_more': False}))
    rsps.add_callback(rsps.GET, f'{BASE}/mpki/api/v1/certificate-search', callback=cb, content_type='application/json')


def rec(client, serial):
    return client.get(f'/api/certificates/{serial}/recommendation')


@rsps.activate
def test_recommends_from_peer_owners_with_evidence(client):
    mock_certs([tenant('P1', owner='Pepper Potts'), tenant('P2', owner='Pepper Potts'), tenant('T1', cn='ledger.acme.com')])
    resp = rec(client, 'T1')
    assert resp.status_code == 200
    body = resp.get_json()
    assert body['confidence'] == 'High'
    assert body['owner']['name'] == 'Pepper Potts'
    assert any('owns 2 of 2' in e for e in body['evidence'])


@rsps.activate
def test_self_signed_gets_no_recommendation(client):
    mock_certs([SELF_SIGNED])
    body = rec(client, 'SELF-1').get_json()
    assert body['confidence'] == 'None' and body['owner'] is None


@rsps.activate
def test_unknown_serial_is_404(client):
    mock_certs([SELF_SIGNED])
    assert rec(client, 'NOPE').status_code == 404


@rsps.activate
def test_expired_cert_still_gets_a_recommendation(client):
    mock_certs([tenant('P1', owner='Pepper Potts'), tenant('OLD', status='expired', cn='ledger.acme.com')])
    resp = rec(client, 'OLD')
    assert resp.status_code == 200
    assert resp.get_json()['owner']['name'] == 'Pepper Potts'


@rsps.activate
def test_owners_assigned_in_our_store_count_as_peer_evidence(client):
    import routes.exceptions as ex
    with sqlite3.connect(ex.DB_PATH) as conn:
        conn.execute("INSERT INTO owner_assignments (serial_number, owner_name, assigned_at) VALUES ('P1', 'Pepper Potts', 'x')")
    mock_certs([tenant('P1'), tenant('T1', cn='ledger.acme.com')])
    assert rec(client, 'T1').get_json()['owner']['name'] == 'Pepper Potts'


@rsps.activate
def test_local_bu_overlay_decides_the_team(client):
    import routes.exceptions as ex
    with sqlite3.connect(ex.DB_PATH) as conn:
        conn.execute("INSERT INTO bu_assignments (serial_number, bu_id, bu_name) VALUES ('T1', 'x', 'Marketing & Growth')")
    mock_certs([tenant('T1', bu='Engineering', cn='edge.acme.com')])
    assert rec(client, 'T1').get_json()['team'] == 'Marketing'
