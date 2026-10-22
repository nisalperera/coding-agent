"""Pure safety tests: no SQL/Mongo drivers, app imports or network connections."""
import os
import unittest
from unittest.mock import patch
from tests_support.sandbox import (
    SafetyError, validate_environment, validate_postgres_url, validate_mongo_uri,
    verify_identity, verify_marker,
)
from tests_support.environment import configure_environment

SQL = "postgresql+psycopg://coding_agent_test:test-only@postgres-test:5432/coding_agent_test"
MONGO = "mongodb://mongo-test:27017/"
TOKEN = "a" * 43


def valid():
    return {"D0_TEST_SANDBOX": "1", "TEST_DATABASE_URL": SQL,
            "TEST_MONGODB_URI": MONGO, "TEST_MONGODB_DATABASE": "coding_agent_test",
            "TEST_SANDBOX_TOKEN": TOKEN}

class PolicyTests(unittest.TestCase):
    def test_valid_targets(self):
        self.assertEqual(validate_environment(valid()).database_url, SQL)

    def test_driver_imports_not_required(self):
        self.assertEqual(validate_environment(valid()).mongodb_uri, MONGO)

    def test_token_hidden_in_repr(self):
        self.assertNotIn(TOKEN, repr(validate_environment(valid())))

    def test_matching_marker(self):
        verify_marker(TOKEN, TOKEN)

    def test_valid_identity(self):
        verify_identity("coding_agent_test", "coding_agent_test")

    def test_configuration_overrides_application_credentials(self):
        env = {**valid(), "DATABASE_URL": "production-must-not-be-used",
               "GITHUB_TOKEN": "must-not-be-used", "GOOGLE_CLIENT_SECRET": "must-not-be-used"}
        with patch.dict(os.environ, env, clear=True):
            configure_environment()
            self.assertEqual(os.environ["DATABASE_URL"], SQL)
            self.assertEqual(os.environ["GITHUB_TOKEN"], "")
            self.assertEqual(os.environ["GOOGLE_CLIENT_SECRET"], "test-google-secret")
            self.assertEqual(os.environ["SKIP_DOTENV"], "true")
            self.assertEqual(os.environ["APP_ENV"], "test")

    def test_refusal_happens_before_configuration_changes(self):
        with patch.dict(os.environ, {"DATABASE_URL": "do-not-touch"}, clear=True):
            with self.assertRaises(SafetyError):
                configure_environment()
            self.assertEqual(os.environ["DATABASE_URL"], "do-not-touch")

    def test_key_is_deterministic_per_run(self):
        with patch.dict(os.environ, valid(), clear=True):
            configure_environment()
            first = os.environ["INTEGRATION_TOKEN_ENCRYPTION_KEY"]
            configure_environment()
            self.assertEqual(first, os.environ["INTEGRATION_TOKEN_ENCRYPTION_KEY"])

BAD_SQL = [
    SQL.replace("postgres-test", "localhost"), SQL.replace("postgres-test", "127.0.0.1"),
    SQL.replace("postgres-test", "production.example"), SQL.replace("/coding_agent_test", "/coding_agent"),
    SQL.replace("coding_agent_test:test-only", "postgres:test-only"),
    SQL.replace("postgresql+psycopg", "postgresql"), SQL.replace(":5432", ""),
    SQL + "?host=production.example", SQL + "#fragment", "", "not-a-url",
    SQL.replace(":test-only@", "@"), SQL.replace(":5432", ":invalid"),
]
BAD_MONGO = [
    MONGO.replace("mongo-test", "localhost"), MONGO.replace("mongo-test", "production.example"),
    MONGO + "?replicaSet=anything", MONGO.replace("mongodb:", "mongodb+srv:"),
    "mongodb://mongo-test:27017/coding_agent", "mongodb://user:pass@mongo-test:27017/",
    "mongodb://mongo-test,production.example:27017/", "", "not-a-url",
]
def reject_sql(value):
    def test(self):
        with self.assertRaises(SafetyError): validate_postgres_url(value)
    return test
def reject_mongo(value):
    def test(self):
        with self.assertRaises(SafetyError): validate_mongo_uri(value)
    return test
def reject_env(changes):
    def test(self):
        with self.assertRaises(SafetyError): validate_environment({**valid(), **changes})
    return test
def reject_marker(value):
    def test(self):
        with self.assertRaises(SafetyError): verify_marker(value, TOKEN)
    return test
for index, value in enumerate(BAD_SQL):
    setattr(PolicyTests, f"test_reject_sql_{index:02}", reject_sql(value))
for index, value in enumerate(BAD_MONGO):
    setattr(PolicyTests, f"test_reject_mongo_{index:02}", reject_mongo(value))
for index, changes in enumerate([
    {"D0_TEST_SANDBOX": ""}, {"D0_TEST_SANDBOX": "true"}, {"TEST_DATABASE_URL": ""},
    {"TEST_MONGODB_DATABASE": "coding_agent"}, {"TEST_SANDBOX_TOKEN": ""},
    {"TEST_SANDBOX_TOKEN": "short"}, {"PYTEST_XDIST_WORKER": "gw0"},
]):
    setattr(PolicyTests, f"test_reject_environment_{index:02}", reject_env(changes))
for index, value in enumerate([None, "b" * 43, "", 1, "é" * 43]):
    setattr(PolicyTests, f"test_reject_marker_{index:02}", reject_marker(value))

if __name__ == "__main__":
    unittest.main()
