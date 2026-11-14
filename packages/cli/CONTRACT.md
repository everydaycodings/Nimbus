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

## Writes (optional for clients)
`POST /secrets` body `{ "project": "web", "env": "dev", "path": "/", "set": { "KEY": "value" }, "delete": ["OLD_KEY"] }`
-> `200 { "created": [], "updated": [], "deleted": [] }`. Needs a read-write machine token or a member who can edit. The shipped CLIs don't use it; it is for scripts.
In a protected environment nothing is written: the answer is `202 { "pending": true, "request": "<change request id>" }` and the change waits for approval in the web app (S3).

## SSH certificates (S4)
`POST /ssh/cert` body `{ "project": "web", "principals": ["deploy"], "ttl": 1, "publicKey": "ssh-ed25519 AAAA..."? }`
-> `200 { "certificate": "ssh-ed25519-cert-v01@openssh.com AAAA... a@b.c", "expiresAt": "2026-01-01T10:00:00.000Z", "serial": 7, "principals": ["deploy"], "keyId": "a@b.c", "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----..."|null, "publicKey": "..." }`
- Member (user) tokens only; machine tokens get `403`. Needs a Developer or Admin role in the project (`403` for Viewer or environment-limited members) and a set-up SSH CA (`404`).
- `ttl` is hours, 1 to 8. `principals` 1 to 10 names. The key id is the member's email.
- Without `publicKey` Nimbus makes an ed25519 pair and returns the private key once; with it only the certificate is made.
- CLI: `nimbus ssh cert --project P --principal deploy[,root] [--ttl H] [--key FILE.pub] [--out FILE]` writes `KEY-cert.pub` (and the key when it was generated, mode 600) and prints the `ssh -i … -o CertificateFile=…` line. Node, Go and the bash script all implement it.

## Dynamic database credentials (S6a)
A project admin sets up connections (PostgreSQL, MySQL/MariaDB, Redis ACL, MongoDB) in the web app. These issue short-lived database users from the connection's role template. A member's CLI token (Developer or Admin) or a **read-write** machine token may use them; Viewers and read-only tokens get `403`. Machine tokens aren't environment-bound here: any rw token of the project works.

`GET /dynamic?project=` -> `200 { "connections": [{ "id": "...", "name": "orders-db", "engine": "postgres", "defaultTtl": 3600, "maxTtl": 86400 }] }` (TTLs in seconds).

`POST /dynamic` body `{ "project": "web"?, "connection": "orders-db", "ttl": "30m"? }` -> `200 { "leaseId": "uuid", "username": "nim_1a2b3c4d5e6f", "password": "...", "host": "db", "port": 5432, "database": "app", "tls": false, "engine": "postgres", "url": "postgres://nim_...:...@db:5432/app", "expiresAt": "2026-01-01T10:30:00.000Z", "ttl": 1800, "lease": { ... } }`
- `connection` is the name or id. `ttl` is seconds or `90`, `30m`, `2h`, `7d`; default = the connection's default TTL; anything above the connection's max TTL is cut to it (read `ttl`/`expiresAt` in the answer). `502` when the database refuses.
- The password is in this answer; a Developer/Admin can show it again in the web app until the lease ends (audited).
- Nimbus removes the user at `expiresAt` (a delayed job, with the hourly sweep as a backstop, so allow up to a minute of slack).

`PATCH /dynamic` body `{ "project"?, "lease": "uuid", "ttl": "1h"? }` -> `200 { "leaseId", "expiresAt" }`. Extends the lease to now + ttl, never past issue time + max TTL (`409` otherwise).

`DELETE /dynamic?project=&lease=uuid` -> `200 {}`. Revokes at once.

Every issue, renew and revoke is written to the audit log with the token name and IP.
- CLI: `nimbus dynamic get NAME [--project P] [--ttl 1h] [--format env|json|url] [--prefix DB_]` prints `DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD DB_URL DB_LEASE_ID DB_EXPIRES_AT` as quoted lines (default; json and url also), and the lease id and end time on stderr; `nimbus dynamic list`; `nimbus dynamic revoke LEASE_ID`. Node, Go and the bash script all implement it.

Rotation (attach a secret to a database user, rotate by interval or by hand) is configured in the web app only. It writes the new password as a new secret version (history action "rotate"). It skips change requests in protected environments and the project admins are told (the same notice any change to a protected environment sends). On failure the secret keeps its old value and the admins are told.

## KMS (S6b)
Named keys per project; the server holds the material (sealed with the project key) and never returns it. Keys are made, rotated, disabled and deleted by a project admin in the web app (**KMS** tab). Kinds: `aes` (AES-256-GCM: encrypt, decrypt), `ed25519` and `p256` (ECDSA P-256 with SHA-256, IEEE P1363 signature: sign, verify). Binary data is base64 in JSON. Values are text of the form `nkms:v1:<key>:<version>:<base64url>`, so decrypt and verify use the right key version without being told. After a rotation new work uses the latest version; older ciphertext and signatures still open. A disabled key refuses everything.

`GET /kms/keys?project=` -> `200 { "keys": [ { "name": "pay", "kind": "aes", "state": "enabled", "latest": 2 } ] }` (names only; needs at least one `kms:*` scope).

`POST /kms/encrypt` body `{ "project": "web", "key": "pay", "data": "<base64>", "context": "order-7"? }` -> `200 { "ciphertext": "nkms:v1:pay:2:...", "version": 2 }`
`POST /kms/decrypt` body `{ "project", "key", "ciphertext", "context"? }` -> `200 { "data": "<base64>", "version": 1 }`. `context` is bound in (AAD): it must match what encrypt used, else `400`.
`POST /kms/sign` body `{ "project", "key", "data": "<base64>" }` -> `200 { "signature": "nkms:v1:rel:1:...", "version": 1 }`
`POST /kms/verify` body `{ "project", "key", "data": "<base64>", "signature" }` -> `200 { "valid": true, "version": 1 }` (a mismatch is `valid: false`, still `200`).

- `project` may be left out for a machine token. Data up to 1 MB. Responses are `cache-control: no-store`.
- Machine tokens need the scope for each call: `kms:encrypt`, `kms:decrypt`, `kms:sign`, `kms:verify` (set when the token is made; a token with none gets `403` here and keeps working for secrets). A member's CLI token follows their role: Viewers may verify, Developers and Admins all four.
- Errors: `404` no such key or version, `409` the key is disabled or is the wrong kind for the call, `400` bad data or a ciphertext that can't be opened (wrong key, context or tampered; the message never echoes data).
- Every call is audited (`secrets_kms_encrypt|decrypt|sign|verify`) with the key, version and sizes, never the data.
- CLI: `nimbus kms encrypt|decrypt|sign|verify --key K [--project P] [--in FILE | --text S | stdin] [--context S] [--signature SIG] [--out FILE]`; `nimbus kms keys`. `verify` exits 1 on `valid: false`. Node, Go and the bash script all implement it.

## Share links
One-time links to a piece of text, for people without an account (`/s/ns_…`). They belong to the member who made them, so only a member's CLI token (`nmu_`) may use these; machine tokens get `403`. The admin switch for share links applies (`403` when off). The text is sealed on the server; only the link's hash is kept.

`POST /shares` body `{ "text": "...", "minutes": 1440, "maxViews": 1, "password": "..."?, "label": "..."? }` -> `200 { "token": "ns_...", "url": "https://host/s/ns_..." }`. `minutes` 60 to 43200 (1 hour to 30 days), `maxViews` 1 to 100, text up to 100,000 characters.
`GET /shares` -> `200 { "shares": [ { "id", "label", "state": "active|viewed|expired|revoked", "views", "maxViews", "password": bool, "expiresAt", "createdAt", "firstViewedAt" } ], "enabled": true }` (the caller's links, newest first, at most 100).
`DELETE /shares?id=<id>` -> `200 { "ok": true }` (`404` when it isn't the caller's or is already revoked).
- CLI (Node, Go): `nimbus share ["TEXT" | stdin] [--expires 1d] [--views 1] [--password | --password=PW] [--label L]` prints the URL. `--expires` is `90m`, `12h`, `7d` (a bare number is hours; default 1 day). A bare `--password` makes one up and prints it on stderr; a stray second word is refused (exit 2) so `--password secret "text"` can't share the password. `nimbus share list`, `nimbus share revoke ID`.

## Webhooks and server push
The same routes the web app uses. With a bearer token, `{project}` and `{env}` may be slugs or ids. A member's CLI token needs the **Admin** role in the project (as in the web app; `403` otherwise). Machine tokens get `403`, except for `POST …/push` (push now): a **read-write** token whose scope includes that environment may trigger it, so a deploy step can push after writing. It runs the stored target only; it can't see or change the host, key or command, and reads nothing back but the result. Every call is audited with the token name and IP (lists too).

Webhooks, per environment (`{base}` = `/projects/{project}/envs/{env}/webhooks`):
`GET {base}` -> `200 { "hooks": [ { "id", "url", "enabled" } ], "deliveries": [ { "id", "webhookId", "event", "status", "httpStatus", "message", "attempts", "at", "keys": [] } ] }` (last 30 deliveries).
`POST {base}` body `{ "url": "https://..." }` -> `200 { "id", "secret": "whsec_..." }`. The signing secret is in this answer only.
`PATCH {base}/{id}` body `{ "url"?, "enabled"? }` -> `200 { "ok": true }`. `DELETE {base}/{id}` -> `200 { "ok": true }`.
`POST {base}/{id}/test` -> `200 { "status": "delivered" | "failed", "httpStatus": 200 | null, "message": null | "..." }` (sends one signed `test` delivery now).
Deliveries are `POST`s with `x-nimbus-event`, `x-nimbus-delivery` and `x-nimbus-signature: sha256=<hex HMAC of the body with the secret>`; the body is `{ "event": "secrets.changed" | "test", "project": { "id", "slug", "name" }, "env": { "slug", "name" }, "keys": [...], "at" }`, key names only. A change that reaches an environment only through a reference (below) sends `keys: []`.

Server push, one target per environment (`{base}` = `/projects/{project}/envs/{env}/push`):
`GET /projects/{project}/push` -> `200 { "targets": [ { "env": "production", "host", "port", "username", "path", "auto", "lastAt", "lastOk", "lastMessage" } ] }`.
`GET {base}` -> `200 { "push": { "host", "port", "username", "path", "keyId", "postCommand", "auto", "hostKey", "lastAt", "lastOk", "lastMessage" } | null }`. The key never comes back.
`PUT {base}` body `{ "host", "port": 22, "username", "path", "privateKey"? | "keyId"?, "postCommand": "", "auto": false, "forgetHostKey"? }` -> `200 { "ok": true }`. Leave the key out to keep the stored one; `keyId` is a key on the project's SSH tab. `auto` pushes after every change.
`POST {base}` -> `200 { "ok": true, "message": "Wrote /srv/app/.env, ran the command" }` or `502` with the reason (host key changed, login refused, command failed).
`DELETE {base}` -> `200 { "ok": true }`.
- CLI (Node, Go): `nimbus webhooks [list] | add URL | remove ID | test ID` (a failed test exits 1) and `nimbus push list | set --host H --user U --path FILE [--port 22] [--key FILE | --key-id ID] [--command CMD] [--auto] | run | remove`, all with `--project` and `--env` (or `.nimbus.json`; `push list` needs only the project).

## Downloads
No token needed; `403` when an admin turned the CLI off, `404` when this server has no such build.
- `GET /cli/download/nimbus-<linux|darwin|windows>-<amd64|arm64>[.exe]`: the Go binary.
- `GET /cli/download/nimbus.mjs`: the Node CLI as one ESM file (Node 20+, no dependencies): `node nimbus.mjs whoami`.
- `GET /cli/download/nimbus-cli.tgz`: the same as an npm package: `npm i -g https://host/api/v1/secrets/cli/download/nimbus-cli.tgz` puts `nimbus` on the PATH.
- `GET /cli/nimbus.sh`: the bash client.
The Docker image builds all of them (`SECRETS_CLI_DIR=/opt/nimbus-cli`); from a checkout, `npm run cli:build` (Go through `docker run golang:1.23`).

## Server notes (S2)
- `slug` of a project is unique and lowercase; an `id` (UUID) is accepted wherever a project slug is.
- `GET /projects` and `GET /projects/{p}/envs` also answer signed-in browsers (the web app reads the same URLs); the shapes above are the bearer-token view.
- A machine token is scoped to one project, one or more environments and a folder path. Without `env`, a token with exactly one environment uses it; with several the caller must say which. Outside its scope: `403 forbidden`.
- `version` changes when anything in that environment is written, and also when an environment it references (`${prod.KEY}` in one of its values, directly or through other environments; cycles are fine) changes. So `ETag`, `/secrets/version`, `/secrets/watch`, the agent, auto pushes and webhooks follow references. Nimbus works the references out from the values at each write and keeps no copy of them.
- Every 200 from `GET /secrets` is written to the audit log with the token name and IP; `304` and `/secrets/version` are not.
- Token endpoints are rate limited per IP (`429` + `Retry-After`). `auth/device/*` and the downloads answer `403` when an admin turned the CLI off; machine tokens answer `403` when tokens are off.

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
