import re
from flask import Blueprint, jsonify
import digicert_client as dc

ownership_bp = Blueprint('ownership', __name__)

# The one real DigiCert BU on the demo tenant — used for enrollment.
# All demo BUs with synthetic IDs are mapped to this at issuance time.
REAL_DEFAULT_BU_ID = '839315b4-fc5a-4d72-9537-b72746637433'

DEMO_BUSINESS_UNITS = [
    {'id': REAL_DEFAULT_BU_ID,    'name': 'Engineering'},
    {'id': 'bu-devops',           'name': 'DevOps & Infrastructure'},
    {'id': 'bu-finance',          'name': 'Finance & Accounting'},
    {'id': 'bu-marketing',        'name': 'Marketing & Growth'},
    {'id': 'bu-legal',            'name': 'Legal & Compliance'},
    {'id': 'bu-security',         'name': 'Information Security'},
    {'id': 'bu-product',          'name': 'Product Management'},
    {'id': 'bu-hr',               'name': 'Human Resources'},
]

_UUID_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I
)


def resolve_bu_id(bu_id: str) -> str:
    """Return a DigiCert-valid BU UUID. Synthetic demo IDs map to the default BU."""
    return bu_id if _UUID_RE.match(bu_id) else REAL_DEFAULT_BU_ID


@ownership_bp.route('/api/business-units')
def list_business_units():
    return jsonify(DEMO_BUSINESS_UNITS)


@ownership_bp.route('/api/business-units/<bu_id>')
def get_business_unit(bu_id):
    return jsonify(dc.get(f'/mpki/api/v1/business-unit/{bu_id}'))


@ownership_bp.route('/api/seats')
def list_seats():
    return jsonify(dc.get('/mpki/api/v1/seat'))
