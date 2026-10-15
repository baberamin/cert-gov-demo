import responses as rsps
import pytest

DIGICERT_BASE = 'https://demo.one.digicert.com'

CERT_A = {
    'serial_number': 'CERT-AAA',
    'common_name': 'a.example.com',
    'status': 'issued',
    'expires_in_days': 100,
    'valid_to': '2027-01-01',
    'seat': {'seat_id': 'a.example.com', 'seat_name': 'Alice'},
    'business_unit': {'id': 'BU-ENG', 'name': 'Engineering'},
}

CERT_B = {
    'serial_number': 'CERT-BBB',
    'common_name': 'b.example.com',
    'status': 'issued',
    'expires_in_days': 200,
    'valid_to': '2027-06-01',
    'seat': {'seat_id': 'b.example.com', 'seat_name': ''},
    'business_unit': {'id': 'BU-FIN', 'name': 'Finance'},
}


@pytest.fixture(autouse=True)
def tmp_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / 'test.db')
    import routes.campaigns
    import routes.owner_store
    monkeypatch.setattr(routes.campaigns, 'DB_PATH', db_path)
    monkeypatch.setattr(routes.owner_store, 'DB_PATH', db_path)
    routes.owner_store.init_db()
    routes.campaigns.init_campaigns_db()


def _mock_cert_search(certs):
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate-search',
             json={'certificates': certs, 'has_more': False})
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate-search',
             json={'certificates': [], 'has_more': False})


@rsps.activate
def test_create_campaign_snapshots_active_certs(client):
    _mock_cert_search([CERT_A, CERT_B])
    resp = client.post('/api/campaigns', json={'name': 'Q4 Review'})
    assert resp.status_code == 201
    data = resp.get_json()
    assert data['name'] == 'Q4 Review'
    assert data['item_count'] == 2


@rsps.activate
def test_create_campaign_with_bu_scope(client):
    _mock_cert_search([CERT_A, CERT_B])
    resp = client.post('/api/campaigns', json={'name': 'Eng Review', 'scope_bu_id': 'BU-ENG'})
    assert resp.status_code == 201
    assert resp.get_json()['item_count'] == 1


@rsps.activate
def test_list_campaigns_includes_summary(client):
    _mock_cert_search([CERT_A, CERT_B])
    client.post('/api/campaigns', json={'name': 'Q4 Review'})
    resp = client.get('/api/campaigns')
    assert resp.status_code == 200
    campaigns = resp.get_json()
    assert len(campaigns) == 1
    assert campaigns[0]['total'] == 2
    assert campaigns[0]['pending'] == 2
    assert campaigns[0]['approved'] == 0


@rsps.activate
def test_get_campaign_detail_includes_items(client):
    _mock_cert_search([CERT_A])
    campaign_id = client.post('/api/campaigns', json={'name': 'Q4'}).get_json()['id']
    resp = client.get(f'/api/campaigns/{campaign_id}')
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data['items']) == 1
    assert data['items'][0]['serial_number'] == 'CERT-AAA'
    assert data['items'][0]['decision'] is None


@rsps.activate
def test_decide_approve_records_decision(client):
    _mock_cert_search([CERT_A])
    campaign_id = client.post('/api/campaigns', json={'name': 'Q4'}).get_json()['id']
    resp = client.post(f'/api/campaigns/{campaign_id}/items/CERT-AAA/decide',
                       json={'decision': 'approved'})
    assert resp.status_code == 200
    assert resp.get_json()['decision'] == 'approved'


@rsps.activate
def test_decide_revoke_calls_digicert(client):
    _mock_cert_search([CERT_A])
    rsps.add(rsps.PUT, f'{DIGICERT_BASE}/mpki/api/v1/certificate/CERT-AAA/revoke', status=204)
    campaign_id = client.post('/api/campaigns', json={'name': 'Q4'}).get_json()['id']
    resp = client.post(f'/api/campaigns/{campaign_id}/items/CERT-AAA/decide',
                       json={'decision': 'revoked'})
    assert resp.status_code == 200
    assert resp.get_json()['decision'] == 'revoked'
    assert any('revoke' in c.request.url for c in rsps.calls)


@rsps.activate
def test_all_decided_marks_campaign_completed(client):
    _mock_cert_search([CERT_A])
    campaign_id = client.post('/api/campaigns', json={'name': 'Q4'}).get_json()['id']
    client.post(f'/api/campaigns/{campaign_id}/items/CERT-AAA/decide',
                json={'decision': 'approved'})
    campaign = client.get(f'/api/campaigns/{campaign_id}').get_json()
    assert campaign['status'] == 'completed'


@rsps.activate
def test_create_campaign_missing_name_returns_400(client):
    resp = client.post('/api/campaigns', json={})
    assert resp.status_code == 400


def test_get_nonexistent_campaign_returns_404(client):
    resp = client.get('/api/campaigns/does-not-exist')
    assert resp.status_code == 404
