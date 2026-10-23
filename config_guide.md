# AWS Configuration Guide

This is a **brief index** of every configuration area in this project. For the actual
commands, in the correct dependency order, see **[`SETUP_GUIDE.md`](./SETUP_GUIDE.md)**.

The stack: vLLM serving Qwen3-Coder-14B on a T4 EC2 instance, an authenticated
Lambda-based web app (Cognito + per-user GitHub/GitLab OAuth), and a CLI coding agent —
following OWASP LLM Top 10 (2026), OWASP API Security Top 10, and the Twelve-Factor App
methodology. Includes GitHub/GitLab repo-management tools (branches, commits, PRs/MRs,
issues via REST APIs).

---

## Configuration areas

| Area | Brief description | Step-by-step guide |
|---|---|---|
| **Networking** | VPC, private subnet, security group, and NAT Gateway/instance so Lambda and EC2 share a network and both have outbound internet access. | [SETUP_GUIDE.md → Step 1](./SETUP_GUIDE.md#step-1-networking--vpc-subnet-security-groups) |
| **EC2 GPU host** | Launch a `g4dn.xlarge` (T4), install vLLM, serve Qwen3-Coder-14B-Instruct-AWQ. The Lambda auto-starts/stops this instance on demand. | [SETUP_GUIDE.md → Step 2](./SETUP_GUIDE.md#step-2-launch-the-ec2-gpu-instance-and-serve-qwen3-coder-14b) |
| **IAM deploy roles** | OIDC trust roles for GitHub Actions and GitLab CI so `sam deploy` runs with no static AWS access keys. | [SETUP_GUIDE.md → Step 3](./SETUP_GUIDE.md#step-3-iam--oidc-deploy-roles-for-github-actions-and-gitlab-ci) |
| **Cognito (sign-in)** | User pool + Google identity provider + app client + Hosted UI domain. GitHub is deliberately **not** federated here — see the callout in Step 4. | [SETUP_GUIDE.md → Step 4](./SETUP_GUIDE.md#step-4-amazon-cognito--user-pool-google-sign-in-app-client) |
| **Shared repo tokens** | One GitHub PAT and one GitLab PAT used as the fallback service-level identity for `github_push_file`/`gitlab_push_file` when a user hasn't connected their own account. | [SETUP_GUIDE.md → Step 5](./SETUP_GUIDE.md#step-5-shared-githubgitlab-repo-management-tokens) |
| **DynamoDB tables** | `pending-actions` (human-in-the-loop approvals, TTL) and `user-integrations` (per-user OAuth tokens — GitHub only; GitLab tokens never reach the backend). Created automatically by `sam deploy`; manual commands included for reference only. | [SETUP_GUIDE.md → Step 6](./SETUP_GUIDE.md#step-6-dynamodb-tables-optional--sam-creates-these-automatically-in-step-8) |
| **Tavily API key** | Powers the agent's `web_search` tool. | [SETUP_GUIDE.md → Step 7](./SETUP_GUIDE.md#step-7-tavily-api-key) |
| **First SAM deploy** | Creates the Lambda + Function URL, both DynamoDB tables, and the S3+CloudFront front-end hosting — using placeholder GitHub OAuth values, since the real callback URL doesn't exist yet. | [SETUP_GUIDE.md → Step 8](./SETUP_GUIDE.md#step-8-first-deploy-sam--with-placeholder-github-oauth-values) |
| **Stack outputs** | `FunctionUrl`, `FrontendUrl`, `FrontendBucketName`, `FrontendDistributionId`. | [SETUP_GUIDE.md → Step 9](./SETUP_GUIDE.md#step-9-retrieve-stack-outputs) |
| **Cognito callback update** | Point the app client's callback/logout URLs at the real front-end URL. | [SETUP_GUIDE.md → Step 10](./SETUP_GUIDE.md#step-10-update-the-cognito-app-client-with-the-real-front-end-url) |
| **Connect GitHub / Connect GitLab** | Per-user repository OAuth, independent of Cognito. Once connected, actions run as that user, not the shared PAT/token — see the note below. GitHub needs a redeploy afterward with real credentials. | [SETUP_GUIDE.md → Step 11](./SETUP_GUIDE.md#step-11-register-the-per-user-connect-githubconnect-gitlab-oauth-integrations) |
| **Custom domain (optional)** | Route 53 + free auto-validated ACM cert + CloudFront alias. HTTPS is enforced regardless of whether you use this. | [SETUP_GUIDE.md → Step 12](./SETUP_GUIDE.md#step-12-optional-custom-domain-via-an-existing-route-53-hosted-zone) |
| **CI/CD secrets** | Full GitHub Secrets / GitLab CI variable list, with the `GITHUB_`-prefix rename explained. | [SETUP_GUIDE.md → Step 13](./SETUP_GUIDE.md#step-13-cicd-secrets--github-actions--gitlab-ci) |
| **Push & verify** | Trigger the `test → deploy → deploy-frontend` pipeline and confirm it runs. | [SETUP_GUIDE.md → Step 14](./SETUP_GUIDE.md#step-14-push-to-main-and-verify-cicd) |
| **Smoke test** | Five checks to confirm the whole stack actually works end-to-end. | [SETUP_GUIDE.md → Step 15](./SETUP_GUIDE.md#step-15-smoke-test) |
| **Least-privilege IAM (optional)** | Replace the quick-start managed policies with a resource-scoped inline policy before production. | [SETUP_GUIDE.md → Step 16](./SETUP_GUIDE.md#step-16-optional-least-privilege-iam-policy-for-the-deploy-role) |
| **CLI setup (optional)** | Local terminal-native agent, tokens via OS keyring. | [SETUP_GUIDE.md → Step 17](./SETUP_GUIDE.md#step-17-optional-cli-setup) |

---

## Local deployment (this branch only)

This branch (`feature/fastapi-mysql-oauth`) targets a self-hosted local/LAN deployment
of the coding agent as an alternative to the AWS stack described above. It uses FastAPI
(`back-end/fast-api/main.py`), MySQL with SQLAlchemy and Alembic, direct Google OpenID
Connect with server-side sessions, and a local/LAN OpenAI-compatible vLLM server.

| AWS component | Local equivalent (this branch) |
|---|---|
| Lambda (`back-end/lambda_function.py`) | FastAPI app (`back-end/fast-api/main.py`) |
| Cognito + Google federation | Direct Google OpenID Connect (`app/auth`), server-side sessions |
| DynamoDB `pending-actions` / `user-integrations` | MySQL via SQLAlchemy + Alembic (`app/db/models.py`, `app/db/sqlalchemy_database.py`) |
| EC2 auto-start + vLLM | Local/LAN vLLM OpenAI-compatible server (`app/services/vllm_service.py`) |
| Shared GitHub/GitLab PAT fallback | Per-user provider OAuth, with shared tokens available only behind `ALLOW_LEGACY_PROVIDER_TOKEN_FALLBACK` for local development |

Schema changes are managed by Alembic under `back-end/fast-api/alembic/`, generated from
the SQLAlchemy models in `app/db/models.py`. Run `alembic upgrade head` against a
configured `DATABASE_URL` to create or upgrade the local MySQL schema; application
startup never runs DDL itself.

### Encrypting stored provider tokens

`user_integrations.access_token_ciphertext` and `refresh_token_ciphertext` must never
contain plaintext tokens. `app/core/crypto.py` encrypts and decrypts provider tokens
with a Fernet key held in `INTEGRATION_TOKEN_ENCRYPTION_KEY`. Generate a key with:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Set the generated value in the local FastAPI `.env`. The helper calls
`Settings.require_integration_encryption()` before every encryption or decryption
operation, so a missing key blocks token storage/retrieval rather than allowing a
plaintext fallback. Rotate a key by decrypting existing values with the old key and
re-encrypting them with the new key; this branch does not yet include an automated
rotation utility.

NOTE: Do not commit this key. Use a separate key per environment and keep it stable for as
long as ciphertext encrypted with it must remain readable.

The AWS material elsewhere in this file remains the deployment reference for the AWS
target. This section applies only to the local deployment architecture on this branch.

---

## How per-user repo authorization actually gets used

**GitHub** — Once a user clicks "Connect GitHub" (Step 11) and the OAuth exchange
completes, `back-end/lambda_function.py`'s `call_repo_tool()` looks up that user's
stored access token (`github_oauth.get_user_integration(user_id, "github")`) and
passes it into `repo_tools.py`'s `github_create_branch`/`github_push_file`/
`github_open_pull_request`/`github_create_issue` as a `github_token` kwarg — every
commit, branch, PR, or issue those tools create is attributed to **that specific
GitHub user**, not the shared service PAT. If a user hasn't connected their own
account, the same functions fall back to the shared `GITHUB_TOKEN` automatically.
Disconnecting GitHub (the 🔗 modal, or the header button) also calls the
`disconnect_integration` Lambda action, which deletes that DynamoDB row via
`github_oauth.delete_user_integration()` — it isn't just a local browser flag.

**GitLab** — GitLab's per-user token is a "public"/native OAuth client PKCE token that
lives only in the browser's `localStorage`; it is never sent to the backend to be
stored. Instead, `front-end/app.js`'s `resolvePendingAction()` attaches it (as
`gitlab_token`) only at the moment a `gitlab_*` tool call is being approved via the
human-in-the-loop flow, and `call_repo_tool()` passes it through to `repo_tools.py`'s
`gitlab_*` functions for that single call only, then discards it. If the user hasn't
connected GitLab, those calls fall back to the shared `GITLAB_TOKEN`. Disconnecting
GitLab clears only the browser's copy, since the server never had one.

This applies to both provider flows via the `approve_pending` action — which is also
where the front-end's confirmation UI (`appendConfirmation()`/`resolvePendingAction()`
in `app.js`) renders Approve/Deny controls for every risky tool call.

---

## How the front-end actually consumes the streamed response

`back-end/lambda_function.py` writes its response as a sequence of events, not one
JSON document: zero or more `{"type":"progress", ...}` lines while `ensure_backend_ready()`
polls a cold EC2 instance / loading vLLM, then either a single `{"type":"error"}` or
`{"type":"confirmation_required"}` object, **or** `{"type":"answer_start"}` followed by
`"data: {\"token\": ...}\n\n"` SSE-style chunks ending in `"data: [DONE]\n\n"`.

`front-end/app.js`'s `consumeAgentStream()` reads `response.body` as a `ReadableStream`,
buffers and splits on newlines, and dispatches each event to a handler as it arrives:
progress lines update a single in-place "⏳ ..." bubble (`appendProgressMessage()`/
`updateProgressMessage()`), an `answer_start` swaps that bubble out for a live assistant
message that grows token-by-token, and a `confirmation_required`/`error` event renders
the same UI `send()` already produced. `resolvePendingAction()` (the `approve_pending`
call) intentionally still uses a plain `resp.json()` — that action never triggers
`ensure_backend_ready()`, so the backend always returns it as one flat object.

---

## Repo-management tools reference

| Tool | Platform | Endpoint used | Risky (needs approval)? |
|---|---|---|---|
| `github_create_branch` | GitHub | `POST /repos/{owner}/{repo}/git/refs` | Yes |
| `github_push_file` | GitHub | `PUT /repos/{owner}/{repo}/contents/{path}` | Yes |
| `github_open_pull_request` | GitHub | `POST /repos/{owner}/{repo}/pulls` | Yes |
| `github_create_issue` | GitHub | `POST /repos/{owner}/{repo}/issues` | Yes |
| `gitlab_create_branch` | GitLab | `POST /projects/:id/repository/branches` | Yes |
| `gitlab_push_file` | GitLab | `POST or PUT /projects/:id/repository/files/:path` | Yes |
| `gitlab_open_merge_request` | GitLab | `POST /projects/:id/merge_requests` | Yes |
| `gitlab_create_issue` | GitLab | `POST /projects/:id/issues` | Yes |

All eight tools are risky and routed through the same human-in-the-loop confirmation
flow as `write_file`/`run_shell`. Repository creation and deletion are not implemented
by design.

---

## Security and standards checklist applied

- [x] OAuth 2.0 Authorization Code + PKCE
- [x] Cognito JWT verification on every Lambda request
- [x] Per-user rate limiting (OWASP API Security)
- [x] Object-level authorization via `owns_conversation()` (OWASP API Security — BOLA)
- [x] Human-in-the-loop approval for all mutating tools (OWASP LLM Top 10 — Excessive Agency),
      with a working front-end Approve/Deny UI (`appendConfirmation()`/`resolvePendingAction()`)
- [x] Structured JSON logging with trace IDs
- [x] All config/tokens via environment variables / Secrets Manager
- [x] Lambda response streaming for real-time token output, correctly consumed end-to-end
      by the front-end's `consumeAgentStream()` (progress → answer/confirmation/error)
- [x] EC2 auto-start with bounded 2-minute startup budget and progress/retry UX, with a
      visible in-chat progress indicator during cold starts
- [x] Repo-management tools use REST API endpoints only, never shell git/gh/glab commands
- [x] Per-user GitHub OAuth tokens stored server-side in DynamoDB, GitHub client secret
      never leaves the Lambda, and are actually used to attribute GitHub actions to the
      connecting user instead of the shared PAT
- [x] Per-user GitLab OAuth tokens are never stored server-side; sent per-request only
      when approving a `gitlab_*` tool call, and used for that single call
- [x] Disconnecting GitHub revokes the server-side DynamoDB token, not just a browser flag
- [x] Front-end S3 bucket fully private, served only via CloudFront with OAC
- [x] Custom-domain certificate DNS-validated automatically, no manual approval step
- [x] HTTPS enforced end-to-end for the front-end, on both default and custom domains
- [x] GitHub is never federated through Cognito — see SETUP_GUIDE.md Step 4's callout
- [x] Lambda Function URL CORS explicitly allows the `authorization`/`content-type`
      headers the front-end actually sends (see `template.yaml`'s `FunctionUrlConfig`)

## Known gaps to close before production

- In-memory rate limiting must move to DynamoDB for multi-instance correctness.
- GitHub/GitLab tokens currently use broad PAT/OAuth scopes; narrow to fine-grained,
  repo-specific tokens before production use.
- Add OpenTelemetry exporter configuration for full distributed tracing.
- Per-user GitHub OAuth tokens have no refresh/expiry handling. GitLab's browser-side
  token does have a `gitlab_refresh_token` stored, but nothing currently uses it to
  silently refresh an expired GitLab access token — an expired token will just fail
  the next `gitlab_*` tool approval with a 401 from GitLab's API.
- ~~The stored per-user GitHub OAuth token is not consumed by `repo_tools.py`~~ and
  ~~the per-user GitLab OAuth token is not wired in~~ — both **resolved**: see
  "How per-user repo authorization actually gets used" above.
- ~~"Disconnect GitHub" only clears local browser state~~ — **resolved**: it now calls
  the `disconnect_integration` Lambda action, which deletes the DynamoDB row.
- ~~`app.js`'s `send()` reads the Lambda response with a single `resp.json()` call,
  which breaks whenever `ensure_backend_ready()` emits progress lines before the final
  answer/confirmation~~ — **resolved**: `send()` now uses `consumeAgentStream()` to read
  `response.body` as a stream and dispatch each event (progress / answer_start+tokens /
  confirmation_required / error) as it arrives. See "How the front-end actually consumes
  the streamed response" above.
- The live-updating assistant bubble re-parses the *entire* accumulated markdown string
  through `marked.parse()` on every single token during streaming, rather than
  incrementally. This is correct but not maximally efficient for very long answers;
  acceptable for a chat UI at this scale, worth revisiting if answers get much longer.

---

*Configuration reference for the coding agent project.*


<!-- deliverable-1-projects-frontend -->
## Projects frontend configuration (Deliverable 1 review)

No new frontend environment variables, npm dependencies, or storage services are
introduced. Requests use existing `APP_CONFIG.BACKEND_URL` and session cookies.
Implement the proposed project routes and revision semantics in
`front-end/next-js/PROJECTS_API_CONTRACT.md` before enabling persistence.
Verify cookie, CSRF, CORS, PATCH/DELETE, and `If-Match` policy on the backend.

Do not put credentials, project records, or private content in localStorage.
Backend authorization and operator bootstrap are outside this frontend delivery.
Remaining validation is tracked in `front-end/next-js/DELIVERABLE_1_FRONTEND.md`.


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
