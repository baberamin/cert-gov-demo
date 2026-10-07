# DigiCert Zuma POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dummy Saviynt Zuma frontend backed by a Flask proxy that demonstrates Story 2 (Certificate Ownership Mapping) and Story 6 (Certificate Remediation) against the DigiCert MPKI API.

**Architecture:** Flask serves static HTML/CSS/JS from `static/` and proxies DigiCert API calls via `/api/*` routes. The `x-api-key` is injected server-side from the environment so it never reaches the browser. Three Blueprint modules (`certificates`, `ownership`, `remediation`) handle routing; a shared `digicert_client.py` handles all outbound HTTP.

**Tech Stack:** Python 3.11+, Flask 3.x, Requests, python-dotenv, pytest, responses (for HTTP mocking), plain HTML/CSS/JS (no frontend framework)

---

## File Map

| File | Responsibility |
|---|---|
| `app.py` | Flask factory, static file serving, global error handler |
| `digicert_client.py` | Outbound HTTP to DigiCert — injects API key, base URL |
| `routes/certificates.py` | `/api/profiles`, `/api/certificates` read/write |
| `routes/ownership.py` | `/api/business-units`, `/api/seats` |
| `routes/remediation.py` | `/api/certificates/<serial>/revoke|reissue|cancel` |
| `tests/conftest.py` | Pytest fixtures: `app`, `client` |
| `tests/test_certificates.py` | Tests for certificate routes |
| `tests/test_ownership.py` | Tests for ownership routes |
| `tests/test_remediation.py` | Tests for remediation routes |
| `static/index.html` | App shell — sidebar nav + content pane + modal overlay |
| `static/css/styles.css` | Dark enterprise theme |
| `static/js/api.js` | `apiFetch()` wrapper + `api.*` methods |
| `static/js/ownership.js` | Story 2 view: certificate table, BU filter, detail panel |
| `static/js/remediation.js` | Story 6 view: action buttons, revoke modal, inline updates |
| `requirements.txt` | Python dependencies |
| `.env.example` | Template for `DIGICERT_API_KEY` and `DIGICERT_BASE_URL` |
| `.gitignore` | Excludes `.env`, `__pycache__`, `.pytest_cache`, `.superpowers` |

---

## Task 1: Project Scaffold

**Files:**
- Create: `requirements.txt`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Create `requirements.txt`**

```
Flask==3.0.3
python-dotenv==1.0.1
requests==2.32.3
pytest==8.3.3
responses==0.25.3
```

- [ ] **Step 2: Create `.env.example`**

```
DIGICERT_API_KEY=your-api-key-here
DIGICERT_BASE_URL=https://demo.one.digicert.com
```

- [ ] **Step 3: Create `.gitignore`**

```
.env
__pycache__/
*.pyc
.pytest_cache/
.superpowers/
```

- [ ] **Step 4: Install dependencies**

```bash
pip install -r requirements.txt
```

Expected: all packages install without errors.

- [ ] **Step 5: Copy `.env.example` to `.env` and fill in the real API key**

```bash
cp .env.example .env
# Edit .env and set DIGICERT_API_KEY to the real value
```

- [ ] **Step 6: Commit**

```bash
git init
git add requirements.txt .env.example .gitignore
git commit -m "feat: initial project scaffold"
```

---

## Task 2: DigiCert Client + Flask App Factory

**Files:**
- Create: `digicert_client.py`
- Create: `app.py`
- Create: `routes/__init__.py`
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`

- [ ] **Step 1: Write the failing test for the client**

Create `tests/conftest.py`:

```python
import pytest
import os
from app import create_app

@pytest.fixture(autouse=True)
def set_env(monkeypatch):
    monkeypatch.setenv('DIGICERT_API_KEY', 'test-api-key')
    monkeypatch.setenv('DIGICERT_BASE_URL', 'https://demo.one.digicert.com')

@pytest.fixture
def app():
    application = create_app()
    application.config['TESTING'] = True
    return application

@pytest.fixture
def client(app):
    return app.test_client()
```

Create `tests/test_certificates.py` with a placeholder import test:

```python
import responses as rsps
import json

def test_app_starts(client):
    resp = client.get('/')
    assert resp.status_code == 200
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_certificates.py::test_app_starts -v
```

Expected: `ModuleNotFoundError: No module named 'app'`

- [ ] **Step 3: Create `digicert_client.py`**

```python
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

def delete(path):
    resp = requests.delete(f"{_base_url()}{path}", headers=_headers())
    resp.raise_for_status()
    return resp.json() if resp.content else {}
```

- [ ] **Step 4: Create `routes/__init__.py`** (empty file)

```bash
touch routes/__init__.py tests/__init__.py
```

- [ ] **Step 5: Create `app.py`**

```python
from flask import Flask, send_from_directory, jsonify
from dotenv import load_dotenv
import requests
import os

load_dotenv()

def create_app():
    app = Flask(__name__, static_folder='static')

    from routes.certificates import certificates_bp
    from routes.ownership import ownership_bp
    from routes.remediation import remediation_bp

    app.register_blueprint(certificates_bp)
    app.register_blueprint(ownership_bp)
    app.register_blueprint(remediation_bp)

    @app.route('/')
    def index():
        return send_from_directory('static', 'index.html')

    @app.errorhandler(requests.HTTPError)
    def handle_digicert_error(e):
        if e.response is not None:
            try:
                body = e.response.json()
            except Exception:
                body = {'error': e.response.text}
            return jsonify(body), e.response.status_code
        return jsonify({'error': str(e)}), 502

    @app.errorhandler(Exception)
    def handle_generic_error(e):
        return jsonify({'error': str(e)}), 500

    return app

if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, port=5000)
```

- [ ] **Step 6: Create stub Blueprint files so the app can import them**

Create `routes/certificates.py`:
```python
from flask import Blueprint
certificates_bp = Blueprint('certificates', __name__)
```

Create `routes/ownership.py`:
```python
from flask import Blueprint
ownership_bp = Blueprint('ownership', __name__)
```

Create `routes/remediation.py`:
```python
from flask import Blueprint
remediation_bp = Blueprint('remediation', __name__)
```

Create the static directory tree and a minimal stub `static/index.html` so `/` returns 200:

```bash
mkdir -p static/css static/js
```

```html
<!DOCTYPE html>
<html><head><title>Zuma POC</title></head><body>Loading...</body></html>
```

- [ ] **Step 7: Run test to verify it passes**

```bash
pytest tests/test_certificates.py::test_app_starts -v
```

Expected: `PASSED`

- [ ] **Step 8: Commit**

```bash
git add app.py digicert_client.py routes/ tests/ static/index.html
git commit -m "feat: Flask app factory and DigiCert client module"
```

---

## Task 3: Certificate Read Routes

**Files:**
- Modify: `routes/certificates.py`
- Modify: `tests/test_certificates.py`

- [ ] **Step 1: Write the failing tests**

Replace `tests/test_certificates.py` with:

```python
import responses as rsps
import json

DIGICERT_BASE = 'https://demo.one.digicert.com'
PROFILE_ID = '2f2afae4-78b6-4c4c-a00b-f1434183eae0'

MOCK_PROFILE = {
    'id': PROFILE_ID,
    'name': 'baber private cert',
    'status': 'Active',
    'business_unit_id': 'BU-1',
    'business_unit_name': 'Default Business Unit',
    'key_escrow_policy': {'key_escrow_enabled': False},
    'private_key_attributes': {'key_size': '2048'},
}

MOCK_CERT = {
    'serial_number': 'CERT-SERIAL-001',
    'common_name': 'test.example.com',
    'status': 'issued',
    'valid_till': '2026-10-11T00:00:00.000Z',
    'issued_on': '2026-10-06T00:00:00.000Z',
    'profile': {'id': PROFILE_ID, 'name': 'baber private cert'},
    'business_unit': {'id': 'BU-1', 'name': 'Default Business Unit'},
    'seat': {'seat_id': 'user@saviynt.com', 'user_name': 'Baber Amin'},
    'tags': [],
    'san': {'dns_names': ['test.example.com']},
}


@rsps.activate
def test_list_profiles(client):
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/profile', json=[MOCK_PROFILE], status=200)
    resp = client.get('/api/profiles')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data[0]['name'] == 'baber private cert'
    assert rsps.calls[0].request.headers['x-api-key'] == 'test-api-key'


@rsps.activate
def test_get_profile(client):
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/profile/{PROFILE_ID}', json=MOCK_PROFILE, status=200)
    resp = client.get(f'/api/profiles/{PROFILE_ID}')
    assert resp.status_code == 200
    assert resp.get_json()['id'] == PROFILE_ID


@rsps.activate
def test_list_certificates(client):
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate', json=[MOCK_CERT], status=200)
    resp = client.get('/api/certificates')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data[0]['serial_number'] == 'CERT-SERIAL-001'
    assert rsps.calls[0].request.headers['x-api-key'] == 'test-api-key'


@rsps.activate
def test_get_certificate(client):
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate/CERT-SERIAL-001', json=MOCK_CERT, status=200)
    resp = client.get('/api/certificates/CERT-SERIAL-001')
    assert resp.status_code == 200
    assert resp.get_json()['common_name'] == 'test.example.com'


@rsps.activate
def test_digicert_error_is_proxied(client):
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate', json={'message': 'Unauthorized'}, status=401)
    resp = client.get('/api/certificates')
    assert resp.status_code == 401
    assert resp.get_json()['message'] == 'Unauthorized'
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_certificates.py -v
```

Expected: 4 FAILs with `404` (routes don't exist yet), 1 PASS for `test_app_starts`

- [ ] **Step 3: Implement the certificate read routes**

Replace `routes/certificates.py`:

```python
from flask import Blueprint, jsonify, request
import digicert_client as dc

certificates_bp = Blueprint('certificates', __name__)


@certificates_bp.route('/api/profiles')
def list_profiles():
    return jsonify(dc.get('/mpki/api/v1/profile'))


@certificates_bp.route('/api/profiles/<profile_id>')
def get_profile(profile_id):
    return jsonify(dc.get(f'/mpki/api/v1/profile/{profile_id}'))


@certificates_bp.route('/api/certificates')
def list_certificates():
    return jsonify(dc.get('/mpki/api/v1/certificate'))


@certificates_bp.route('/api/certificates/<serial>')
def get_certificate(serial):
    return jsonify(dc.get(f'/mpki/api/v1/certificate/{serial}'))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_certificates.py -v
```

Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add routes/certificates.py tests/test_certificates.py
git commit -m "feat: certificate read routes (profiles + certificates)"
```

---

## Task 4: Certificate Enrollment Route

**Files:**
- Modify: `routes/certificates.py`
- Modify: `tests/test_certificates.py`

- [ ] **Step 1: Add the failing enrollment test**

Append to `tests/test_certificates.py`:

```python
@rsps.activate
def test_enroll_certificate(client):
    new_cert = {**MOCK_CERT, 'serial_number': 'NEW-SERIAL-002'}
    rsps.add(rsps.POST, f'{DIGICERT_BASE}/mpki/api/v1/certificate', json=new_cert, status=201)

    enroll_body = {
        'profile': {'id': PROFILE_ID},
        'certificate': {
            'common_name': 'test.example.com',
            'sans': {'dns_names': ['test.example.com']},
        }
    }
    resp = client.post('/api/certificates', json=enroll_body)
    assert resp.status_code == 201
    assert resp.get_json()['serial_number'] == 'NEW-SERIAL-002'

    sent = rsps.calls[0].request
    body = json.loads(sent.body)
    assert body['certificate']['common_name'] == 'test.example.com'
    assert sent.headers['x-api-key'] == 'test-api-key'
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_certificates.py::test_enroll_certificate -v
```

Expected: FAIL with `405 Method Not Allowed`

- [ ] **Step 3: Add enrollment route**

Append to `routes/certificates.py`:

```python
@certificates_bp.route('/api/certificates', methods=['POST'])
def enroll_certificate():
    return jsonify(dc.post('/mpki/api/v1/certificate', request.get_json())), 201
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_certificates.py -v
```

Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add routes/certificates.py tests/test_certificates.py
git commit -m "feat: certificate enrollment route"
```

---

## Task 5: Ownership Routes

**Files:**
- Modify: `routes/ownership.py`
- Create: `tests/test_ownership.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_ownership.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_ownership.py -v
```

Expected: 3 FAILs with `404`

- [ ] **Step 3: Implement ownership routes**

Replace `routes/ownership.py`:

```python
from flask import Blueprint, jsonify
import digicert_client as dc

ownership_bp = Blueprint('ownership', __name__)


@ownership_bp.route('/api/business-units')
def list_business_units():
    return jsonify(dc.get('/mpki/api/v1/business-unit'))


@ownership_bp.route('/api/business-units/<bu_id>')
def get_business_unit(bu_id):
    return jsonify(dc.get(f'/mpki/api/v1/business-unit/{bu_id}'))


@ownership_bp.route('/api/seats')
def list_seats():
    return jsonify(dc.get('/mpki/api/v1/seat'))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_ownership.py -v
```

Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add routes/ownership.py tests/test_ownership.py
git commit -m "feat: ownership routes (business-units, seats)"
```

---

## Task 6: Remediation Routes

**Files:**
- Modify: `routes/remediation.py`
- Create: `tests/test_remediation.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_remediation.py`:

```python
import responses as rsps
import json

DIGICERT_BASE = 'https://demo.one.digicert.com'
SERIAL = 'CERT-SERIAL-001'
PROFILE_ID = '2f2afae4-78b6-4c4c-a00b-f1434183eae0'

MOCK_OLD_CERT = {
    'serial_number': SERIAL,
    'common_name': 'test.example.com',
    'status': 'issued',
    'profile': {'id': PROFILE_ID, 'name': 'baber private cert'},
    'san': {'dns_names': ['test.example.com']},
}

MOCK_NEW_CERT = {
    'serial_number': 'NEW-SERIAL-999',
    'common_name': 'test.example.com',
    'status': 'issued',
    'profile': {'id': PROFILE_ID, 'name': 'baber private cert'},
    'san': {'dns_names': ['test.example.com']},
}


@rsps.activate
def test_revoke_certificate(client):
    rsps.add(rsps.POST, f'{DIGICERT_BASE}/mpki/api/v1/certificate/{SERIAL}/revocation', status=204)
    resp = client.post(f'/api/certificates/{SERIAL}/revoke', json={'reason': 'key_compromise'})
    assert resp.status_code == 200
    sent = rsps.calls[0].request
    body = json.loads(sent.body)
    assert body['reason'] == 'key_compromise'
    assert sent.headers['x-api-key'] == 'test-api-key'


@rsps.activate
def test_reissue_certificate_success(client):
    # GET old cert
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate/{SERIAL}', json=MOCK_OLD_CERT, status=200)
    # POST new cert enrollment
    rsps.add(rsps.POST, f'{DIGICERT_BASE}/mpki/api/v1/certificate', json=MOCK_NEW_CERT, status=201)
    # POST revoke old cert
    rsps.add(rsps.POST, f'{DIGICERT_BASE}/mpki/api/v1/certificate/{SERIAL}/revocation', status=204)

    resp = client.post(f'/api/certificates/{SERIAL}/reissue')
    assert resp.status_code == 201
    data = resp.get_json()
    assert data['serial_number'] == 'NEW-SERIAL-999'

    # Verify correct call order
    assert rsps.calls[0].request.method == 'GET'
    assert rsps.calls[1].request.method == 'POST'
    assert 'revocation' not in rsps.calls[1].request.url
    assert rsps.calls[2].request.method == 'POST'
    assert 'revocation' in rsps.calls[2].request.url

    # Verify new cert enrolled with same CN and SANs as old
    enroll_body = json.loads(rsps.calls[1].request.body)
    assert enroll_body['certificate']['common_name'] == 'test.example.com'
    assert enroll_body['certificate']['sans'] == {'dns_names': ['test.example.com']}


@rsps.activate
def test_reissue_revocation_failure_returns_207(client):
    rsps.add(rsps.GET, f'{DIGICERT_BASE}/mpki/api/v1/certificate/{SERIAL}', json=MOCK_OLD_CERT, status=200)
    rsps.add(rsps.POST, f'{DIGICERT_BASE}/mpki/api/v1/certificate', json=MOCK_NEW_CERT, status=201)
    rsps.add(rsps.POST, f'{DIGICERT_BASE}/mpki/api/v1/certificate/{SERIAL}/revocation',
             json={'message': 'Already revoked'}, status=409)

    resp = client.post(f'/api/certificates/{SERIAL}/reissue')
    assert resp.status_code == 207
    data = resp.get_json()
    assert data['new_serial'] == 'NEW-SERIAL-999'
    assert 'error' in data


@rsps.activate
def test_cancel_certificate(client):
    rsps.add(rsps.DELETE, f'{DIGICERT_BASE}/mpki/api/v1/certificate/{SERIAL}', status=204)
    resp = client.post(f'/api/certificates/{SERIAL}/cancel')
    assert resp.status_code == 200
    assert rsps.calls[0].request.method == 'DELETE'
    assert rsps.calls[0].request.headers['x-api-key'] == 'test-api-key'
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_remediation.py -v
```

Expected: 4 FAILs with `404`

- [ ] **Step 3: Implement remediation routes**

Replace `routes/remediation.py`:

```python
from flask import Blueprint, jsonify, request
import requests as http_requests
import digicert_client as dc

remediation_bp = Blueprint('remediation', __name__)


@remediation_bp.route('/api/certificates/<serial>/revoke', methods=['POST'])
def revoke_certificate(serial):
    dc.post(f'/mpki/api/v1/certificate/{serial}/revocation', request.get_json())
    return jsonify({'status': 'revoked', 'serial_number': serial})


@remediation_bp.route('/api/certificates/<serial>/reissue', methods=['POST'])
def reissue_certificate(serial):
    old_cert = dc.get(f'/mpki/api/v1/certificate/{serial}')

    enroll_body = {
        'profile': {'id': old_cert['profile']['id']},
        'certificate': {
            'common_name': old_cert['common_name'],
            'sans': old_cert.get('san', {}),
        }
    }
    new_cert = dc.post('/mpki/api/v1/certificate', enroll_body)

    try:
        dc.post(f'/mpki/api/v1/certificate/{serial}/revocation', {'reason': 'superseded'})
    except http_requests.HTTPError:
        return jsonify({
            'error': 'New certificate issued but revocation of old cert failed',
            'new_serial': new_cert.get('serial_number'),
        }), 207

    return jsonify(new_cert), 201


@remediation_bp.route('/api/certificates/<serial>/cancel', methods=['POST'])
def cancel_certificate(serial):
    # DigiCert MPKI cancel for pending certs uses DELETE on the certificate resource.
    # If this returns an error, verify the correct endpoint in the API docs and adjust.
    dc.delete(f'/mpki/api/v1/certificate/{serial}')
    return jsonify({'status': 'cancelled', 'serial_number': serial})
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_remediation.py -v
```

Expected: all 4 tests PASS

- [ ] **Step 5: Run the full test suite**

```bash
pytest -v
```

Expected: all 14 tests PASS

- [ ] **Step 6: Commit**

```bash
git add routes/remediation.py tests/test_remediation.py
git commit -m "feat: remediation routes (revoke, reissue, cancel)"
```

---

## Task 7: Frontend Shell + Dark Theme CSS

**Files:**
- Modify: `static/index.html`
- Create: `static/css/styles.css`

- [ ] **Step 1: Create `static/css/styles.css`**

```css
:root {
  --bg: #0f1923;
  --sidebar-bg: #0d1117;
  --panel: #1e293b;
  --border: #334155;
  --text-primary: #e2e8f0;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --accent: #4f46e5;
  --success: #22c55e;
  --warning: #f59e0b;
  --danger: #ef4444;
  --cert-link: #93c5fd;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--text-primary);
  height: 100vh;
  overflow: hidden;
}

#app { display: flex; height: 100vh; }

/* Sidebar */
#sidebar {
  width: 180px;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
  padding: 20px 12px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.logo {
  color: var(--accent);
  font-weight: 700;
  font-size: 16px;
  padding: 0 8px;
  margin-bottom: 20px;
  letter-spacing: 0.1em;
}

.nav-item {
  display: block;
  padding: 8px 10px;
  border-radius: 4px;
  color: var(--text-muted);
  text-decoration: none;
  font-size: 13px;
  transition: color 0.15s;
  border-left: 3px solid transparent;
}

.nav-item:hover { color: var(--text-secondary); }

.nav-item.active {
  background: rgba(79, 70, 229, 0.12);
  border-left-color: var(--accent);
  color: var(--text-primary);
}

/* Main content */
#content {
  flex: 1;
  overflow-y: auto;
  padding: 28px;
}

.view-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 20px;
}

.view-title { font-size: 18px; font-weight: 600; }
.view-subtitle { font-size: 12px; color: var(--text-muted); margin-top: 3px; }

/* Error banner */
.error-banner {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: 6px;
  color: #fca5a5;
  padding: 10px 14px;
  margin-bottom: 16px;
  font-size: 13px;
}

.hidden { display: none !important; }

/* Table */
.cert-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--panel);
  border-radius: 8px;
  overflow: hidden;
  font-size: 13px;
}

.cert-table thead tr { background: var(--sidebar-bg); }

.cert-table th {
  padding: 10px 14px;
  text-align: left;
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.06em;
  font-weight: 500;
  text-transform: uppercase;
}

.cert-table td {
  padding: 10px 14px;
  border-top: 1px solid var(--bg);
  color: var(--text-secondary);
}

.cert-row { cursor: pointer; }
.cert-row:hover td { background: rgba(79, 70, 229, 0.04); }
.cert-row.orphaned td:first-child { padding-left: 11px; border-left: 3px solid var(--danger); }
.row-revoked { opacity: 0.4; cursor: default; }
.row-revoked:hover td { background: none; }

.cert-name { color: var(--cert-link); font-family: 'Courier New', monospace; font-size: 12px; }
.unassigned { color: var(--text-muted); font-style: italic; }

/* Status badges */
.status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 3px;
  font-weight: 500;
}
.status-issued  { background: rgba(34,197,94,0.1);  color: var(--success); }
.status-revoked { background: rgba(239,68,68,0.1);  color: #fca5a5; }
.status-pending { background: rgba(167,139,250,0.1); color: #a78bfa; }
.status-expired { background: rgba(100,116,139,0.1); color: var(--text-muted); }

.expiry-warn { color: var(--warning); }

/* Tags */
.tag {
  display: inline-block;
  background: rgba(147,197,253,0.08);
  color: var(--cert-link);
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 3px;
  margin-right: 3px;
}

/* Detail panel */
.detail-panel {
  margin-top: 14px;
  background: var(--panel);
  border-radius: 8px;
  padding: 16px;
  border-left: 3px solid var(--accent);
}

.detail-label {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 12px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 14px;
}

.detail-key {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 3px;
}

.detail-val { font-size: 13px; color: var(--text-primary); }

/* Buttons */
.btn {
  border: none;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
  transition: opacity 0.15s;
}

.btn:hover { opacity: 0.85; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-revoke  { background: rgba(127,29,29,0.7); color: #fca5a5; }
.btn-replace { background: rgba(30,58,95,0.8); color: var(--cert-link); }
.btn-cancel  { background: rgba(59,42,0,0.8); color: #fbbf24; }
.btn-secondary {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-secondary);
}

.actions-cell { display: flex; gap: 6px; align-items: center; }
.no-action { color: var(--text-muted); font-size: 12px; }
.working { color: var(--text-muted); font-size: 11px; font-style: italic; }

/* Filter */
.filter-select {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  outline: none;
}

/* Loading / empty */
.loading, .empty {
  padding: 48px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

/* Modal */
#modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

#modal {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 24px;
  min-width: 360px;
  max-width: 500px;
}

.modal-title {
  font-size: 14px;
  font-weight: 600;
  color: #fca5a5;
  margin-bottom: 14px;
}

.modal-label {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 10px;
}

.reason-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
}

.reason-btn {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}

.reason-btn:hover { border-color: var(--accent); color: var(--text-primary); }
.reason-btn.selected { background: var(--accent); border-color: var(--accent); color: #fff; }

.modal-actions { display: flex; gap: 8px; }
```

- [ ] **Step 2: Replace `static/index.html` with the full app shell**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Saviynt Zuma — NHI Management</title>
  <link rel="stylesheet" href="/static/css/styles.css">
</head>
<body>
  <div id="app">
    <nav id="sidebar">
      <div class="logo">ZUMA</div>
      <a href="#" class="nav-item active" data-view="ownership">Ownership</a>
      <a href="#" class="nav-item" data-view="remediation">Remediation</a>
    </nav>
    <main id="content">
      <div id="error-banner" class="error-banner hidden"></div>
      <div id="view-container"></div>
    </main>
  </div>

  <div id="modal-overlay" class="hidden">
    <div id="modal"></div>
  </div>

  <script src="/static/js/api.js"></script>
  <script src="/static/js/ownership.js"></script>
  <script src="/static/js/remediation.js"></script>
  <script>
    const views = {
      ownership: () => renderOwnershipView(),
      remediation: () => renderRemediationView(),
    };

    document.querySelectorAll('.nav-item[data-view]').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        document.querySelectorAll('.nav-item').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        const view = link.dataset.view;
        if (views[view]) views[view]();
      });
    });

    renderOwnershipView();
  </script>
</body>
</html>
```

- [ ] **Step 3: Create stub JS files so the page loads without errors**

`static/js/` was created in Task 2. Create empty stubs:

```bash
touch static/js/api.js static/js/ownership.js static/js/remediation.js
```

- [ ] **Step 4: Start the app and verify the shell loads**

```bash
python app.py
```

Open `http://localhost:5000`. Expected: page loads, sidebar shows "ZUMA" logo with Ownership and Remediation links, dark background, no JS errors in browser console.

- [ ] **Step 5: Commit**

```bash
git add static/
git commit -m "feat: app shell with sidebar nav and dark enterprise CSS theme"
```

---

## Task 8: api.js — Fetch Wrapper

**Files:**
- Modify: `static/js/api.js`

- [ ] **Step 1: Implement `api.js`**

Replace `static/js/api.js`:

```javascript
function showError(message) {
  const banner = document.getElementById('error-banner');
  banner.textContent = message;
  banner.classList.remove('hidden');
  setTimeout(() => banner.classList.add('hidden'), 8000);
}

async function apiFetch(path, options = {}) {
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };
  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }

  const resp = await fetch(path, config);

  if (!resp.ok) {
    let msg;
    try {
      const err = await resp.json();
      msg = err.message || err.error || JSON.stringify(err);
    } catch {
      msg = `HTTP ${resp.status}: ${resp.statusText}`;
    }
    showError(`DigiCert API error: ${msg}`);
    throw new Error(msg);
  }

  if (resp.status === 204) return null;
  return resp.json();
}

const api = {
  getCertificates:   ()             => apiFetch('/api/certificates'),
  getCertificate:    (serial)       => apiFetch(`/api/certificates/${serial}`),
  enrollCertificate: (body)         => apiFetch('/api/certificates', { method: 'POST', body }),
  getProfiles:       ()             => apiFetch('/api/profiles'),
  getBusinessUnits:  ()             => apiFetch('/api/business-units'),
  getSeats:          ()             => apiFetch('/api/seats'),
  revoke:  (serial, reason) => apiFetch(`/api/certificates/${serial}/revoke`,  { method: 'POST', body: { reason } }),
  reissue: (serial)         => apiFetch(`/api/certificates/${serial}/reissue`, { method: 'POST' }),
  cancel:  (serial)         => apiFetch(`/api/certificates/${serial}/cancel`,  { method: 'POST' }),
};
```

- [ ] **Step 2: Verify `api.js` loads without errors**

Reload `http://localhost:5000`. Open browser DevTools → Console. Expected: no errors. Type `api` in console — expected: object with methods `getCertificates`, `revoke`, etc.

- [ ] **Step 3: Commit**

```bash
git add static/js/api.js
git commit -m "feat: api.js fetch wrapper with error banner"
```

---

## Task 9: Ownership View (Story 2)

**Files:**
- Modify: `static/js/ownership.js`

- [ ] **Step 1: Implement `ownership.js`**

Replace `static/js/ownership.js`:

```javascript
async function renderOwnershipView() {
  const container = document.getElementById('view-container');
  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Certificate Ownership</h1>
        <p class="view-subtitle">Business unit &amp; owner mapping from DigiCert</p>
      </div>
      <select id="bu-filter" class="filter-select">
        <option value="">All Business Units</option>
      </select>
    </div>
    <div id="cert-table-wrap"><div class="loading">Loading certificates...</div></div>
    <div id="cert-detail" class="detail-panel hidden"></div>
  `;

  let certs, businessUnits;
  try {
    [certs, businessUnits] = await Promise.all([api.getCertificates(), api.getBusinessUnits()]);
  } catch {
    return;
  }

  const buFilter = document.getElementById('bu-filter');
  businessUnits.forEach(bu => {
    const opt = document.createElement('option');
    opt.value = bu.id;
    opt.textContent = bu.name;
    buFilter.appendChild(opt);
  });

  buFilter.addEventListener('change', () => renderOwnershipTable(certs, buFilter.value));
  renderOwnershipTable(certs, '');
}

function renderOwnershipTable(certs, buId) {
  const wrap = document.getElementById('cert-table-wrap');
  const filtered = buId ? certs.filter(c => c.business_unit?.id === buId) : certs;

  if (!filtered.length) {
    wrap.innerHTML = '<div class="empty">No certificates found.</div>';
    return;
  }

  wrap.innerHTML = `
    <table class="cert-table">
      <thead><tr>
        <th>Common Name</th>
        <th>Business Unit</th>
        <th>Owner</th>
        <th>Tags</th>
        <th>Status</th>
        <th>Expiry</th>
      </tr></thead>
      <tbody>
        ${filtered.map(c => `
          <tr class="cert-row ${isOrphaned(c) ? 'orphaned' : ''}" data-serial="${c.serial_number}">
            <td class="cert-name">${c.common_name}</td>
            <td>${c.business_unit?.name || '<span class="unassigned">Unassigned</span>'}</td>
            <td>${c.seat?.user_name || c.seat?.seat_id || '<span class="unassigned">—</span>'}</td>
            <td>${renderTags(c.tags || [])}</td>
            <td><span class="status status-${c.status}">${formatStatus(c.status)}</span></td>
            <td class="${daysUntil(c.valid_till) < 7 ? 'expiry-warn' : ''}">${formatExpiry(c.valid_till)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll('.cert-row').forEach(row => {
    row.addEventListener('click', () => showOwnershipDetail(row.dataset.serial, filtered));
  });
}

function isOrphaned(cert) {
  return !cert.business_unit || !cert.seat;
}

function renderTags(tags) {
  if (!tags.length) return '<span class="unassigned">—</span>';
  return tags.map(t => `<span class="tag">${t.name || t}</span>`).join('');
}

function formatStatus(s) {
  const map = { issued: 'Active', revoked: 'Revoked', pending: 'Pending', expired: 'Expired' };
  return map[s] || s;
}

function daysUntil(dateStr) {
  if (!dateStr) return Infinity;
  return Math.floor((new Date(dateStr) - Date.now()) / 86400000);
}

function formatExpiry(dateStr) {
  if (!dateStr) return '—';
  const d = daysUntil(dateStr);
  if (d < 0) return 'Expired';
  if (d === 0) return 'Today';
  return `${d}d`;
}

function showOwnershipDetail(serial, certs) {
  const cert = certs.find(c => c.serial_number === serial);
  if (!cert) return;

  const detail = document.getElementById('cert-detail');
  detail.classList.remove('hidden');
  detail.innerHTML = `
    <div class="detail-label">SELECTED: ${cert.common_name}</div>
    <div class="detail-grid">
      <div><div class="detail-key">Serial</div><div class="detail-val" style="font-size:11px;font-family:monospace">${cert.serial_number}</div></div>
      <div><div class="detail-key">Issuer</div><div class="detail-val">${cert.issuer?.common_name || '—'}</div></div>
      <div><div class="detail-key">Key Size</div><div class="detail-val">${cert.key_size || '2048'}-bit RSA (software)</div></div>
      <div><div class="detail-key">Key Escrow</div><div class="detail-val">${cert.key_escrow_enabled ? 'Enabled' : 'Disabled'}</div></div>
      <div><div class="detail-key">Business Unit</div><div class="detail-val">${cert.business_unit?.name || '—'}</div></div>
      <div><div class="detail-key">Owner</div><div class="detail-val">${cert.seat?.user_name || cert.seat?.seat_id || '—'}</div></div>
      <div><div class="detail-key">Profile</div><div class="detail-val">${cert.profile?.name || '—'}</div></div>
      <div><div class="detail-key">Valid Until</div><div class="detail-val">${cert.valid_till ? new Date(cert.valid_till).toLocaleDateString() : '—'}</div></div>
    </div>
  `;
}
```

- [ ] **Step 2: Manually verify the Ownership view end-to-end**

Ensure `python app.py` is running. Open `http://localhost:5000`.

Expected:
- The Ownership view loads as the default
- The table shows real certificates from DigiCert (fetched live via Flask proxy)
- The BU filter dropdown is populated with business units from DigiCert
- Clicking a row shows the detail panel below the table with serial, key info, owner, BU
- Orphaned certs (no BU or owner) have a red left border on the first column
- Any cert expiring within 7 days shows the expiry in amber

- [ ] **Step 3: Commit**

```bash
git add static/js/ownership.js
git commit -m "feat: ownership view — Story 2 certificate ownership mapping"
```

---

## Task 10: Remediation View (Story 6)

**Files:**
- Modify: `static/js/remediation.js`

- [ ] **Step 1: Implement `remediation.js`**

Replace `static/js/remediation.js`:

```javascript
const REVOCATION_REASONS = [
  { value: 'key_compromise',        label: 'Key Compromise' },
  { value: 'cessation_of_operation', label: 'Cessation of Operation' },
  { value: 'superseded',            label: 'Superseded' },
  { value: 'unspecified',           label: 'Unspecified' },
];

async function renderRemediationView() {
  const container = document.getElementById('view-container');
  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Certificate Remediation</h1>
        <p class="view-subtitle">Revoke, replace, or cancel certificates via DigiCert API</p>
      </div>
    </div>
    <div id="remediation-wrap"><div class="loading">Loading certificates...</div></div>
  `;

  let certs;
  try {
    certs = await api.getCertificates();
  } catch {
    return;
  }

  renderRemediationTable(certs);
}

function renderRemediationTable(certs) {
  document.getElementById('remediation-wrap').innerHTML = `
    <table class="cert-table">
      <thead><tr>
        <th>Common Name</th><th>Profile</th><th>Status</th><th>Expiry</th><th>Actions</th>
      </tr></thead>
      <tbody id="rem-tbody">
        ${certs.map(c => remRow(c)).join('')}
      </tbody>
    </table>
  `;
  attachRemHandlers(certs);
}

function remRow(cert) {
  const s = cert.status;
  const isRevoked = s === 'revoked' || s === 'expired';
  const isPending = s === 'pending';
  const isActive  = s === 'issued';
  const d = daysUntilRem(cert.valid_till);
  const expiryClass = d !== null && d < 7 ? 'expiry-warn' : '';

  const actions = isRevoked
    ? '<span class="no-action">—</span>'
    : isPending
      ? `<button class="btn btn-cancel" data-action="cancel" data-serial="${cert.serial_number}">Cancel</button>`
      : isActive
        ? `<button class="btn btn-revoke" data-action="revoke" data-serial="${cert.serial_number}">Revoke</button>
           <button class="btn btn-replace" data-action="reissue" data-serial="${cert.serial_number}">Replace</button>`
        : '';

  return `
    <tr id="row-${cert.serial_number}" class="cert-row ${isRevoked ? 'row-revoked' : ''}">
      <td class="cert-name">${cert.common_name}</td>
      <td>${cert.profile?.name || '—'}</td>
      <td><span class="status status-${s}">${formatStatusRem(s)}</span></td>
      <td class="${expiryClass}">${formatExpiryRem(cert.valid_till)}</td>
      <td class="actions-cell">${actions}</td>
    </tr>
  `;
}

function formatStatusRem(s) {
  return { issued: 'Active', revoked: 'Revoked', pending: 'Pending', expired: 'Expired' }[s] || s;
}

function daysUntilRem(dateStr) {
  if (!dateStr) return null;
  return Math.floor((new Date(dateStr) - Date.now()) / 86400000);
}

function formatExpiryRem(dateStr) {
  if (!dateStr) return '—';
  const d = daysUntilRem(dateStr);
  if (d < 0) return 'Expired';
  if (d === 0) return 'Today';
  return `${d}d`;
}

function attachRemHandlers(certs) {
  document.getElementById('rem-tbody').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, serial } = btn.dataset;
    const cert = certs.find(c => c.serial_number === serial);
    if (!cert) return;
    if (action === 'revoke')  showRevokeModal(cert, certs);
    if (action === 'reissue') doReissue(cert, certs);
    if (action === 'cancel')  doCancel(cert, certs);
  });
}

function showRevokeModal(cert, certs) {
  const overlay = document.getElementById('modal-overlay');
  const modal   = document.getElementById('modal');
  overlay.classList.remove('hidden');

  modal.innerHTML = `
    <div class="modal-title">Revoke: ${cert.common_name}</div>
    <div class="modal-label">Select revocation reason:</div>
    <div class="reason-buttons">
      ${REVOCATION_REASONS.map(r =>
        `<button class="reason-btn" data-reason="${r.value}">${r.label}</button>`
      ).join('')}
    </div>
    <div class="modal-actions">
      <button id="confirm-revoke" class="btn btn-revoke" disabled>Confirm Revoke</button>
      <button id="cancel-modal" class="btn btn-secondary">Cancel</button>
    </div>
  `;

  let selectedReason = null;
  modal.querySelectorAll('.reason-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.reason-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedReason = btn.dataset.reason;
      document.getElementById('confirm-revoke').disabled = false;
    });
  });

  document.getElementById('cancel-modal').addEventListener('click', closeModal);
  document.getElementById('confirm-revoke').addEventListener('click', async () => {
    closeModal();
    setRowWorking(cert.serial_number);
    try {
      await api.revoke(cert.serial_number, selectedReason);
      updateCert(certs, cert.serial_number, { status: 'revoked' });
      refreshRow(cert.serial_number, certs);
    } catch {
      setRowWorking(cert.serial_number, 'Error — see banner');
    }
  });
}

async function doReissue(cert, certs) {
  if (!confirm(`Issue a replacement for ${cert.common_name} and revoke the original?`)) return;
  setRowWorking(cert.serial_number);
  try {
    const newCert = await api.reissue(cert.serial_number);
    // Remove old cert from list, prepend new one
    const idx = certs.findIndex(c => c.serial_number === cert.serial_number);
    if (idx !== -1) certs.splice(idx, 1);
    certs.unshift(newCert);
    renderRemediationTable(certs);
  } catch {
    setRowWorking(cert.serial_number, 'Error — see banner');
  }
}

async function doCancel(cert, certs) {
  if (!confirm(`Cancel pending issuance for ${cert.common_name}?`)) return;
  setRowWorking(cert.serial_number);
  try {
    await api.cancel(cert.serial_number);
    updateCert(certs, cert.serial_number, { status: 'revoked' });
    refreshRow(cert.serial_number, certs);
  } catch {
    setRowWorking(cert.serial_number, 'Error — see banner');
  }
}

function setRowWorking(serial, msg = 'Working...') {
  const row = document.getElementById(`row-${serial}`);
  if (row) row.querySelector('.actions-cell').innerHTML = `<span class="working">${msg}</span>`;
}

function updateCert(certs, serial, updates) {
  const cert = certs.find(c => c.serial_number === serial);
  if (cert) Object.assign(cert, updates);
}

function refreshRow(serial, certs) {
  const cert = certs.find(c => c.serial_number === serial);
  const row  = document.getElementById(`row-${serial}`);
  if (cert && row) row.outerHTML = remRow(cert);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}
```

- [ ] **Step 2: Manually verify the Remediation view end-to-end**

With `python app.py` running, open `http://localhost:5000` and click **Remediation** in the sidebar.

Expected:
- Certificate table loads with live data
- Active certs show **Revoke** and **Replace** buttons
- Pending certs show **Cancel** button
- Revoked certs show `—` (no buttons) and are dimmed
- Clicking **Revoke** opens a modal with 4 reason buttons
- Selecting a reason enables the **Confirm Revoke** button; clicking it closes the modal, shows "Working...", then dims the row with status "Revoked"
- Clicking **Replace** shows a `confirm()` dialog; confirming calls the reissue route, removes the old row, and prepends the new cert at the top of the table
- Any API error shows a red banner at the top of the content area for 8 seconds

- [ ] **Step 3: Commit**

```bash
git add static/js/remediation.js
git commit -m "feat: remediation view — Story 6 revoke, reissue, cancel"
```

---

## Task 11: End-to-End Smoke Test Against Live Tenant

This task verifies the full stack works against the real DigiCert MPKI test tenant.

- [ ] **Step 1: Confirm `.env` has the real API key**

```bash
grep DIGICERT_API_KEY .env
```

Expected: the line shows the real key (not the placeholder from `.env.example`).

- [ ] **Step 2: Start the app**

```bash
python app.py
```

Expected: `Running on http://127.0.0.1:5000`

- [ ] **Step 3: Verify certificate list loads**

```bash
curl -s http://localhost:5000/api/certificates | python3 -m json.tool | head -30
```

Expected: JSON array of certificate objects (may be empty if no certs enrolled yet).

- [ ] **Step 4: Enroll a test certificate via the API**

```bash
curl -s -X POST http://localhost:5000/api/certificates \
  -H "Content-Type: application/json" \
  -d '{
    "profile": {"id": "2f2afae4-78b6-4c4c-a00b-f1434183eae0"},
    "certificate": {
      "common_name": "smoke-test.example.com",
      "sans": {"dns_names": ["smoke-test.example.com"]}
    }
  }' | python3 -m json.tool
```

Expected: JSON response with `serial_number` and `status: "issued"`. Save the `serial_number` value.

- [ ] **Step 5: Verify the enrolled cert appears in the Ownership view**

Reload `http://localhost:5000`. Click **Ownership**. Expected: `smoke-test.example.com` appears in the table.

- [ ] **Step 6: Revoke the test cert via the Remediation view**

Click **Remediation**. Find `smoke-test.example.com`. Click **Revoke**, select **Unspecified**, click **Confirm Revoke**. Expected: row dims and status shows `Revoked`.

- [ ] **Step 7: Run the full test suite one final time**

```bash
pytest -v
```

Expected: all 14 tests PASS

- [ ] **Step 8: Final commit**

```bash
git add .
git commit -m "feat: end-to-end POC complete — Story 2 ownership mapping + Story 6 remediation"
```
