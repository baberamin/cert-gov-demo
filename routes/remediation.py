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
