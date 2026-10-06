import responses as rsps
import json

def test_app_starts(client):
    resp = client.get('/')
    assert resp.status_code == 200
