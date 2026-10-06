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
