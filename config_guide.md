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
