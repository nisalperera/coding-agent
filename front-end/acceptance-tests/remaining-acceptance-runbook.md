# Remaining Acceptance Gates: Execution Runbook

Purpose: close the currently pending visual, real-browser, hosted-CI and ownership
criteria without repeating already-passed implementation tests or granting
approval automatically. No extra package installation or source changes are
required by this instruction pack. Use the accompanying 32-case CSV as the
execution worksheet. It is initialized to NOT_RUN, never prefilled as passed.

## 0. Scope and reporting rules

Already passed locally: clean installation, 122 Node tests, 28 rendered tests,
hardening verification, lint (three warnings), build, production audit, standalone
and container HTML/assets. These are not the pending browser or hosted gates.

Allowed case results: PASS, FAIL, BLOCKED, NOT_RUN, NOT_APPLICABLE_WITH_APPROVAL.
A test that was not reproduced is BLOCKED, not PASS. A blocked required test
prevents unconditional closure. Save exact steps, actual result and evidence.
Use synthetic accounts/projects only. Do not use production customer data or
real external write tools. Tests can create/update/soft-delete their own disposable
projects but must never mutate unrelated projects or production configuration.

Browser proof must use real backend responses and cookie handling. Route mocks,
Vitest fixture results and an HTML fetch are supporting evidence, not replacements.
No headless test can approve maintenance ownership, independent review or sign-off.

## 1. Establish a safe browser test environment (ENV-01, ENV-02)

1. Use the intended test deployment, including its real frontend/backend origins,
   HTTPS configuration, CORS/trusted-Origin policy and session-cookie settings.
   Do not disable security controls to make a test pass. Use normal approved
   deployment/IaC configuration for any environment change.
2. Prepare dedicated accounts A and B with visibly different synthetic projects
   and settings. Never paste production credentials or real API keys into fixtures.
3. Record browser/version, OS, frontend origin, backend origin (no credentials),
   Git SHA/source fingerprint and image ID if testing a container.
4. Verify the browser actually sends /v1/auth/me and settings/project calls to the
   intended backend. NEXT_PUBLIC_BACKEND_URL is baked into the build, not fixed
   by passing a different value when server.js starts.
5. The earlier container asset smoke might have built without a public backend
   URL. Its success is not a backend-connectivity pass. If that build URL is wrong,
   rebuild through the acceptance runner with the intended public URL exported,
   and record the NEW image digest and asset evidence. A public URL must contain
   no userinfo, API token or other secret.
6. Use the current completed build. If assets need preparation after rebuilding,
   run the following from front-end/next-js:

```bash
test -f .next/standalone/server.js
mkdir -p .next/standalone/.next
cp -a .next/static .next/standalone/.next/
if [ -d public ]; then cp -a public .next/standalone/; fi
HOSTNAME=127.0.0.1 PORT=3000 node .next/standalone/server.js
```

Stop only the server you own in its original terminal before reusing port3000.
Use the real HTTPS test origin instead for production Secure/cross-site policy
acceptance. Do not substitute localhost and claim deployment-cookie equivalence.
If localhost is not an approved backend origin, use the intended test origin.

Optional runtime UID check against the known tested image, without publishing
ports, mounting host data, or starting the web app:

```bash
docker run --rm --network none --read-only --entrypoint node   coding-agent-frontend:acceptance-414e2cdd9fa5   -e 'const uid=process.getuid(); console.log({uid}); if(uid===0)process.exit(1)'
```

A different image/tag requires recording its actual ID. This checks runtime UID,
not all container security properties. It is not required to repeat asset smoke.

## 2. Visual acceptance (VIS-01 through VIS-06)

Suggested deterministic matrix:
- Desktop viewport: 1440 x 900, light and dark.
- Mobile viewport: 390 x 844, light and dark, through responsive emulation.
- Add at least one physical/mobile browser if mobile support is a release promise.
- Same OS/browser/fonts/zoom/device scale when comparing before/after screenshots.
- Test 200% zoom and keyboard flow separately; record these conditions.

Execute the six VIS rows in the CSV. Inspect every state, not just route loading:
chat shell and composer; representative Markdown/code; auth validation; project
list/empty/search/create/settings/conflict/delete; account tabs/scopes/toggles;
focus, scroll and dialogs. Long code may scroll within the code block, but must
not unexpectedly make the whole page unusable.

For each case record screenshot references and an explicit human result. A useful
filename is VIS-04-desktop-dark-project-delete.png; avoid names containing user
emails or actual secrets. Redact account details. Do not mask the UI region being
tested merely to obtain a visual pass.

If no pre-remediation screenshot baseline exists, state that. You can approve the
current UI manually and establish a baseline for future changes, but cannot
retroactively claim a pixel-identical before/after comparison. Generating a first
Playwright snapshot also creates a candidate baseline, not a human visual approval.
No Playwright dependency is added in this pack; manual completion is acceptable.

PASS requires each agreed viewport/theme state to be usable and reviewed. Any
new clipping, missing CSS, illegible color/focus state or unusable control is FAIL.
Missing browser access or an unvisited state is BLOCKED/NOT_RUN.

## 3. Real session, OAuth and isolation tests

Execute AUTH-01 through AUTH-07, ISO-01 through ISO-05, NAV-01 through NAV-03 and
PROJ-01 in the CSV. Use DevTools Network with Preserve log for local observation,
but do not export a raw HAR or auth trace for sharing: those can include cookies,
passwords, tokens, settings bodies and OAuth transaction data.

### Password login and cookies
Sign in as A through the actual UI, hard reload and navigate to protected views.
Verify the account identity privately against /auth/me. Inspect cookie attributes
in Application/Storage without copying the value. HttpOnly, host/path, lifetime,
Secure and SameSite must match the approved deployment policy, not an invented
generic setting. Confirm normal logout makes the backend stop accepting that
session. Cache display alone is not authentication evidence.

### Verification-error and logout-uncertainty injection
These are local browser fault injections; they do not require stopping services:
1. Sign in with a disposable account.
2. In DevTools request blocking, block the actual backend path /v1/auth/me.
3. Reload the protected page. Expect verification error and no old private state,
   not a false claim that the server confirmed anonymous status.
4. Remove that blocking rule and click Retry session verification. Expect recovery.
5. In a separate case, block only /v1/auth/logout, then logout through the UI.
6. Expect local account cleanup plus truthful unconfirmed-server-logout messaging.
7. Unblock and use Retry logout. Network must show another logout, not just /me
   restoring the old account. Verify subsequent protected requests are rejected.

Remove all request-blocking rules after these cases. Do not capture cookie values
in screenshots. A simulated network failure is not a real server expiry test.

### Actual expiry
Use natural expiry, or an isolated test backend with an approved short TTL.
Never shorten a shared production TTL or change system clocks for this test.
Record the configured TTL/reference and timestamps; wait for backend rejection.
Deleting a browser cookie tests missing-cookie handling, not actual expiry. If
there is no safe expiry facility, mark the expiry case BLOCKED rather than claim
that the missing-cookie case completes it.

### Google OAuth
Use a dedicated provider test account, the intended callback origin and normal
provider consent/MFA flow. Test successful sign-in, reload, logout and provider
cancel/deny. Confirm final identity and lack of false success. Do not automate
provider credentials, bypass MFA, or upload tokens/state/codes/complete redirect
queries. Record hosts/statuses with values redacted. This is intentionally manual.

### Account replacement and delayed operations
Use A and B sequentially in the SAME browser context so they share the application
session cookie. Separate profiles alone do not test same-context replacement.
For late reads, enable high-latency network throttling and confirm the A request
is actually pending before logging out and signing in as B. For create/update/
delete, use only disposable synthetic projects and a reproducible pending response.
If UI serialization or timing prevents the race, mark the manual race case BLOCKED;
do not treat the already-passing controlled rendered case as a new browser pass.

Assert both visible state and follow-on behavior: no A records/secret drafts/flags,
no stale success or redirect, no old cleanup clearing new progress. A client abort
cannot establish that a backend mutation was rolled back. Inspect the test account's
server-visible result separately. Never replay an uncertain external action.

Preferences must differ by account and restore on re-login. Do not import the old
browser-global preference key into either account. Inspect only boolean preference
values and key names, not full integration caches or real secrets.

### Navigation and conflicts
Use real app links and actual Back/Forward, not just hard-reloading paths. Exercise
unsaved drafts and navigation during a pending operation. Unsaved-navigation warnings
and draft preservation must match the release contract. A missing required guard is
a defect to fix, not something to rename as a pass. Same-user session re-verification
currently resets drafts by explicit implementation policy; record that separately.

For revision conflict, open the same synthetic project in two tabs under A. Save
in tab1, then save the stale tab2 draft. Expect 409/412 handling, no false success,
draft preservation and an explicit reload path. Do not test on real projects.

## 4. Freeze the final source and verify both remotes (CI-01)

Do this only after code/test fixes are finished and publication is explicitly
approved. This pack does not stage, commit or push. Never use blanket git add .:
a client-secret JSON file was previously visible as untracked at the repo root.
Review an explicit allowlist and ensure every required new script/test/workflow is
tracked, without evidence outputs, .env, credentials, auth state or screenshots.

Read-only checks from repository root:

```bash
git diff --check
git status --short -- front-end/next-js .github/workflows .gitlab-ci.yml README.md config_guide.md
git rev-parse HEAD
git branch --show-current
```

After a reviewed commit and authorized publication to both providers:

```bash
BRANCH=$(git branch --show-current)
FINAL_SHA=$(git rev-parse HEAD)
read -r -p 'GitHub remote name: ' GITHUB_REMOTE
read -r -p 'GitLab remote name: ' GITLAB_REMOTE
for REMOTE in "$GITHUB_REMOTE" "$GITLAB_REMOTE"; do
  REMOTE_SHA=$(git ls-remote --exit-code "$REMOTE" "refs/heads/$BRANCH" | awk '{print $1}')
  printf '%s %s
' "$REMOTE" "$REMOTE_SHA"
  test "$REMOTE_SHA" = "$FINAL_SHA" || { echo 'Remote revision mismatch'; exit 1; }
done
```

Do not guess remote names. Inspect git remote locally if needed. Never share
credential-bearing remote URLs. Do not push main or merge just to trigger evidence:
existing main-branch deployment jobs must not be activated accidentally.

Rerun the acceptance runner on the final source if it changed. Record final SHA,
source fingerprint and exact environment. npm ci was already proven; rerunning it
inside final evidence binds the final source, not reopening the historical gate.

Important: store final evidence/signatures OUTSIDE the runner's hashed source
tree, such as output/signoff/. Editing DEPENDENCY_ACCEPTANCE.md, README, code or
CI after freezing changes the source identity and requires a new revision/run.
Do not embed a fingerprint into a file whose contents are part of that fingerprint.
Historical hashes in source documents remain explicitly historical.

## 5. GitHub hosted execution (CI-02)

1. After authorized feature-branch publication, open Actions for nisalperera/coding-agent.
2. Locate Frontend acceptance evidence and inspect the run's exact commit SHA.
   The workflow is triggered by matching frontend/CI path changes. On its first
   feature-branch publication, use that push event. A manual-dispatch UI may not
   be available if the workflow has not been registered on the default branch.
   Do not merge/deploy merely to make the button appear.
3. Confirm the frontend-acceptance job actually executes the shared runner with
   --container, not an unrelated legacy deployment/backend job.
4. Require a completed successful job and inspect npm ci/hardening, both suites,
   lint/build, audits, standalone routes/assets and container smoke in its logs.
5. Record run URL, run attempt, job URL, exact commit and artifact reference.
6. Retrieve summary.json, source-before.json, source-after.json and relevant logs
   from the uploaded evidence artifact. If the website downloads an archive,
   extract it locally and share only plain files. Do not upload ZIPs here.
7. Read summary: automatedEvidence=passed, sourceUnchanged=true, final expected
   head, containerImage present. Known full-audit findings still require review.

A rerun of an old GitHub event uses the old event's SHA. It is not a test of a
new commit. Select the correct final-commit run; do not count a green old run.
The artifact must be reviewed; a green workflow is not formal security sign-off.

## 6. GitLab hosted execution (CI-03)

1. Use the actual GitLab project remote and verify it contains the same final SHA.
2. Validate .gitlab-ci.yml in that project's pipeline editor/lint UI. Do not change
   unrelated backend/deploy jobs. Inspect the intended feature-branch pipeline.
3. Confirm an eligible runner can execute the configured Docker-in-Docker job.
   The supplied TLS job requires privileged service support and shared client
   certificates at /certs/client, with DOCKER_HOST tcp://docker:2376,
   DOCKER_TLS_VERIFY=1 and DOCKER_TLS_CERTDIR=/certs.
4. These are operator-managed runner prerequisites, not a request to disable
   TLS, use chmod 666 on a Docker socket, expose an unauthenticated daemon, or
   grant broad host access. Use a dedicated trusted runner, not an application
   data host. If AWS runner resources are needed, propose them in CloudFormation
   before provisioning; no manual cloud-console deployment is implied.
5. Observe frontend-acceptance in the actual matching-revision pipeline. A skipped,
   pending, missing or environment-failed container job is NOT a passed gate.
6. Require the same runner command, successful steps and artifacts as GitHub.
   Record pipeline/job URLs, SHA and runner/job environment. Retrieve plain JSON/
   text evidence after local extraction if artifact download is bundled.

If assisted lookup is wanted later, connect GitLab through Settings -> Connectors.
That is separate from configuring the CI runner or publishing source. No connector
connection itself proves a pipeline ran successfully.

## 7. Compare hosted evidence (CI-04)

Use the attached read-only comparison helper against the downloaded plain files:

```bash
python /path/to/compare_hosted_evidence.py   --commit "$FINAL_SHA"   --github-summary /path/to/github/summary.json   --github-source /path/to/github/source-before.json   --gitlab-summary /path/to/gitlab/summary.json   --gitlab-source /path/to/gitlab/source-before.json   --output output/hosted-evidence-comparison.json
```

Use a new --output name on repeat runs; the helper refuses to overwrite it.
Exit0: comparison passed; exit1: failed/missing/mismatched evidence; exit2: source
content/execute-bit fingerprints agree but raw fingerprint differs and needs review.
The existing runner hashes permission bits, so different checkout umasks can cause
raw differences. Review the exact difference; do not silently waive it. If source
content differs, fix/re-run the correct revision. Image and asset hashes can differ
by build environment/public backend configuration; same source does not guarantee
identical binaries. Explain those differences rather than fabricating equality.

The helper checks required steps, commit/source stability, asset evidence,
production audit and known advisory IDs. It checks cross-consistency, not cryptographic
artifact provenance. You must verify that files came from the stated provider/run.
It never grants approval and does not replace reviewing logs, test counts, URLs,
container inspection or browser results.

## 8. Ownership, code review and registry findings (OWN-01 to OWN-03)

No test can make an unassigned owner or unsigned approval complete. Obtain actual
review records and explicit decisions. Proposed owner Nisal Perera remains only
proposed until that person accepts. A self-review must be labeled self-review, not
independent review. If an independent reviewer is required but unavailable, record
BLOCKED; do not invent one.

Braces reviewer checklist:
- All currently installed copies are discovered from the lockfile.
- All affected public and direct AST entry points are covered.
- Parser nesting includes parentheses and respects existing escaping/quotes.
- Iterative validation bounds depth/width, rejects child/parent cycles and does not
  claim to sandbox arbitrary getters, proxies or arbitrary executable JS objects.
- Exact-source checks, idempotence, postinstall persistence and Docker ordering work.
- Unexpected source/newer versions or a missing guard fail closed before build.
- npm --ignore-scripts cannot accidentally become evidence of a hardened install.
- Expansion cardinality/CPU limits beyond the disclosed recursion fix are not
  falsely represented as solved. Treat any review-discovered issue as a blocker.
- Owner accepts maintenance, update/re-review triggers and upstream retirement plan.

Selector-parser reviewer checklist:
- Lockfile and actual install show all relevant v6 copies on 6.1.5.
- Version/selector/stress tests and application regressions are attached.
- Maintainer patched-range evidence and central advisory conflict are retained.
- Chosen scanner policy is explicit. Do not suppress the global advisory, rename
  the package, or call the raw full audit clean.

ESLint support warning:
- Assign an owner, supported-toolchain plan and review/due date.
- Read-only metadata checks can inform a separately reviewed compatible upgrade:
  npm view eslint-config-next@16.4.2 peerDependencies --json
  npm view eslint@latest version engines --json
- Do not install a major update blindly just because a warning appears.

Important policy boundary: if a mandatory criterion is literally zero findings in
full npm audit, the current graph does NOT meet it. A signature cannot turn ten
findings into zero. That criterion remains blocked until dependency-path replacement,
an official patched release or authoritative audit-data correction resolves it.
The current backport route can receive an explicitly documented code-remediation
and scanner-discrepancy decision; it is not equivalent to an audit-clean release.

## 9. Final sign-off (OWN-04)

Use final-signoff-template.md OUTSIDE hashed source, with final revision, source
fingerprint, image ID, local evidence directory, CI URLs/attempts, comparison report,
manual CSV results, reviewer records, owner approvals and audit dispositions.
The named authorized approver must write the actual decision/date; no tool fills
in a signature. Approve/reject/restricted-scope decisions must match organizational
policy and remaining blockers. Do not mark blocked browser or hosted criteria PASS.

Dependency closure alone does not resolve all R1b/D0 backend, durable-run, approval,
CLI/AWS, ingestion/RAG or contract findings. Record exact accepted scope.

## Evidence to return here

Provide plain files, not ZIPs:
1. Completed remaining-acceptance-results.csv (including FAIL/BLOCKED rows).
2. GitHub and GitLab summary/source manifests and their run URLs.
3. Hosted comparison JSON and any failure logs.
4. Redacted screenshots or concise visual result notes with viewport/theme/browser.
5. Explicit owner/reviewer decisions and signed record when actually approved.

Do NOT upload .env, private credentials, raw HARs, browser storageState, cookies,
OAuth codes/state/transaction queries, real account data or unredacted traces.
