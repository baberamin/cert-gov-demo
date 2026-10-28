from flask import Flask, jsonify
from werkzeug.exceptions import NotFound
from dotenv import load_dotenv
import requests

def create_app():
    load_dotenv()
    app = Flask(__name__, static_folder='static')

    from routes.certificates import certificates_bp
    from routes.ownership import ownership_bp
    from routes.remediation import remediation_bp
    from routes.owner_store import owner_store_bp, init_db
    from routes.users import users_bp
    from routes.findings import findings_bp, init_findings_db
    from routes.campaigns import campaigns_bp, init_campaigns_db
    from routes.exceptions import exceptions_bp, init_exceptions_db

    app.register_blueprint(certificates_bp)
    app.register_blueprint(ownership_bp)
    app.register_blueprint(remediation_bp)
    app.register_blueprint(owner_store_bp)
    app.register_blueprint(users_bp)
    app.register_blueprint(findings_bp)
    app.register_blueprint(campaigns_bp)
    app.register_blueprint(exceptions_bp)
    init_db()
    init_findings_db()
    init_campaigns_db()
    init_exceptions_db()

    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def catch_all(path):
        if path.startswith('api/'):
            return {'error': 'not found'}, 404
        try:
            return app.send_static_file(path) if path else app.send_static_file('index.html')
        except NotFound:
            return app.send_static_file('index.html')

    @app.errorhandler(requests.HTTPError)
    def handle_digicert_error(e):
        if e.response is not None:
            try:
                body = e.response.json()
            except Exception:
                body = {'error': e.response.text}
            return jsonify(body), e.response.status_code
        return jsonify({'error': str(e)}), 502

    @app.errorhandler(Exception)
    def handle_generic_error(e):
        return jsonify({'error': str(e)}), 500

    return app

if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, port=5001)
