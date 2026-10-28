"""Issue a few demo certificates from the tenant CA so owner recommendations have real evidence.

Run from the project root (needs DIGICERT_API_KEY in .env):
    .venv/bin/python scripts/seed_demo_certs.py --dry-run
    .venv/bin/python scripts/seed_demo_certs.py

Safe to re-run: names that already exist are skipped. Certificates are real and live in the
shared demo tenant (199-day profile); revoke them by common name below when finished.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app
from routes.certificates import _fetch_all_certs
from routes.ownership import get_business_units
from routes.users import USERS

# (common name, business unit, owner). Owned certs give their BU "peer owner" evidence; the rest are left
# unassigned so the queue can recommend an owner for them.
SEED = [
    ('payroll.acme.com',     'Finance & Accounting',    'Pepper Potts'),
    ('billing-api.acme.com', 'Finance & Accounting',    'Pepper Potts'),
    ('ledger.acme.com',      'Finance & Accounting',    None),
    ('orders-api.acme.com',  'Engineering',             'Tony Stark'),
    ('auth-svc.acme.com',    'Engineering',             None),
    ('cdn.acme.com',         'Marketing & Growth',      'Carol Danvers'),
    ('edge-proxy.acme.com',  'Marketing & Growth',      None),
    ('deploy-hub.acme.com',  'DevOps & Infrastructure', None),
    ('runner-pool.acme.com', 'DevOps & Infrastructure', None),
    ('contracts.acme.com',   'Legal & Compliance',      None),
]


def main(dry_run):
    app = create_app()
    client = app.test_client()
    bu_ids = {b['name']: b['id'] for b in get_business_units()}
    emails = {u['name']: u['email'] for u in USERS}
    existing = {(c.get('subject') or {}).get('common_name') or c.get('common_name') or (c.get('seat') or {}).get('seat_id')
                for c in _fetch_all_certs({})}

    for cn, bu, owner in SEED:
        label = f"{cn:<24} {bu:<26} {owner or '(unassigned)'}"
        if cn in existing:
            print(f'skip   {label}  already exists')
            continue
        if dry_run:
            print(f'would  {label}')
            continue
        resp = client.post('/api/certificates/issue', json={
            'common_name': cn, 'dns_names': [cn], 'seat_id': cn, 'business_unit_id': bu_ids[bu]})
        if resp.status_code != 201:
            print(f'FAILED {label}  {resp.status_code} {resp.get_data(as_text=True)[:200]}')
            continue
        serial = resp.get_json().get('serial_number')
        if owner and serial:
            client.post(f'/api/certificates/{serial}/assign-owner',
                        json={'owner_name': owner, 'owner_email': emails[owner], 'seat_id': cn})
        print(f'issued {label}  serial={serial}')


if __name__ == '__main__':
    main('--dry-run' in sys.argv)
