import responses as rsps

DIGICERT_BASE = 'https://demo.one.digicert.com'

MOCK_BU = {
    'id': 'BU-1',
    'name': 'Default Business Unit',
    'description': 'Main BU',
}

MOCK_SEAT = {
    'seat_id': 'user@saviynt.com',
    'user_name': 'Baber Amin',
    'status': 'active',
}


@rsps.activate
def test_list_business_units(client):
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/business-unit', json=[MOCK_BU], status=200)
    resp = client.get('/api/business-units')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data[0]['name'] == 'Default Business Unit'
    assert rsps.calls[0].request.headers['x-api-key'] == 'test-api-key'


@rsps.activate
def test_get_business_unit(client):
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/business-unit/BU-1', json=MOCK_BU, status=200)
    resp = client.get('/api/business-units/BU-1')
    assert resp.status_code == 200
    assert resp.get_json()['id'] == 'BU-1'


@rsps.activate
def test_list_seats(client):
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/seat', json=[MOCK_SEAT], status=200)
    resp = client.get('/api/seats')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data[0]['seat_id'] == 'user@saviynt.com'
    assert rsps.calls[0].request.headers['x-api-key'] == 'test-api-key'
