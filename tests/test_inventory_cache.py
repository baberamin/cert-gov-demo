import json
import pytest
import responses as rsps
import digicert_client as dc
import routes.certificates as certs_mod

BASE = 'https://demo.one.digicert.com'
SEARCH = f'{BASE}/mpki/api/v1/certificate-search'


@pytest.fixture(autouse=True)
def cache_on(monkeypatch):
    monkeypatch.setattr(certs_mod, '_INVENTORY_TTL', 60)
    certs_mod.invalidate_inventory()


def mock_search(certs):
    def cb(request):
        empty = 'profile_id' in request.url
        return (200, {}, json.dumps({'certificates': [] if empty else certs, 'has_more': False}))
    rsps.add_callback(rsps.GET, SEARCH, callback=cb, content_type='application/json')


def searches():
    return len([c for c in rsps.calls if 'certificate-search' in c.request.url])


@rsps.activate
def test_inventory_is_pulled_once_within_ttl():
    mock_search([{'serial_number': 'A'}])
    assert certs_mod.fetch_inventory() == certs_mod.fetch_inventory() == [{'serial_number': 'A'}]
    assert searches() == 2  # unfiltered + profile-filtered, then served from cache


@rsps.activate
def test_expires_after_ttl(monkeypatch):
    monkeypatch.setattr(certs_mod, '_INVENTORY_TTL', 0)
    mock_search([{'serial_number': 'A'}])
    certs_mod.fetch_inventory()
    certs_mod.fetch_inventory()
    assert searches() == 4


@rsps.activate
def test_any_write_to_digicert_drops_the_cache():
    mock_search([{'serial_number': 'A'}])
    rsps.add(rsps.PUT, f'{BASE}/mpki/api/v1/seat/s1', status=204)
    certs_mod.fetch_inventory()
    dc.put('/mpki/api/v1/seat/s1', {'seat_name': 'x'})
    certs_mod.fetch_inventory()
    assert searches() == 4


@rsps.activate
def test_failed_write_also_drops_the_cache():
    mock_search([{'serial_number': 'A'}])
    rsps.add(rsps.PUT, f'{BASE}/mpki/api/v1/seat/s1', status=500)
    certs_mod.fetch_inventory()
    with pytest.raises(Exception):
        dc.put('/mpki/api/v1/seat/s1', {})
    certs_mod.fetch_inventory()
    assert searches() == 4


@rsps.activate
def test_revoking_through_the_app_drops_the_cache(client):
    mock_search([{'serial_number': 'A'}])
    rsps.add(rsps.PUT, f'{BASE}/mpki/api/v1/certificate/A/revoke', status=204)
    certs_mod.fetch_inventory()
    assert client.post('/api/certificates/A/revoke', json={'reason': 'superseded'}).status_code == 200
    certs_mod.fetch_inventory()
    assert searches() == 4


@rsps.activate
def test_callers_cannot_corrupt_the_cache_by_mutating_the_result():
    mock_search([{'serial_number': 'A'}])
    first = certs_mod.fetch_inventory()
    first.append({'serial_number': 'JUNK'})
    assert certs_mod.fetch_inventory() == [{'serial_number': 'A'}]


@rsps.activate
def test_a_failed_pull_is_not_cached():
    rsps.add(rsps.GET, SEARCH, status=500)
    with pytest.raises(Exception):
        certs_mod.fetch_inventory()
    rsps.reset()
    mock_search([{'serial_number': 'A'}])
    assert certs_mod.fetch_inventory() == [{'serial_number': 'A'}]
