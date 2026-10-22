# Deliverable 1 backend

Branch: feature/projects-and-general-settings. Baseline: bd5f2943c446ede26cf90c371822858ec74ac7b1.

## Setup

From back-end/fast-api with the existing backend environment configured:

```sh
alembic upgrade head
uvicorn main:app --host 127.0.0.1 --port 8000
```

Migration 20261022_projects follows 68511d57cb58. It adds projects and
project_settings_versions. Startup performs no DDL. Back up data first;
downgrade drops the new tables and history and is not a normal production rollback.

OPERATOR_USER_IDS optionally contains comma-separated canonical existing user
UUIDs. Empty means no operator. Invalid UUIDs fail startup. Restart all workers
after changing the deployment allowlist. No public role-assignment API exists.
Operator status never bypasses project ownership. Future management endpoints
must explicitly depend on current_operator.

## Contract

GET/POST /v1/projects and GET/PATCH/DELETE /v1/projects/{uuid} match the frontend
adapter. List returns {"projects": [...]} without pagination. Create returns
201. PATCH accepts a nonempty subset of editable settings; null is rejected.
Names are trimmed/nonblank and limited to 255 characters; descriptions to 10,000.
NUL characters, unknown fields and unknown catalog IDs are rejected with 422.
Arrays may be empty and are deduplicated/sorted without inferred technologies.

PATCH/DELETE require one strong quoted numeric If-Match revision. Missing gives
428, malformed 400, stale 412. Successful mutations increment revision and write
an immutable settings snapshot in the same transaction. Even no-op PATCH creates
a revision. Responses expose ETag and use Cache-Control: no-store.

Cookie-authenticated writes require an exact Origin in FRONTEND_ORIGIN or
CORS_ALLOW_ORIGINS. Valid bearer authentication supports nonbrowser clients;
a header alone does not bypass current_user. This protection is scoped to the
new project routes and does not retrofit unrelated legacy routes.

Foreign/missing projects return 404. Owners see 410 for deleted projects.
DELETE acknowledges {"id": "...", "status": "deleted"}, retaining settings and
deletion metadata. No restore or hard-delete endpoint exists. Future run/job
cancellation is not claimed before project workers exist.

The frontend contract document's earlier proposed/missing-backend notes are
superseded by this implementation. Frontend runtime integration remains unverified.

## Validation and tracking

- [x] Project routes, owner isolation, settings versions and revision CAS prepared.
- [x] Additive migration, model registration and operator allowlist prepared.
- [x] Pure schema/policy tests: 38 passed; Python source syntax checked.
- [x] API/repository/rollback and migration tests added under tests/.
- [ ] Execute API/database/migration tests with installed dependencies.
- [ ] Verify full PostgreSQL/MySQL upgrade path and concurrent mutations.
- [ ] Verify frontend integration and full regression suite.
- [ ] Record actual GitHub/GitLab CI results.

Both existing CI jobs run pytest tests and discover these tests; no pipeline or
deployment changes are introduced. The existing tests/conftest.py requires a
properly provisioned disposable database and performs destructive cleanup. Never
run it against real user data. Added project API tests clean their project rows
before legacy user cleanup. The migration test exercises the new revision on
SQLite; this does not prove the legacy chain or production-dialect concurrency.

Run the full suite only in the configured disposable environment:

```sh
python -m pytest -q tests
```

Pure checks without the database fixture:

```sh
python -m pytest --noconftest -q tests/test_project_schema_policy.py
```

No project chat, skills, uploads, storage approval UI, new AWS resources, or
MongoDB changes are included. No deployment is performed by this commit.
