import responses as rsps
import pytest

DIGICERT_BASE = 'https://demo.one.digicert.com'


def cert(serial, **over):
    base = {
        'serial_number': serial,
        'common_name': f'{serial.lower()}.example.com',
        'status': 'issued',
        'expires_in_days': 120,
        'valid_from': '2026-06-01T00:00:00Z',
        'valid_to': '2026-12-15T00:00:00Z',
        'key_size': '2048',
        'seat': {'seat_id': f'{serial}-seat', 'seat_name': 'Alice'},
        'business_unit': {'id': 'BU-ENG', 'name': 'Engineering'},
    }
    base.update(over)
    return base


HEALTHY = cert('HEALTHY-1')
UNOWNED = cert('UNOWNED-2', seat={'seat_id': 'u-seat', 'seat_name': ''})
WEAK = cert('WEAK-3', key_size='1024')
EXPIRING = cert('EXPIRING-4', expires_in_days=10)


@pytest.fixture(autouse=True)
def tmp_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / 'test.db')
    import routes.exceptions
    import routes.owner_store
    monkeypatch.setattr(routes.exceptions, 'DB_PATH', db_path)
    monkeypatch.setattr(routes.owner_store, 'DB_PATH', db_path)
    monkeypatch.setattr(routes.exceptions, '_CERT_TTL', 0)
    routes.owner_store.init_db()
    routes.exceptions.init_exceptions_db()


def mock_certs(certs):
    """Return `certs` for the unfiltered search and nothing for the profile-filtered one, on every call."""
    def cb(request):
        import json
        empty = 'profile_id' in request.url
        return (200, {}, json.dumps({'certificates': [] if empty else certs, 'has_more': False}))
    rsps.add_callback(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate-search',
                      callback=cb, content_type='application/json')


def queue(client):
    return {i['serial_number']: i for i in client.get('/api/exceptions').get_json()}


def handled(client):
    return {i['serial_number']: i for i in client.get('/api/exceptions/auto-handled').get_json()}


def rule_by_template(client, template):
    return next(r for r in client.get('/api/rules').get_json() if r['template'] == template)


@rsps.activate
def test_healthy_owned_cert_is_auto_approved_with_rule_and_reason(client):
    mock_certs([HEALTHY])
    assert queue(client) == {}
    item = handled(client)['HEALTHY-1']
    assert item['outcome'] == 'auto_approved'
    assert item['rule_name'] == 'Healthy and owned'
    assert 'Owner present' in item['reason']


@rsps.activate
def test_unowned_cert_goes_to_queue(client):
    mock_certs([UNOWNED])
    item = queue(client)['UNOWNED-2']
    assert item['rule_name'] == 'Unowned certificate'
    assert 'owner' in item['reason'].lower()


@rsps.activate
def test_weak_key_goes_to_queue(client):
    mock_certs([WEAK])
    item = queue(client)['WEAK-3']
    assert item['rule_name'] == 'Policy violation'
    assert '1024' in item['reason']


@rsps.activate
def test_expiring_cert_falls_through_to_queue_with_reason(client):
    mock_certs([EXPIRING])
    item = queue(client)['EXPIRING-4']
    assert item['rule_name'] is None
    assert 'expires in 10 days' in item['reason'].lower()


@rsps.activate
def test_local_owner_assignment_counts_as_owner(client):
    import routes.exceptions as ex
    import sqlite3
    with sqlite3.connect(ex.DB_PATH) as conn:
        conn.execute("INSERT INTO owner_assignments (serial_number, owner_name, assigned_at) VALUES ('UNOWNED-2', 'Bob', 'x')")
    mock_certs([UNOWNED])
    assert 'UNOWNED-2' in handled(client)


@rsps.activate
def test_decide_approve_is_sticky_and_leaves_queue(client):
    mock_certs([UNOWNED])
    queue(client)
    resp = client.post('/api/exceptions/UNOWNED-2/decide', json={'decision': 'approved'})
    assert resp.status_code == 200
    assert resp.get_json()['outcome'] == 'approved'
    assert queue(client) == {}
    assert 'UNOWNED-2' not in handled(client)


@rsps.activate
def test_decide_revoke_calls_digicert(client):
    mock_certs([WEAK])
    rsps.add(rsps.PUT, f'{DIGICERT_BASE}/mpki/api/v1/certificate/WEAK-3/revoke', status=204)
    queue(client)
    resp = client.post('/api/exceptions/WEAK-3/decide', json={'decision': 'revoked'})
    assert resp.status_code == 200
    assert any('revoke' in c.request.url for c in rsps.calls)


@rsps.activate
def test_decide_reassign_requires_owner_and_stores_it(client):
    mock_certs([UNOWNED])
    queue(client)
    bad = client.post('/api/exceptions/UNOWNED-2/decide', json={'decision': 'reassigned'})
    assert bad.status_code == 400
    ok = client.post('/api/exceptions/UNOWNED-2/decide',
                     json={'decision': 'reassigned', 'new_owner': 'Carol'})
    assert ok.status_code == 200
    import routes.exceptions as ex
    import sqlite3
    with sqlite3.connect(ex.DB_PATH) as conn:
        row = conn.execute("SELECT owner_name FROM owner_assignments WHERE serial_number='UNOWNED-2'").fetchone()
    assert row[0] == 'Carol'


@rsps.activate
def test_decide_invalid_and_unknown(client):
    mock_certs([UNOWNED])
    queue(client)
    assert client.post('/api/exceptions/UNOWNED-2/decide', json={'decision': 'banana'}).status_code == 400
    assert client.post('/api/exceptions/NOPE/decide', json={'decision': 'approved'}).status_code == 404


@rsps.activate
def test_editing_rule_moves_certs_between_buckets(client):
    mock_certs([EXPIRING])
    assert 'EXPIRING-4' in queue(client)
    rule = rule_by_template(client, 'healthy_owned')
    resp = client.patch(f"/api/rules/{rule['id']}", json={'params': {'min_days_to_expiry': 5}})
    assert resp.status_code == 200
    assert 'EXPIRING-4' in handled(client)
    assert queue(client) == {}


@rsps.activate
def test_disabling_rule_sends_certs_to_queue(client):
    mock_certs([HEALTHY])
    assert 'HEALTHY-1' in handled(client)
    rule = rule_by_template(client, 'healthy_owned')
    client.patch(f"/api/rules/{rule['id']}", json={'enabled': False})
    assert 'HEALTHY-1' in queue(client)


@rsps.activate
def test_rule_validation(client):
    rule = rule_by_template(client, 'healthy_owned')
    url = f"/api/rules/{rule['id']}"
    assert client.patch(url, json={'params': {'bogus': 1}}).status_code == 400
    assert client.patch(url, json={'params': {'min_days_to_expiry': 'abc'}}).status_code == 400
    assert client.patch(url, json={'params': {'min_days_to_expiry': -1}}).status_code == 400
    assert client.patch(url, json={'enabled': 'yes'}).status_code == 400
    assert client.patch('/api/rules/9999', json={'enabled': False}).status_code == 404


@rsps.activate
def test_preview_shows_impact_without_saving(client):
    mock_certs([HEALTHY, EXPIRING])
    queue(client)
    rule = rule_by_template(client, 'healthy_owned')
    resp = client.post(f"/api/rules/{rule['id']}/preview", json={'params': {'min_days_to_expiry': 200}})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['to_queue'] == 1
    assert data['to_auto_approved'] == 0
    assert data['samples'][0]['serial_number'] == 'HEALTHY-1'
    assert 'HEALTHY-1' in handled(client)  # nothing was saved
    assert rule_by_template(client, 'healthy_owned')['params']['min_days_to_expiry'] == 30


@rsps.activate
def test_preview_ignores_human_decided_certs(client):
    mock_certs([UNOWNED])
    queue(client)
    client.post('/api/exceptions/UNOWNED-2/decide', json={'decision': 'approved'})
    rule = rule_by_template(client, 'unowned')
    data = client.post(f"/api/rules/{rule['id']}/preview", json={'enabled': False}).get_json()
    assert data['to_queue'] == 0 and data['to_auto_approved'] == 0


@rsps.activate
def test_stale_auto_rows_are_removed_when_cert_disappears(client):
    mock_certs([HEALTHY])
    assert 'HEALTHY-1' in handled(client)
    rsps.reset()
    mock_certs([])
    assert handled(client) == {}


def test_default_rules_seeded(client):
    rules = client.get('/api/rules').get_json()
    assert [r['template'] for r in rules] == ['unowned', 'policy_violation', 'healthy_owned']
    assert rules[2]['outcome'] == 'auto_approve'


@rsps.activate
def test_preview_sample_uses_subject_common_name(client):
    live = cert('LIVE-9')
    del live['common_name']
    live['subject'] = {'common_name': 'live.lab.local'}
    mock_certs([live])
    rule = rule_by_template(client, 'healthy_owned')
    data = client.post(f"/api/rules/{rule['id']}/preview", json={'enabled': False}).get_json()
    assert data['samples'][0]['common_name'] == 'live.lab.local'


@rsps.activate
def test_certs_pulled_once_within_ttl(client, monkeypatch):
    import routes.exceptions as ex
    monkeypatch.setattr(ex, '_CERT_TTL', 60)
    ex._cert_cache['at'] = float('-inf')
    mock_certs([HEALTHY])
    handled(client)
    queue(client)
    searches = [c for c in rsps.calls if 'certificate-search' in c.request.url]
    assert len(searches) == 2  # one unfiltered + one profile-filtered pull, shared by both views
