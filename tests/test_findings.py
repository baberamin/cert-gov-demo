import responses as rsps
import pytest

DIGICERT_BASE = 'https://demo.one.digicert.com'

CERT_EXPIRING = {
    'serial_number': 'EXPIRING-001',
    'common_name': 'expiring.example.com',
    'status': 'issued',
    'expires_in_days': 15,
    'valid_from': '2026-01-01T00:00:00Z',
    'valid_to': '2026-11-15T00:00:00Z',
    'seat': {'seat_name': 'Alice'},
    'quantum_safe': True,
}

CERT_UNOWNED = {
    'serial_number': 'UNOWNED-002',
    'common_name': 'unowned.example.com',
    'status': 'issued',
    'expires_in_days': 120,
    'valid_from': '2025-01-01T00:00:00Z',
    'valid_to': '2027-01-01T00:00:00Z',
    'seat': {},
    'quantum_safe': True,
}

CERT_WEAK_KEY = {
    'serial_number': 'WEAKKEY-003',
    'common_name': 'weakkey.example.com',
    'status': 'issued',
    'expires_in_days': 200,
    'valid_from': '2026-01-01T00:00:00Z',
    'valid_to': '2026-11-01T00:00:00Z',
    'key_size': '1024',
    'seat': {'seat_name': 'Bob'},
    'quantum_safe': True,
}


@pytest.fixture(autouse=True)
def tmp_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / 'test.db')
    import routes.findings
    import routes.owner_store
    monkeypatch.setattr(routes.findings, 'DB_PATH', db_path)
    monkeypatch.setattr(routes.owner_store, 'DB_PATH', db_path)
    routes.owner_store.init_db()
    routes.findings.init_findings_db()


def _mock_cert_search(certs):
    """Add two cert-search mocks: one default, one profile-filtered (empty)."""
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate-search',
             json={'certificates': certs, 'has_more': False})
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate-search',
             json={'certificates': [], 'has_more': False})


@rsps.activate
def test_expiring_cert_creates_critical_finding(client):
    _mock_cert_search([CERT_EXPIRING])
    resp = client.get('/api/findings')
    assert resp.status_code == 200
    findings = resp.get_json()
    expiring = [f for f in findings if f['finding_type'] == 'expiring_soon']
    assert len(expiring) == 1
    assert expiring[0]['severity'] == 'critical'
    assert expiring[0]['serial_number'] == 'EXPIRING-001'
    assert expiring[0]['status'] == 'open'


@rsps.activate
def test_unowned_cert_creates_high_finding(client):
    _mock_cert_search([CERT_UNOWNED])
    resp = client.get('/api/findings')
    assert resp.status_code == 200
    unowned = [f for f in resp.get_json() if f['finding_type'] == 'unowned']
    assert len(unowned) == 1
    assert unowned[0]['severity'] == 'high'


@rsps.activate
def test_weak_key_creates_critical_finding(client):
    _mock_cert_search([CERT_WEAK_KEY])
    resp = client.get('/api/findings')
    assert resp.status_code == 200
    weak = [f for f in resp.get_json() if f['finding_type'] == 'weak_key']
    assert len(weak) == 1
    assert weak[0]['severity'] == 'critical'


@rsps.activate
def test_status_preserved_on_refresh(client):
    _mock_cert_search([CERT_EXPIRING])
    client.get('/api/findings')  # create finding

    finding_id = 'EXPIRING-001:expiring_soon:critical'
    resp = client.patch(f'/api/findings/{finding_id}/status', json={'status': 'in-review'})
    assert resp.status_code == 200
    assert resp.get_json()['status'] == 'in-review'

    # Second page load — status must survive
    _mock_cert_search([CERT_EXPIRING])
    resp2 = client.get('/api/findings')
    expiring = [f for f in resp2.get_json() if f['finding_type'] == 'expiring_soon']
    assert expiring[0]['status'] == 'in-review'


@rsps.activate
def test_stale_finding_deleted_when_cert_no_longer_qualifies(client):
    _mock_cert_search([CERT_EXPIRING])
    client.get('/api/findings')

    # Now cert expires in 200 days — no longer expiring_soon
    cert_healed = {**CERT_EXPIRING, 'expires_in_days': 200}
    _mock_cert_search([cert_healed])
    resp = client.get('/api/findings')
    expiring = [f for f in resp.get_json() if f['finding_type'] == 'expiring_soon']
    assert len(expiring) == 0


@rsps.activate
def test_overview_returns_correct_kpis(client):
    _mock_cert_search([CERT_EXPIRING, CERT_UNOWNED])
    resp = client.get('/api/overview')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['total_active'] == 2
    assert data['expiring_30'] == 1
    assert 'owned_pct' in data
    assert 'findings_critical' in data


@rsps.activate
def test_patch_finding_status_invalid_value(client):
    _mock_cert_search([CERT_EXPIRING])
    client.get('/api/findings')
    resp = client.patch('/api/findings/EXPIRING-001:expiring_soon:critical/status',
                        json={'status': 'banana'})
    assert resp.status_code == 400


@rsps.activate
def test_overview_counts_findings_without_visiting_the_findings_page_first(client):
    _mock_cert_search([CERT_EXPIRING, CERT_WEAK_KEY])
    data = client.get('/api/overview').get_json()
    assert data['findings_critical'] == 2  # expiring_soon + weak_key, both critical
