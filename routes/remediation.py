from flask import Blueprint, jsonify, request
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
import digicert_client as dc

remediation_bp = Blueprint('remediation', __name__)


def _generate_csr(common_name: str) -> str:
    """Return CSR PEM for a fresh RSA-2048 key."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    csr = (
        x509.CertificateSigningRequestBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)]))
        .sign(key, hashes.SHA256())
    )
    return csr.public_bytes(serialization.Encoding.PEM).decode()


@remediation_bp.route('/api/certificates/<serial>/revoke', methods=['POST'])
def revoke_certificate(serial):
    body = request.get_json() or {}
    dc.put(f'/mpki/api/v1/certificate/{serial}/revoke', {'revocation_reason': body.get('reason', 'unspecified')})
    return jsonify({'status': 'revoked', 'serial_number': serial})


@remediation_bp.route('/api/certificates/<serial>/reissue', methods=['POST'])
def reissue_certificate(serial):
    old_cert = dc.get(f'/mpki/api/v1/certificate/{serial}')
    seat_id = (old_cert.get('seat') or {}).get('seat_id') or old_cert.get('common_name') or 'unknown'

    csr_pem = _generate_csr(seat_id)
    new_cert = dc.post(f'/mpki/api/v1/certificate/{serial}/renew', {
        'csr': csr_pem,
        'delivery_format': 'x509',
    })

    try:
        dc.put(f'/mpki/api/v1/certificate/{serial}/revoke', {'revocation_reason': 'superseded'})
    except Exception:
        return jsonify({
            'error': 'Renewal succeeded but revocation of old cert failed',
            'new_serial': new_cert.get('serial_number'),
        }), 207

    return jsonify(new_cert), 201


@remediation_bp.route('/api/certificates/<serial>/cancel', methods=['POST'])
def cancel_certificate(serial):
    # DigiCert has no cancel endpoint for pending certificate requests.
    # DELETE /certificate/{serial}/revoke means "resume suspended", not cancel.
    return jsonify({'error': 'Cancel is not supported by the DigiCert MPKI API for this profile.'}), 501
