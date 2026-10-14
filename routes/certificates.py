from flask import Blueprint, jsonify, request
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
import digicert_client as dc
from routes.ownership import resolve_bu_id

certificates_bp = Blueprint('certificates', __name__)

PROFILE_ID = '23d9643d-5be3-4e0c-9814-b6504ec6c251'  # GenPrivateCA (rest_api, third_party_app)


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


@certificates_bp.route('/api/certificates')
def list_certificates():
    args = dict(request.args)
    data = dc.get('/mpki/api/v1/certificate-search', params=args)
    certs = _extract_certs(data)

    # For open searches (no targeted filter), also pull our GenPrivateCA certs
    # because DigiCert's default search scope may exclude private-CA issuances
    if not any(k in args for k in ('seat_id', 'serial_number', 'profile_id')):
        try:
            profile_data = dc.get('/mpki/api/v1/certificate-search',
                                  params={**args, 'profile_id': PROFILE_ID})
            profile_certs = _extract_certs(profile_data)
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

    enroll_body = {
        'profile': {'id': PROFILE_ID},
        'csr': csr_pem,
        'seat': {'seat_id': seat_id},
        'attributes': {'subject.common_name': common_name},
    }
    if business_unit_id:
        enroll_body['business_unit'] = {'id': resolve_bu_id(business_unit_id)}

    result = dc.post('/mpki/api/v1/certificate', enroll_body)
    result['private_key'] = key_pem
    return jsonify(result), 201
