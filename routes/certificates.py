import threading
import time
from concurrent.futures import ThreadPoolExecutor
from flask import Blueprint, jsonify, request
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
import digicert_client as dc
from routes.ownership import ensure_seat_exists, get_business_units
from routes.owner_store import save_bu_assignment

certificates_bp = Blueprint('certificates', __name__)

PROFILE_ID = '85d4bc85-d567-4a3e-a832-dc1b770e1e52'  # Private Server Certificate 199 Days (rest_api, third_party_app)


def _generate_csr(common_name: str, dns_names: list[str]) -> tuple[str, str]:
    """Return (csr_pem, private_key_pem) for an RSA-2048 keypair."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    san_dns = [x509.DNSName(n) for n in dns_names] if dns_names else [x509.DNSName(common_name)]
    csr = (
        x509.CertificateSigningRequestBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)]))
        .add_extension(x509.SubjectAlternativeName(san_dns), critical=False)
        .sign(key, hashes.SHA256())
    )

    csr_pem = csr.public_bytes(serialization.Encoding.PEM).decode()
    key_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    ).decode()

    return csr_pem, key_pem


@certificates_bp.route('/api/profiles')
def list_profiles():
    return jsonify(dc.get('/mpki/api/v1/profile'))


@certificates_bp.route('/api/profiles/<profile_id>')
def get_profile(profile_id):
    return jsonify(dc.get(f'/mpki/api/v1/profile/{profile_id}'))


def _extract_certs(data):
    if isinstance(data, list):
        return data
    return data.get('certificates', data.get('items', data.get('results', [])))


def _search_page(params, page, limit=100):
    return dc.get('/mpki/api/v1/certificate-search', params={**params, 'limit': limit, 'offset': page * limit})


def _fetch_all_certs(params, max_pages=1000, workers=6):
    """Fetch every page of certificate-search (limit/offset, max 100 per page) until DigiCert says there is no more.

    Pages after the first are requested `workers` at a time, which is what keeps a ~900-cert tenant to a few
    seconds. max_pages is only a runaway guard: a low cap silently hides certs, because expired ones sort first.
    """
    data = _search_page(params, 0)
    if isinstance(data, list):
        return data
    certs = _extract_certs(data)
    if not certs or not data.get('has_more', False):
        return certs
    all_certs = list(certs)
    page = 1
    with ThreadPoolExecutor(max_workers=workers) as pool:
        while page < max_pages:
            batch = range(page, min(page + workers, max_pages))
            for data in pool.map(lambda p: _search_page(params, p), batch):
                if isinstance(data, list):
                    return all_certs + data
                certs = _extract_certs(data)
                all_certs.extend(certs)
                if not certs or not data.get('has_more', False):
                    return all_certs
            page += workers
    return all_certs


_INVENTORY_TTL = 30
_inventory_cache = {'at': float('-inf'), 'writes': -1, 'certs': []}
_inventory_lock = threading.Lock()


def invalidate_inventory():
    with _inventory_lock:
        _inventory_cache['at'] = float('-inf')


def fetch_inventory():
    """Every cert (open search plus our profile's), shared by the governance pages.

    Cached for a short time, and dropped as soon as the app writes anything to DigiCert.
    """
    with _inventory_lock:
        c = _inventory_cache
        if time.monotonic() - c['at'] >= _INVENTORY_TTL or c['writes'] != dc.writes:
            writes = dc.writes
            certs = _fetch_all_certs({})
            try:
                profile_certs = _fetch_all_certs({'profile_id': PROFILE_ID})
                seen = {x.get('serial_number') for x in certs}
                certs = certs + [x for x in profile_certs if x.get('serial_number') not in seen]
            except Exception:
                pass
            c.update(at=time.monotonic(), writes=writes, certs=certs)
        return list(c['certs'])


@certificates_bp.route('/api/certificates')
def list_certificates():
    args = dict(request.args)
    certs = _fetch_all_certs(args)

    # For open searches (no targeted filter), also pull our GenPrivateCA certs
    # because DigiCert's default search scope may exclude private-CA issuances
    if not any(k in args for k in ('seat_id', 'serial_number', 'profile_id')):
        try:
            profile_certs = _fetch_all_certs({**args, 'profile_id': PROFILE_ID})
            existing = {c.get('serial_number') for c in certs}
            certs = certs + [c for c in profile_certs if c.get('serial_number') not in existing]
        except Exception:
            pass

    return jsonify(certs)


@certificates_bp.route('/api/certificates/<serial>')
def get_certificate(serial):
    return jsonify(dc.get(f'/mpki/api/v1/certificate/{serial}'))


@certificates_bp.route('/api/certificates/issue', methods=['POST'])
def issue_certificate():
    """
    Issue a cert via GenPrivateCA (rest_api + third_party_app).
    Body: { "common_name": "...", "dns_names": ["..."], "seat_id": "...", "business_unit_id": "..." }
    Returns: DigiCert cert fields + private_key (PEM)
    """
    body = request.get_json() or {}
    common_name = (body.get('common_name') or '').strip()
    dns_names = body.get('dns_names') or [common_name]
    seat_id = (body.get('seat_id') or common_name).strip()
    business_unit_id = body.get('business_unit_id')

    if not common_name:
        return jsonify({'error': 'common_name is required'}), 400

    csr_pem, key_pem = _generate_csr(common_name, dns_names)

    # Seat must exist in the right BU before enrollment — BU is determined by seat membership,
    # not the enrollment body. Create/move the seat now so the cert inherits the correct BU.
    if business_unit_id:
        ensure_seat_exists(seat_id, business_unit_id)

    enroll_body = {
        'profile': {'id': PROFILE_ID},
        'csr': csr_pem,
        'seat': {'seat_id': seat_id},
        'attributes': {'subject.common_name': common_name},
    }

    result = dc.post('/mpki/api/v1/certificate', enroll_body)
    result['private_key'] = key_pem

    # Save BU locally — DigiCert always files certs under the profile's BU (Engineering),
    # so we track the user's intended BU in SQLite and overlay it in the inventory.
    serial = result.get('serial_number')
    if serial and business_unit_id:
        bu_name = next(
            (b['name'] for b in get_business_units() if b['id'] == business_unit_id),
            None,
        )
        if bu_name:
            save_bu_assignment(serial, business_unit_id, bu_name)

    return jsonify(result), 201
