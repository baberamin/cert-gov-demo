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

# Bumped after every post/put/delete, even a failed one, so caches of DigiCert data can tell they are stale.
writes = 0


def _wrote():
    global writes
    writes += 1


def get(path, params=None):
    resp = requests.get(f"{_base_url()}{path}", headers=_headers(), params=params)
    resp.raise_for_status()
    return resp.json()

def post(path, body=None):
    try:
        resp = requests.post(f"{_base_url()}{path}", headers=_headers(), json=body)
        resp.raise_for_status()
        if resp.status_code == 204 or not resp.content:
            return {}
        return resp.json()
    finally:
        _wrote()

def put(path, body=None):
    try:
        resp = requests.put(f"{_base_url()}{path}", headers=_headers(), json=body)
        resp.raise_for_status()
        return resp.json() if resp.content else {}
    finally:
        _wrote()

def delete(path):
    try:
        resp = requests.delete(f"{_base_url()}{path}", headers=_headers())
        resp.raise_for_status()
        return resp.json() if resp.content else {}
    finally:
        _wrote()
