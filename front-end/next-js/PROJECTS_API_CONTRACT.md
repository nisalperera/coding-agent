# Deliverable 1: Proposed Projects API Contract

Status: proposed integration contract, not a verified existing backend implementation.
Baseline: main commit 87d8457286621d8454b85fb9d6e5a2e46ce33ad3.

The adapter is lib/projects.js. It uses existing APP_CONFIG.BACKEND_URL and
credentialed requests; it does not change lib/api.js or chat behavior.

## Project representation

```json
{
  "id": "server-project-id",
  "name": "Compiler",
  "description": "Optional text",
  "project_type": "general",
  "languages": ["cpp"],
  "frameworks": [],
  "runtimes": [],
  "database_categories": [],
  "revision": 1,
  "status": "active"
}
```

Required arrays may be empty. This frontend does not invent a requirement that
at least one technology be selected. Name must be nonblank, type must be one
of frontend/backend/fullstack/general. No arbitrary length limit is invented;
the backend must publish and enforce any additional limits. Unknown technology
IDs fail closed and require a catalog update rather than silent data loss.

Catalog IDs:
- languages: javascript, typescript, python, sql, cpp
- frameworks: nextjs, angular, react
- runtimes: nodejs
- database_categories: nosql

## Endpoints

| Method | Path | Request | Successful response |
|---|---|---|---|
| GET | /v1/projects | None | 200, {"projects": [project, ...]} |
| POST | /v1/projects | Editable fields | 201, project object |
| GET | /v1/projects/{id} | None | 200, active project object |
| PATCH | /v1/projects/{id} | Editable fields; If-Match: "revision" | 200, new project object with incremented revision |
| DELETE | /v1/projects/{id} | If-Match: "revision" | 200, {"id": "same-id", "status": "deleted"} |

Editable fields are name, description, project_type and all four technology
arrays. Owner, revision, status and deletion metadata are server-owned.

The list contract is unpaginated in this first adapter. Backend pagination
requires an explicit client/contract update; never silently drop later pages.

DELETE must soft-delete and explicitly acknowledge it. The frontend will not
claim deletion succeeded on an empty/ambiguous response. A backend timeout can
leave a mutation outcome uncertain: refresh state before retrying. No client
idempotency mechanism is claimed here.

## Errors and authorization

401: session missing/expired. 403: resource denied. 404: not found or unavailable
route. 410: deleted resource. 409/412: revision conflict. 422: validation.
Errors may include string detail/message, or FastAPI-style detail arrays.
The collection UI treats missing routes as unavailable, not as a successful
empty list. A detail 404 cannot distinguish a missing route from a missing
project; show a neutral unavailable state.

Authentication, ownership, catalog validation, length limits, concurrency,
soft-delete behavior, and operator bootstrap must be enforced by the backend.
The frontend is not an authorization boundary. No fake server persistence,
project data in localStorage, or browser-selected server filesystem path exists.

Deployment must already supply correct session-cookie/CORS/CSRF protections.
Cross-origin backends must allow the new methods and If-Match header. No CSRF
mechanism has been invented by this frontend package; verify existing policy
before production enablement.

## Integration limits

No project chat, skills, documents, storage, management UI, or backend routes
are implemented here. No counters or readiness claims are fabricated.
Save conflicts retain the draft until an explicit reload/discard decision.
Warnings cover link clicks and reload/close; a full browser-history interception
mechanism is not implemented. Native browser history navigation may discard a
form. Treat this as an open acceptance issue, not a completed navigation guard.
