import pytest
import responses as rsps
import digicert_client as dc


@pytest.fixture(autouse=True)
def tmp_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / 'test.db')
    import routes.owner_store
    monkeypatch.setattr(routes.owner_store, 'DB_PATH', db_path)
    routes.owner_store.init_db()


@rsps.activate
def test_assigning_an_owner_is_kept_locally_and_never_written_to_digicert(client):
    before = dc.writes
    resp = client.post('/api/certificates/S1/assign-owner',
                       json={'owner_name': 'Pat Lee', 'owner_email': 'pat@acme.com', 'seat_id': 'seat-1'})
    assert resp.status_code == 200
    assert dc.writes == before
    assert not [c for c in rsps.calls if c.request.method in ('PUT', 'POST')]
    assert client.get('/api/owner-assignments').get_json() == {'S1': 'Pat Lee'}
