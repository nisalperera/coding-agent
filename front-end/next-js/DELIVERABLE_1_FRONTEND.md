# Deliverable 1 frontend review package

Status: source prepared, API-ready; backend integration and browser validation pending.

## Included

- Protected project routes, list/search/create, overview, general settings.
- Required stack catalog, explicit single-choice project type.
- Safe escaped text rendering, loading/error/empty/session states.
- Revision-aware updates and soft-delete confirmation/notification.
- Abortable reads and stale-response suppression.
- No project persistence in localStorage, fake backend, new npm dependency,
  integration hook replacement, or existing chat API modification.

## Apply

Use apply_frontend.py from the extracted package (instructions in REVIEW.md).
It checks the pinned Git baseline and original sidebar blob, refuses collisions,
adds a Projects navigation link, and appends matching documentation sections.
It does not commit, push, create branches, deploy, or run npm installation.

## Validate after application

Run from front-end/next-js:

```sh
node --test tests/project-domain.test.mjs tests/projects-api.test.mjs
npm run lint
npm run build
```

No package.json change is needed for dependency-free Node unit tests. Existing
GitHub/GitLab pipelines were not modified in this package. A follow-up must wire
the same unit-test command into both after their full contents are inspected.

## Manual acceptance

- Signed-out project routes show sign-in, not private data.
- Missing /v1/projects displays unavailable, not fake empty projects.
- Real empty response enables creating a project.
- Create requires name/type, preserves selections, and never invents stack choices.
- Navigation from personal chat reaches Projects without replacing chat code.
- Project details/settings reload from backend; failed saves retain the draft.
- 409/412 preserves the draft and blocks saving until explicit reload.
- Deletion requires exact project name and explicit server acknowledgement.
- Deletion success states soft deletion and offers no restore claim.
- Direct deleted/unauthorized project access is blocked by backend.
- Mobile, keyboard, dialog focus restoration, dark/light themes work.
- Browser refresh/close and clicked-link unsaved guards work.
- Browser back/forward guard remains an open issue, documented in the contract.

## Tracking

- [x] Prepare frontend source and proposed API contract.
- [x] Implement required pages and catalog.
- [x] Add dependency-free domain and API unit tests.
- [ ] Apply/review source in the repository.
- [ ] Implement/verify backend project contracts and ownership.
- [ ] Run Next.js lint/build in the repository environment.
- [ ] Run browser/accessibility/regression acceptance.
- [ ] Resolve browser-history unsaved guard.
- [ ] Integrate equivalent test commands in both CI systems.
- [ ] Approve any remote write separately.

This is frontend implementation work, not completion of the full Deliverable 1.
