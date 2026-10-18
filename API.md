# PEAK Cloud API (v1)

All routes share the website origin; no cross-origin write API is exposed.

## Endpoints

- `GET /api/health` — D1 health probe.
- `POST /api/races` — Create a race. JSON body `{"name":"Saturday Summit"}`. Returns the public code, revision 1, initial state, random `manageKey`, and random `recoveryKey`. Keep the keys private.
- `GET /api/races/PEAK-ABCDEFGH` — Public race state and current revision. Keys are never returned.
- `PUT /api/races/PEAK-ABCDEFGH/state` — Requires `Authorization: Bearer <64-hex-manage-key>` and JSON body `{"revision":1,"state":{...}}`. Returns new revision. An out-of-date revision returns HTTP 409.
- `POST /api/races/PEAK-ABCDEFGH/recover` — Body `{"recoveryKey":"<64-hex>"}`. Returns a new management key and a **new recovery key**; the old keys are revoked.
- `POST /api/races/PEAK-ABCDEFGH/rotate` — Requires current organizer authorization. Rotates both keys; old keys are revoked.

## Concurrency

D1 executes `UPDATE races SET revision=revision+1 ... WHERE code=? AND revision=? RETURNING revision`. That conditional update is atomic. A stale writer cannot replace the latest race state. The client must export and/or reload the newer state; automatic merging is deliberately not attempted.

## Security / visibility

- Race codes are designed for sharing; anyone with the code can see that race's names and scores.
- Editing requires a cryptographically random management token. Only its SHA-256 hash is stored in D1.
- Management keys are placed in the **fragment** portion of the organizer URL, not in the public query string. Browsers do not send URL fragments with HTTP requests. The app presents the key in the Authorization header for write requests.
- CORS is intentionally not enabled. Mutation requests carrying a different Origin are rejected.
- Public creation has basic per-IP rate limits; an open public service may need Cloudflare rules and monitoring as usage grows.
