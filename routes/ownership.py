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
