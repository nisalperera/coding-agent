"""Guard targets, claim fresh scratch services, migrate, then run tests serially."""
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
from .sandbox import SafetyError, validate_environment, prepare_relational_sandbox, prepare_mongo_sandbox
from .environment import configure_environment

def main():
    # Validate explicit endpoints before importing SQL drivers or the app.
    validate_environment(os.environ, require_token=False)
    os.environ["TEST_SANDBOX_TOKEN"] = secrets.token_urlsafe(32)
    targets = configure_environment()
    os.chdir(Path(__file__).resolve().parents[1])
    from sqlalchemy import create_engine, text
    from pymongo import MongoClient
    engine = create_engine(targets.database_url, connect_args={"connect_timeout": 2})
    mongo = MongoClient(targets.mongodb_uri, serverSelectionTimeoutMS=1000, connectTimeoutMS=1000)
    try:
        deadline = time.monotonic() + 90
        while True:
            try:
                with engine.connect() as connection:
                    connection.execute(text("SELECT 1"))
                mongo.admin.command("ping")
                break
            except Exception:
                if time.monotonic() >= deadline:
                    raise SafetyError("Disposable service readiness timed out; no migration or cleanup was started") from None
                time.sleep(1)
        prepare_relational_sandbox(engine, targets)
        prepare_mongo_sandbox(mongo, targets)
        print("Disposable SQL/Mongo targets claimed. Applying test migrations.", flush=True)
        result = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"])
        if result.returncode:
            return result.returncode
        print("Running serial backend tests in the disposable sandbox.", flush=True)
        return subprocess.run([sys.executable, "-m", "pytest", "-q", "tests"]).returncode
    finally:
        engine.dispose()
        mongo.close()

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SafetyError as exc:
        print(f"Test safety refusal: {exc}", file=sys.stderr)
        raise SystemExit(2)
