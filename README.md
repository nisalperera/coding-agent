# coding-agent

A personal coding agent that runs on AWS — combining a self-hosted Qwen3-Coder-14B model
(vLLM on a T4 EC2 instance), an authenticated serverless web app, and a terminal-native
CLI agent, with human-in-the-loop approval for any risky action (file writes, shell
commands, and GitHub/GitLab repo changes).

## Project layout

```
back-end/     Lambda handler, repo tools, and GitHub OAuth token exchange
cli/          Terminal-native coding agent + local auth flow
front-end/    Static chat UI (index.html + app.js + config.js), deployed to S3
template.yaml SAM/CloudFormation stack: Lambda, DynamoDB, Function URL
.github/      GitHub Actions CI/CD (test → deploy → deploy-frontend)
.gitlab-ci.yml GitLab CI/CD mirror of the same three stages
```

## Getting started

See [`config_guide.md`](./config_guide.md) for the complete setup: Cognito login
(Google/GitHub), per-user "Connect GitHub"/"Connect GitLab" repository authorization,
the vLLM serving setup, DynamoDB tables, and the OIDC-based CI/CD pipelines for both
GitHub Actions and GitLab CI.

## Local FastAPI deployment

The `feature/fastapi-mysql-oauth` branch adds a self-hosted local/LAN deployment
target alongside the AWS stack. It runs:

- `back-end/fast-api/main.py` as the FastAPI backend.
- MySQL with SQLAlchemy and Alembic for users, sessions, OAuth state, integrations,
  and pending actions.
- Direct Google OpenID Connect with server-side sessions instead of Cognito.
- A local or LAN-accessible OpenAI-compatible vLLM server.
- Per-user GitHub/GitLab provider OAuth, with legacy shared tokens available only when
  `ALLOW_LEGACY_PROVIDER_TOKEN_FALLBACK=true` is explicitly configured for development.

From `back-end/fast-api`, configure the local environment, apply the schema, and start
the service:

```bash
alembic upgrade head
uvicorn main:app --host 127.0.0.1 --port 8000
```

Provider access and refresh tokens will be encrypted before storage by the local
integration repository using `INTEGRATION_TOKEN_ENCRYPTION_KEY`; generate a Fernet key
with:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Do not commit the key. Keep a separate, stable key for each environment while any token
ciphertext encrypted with it remains stored. See the
[local deployment section in `config_guide.md`](./config_guide.md#local-deployment-this-branch-only)
for the architecture, database migration, and key-rotation details.


<!-- deliverable-1-projects-frontend -->
## Projects frontend (Deliverable 1 review)

The project frontend adds `/projects`, project overview, and general settings.
It requires the proposed project API in
`front-end/next-js/PROJECTS_API_CONTRACT.md`. Missing backend support is displayed
as unavailable; no project data is simulated or saved locally.

See `front-end/next-js/DELIVERABLE_1_FRONTEND.md` for validation commands,
limitations, and tracking. This is not the full backend Deliverable 1 and does
not implement project chat, uploads, skills, or storage.


## Rendered auth/chat lifecycle acceptance

From `front-end/next-js`, install the development-only test dependencies once:

```bash
npm install --save-dev --save-exact vitest vite @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom
npm run test:lifecycle
```

Keep the resulting `package.json` and `package-lock.json` changes together.
Use the resolved lockfile for subsequent `npm ci` runs. Node must satisfy the
resolved test dependency engines; this setup targets the previously reported
Node 22.22.2 environment. No production runtime dependencies are added.

`test:lifecycle` runs real React mounts under StrictMode in jsdom, including
actual useAuth/useChat hooks, AuthSessionNotice, and login/register pages.
Network calls, stream-consumption callbacks, Next router and theme are mocked.
This is rendered component acceptance, not a real Next.js router/browser test.
The separate 88-test Node suite remains `node --test tests/*.test.mjs`.
Lifecycle tests are discovered only under `tests/lifecycle/` by the dedicated
Vitest config, so they are not mixed with the Node test runner.

Both GitHub Actions and GitLab CI must eventually execute this same frontend
sequence with the committed lockfile: `npm ci`, `node --test tests/*.test.mjs`,
`npm run test:lifecycle`, `npm run lint`, `npm run build`. This packet does not
modify or claim execution of either provider's pipeline. A local pass is not
hosted CI or browser acceptance. Existing backend/disposable test stages must
be preserved when the new command is wired into both providers.


## Verified identity isolation for projects and account settings

Project routes and account settings bind their state to the verified shared auth
identity, including the current verified user object. Account replacement,
logout, verification failure and route unmount invalidate pending operations.
Stale reads/mutations cannot navigate, display success, or hydrate shared
integration flags. Abort only detaches browser requests; it cannot undo a server
mutation already accepted. Server ownership checks remain authoritative.

Same-user session re-verification conservatively resets project/settings drafts
and reloads server data, matching the existing chat isolation policy. Unsaved
credential inputs are never persisted. Users should not expect draft continuity
across verification or account changes.

Browser UI preferences now use `coding-agent-settings:account:<encoded-user-id>`.
Only the default boolean preference fields are read. The legacy browser-global
`coding-agent-settings` key is intentionally not imported or migrated because it
has no verified owner. Account-scoped preferences remain on that browser until
its storage is cleared; this is isolation, not confidentiality from other code
running on the same origin. Guest preferences are in-memory for the page session.
Storage failures fall back to defaults. Theme remains a browser-wide preference.

No new dependencies/configuration are required. Validate from `front-end/next-js`:
`node --test tests/*.test.mjs`, `npm run test:lifecycle`, `npm run lint`, and
`npm run build`. Apply this identical frontend command set in both GitHub Actions
and GitLab CI when updating their jobs. This change does not edit CI YAML or
claim hosted CI execution, real-browser acceptance, or formal D0 sign-off.


## Selector-parser security backport validation

The frontend targets postcss-selector-parser 6.1.5 for transitive v6 consumers
using a range-scoped npm override. This is the maintainer-listed same-major
backport for GHSA-rj75-hqrm-r3gf, not a blanket migration to v7. Existing v7
consumers, if added later, must independently use a patched v7 release.
Tailwind remains 3.4.19; Typography remains 0.5.20; Next.js and its ESLint config
remain 16.4.2. No lint rules are removed or suppressed.

After applying the package change, run npm install without --force or
--legacy-peer-deps and preserve package.json/package-lock.json together.
Run node --test tests/*.test.mjs, npm run test:lifecycle, npm run lint,
npm run build, npm audit --omit=dev, and npm audit in both frontend CI lanes
when their jobs are updated. This packet does not edit either provider's YAML.

New dependency tests check installed parser versions, representative selector
roundtrips, and a bounded subprocess stress case. They do not establish whole-
application visual equivalence. Perform desktop/mobile and light/dark review
of chat, formatted answers/code, auth pages, projects, project settings and
account settings before accepting the override. CSS hash equality is supporting
evidence only. Braces GHSA-vfj7-8cjw-p6xm remains open; this change does not claim
a clean full audit or complete dependency remediation.


## Project-owned Braces recursion security backport

Braces 3.0.3 is hardened after installation by scripts/harden-braces.mjs for
GHSA-vfj7-8cjw-p6xm. Upstream package name/version remain unchanged; this is a
project-maintained source patch, not an official release or an audit suppression.
Parser AST nesting is limited to 100 (including parentheses); direct AST consumers
compile/expand/stringify validate iteratively with depth 128 and 50,000 visited
nodes. Cyclic child and parent chains are rejected with a controlled SyntaxError.
Hostile getters/proxies or arbitrary code execution inside JavaScript objects are
not sandboxed. Existing expansion resource limits remain necessary and unchanged.

All installed lockfile-listed copies are checked against exact upstream Git blob
hashes before patching; modified/newer sources fail closed for review. Previously
patched source must reverse exactly to the reviewed original, and guard contents
must match. npm install/npm ci apply via postinstall. prebuild/prelint and the
rendered-test pre-hook verify without silently repairing. --ignore-scripts does
not establish a hardened install; npm run deps:harden is then required explicitly.

Docker copies the hardening script before npm ci. No base-image migration is
included. Pinning/testing container Node against the current Vitest/Vite engine
requirements remains part of container acceptance, separate from the backport.

Validate with npm run deps:verify, node --test tests/*.test.mjs,
npm run test:lifecycle, npm run lint, npm run build and npm audit --omit=dev.
Use the same command set for both GitHub/GitLab frontend lanes when integrated.
Existing CI YAML is not edited. Record full npm audit separately: upstream-version
warnings remain, including the parser-v6 advisory metadata discrepancy. A green
source verification is not a green registry audit, hosted CI or D0 sign-off.

Keep the selector-parser 6.1.5 override and its regressions. Do not run audit fix
--force or relabel package versions to hide warnings. Preserve package/lockfile,
patch script, regression tests, Dockerfile and both docs together. Run npm ci and
repeat all tests to verify patch persistence. Recheck production UI desktop/mobile,
light/dark, formatted code, auth and project/settings dialogs after the rebuild.


## Frontend acceptance evidence and closure

Run `node front-end/next-js/scripts/run-frontend-acceptance.mjs --container` from
the repository root. It executes npm ci, source-hardening checks, Node/rendered
tests, lint/build, production/full audits, standalone assets and an isolated
container build/asset smoke. Evidence is plain JSON/text under output. It does
not commit, push, deploy, send actions or grant sign-off. Docker must be available.
The runner fails if source hashes change while checks run. A dirty checkout is
identified by HEAD plus source hashes, not falsely represented as that commit.
After publication rerun against the final clean revision on both remotes.

Standalone mode copies public and .next/static into .next/standalone before
starting server.js on an ephemeral loopback port. Container probes run through
docker exec: no host mounts, published ports or existing application containers
are used. Only the uniquely named container created by this run is removed.
The image is retained for inspection; no global prune is performed.
The Dockerfile uses Node 22.22.2-alpine and excludes .env files and local build/
node_modules directories from its context using Dockerfile.dockerignore.
Image tags are not digests; the resolved build logs/image inspection are evidence.

NEXT_PUBLIC_BACKEND_URL, if supplied in the environment, is passed as a PUBLIC
container build argument. GitHub may use a repository Actions variable of that
name; GitLab may use a CI/CD variable. No provider credentials are bundled.
Unauthenticated HTML/static-asset smoke can run without the backend; it is not
an auth/API/browser E2E pass. Do not infer functioning integrations from it.

GitHub and GitLab use the same runner with --container, Node 22.22.2, the same
lockfile, timeout and evidence structure. GitLab Docker-in-Docker requires a
runner with privileged service support and a shared /certs/client TLS volume.
The script performs no automatic runner configuration. An unsuitable runner must
fail visibly, not skip the container gate. Connect GitLab in connector settings
for assisted lookup; publishing and pipeline execution still require permission.
Existing backend/deployment pipeline jobs are preserved.

The full audit is collected, not hidden. Known Braces/parser advisory identifiers
are recorded with nonzero audit status and dependencyDisposition=pending_review.
New/unidentified findings or audit service failures fail the evidence job. A
successful evidence job therefore does NOT mean full audit clean or release
approved. See DEPENDENCY_ACCEPTANCE.md for unsigned ownership/review/sign-off.
Do not upload .env, credential JSON, account data or unreviewed screenshots.
Review generated logs before sharing even though no secrets are intentionally
collected. Local browser acceptance, hosted results and formal signature remain
separate. No real-browser screenshot automation is installed by this packet.
