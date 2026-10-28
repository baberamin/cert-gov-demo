"""Put the demo back to a known starting point.

    make demo-reset                    (or:  .venv/bin/python scripts/reset_demo.py [--dry-run])

What it does:
  1. Makes sure the demo certificates exist, issuing any that are missing from the tenant CA (needs DIGICERT_API_KEY in .env).
  2. Resets the local demo state: Exceptions decisions, finding statuses, rule edits, and the owners of the demo certs.

What it does not do: it never writes ownership to DigiCert (ownership lives in Saviynt), never revokes anything,
and leaves the owners of every other certificate alone. A running app caches certificates for about 30 seconds.
"""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app
from routes import exceptions as ex
from routes.certificates import fetch_inventory
from routes.ownership import get_business_units
from routes.recommendations import cert_name

# (common name, business unit, baseline owner). Owned certs give their BU "peer owner" evidence; the rest start
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


def plan_local_reset(db_path):
    with sqlite3.connect(db_path) as conn:
        return {table: conn.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] for table in ('decisions', 'findings')}


def reset_local_state(db_path, owners_by_serial):
    """Clear demo state. `owners_by_serial` maps each demo cert's serial to its baseline owner (None = unowned)."""
    with sqlite3.connect(db_path) as conn:
        conn.execute('DELETE FROM decisions')
        conn.execute('DELETE FROM findings')
        conn.execute('DELETE FROM rules')
        ex.seed_default_rules(conn)
        for serial, owner in owners_by_serial.items():
            if owner:
                conn.execute(
                    "INSERT OR REPLACE INTO owner_assignments (serial_number, owner_name, assigned_at) "
                    "VALUES (?, ?, datetime('now'))", (serial, owner))
            else:
                conn.execute('DELETE FROM owner_assignments WHERE serial_number=?', (serial,))
        conn.commit()


def main(dry_run):
    client = create_app().test_client()
    bu_ids = {b['name']: b['id'] for b in get_business_units()}
    active = {cert_name(c): c['serial_number'] for c in fetch_inventory() if c.get('status') == 'issued'}

    owners_by_serial = {}
    for cn, bu, owner in SEED:
        label = f"{cn:<24} {bu:<26} {owner or '(unassigned)'}"
        serial = active.get(cn)
        if serial:
            print(f'keep    {label}')
        elif dry_run:
            print(f'would issue {label}')
            continue
        else:
            resp = client.post('/api/certificates/issue', json={
                'common_name': cn, 'dns_names': [cn], 'seat_id': cn, 'business_unit_id': bu_ids[bu]})
            if resp.status_code != 201:
                print(f'FAILED  {label}  {resp.status_code} {resp.get_data(as_text=True)[:200]}')
                continue
            serial = resp.get_json()['serial_number']
            print(f'issued  {label}')
        owners_by_serial[serial] = owner

    counts = plan_local_reset(ex.DB_PATH)
    verb = 'would clear' if dry_run else 'cleared'
    print(f"{verb}: {counts['decisions']} decision rows and {counts['findings']} finding rows "
          '(the app recomputes them on the next load); rules back to defaults; '
          f'owners restored for {len(owners_by_serial)} demo certs')
    if not dry_run:
        reset_local_state(ex.DB_PATH, owners_by_serial)
        print('Reset done. A running app picks up new certificates within about 30 seconds.')


if __name__ == '__main__':
    main('--dry-run' in sys.argv)
