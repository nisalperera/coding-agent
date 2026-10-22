# D0 / R0: Disposable backend test infrastructure

Baseline branch: feature/projects-and-general-settings
Baseline commit: fd68fc45230a1e855661967f5baa756ef1697d70
Status: prepared for review; not applied, pushed, or executed as a container stack.

## Scope

Replace the destructive fixture's application-like localhost database target
with a dedicated test lane. Preserve the application Compose file, runtime
database configuration, API behavior, README.md, and config_guide.md.
No application database is migrated, cleaned, or otherwise accessed by this
package preparation. No infrastructure is deployed automatically.

## Safety layers

- Explicit D0_TEST_SANDBOX=1 and TEST_* endpoints; no fallback to DATABASE_URL.
- Only postgres-test:5432 with role/database coding_agent_test is accepted.
- Only standalone mongo-test:27017 and database coding_agent_test is accepted.
- localhost, arbitrary hosts, wrong roles/names, query overrides and missing
  ownership tokens are rejected before application imports or cleanup.
- The guarded runner creates a random run token. It refuses to adopt a nonempty
  unmarked schema or a marker belonging to another run. SQL marker lives in
  d0_safety; Mongo marker is a dedicated control collection.
- Before every cleanup, verify actual SQL database/role and this run's marker.
  Mongo address and marker are also checked. No marker is deleted by cleanup.
- SQL data cleanup follows reverse FK dependency order, including project
  revisions/projects/settings before users. Mongo cleanup covers the verified
  messages/conversations collections and preserves indexes/control marker.
- Serial execution only. This is not an adversarial sandbox for arbitrary test
  code and does not protect against deliberately bypassing guards or malicious
  tests independently opening unrelated services.

## Local isolation

Use only the dedicated compose.tests.yml with a distinct Compose project name.
It has an internal network, no host networking, published ports, bind mounts,
external volumes, environment files, or production service dependencies.
PostgreSQL/Mongo test data use tmpfs and are disposable. The test-image build
copies only required source/tests; Dockerfile.tests.dockerignore excludes .env,
Git state, local caches and unrelated context. Docker must support this
Dockerfile-specific ignore file and Compose v2.

PostgreSQL 13 follows the version declared in the existing application Compose
file; this is not a production version/support recommendation. Mongo 8.0 is
the explicit sandbox image selection. Neither is evidence of compatibility
with a differently versioned deployed server. Image digests are not pinned;
record pulled versions/digests with executed evidence before release.

From the repository root after reviewing/applying the package:

```sh
docker compose -p coding-agent-d0-r0 -f back-end/fast-api/compose.tests.yml config --quiet
docker compose -p coding-agent-d0-r0 -f back-end/fast-api/compose.tests.yml up --build --abort-on-container-exit --exit-code-from backend-tests
```

Record the test command's exit status before running cleanup. After preserving
logs, remove only this dedicated test project:

```sh
docker compose -p coding-agent-d0-r0 -f back-end/fast-api/compose.tests.yml down --volumes --remove-orphans
```

Never substitute the normal application Compose file in the cleanup command.
Reusing a failed sandbox with a new runner token is intentionally refused;
remove/recreate the dedicated sandbox instead of forcing marker replacement.
Keep PostgreSQL/Mongo logs private; share only relevant redacted failures.

## What runs

1. Dependency-free safety-policy unit tests.
2. Validate target configuration and force test-only app settings, fake OAuth
   values, fresh test encryption material, empty shared tokens and SKIP_DOTENV.
3. Wait for only the dedicated services, verify identity, claim fresh markers.
4. Run alembic upgrade head against the disposable relational database.
5. Run the existing complete pytest tests suite serially with guarded fixtures.

No metadata.create_all, stamp, production migration, automatic model service,
external embedding service, or test-result suppression is introduced.
Existing app defects may now fail reproducibly. Fix them in separately reviewed
packets rather than skipping tests or weakening safety guards.

## CI parity

GitHub uses a Python job container with postgres-test/mongo-test service aliases.
The GitLab fastapi-test job uses the same images, credentials, database names,
aliases, policy-test command, guarded runner, migrations and pytest command.
The installer replaces only the identified GitLab fastapi-test block; unrelated
legacy test/deployment jobs are preserved, not repaired or declared validated.
CI services are disposable but their networks are not claimed identical to the
local internal Compose network. No deploy commands are added.

## Validation so far

- 42 pure safety-policy tests passed in preparation.
- All prepared Python source parsed successfully.
- These checks did not import SQLAlchemy/FastAPI or contact any service.
- Container build, Docker Compose, PostgreSQL/Mongo markers, migrations, full
  pytest suite and CI workflows have not been executed in this environment.
- Guards are designed to fail closed, but are not represented as integration-
  validated until the disposable stack is run and evidence is reviewed.

## Tracking

- [x] Explicit target/identity/run-marker policy implemented in prepared source.
- [x] Test-only environment bootstrap and no application credential fallback.
- [x] Guarded migration/test runner and FK-aware cleanup prepared.
- [x] Dedicated local container profile and matching CI job changes prepared.
- [x] Pure safety tests passed; source syntax reviewed.
- [ ] Review/apply package locally; no remote write implied.
- [ ] Build and run disposable stack, preserve actual failures/results.
- [ ] Validate markers, refusal cases and cleanup against live disposable services.
- [ ] Validate empty-database migration and full existing test suite.
- [ ] Execute both CI providers and record actual results.
- [ ] Resolve remaining D0 contracts and unrelated R1-R6 findings separately.
