from flask import Flask, send_from_directory, jsonify
from dotenv import load_dotenv
import requests
import os

load_dotenv()

def create_app():
    app = Flask(__name__, static_folder='static')

    from routes.certificates import certificates_bp
    from routes.ownership import ownership_bp
    from routes.remediation import remediation_bp

    app.register_blueprint(certificates_bp)
    app.register_blueprint(ownership_bp)
    app.register_blueprint(remediation_bp)

    @app.route('/')
    def index():
        return send_from_directory('static', 'index.html')

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
    app.run(debug=True, port=5000)
