import pytest
import os
from app import create_app

@pytest.fixture(autouse=True)
def set_env(monkeypatch):
    monkeypatch.setenv('DIGICERT_API_KEY', 'test-api-key')
    monkeypatch.setenv('DIGICERT_BASE_URL', 'https://demo.one.digicert.com')

@pytest.fixture
def app():
    application = create_app()
    application.config['TESTING'] = True
    return application

@pytest.fixture
def client(app):
    return app.test_client()
