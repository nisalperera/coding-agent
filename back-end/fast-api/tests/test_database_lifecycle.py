from unittest.mock import MagicMock, patch

import pytest

from app.db import database


def test_session_factory_contract():
    assert database.SessionLocal.kw["autoflush"] is False
    assert database.SessionLocal.kw["autocommit"] is False
    assert database.SessionLocal.kw["expire_on_commit"] is False


def test_db_session_commits_and_closes():
    session = MagicMock()

    with patch.object(database, "SessionLocal", return_value=session):
        with database.db_session() as yielded:
            assert yielded is session

    session.commit.assert_called_once()
    session.rollback.assert_not_called()
    session.close.assert_called_once()


def test_db_session_rolls_back_and_closes():
    session = MagicMock()

    with patch.object(database, "SessionLocal", return_value=session):
        with pytest.raises(RuntimeError, match="expected"):
            with database.db_session():
                raise RuntimeError("expected")

    session.commit.assert_not_called()
    session.rollback.assert_called_once()
    session.close.assert_called_once()


def test_database_readiness_executes_select_one():
    connection = MagicMock()
    connection_context = MagicMock()
    connection_context.__enter__.return_value = connection
    connection_context.__exit__.return_value = False

    with patch.object(database.engine, "connect", return_value=connection_context):
        database.assert_database_ready()

    connection.execute.assert_called_once()
    statement = connection.execute.call_args.args[0]
    assert str(statement) == "SELECT 1"


def test_database_engine_disposal():
    with patch.object(database.engine, "dispose") as dispose:
        database.dispose_database_engine()

    dispose.assert_called_once()