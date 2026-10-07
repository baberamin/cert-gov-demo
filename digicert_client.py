import os
import requests

def _headers():
    return {
        'x-api-key': os.environ['DIGICERT_API_KEY'],
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    }

def _base_url():
    return os.environ.get('DIGICERT_BASE_URL', 'https://demo.one.digicert.com')

def get(path, params=None):
    resp = requests.get(f"{_base_url()}{path}", headers=_headers(), params=params)
    resp.raise_for_status()
    return resp.json()

def post(path, body=None):
    resp = requests.post(f"{_base_url()}{path}", headers=_headers(), json=body)
    resp.raise_for_status()
    if resp.status_code == 204 or not resp.content:
        return {}
    return resp.json()

def put(path, body=None):
    resp = requests.put(f"{_base_url()}{path}", headers=_headers(), json=body)
    resp.raise_for_status()
    return resp.json() if resp.content else {}

def delete(path):
    resp = requests.delete(f"{_base_url()}{path}", headers=_headers())
    resp.raise_for_status()
    return resp.json() if resp.content else {}
