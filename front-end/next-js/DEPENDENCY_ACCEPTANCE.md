# Dependency Acceptance and Closure Register

Status: UNSIGNED, FORMAL SIGN-OFF NOT GRANTED.
Evidence checkpoint: 2026-10-23, user-supplied acceptance-run output received at 18:05 UTC+05:30.
Scope: frontend dependency hardening and packaging acceptance, not all R1b/D0 requirements.

## 1. Exact evidence identity

| Field | Recorded value |
|---|---|
| Base Git HEAD shown in image label | `458d9371fe8b66a61943eab18d2032cd976f04bd` |
| Working-tree source fingerprint shown in image label | `bc907375b2ca05ccdd8d4436d63aabd8f4f2b5f35cf625418b6865643f207826` |
| Acceptance output directory, repository-relative | `output/frontend-acceptance/2026-10-23T12-20-54-798Z` |
| Local image tag | `coding-agent-frontend:acceptance-414e2cdd9fa5` |
| Image ID / OCI index digest reported by docker image inspect | `sha256:91c24f0a040fae14b286c107446aee14ec155b7eb389f427c4b026299ef02990` |
| Platform | `linux/amd64` |
| Base image | `node:22.22.2-alpine` |
| Resolved base-image digest in build output | `sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f` |
| Container runtime user | `nextjs` |
| Docker engine in local run | `29.9.1` |
| Final published source revision | NOT RECORDED |

The base HEAD is not proof that the continuation is committed at that revision.
Pair it with the working-tree fingerprint. The runner reported automated status
passed, which includes its before/after source check by design. The summary.json
and source manifests have not been separately supplied or independently reviewed
at this checkpoint. Do not describe this as a fresh-clone or hosted-CI execution.

## 2. Automated evidence ledger

| Gate | Status | Evidence and limitation |
|---|---|---|
| Local clean dependency installation | PASSED, user reported | Prior npm ci reapplied the Braces patch and full validation passed |
| Current runner Node suite | PASSED, user reported | 122 tests, zero failures |
| Current rendered suites | PASSED, user reported | 28 tests, zero failures; jsdom and controlled network/router fixtures |
| Braces source integrity verification | PASSED, user reported | One installed instance; install and verification hooks exercised |
| Lint | PASSED WITH WARNINGS | Zero errors; three existing OAuth top-level-navigation warnings |
| Production build | PASSED, user reported | Next.js 16.4.2 |
| Production-only dependency audit | PASSED in runner | Runner advanced beyond production audit; retain raw JSON artifact |
| Full registry audit | FINDINGS REMAIN | Ten entries; GHSA-vfj7-8cjw-p6xm and GHSA-rj75-hqrm-r3gf |
| Standalone server packaging/assets | PASSED, user reported | /login, /register, /projects, /settings plus 13 CSS/JS assets |
| Container dependency installation | PASSED, user reported | Docker npm ci applied hardening |
| Container production build | PASSED, user reported | Node22.22.2-alpine; prebuild verified hardening |
| Container HTML/assets | PASSED, user reported | Same four routes and 13 assets, through in-container HTTP probe |
| Runtime non-root configuration | OBSERVED | Image Config.User is nextjs; not a complete container security audit |
| Post-hardening visual acceptance | PENDING | HTTP asset probes do not render the UI or execute client JavaScript |
| Real cookies/OAuth/account-switch browser acceptance | PENDING | Requires intended backend and deployment policy |
| GitHub hosted execution | PENDING | No matching-revision run URL/logs supplied |
| GitLab hosted execution | PENDING | No matching-revision run URL/logs supplied |
| Formal ownership and approval | PENDING | No explicit owner/reviewer signatures supplied |

The focused dependency tests overlap the full Node suite and are not extra
unique tests. Repeated successful runs are historical checkpoints, not new tests.
A successful evidence job is not a clean full registry audit or release approval.

## 3. Dependency dispositions, awaiting approval

### Braces: GHSA-vfj7-8cjw-p6xm

Implementation: project-owned backport applied to upstream braces@3.0.3 after
installation; exact source hashes and guard content are verified. Parser nesting
is bounded at 100; direct AST consumers are validated iteratively with depth 128
and a 50,000-node traversal budget; cyclic child and parent links are rejected.

Validation: guard, public API, direct AST, Micromatch and both Fast-glob consumer
regressions passed in the supplied run. Install persistence and container build
were exercised. This is not an official upstream patched release, a generic
resource sandbox, or a proof that every possible expansion attack is prevented.
The package version remains honest and the full registry audit remains flagged.

Proposed maintenance owner: Nisal Perera, NOT YET APPROVED.
Independent reviewer: NOT ASSIGNED.
Required review: patch correctness, limits, install-hook behavior, source-hash
refusal, and any remaining untrusted-pattern reachability in agent/build paths.
Re-review on every affected dependency update and before release. Never change
accepted upstream hashes without reviewing the changed source. Do not silently
skip failed hardening or suppress the upstream advisory globally.

### Selector-parser: GHSA-rj75-hqrm-r3gf

Implementation: range-scoped override of v6 consumers to 6.1.5, retaining the
current Tailwind3 toolchain. Installed-version, selector-preservation and bounded
flat-selector stress tests passed. The maintainer advisory was recorded as listing
6.1.5 as patched; central audit metadata still flags all versions below 7.1.6.

Disposition: installed-code remediation has local evidence; central-advisory
reconciliation and the chosen scanner policy remain PENDING APPROVAL. Do not
misrepresent the full audit as clean. Preserve advisory/version evidence alongside
the lockfile and tests.
Proposed owner: Nisal Perera, NOT YET APPROVED.

### ESLint support warning

npm reports eslint@9.39.5 as unsupported/deprecated. Lint passes, but support status
remains an open maintenance finding. Do not infer a new vulnerability from that
warning alone or perform an unreviewed major upgrade. Record a compatible
supported-toolchain plan or an explicitly approved, bounded restriction.
Owner, plan and review date: NOT ASSIGNED.

## 4. Manual browser and visual acceptance

Use synthetic accounts/projects and the intended backend/cookie configuration.
Start the prepared local standalone server from front-end/next-js:

```bash
HOSTNAME=127.0.0.1 PORT=3000 node .next/standalone/server.js
```

The acceptance runner has copied public and .next/static into that standalone
output for this build. Stop only the prior server you own before reusing port3000.
A rebuild may require rerunning asset preparation. Browser acceptance must use a
configured NEXT_PUBLIC_BACKEND_URL build; an anonymous HTML smoke with no backend
is not evidence that authentication or settings persistence works.

For each row record browser/version, viewport, theme, result and screenshot/log
reference. Redact private data and inspect artifacts before sharing.

| Scenario | Desktop light | Desktop dark | Mobile light | Mobile dark | Evidence / notes |
|---|---|---|---|---|---|
| Chat layout and composer | Pending | Pending | Pending | Pending | |
| Markdown, citations and code formatting | Pending | Pending | Pending | Pending | |
| Login/register and validation errors | Pending | Pending | Pending | Pending | |
| Projects list/search/create | Pending | Pending | Pending | Pending | |
| Project settings/conflict/delete dialogs | Pending | Pending | Pending | Pending | |
| Account settings/toggles/scopes/menus | Pending | Pending | Pending | Pending | |
| Keyboard focus and scrolling | Pending | Pending | Pending | Pending | |

Additional functional acceptance:
- [ ] Password login, hard refresh, logout and server-logout uncertainty/retry.
- [ ] Google OAuth with the intended backend and real cookie policy.
- [ ] A -> B and A -> anonymous -> A, delayed reads/mutations and credential drafts.
- [ ] Session expiry, verification outage and recovery without false success.
- [ ] Next navigation/back/forward and unsaved-draft behavior.
- [ ] Stream failure, retry, navigation unmount and late response suppression.

## 5. Hosted CI and final revision evidence

Both providers must run the same published continuation with the locked graph,
hardening verification, regression suites, standalone and container smoke.
A Git SHA alone is insufficient if tested source was dirty or differs remotely.

| Provider | Run/pipeline URL | Commit SHA | Source fingerprint | Result/artifacts |
|---|---|---|---|---|
| GitHub | Pending | Pending | Pending | Pending |
| GitLab | Pending | Pending | Pending | Pending |

GitLab runner prerequisites include privileged Docker-in-Docker service support
and the configured shared TLS client-certificate volume. A failed prerequisite
must not become a skipped gate. No remote publication, pipeline dispatch, merge
or deployment is authorized by this document.

## 6. Closure decision, intentionally unsigned

Final commit:
Final source fingerprint:
Independent patch review evidence:
Patch maintenance owner approval:
Braces advisory/patch disposition approval:
Selector-parser scanner discrepancy approval:
ESLint support finding owner/plan/review date:
Browser/visual evidence:
GitHub run URL:
GitLab pipeline URL:
Container evidence confirmation:
Decision (approve / reject / restricted scope):
Restrictions:
Signed by:
Signed at:

Dependency acceptance does not independently close R1b/D0 product contracts,
backend/CLI findings, deployment acceptance or unrelated risk-register entries.
