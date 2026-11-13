# Nimbus Secrets HTTP contract (v1)

The CLIs (Node, Go, bash) and the S2 server both follow this file. Base: `{server}/api/v1/secrets`.
All bodies are JSON (UTF-8). Projects and environments are addressed by `slug`. Folder paths start with `/` (default `/`).

## Auth
`Authorization: Bearer <token>` on every call except `auth/device/*`.
- Machine token: `nms_<random>`. Scoped to project/env/folder, read-only or read-write, may expire, may have an IP allowlist.
- User CLI token: `nmu_<random>`, issued by the device login flow below. Acts as the user.
Tokens are stored hashed server-side.

### Device login
`POST /auth/device/start`  body `{ "deviceName": "laptop (linux)" }`
-> `200 { "userCode": "ABCD-1234", "verifyUrl": "https://host/secrets/cli?code=ABCD-1234", "pollToken": "<opaque>", "expiresIn": 120, "interval": 2 }`

The user opens `verifyUrl` in a signed-in browser and approves (same approval screen pattern as `lib/device-link.ts`: one-time, ~2 min, only hashes stored).

`POST /auth/device/poll`  body `{ "pollToken": "<opaque>" }`
- `202 { "status": "pending" }`
- `200 { "token": "nmu_...", "user": { "email": "a@b.c", "name": "A" } }` (once; later polls give 410)
- `403 { "error": { "code": "denied", ... } }` user rejected
- `410 { "error": { "code": "expired", ... } }` expired or already collected

`POST /auth/logout` -> `204`. Revokes the calling token.

`GET /whoami` -> `200 { "type": "user" | "machine", "name": "...", "email": "..."?, "server": "...", "scope": { "project": "slug"?, "env": "slug"?, "path": "/"?, "access": "ro" | "rw" }? }`

## Reads
`GET /projects` -> `200 { "projects": [ { "id": "...", "slug": "web", "name": "Web" } ] }`

`GET /projects/{project}/envs` -> `200 { "envs": [ { "slug": "dev", "name": "Development" } ] }`

`GET /secrets?project={slug}&env={slug}&path=/&expand=true`
-> `200 [ { "key": "DB_URL", "value": "postgres://...", "type": "string", "comment": "" } ]`
- `expand=true`: `${KEY}` / `${env.folder.KEY}` references resolved and the caller's personal overrides applied (user tokens only; machine tokens have none). Without it, raw stored values.
- `type`: `string | number | bool | url | json | pem`. `comment` may be empty.
- Not recursive: only secrets directly in `path`.
- Response headers: `ETag: "<version>"` and `X-Secrets-Version: <version>`. Request `If-None-Match: "<version>"` -> `304` with no body when unchanged.
- Machine tokens: project/env may be omitted when the token is scoped to one.

`GET /secrets/version?project=&env=&path=` -> `200 { "version": 42, "etag": "\"42\"" }`
Cheap change check. `version` is a monotonically increasing integer per project+env, bumped on any write (any folder) in that env, and on changes to personal overrides for user tokens.

`GET /secrets/watch?project=&env=&path=&version=42&timeout=25`
Long-poll (SSE is not used). Holds the request until the version differs from `version` or `timeout` seconds pass (max 60).
-> `200 { "version": 43, "changed": true }` or `200 { "version": 42, "changed": false }` on timeout.
Clients then re-GET `/secrets`.

## Errors
Non-2xx bodies: `{ "error": { "code": "<machine_code>", "message": "<human text>" } }`

| Status | code | Meaning |
|---|---|---|
| 400 | `bad_request` | missing/invalid parameter |
| 401 | `unauthorized` | missing, invalid, expired or revoked token |
| 403 | `forbidden` | token scope, role or policy (CLI disabled, IP not allowed) denies it |
| 404 | `not_found` | unknown project, env or path |
| 423 | `locked` | Secrets section is locked for this user. Body adds `"unlockUrl": "https://host/secrets"`. The user unlocks in the web app (the unlock session is server-enforced); the CLI prints `unlockUrl`, exits 3 and the agent retries on its interval. Machine tokens are never locked. |
| 429 | `rate_limited` | back off; `Retry-After` seconds |
| 5xx | `server_error` | retry |

CLI exit codes: 0 ok, 1 error, 2 usage, 3 locked, 4 not signed in / unauthorized. `run` returns the child's code (128+n for signal n).
