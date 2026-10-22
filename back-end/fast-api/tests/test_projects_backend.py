import importlib.util
from pathlib import Path
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from app.api.projects import router
from app.auth.dependencies import current_user
from app.db.database import db_session
from app.db.models.common import User
from app.db.models.projects import Project, ProjectSettingsVersion
from app.db.core import projects_repository as repo

OWNER = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"
ORIGIN = {"Origin": "http://localhost:3000"}
PAYLOAD = {"name": "Compiler", "project_type": "general", "languages": ["cpp"]}

@pytest.fixture
def project_client():
    with db_session() as session:
        session.add_all([User(user_id=OWNER, email="project-owner@example.test", email_verified=True),
                         User(user_id=OTHER, email="project-other@example.test", email_verified=True)])
    app = FastAPI()
    app.include_router(router)
    actor = {"user_id": OWNER}
    async def identity():
        return dict(actor)
    app.dependency_overrides[current_user] = identity
    try:
        with TestClient(app) as client:
            yield client, actor, app
    finally:
        with db_session() as session:
            ids = select(Project.id).where(Project.owner_id.in_([OWNER, OTHER]))
            session.execute(delete(ProjectSettingsVersion).where(ProjectSettingsVersion.project_id.in_(ids)))
            session.execute(delete(Project).where(Project.owner_id.in_([OWNER, OTHER])))

def create(client):
    response = client.post("/v1/projects", json=PAYLOAD, headers=ORIGIN)
    assert response.status_code == 201, response.text
    return response.json()

def test_create_and_history(project_client):
    client, actor, app = project_client
    item = create(client)
    assert item["revision"] == 1 and "owner_id" not in item
    assert client.get("/v1/projects").json()["projects"] == [item]
    with db_session() as session:
        assert session.get(ProjectSettingsVersion, (item["id"], 1)).settings_json["languages"] == ["cpp"]

def test_owner_isolation(project_client):
    client, actor, app = project_client
    item = create(client)
    actor["user_id"] = OTHER
    path = f'/v1/projects/{item["id"]}'
    headers = {**ORIGIN, "If-Match": '"1"'}
    assert client.get("/v1/projects").json() == {"projects": []}
    assert client.get(path).status_code == 404
    assert client.patch(path, json={"name": "Stolen"}, headers=headers).status_code == 404
    assert client.delete(path, headers=headers).status_code == 404

def test_revision_and_soft_delete(project_client):
    client, actor, app = project_client
    item = create(client)
    path = f'/v1/projects/{item["id"]}'
    first = client.patch(path, json={"name": "Renamed"}, headers={**ORIGIN, "If-Match": '"1"'})
    assert first.status_code == 200 and first.json()["revision"] == 2
    assert first.headers["etag"] == '"2"'
    assert client.patch(path, json={"name": "Stale"}, headers={**ORIGIN, "If-Match": '"1"'}).status_code == 412
    assert client.delete(path, headers={**ORIGIN, "If-Match": '"2"'}).json() == {"id": item["id"], "status": "deleted"}
    assert client.get(path).status_code == 410
    assert client.get("/v1/projects").json() == {"projects": []}
    with db_session() as session:
        assert session.get(Project, item["id"]).deleted_by == OWNER
        assert session.get(ProjectSettingsVersion, (item["id"], 1)).settings_json["name"] == "Compiler"
        assert session.get(ProjectSettingsVersion, (item["id"], 3)).project_status == "deleted"

@pytest.mark.parametrize("header,status", [(None, 428), ('1', 400), ('W/"1"', 400)])
def test_preconditions(project_client, header, status):
    client, actor, app = project_client
    item = create(client)
    headers = ORIGIN if header is None else {**ORIGIN, "If-Match": header}
    assert client.patch(f'/v1/projects/{item["id"]}', json={"name": "X"}, headers=headers).status_code == status

def test_auth_origin_and_fields(project_client):
    client, actor, app = project_client
    assert client.post("/v1/projects", json=PAYLOAD).status_code == 403
    assert client.post("/v1/projects", json=PAYLOAD, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/v1/projects", json={**PAYLOAD, "owner_id": OTHER}, headers=ORIGIN).status_code == 422
    app.dependency_overrides.clear()
    assert client.get("/v1/projects").status_code == 401

def test_snapshot_failure_rolls_back(project_client, monkeypatch):
    client, actor, app = project_client
    item = create(client)
    def fail(*args):
        raise RuntimeError("snapshot unavailable")
    monkeypatch.setattr(repo, "_snapshot", fail)
    with pytest.raises(RuntimeError):
        client.patch(f'/v1/projects/{item["id"]}', json={"name": "Lost"}, headers={**ORIGIN, "If-Match": '"1"'})
    assert client.get(f'/v1/projects/{item["id"]}').json()["revision"] == 1

def test_new_migration_upgrade_downgrade():
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import Column, MetaData, String, Table, create_engine, inspect
    path = Path(__file__).resolve().parents[1] / "alembic/versions/20261022_projects_settings.py"
    spec = importlib.util.spec_from_file_location("projects_revision", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    metadata = MetaData()
    Table("users", metadata, Column("user_id", String(36), primary_key=True))
    metadata.create_all(engine)
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            assert {"projects", "project_settings_versions"}.issubset(inspect(connection).get_table_names())
            migration.downgrade()
            assert inspect(connection).get_table_names() == ["users"]
    engine.dispose()
