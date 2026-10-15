.PHONY: setup run test

setup:
	python3 -m venv .venv
	.venv/bin/pip install -q -r requirements.txt
	cd frontend && npm install && npm run build

run:
	@test -f .env || (echo "ERROR: .env not found. Run: cp .env.example .env and fill in your DIGICERT_API_KEY"; exit 1)
	.venv/bin/python app.py

test:
	.venv/bin/pytest tests/ -v
