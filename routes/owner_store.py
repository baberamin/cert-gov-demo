import sqlite3
import os
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request
from routes.ownership import update_seat_owner

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
        conn.commit()


@owner_store_bp.route('/api/certificates/<serial>/assign-owner', methods=['POST'])
def assign_owner(serial):
    body = request.get_json() or {}
    owner_name = (body.get('owner_name') or '').strip()
    owner_email = (body.get('owner_email') or '').strip()
    seat_id = (body.get('seat_id') or '').strip()
    if not owner_name:
        return jsonify({'error': 'owner_name is required'}), 400

    with _db() as conn:
        conn.execute(
            'INSERT OR REPLACE INTO owner_assignments (serial_number, owner_name, assigned_at) VALUES (?, ?, ?)',
            (serial, owner_name, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()

    # Write owner back to DigiCert seat so it's recorded in the CA, not just locally
    if seat_id:
        update_seat_owner(seat_id, seat_name=owner_name, email=owner_email)

    return jsonify({'serial_number': serial, 'owner_name': owner_name})


@owner_store_bp.route('/api/owner-assignments')
def list_assignments():
    with _db() as conn:
        rows = conn.execute('SELECT serial_number, owner_name FROM owner_assignments').fetchall()
    return jsonify({r['serial_number']: r['owner_name'] for r in rows})
