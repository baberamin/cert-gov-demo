import json
import sqlite3
import pytest
from scripts import reset_demo
from routes.ownership import get_business_units
from routes.users import USERS


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = str(tmp_path / 'demo.db')
    import routes.exceptions, routes.findings, routes.owner_store
    for mod in (routes.exceptions, routes.findings, routes.owner_store):
        monkeypatch.setattr(mod, 'DB_PATH', path)
    routes.owner_store.init_db()
    routes.findings.init_findings_db()
    routes.exceptions.init_exceptions_db()
    return path


def dirty(path):
    with sqlite3.connect(path) as conn:
        conn.execute("INSERT INTO decisions (serial_number, outcome, decided_by, decided_at) VALUES ('S-1', 'approved', 'reviewer', 'x')")
        conn.execute("INSERT INTO findings (id, serial_number, finding_type, severity, status, created_at, updated_at) "
                     "VALUES ('S-1:unowned:high', 'S-1', 'unowned', 'high', 'resolved', 'x', 'x')")
        conn.execute("UPDATE rules SET params=?, enabled=0 WHERE template='healthy_owned'",
                     (json.dumps({'min_key_size': 1, 'max_validity_days': 1, 'min_days_to_expiry': 360}),))
        conn.executemany("INSERT INTO owner_assignments (serial_number, owner_name, assigned_at) VALUES (?, ?, 'x')",
                         [('S-OWNED', 'Wrong Person'), ('S-UNOWNED', 'Wrong Person'), ('S-OTHER', 'Keep Me')])


def test_reset_restores_demo_state_and_leaves_other_certs_alone(db):
    dirty(db)
    reset_demo.reset_local_state(db, {'S-OWNED': 'Pepper Potts', 'S-UNOWNED': None})
    with sqlite3.connect(db) as conn:
        assert conn.execute('SELECT COUNT(*) FROM decisions').fetchone()[0] == 0
        assert conn.execute('SELECT COUNT(*) FROM findings').fetchone()[0] == 0
        rules = conn.execute('SELECT template, params, enabled FROM rules ORDER BY priority').fetchall()
        assert [r[0] for r in rules] == ['unowned', 'policy_violation', 'healthy_owned']
        assert json.loads(rules[2][1]) == {'min_key_size': 2048, 'max_validity_days': 365, 'min_days_to_expiry': 30}
        assert all(r[2] == 1 for r in rules)
        owners = dict(conn.execute('SELECT serial_number, owner_name FROM owner_assignments').fetchall())
    assert owners == {'S-OWNED': 'Pepper Potts', 'S-OTHER': 'Keep Me'}


def test_plan_counts_what_a_reset_would_wipe(db):
    dirty(db)
    assert reset_demo.plan_local_reset(db) == {'decisions': 1, 'findings': 1}


def test_seed_list_is_consistent():
    names = [cn for cn, _, _ in reset_demo.SEED]
    assert len(names) == len(set(names))
    assert {bu for _, bu, _ in reset_demo.SEED} <= {b['name'] for b in get_business_units()}
    assert {o for _, _, o in reset_demo.SEED if o} <= {u['name'] for u in USERS}
