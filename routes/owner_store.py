import sqlite3
import os
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request

owner_store_bp = Blueprint('owner_store', __name__)

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'owner_assignments.db')


def _db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS owner_assignments (
                serial_number TEXT PRIMARY KEY,
                owner_name    TEXT NOT NULL,
                assigned_at   TEXT NOT NULL
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS bu_assignments (
                serial_number TEXT PRIMARY KEY,
                bu_id         TEXT NOT NULL,
                bu_name       TEXT NOT NULL
            )
        ''')
        conn.commit()


def save_bu_assignment(serial: str, bu_id: str, bu_name: str) -> None:
    with _db() as conn:
        conn.execute(
            'INSERT OR REPLACE INTO bu_assignments (serial_number, bu_id, bu_name) VALUES (?, ?, ?)',
            (serial, bu_id, bu_name),
        )
        conn.commit()


@owner_store_bp.route('/api/certificates/<serial>/assign-owner', methods=['POST'])
def assign_owner(serial):
    body = request.get_json() or {}
    owner_name = (body.get('owner_name') or '').strip()
    if not owner_name:
        return jsonify({'error': 'owner_name is required'}), 400

    with _db() as conn:
        conn.execute(
            'INSERT OR REPLACE INTO owner_assignments (serial_number, owner_name, assigned_at) VALUES (?, ?, ?)',
            (serial, owner_name, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()

    return jsonify({'serial_number': serial, 'owner_name': owner_name})


@owner_store_bp.route('/api/owner-assignments')
def list_assignments():
    with _db() as conn:
        rows = conn.execute('SELECT serial_number, owner_name FROM owner_assignments').fetchall()
    return jsonify({r['serial_number']: r['owner_name'] for r in rows})


@owner_store_bp.route('/api/bu-assignments')
def list_bu_assignments():
    with _db() as conn:
        rows = conn.execute('SELECT serial_number, bu_id, bu_name FROM bu_assignments').fetchall()
    return jsonify({r['serial_number']: {'id': r['bu_id'], 'name': r['bu_name']} for r in rows})
