# Configuration

Nimbus reads its settings from environment variables. Many more live in the admin panel and are stored in the database. This page lists every variable the server reads, and what moved to the admin panel instead.

How to install is in [install.md](install.md). Problems are in [troubleshooting.md](troubleshooting.md).

## Where the values go

| Setup | File | Template |
|---|---|---|
| Production (Docker Compose) | `.env` at the repo root, next to `docker-compose.yml` | [production_script/.env.example](../production_script/.env.example), or let `./setup.sh` write it |
| Local development | `apps/web/.env.local` | [apps/web/.env.example](../apps/web/.env.example) |
| Local dev services (Postgres, MinIO, tusd, Redis) | `local_server/.env` | [local_server/.env.example](../local_server/.env.example) |

Rules for `.env`:

- Values that contain `$`, `#` or spaces must be in single quotes, as `setup.sh` writes them. A value can't contain a single quote.
- Keep comments on their own lines. Docker Compose reads `KEY=  # note` as the value `# note`.
- After a change, run `docker compose up -d` so the containers restart with the new values.

In production, `docker-compose.yml` sets some variables itself, from `DOMAIN` and the service names. You don't put these in `.env`:

| Variable | Set by compose to |
|---|---|
| `BETTER_AUTH_URL` | `https://${DOMAIN}` |
| `TUS_URL` | `https://${DOMAIN}/files/` |
| `REDIS_URL` | `redis://redis:6379/0` (the backup worker: `redis://127.0.0.1:6340/0`) |
| `CACHE_URL` | `redis://redis:6379/1` (the backup worker: `redis://127.0.0.1:6340/1`) |
| `ML_URL` | `http://ml:8000` |
| `WEBDAV_APP_URL`, `S3API_APP_URL`, `REGISTRY_APP_URL`, `SSH_TERMINAL_APP_URL`, `REGISTRY_BUILD_APP_URL` | `http://app:3000` |
| `DATABASE_URL` (backup worker only) | `${HOST_DATABASE_URL}` |

## Core

| Variable | Required | Default | What it does |
|---|---|---|---|
| `DOMAIN` | Yes (production) | | The app's public name, for example `nimbus.example.com`. It needs a DNS A record pointing at the server. Compose builds `BETTER_AUTH_URL` and `TUS_URL` from it. |
| `COMPOSE_PROFILES` | No | `postgres,minio` | Which optional services run, comma-separated. See [install.md](install.md#postgres-and-storage-here-or-your-own). |
| `BETTER_AUTH_SECRET` | Yes | | Signs sessions and seals secrets saved through the admin panel. Generate with `openssl rand -base64 32`. Changing it signs everyone out and makes those saved secrets unreadable. |
| `BETTER_AUTH_URL` | Yes (dev) | `http://localhost:3000` | The app's public address. Sign-in callbacks, links in emails and passkeys use it, and Secrets writes it into issued certificates' CRL links. Compose sets it in production. |
| `DATABASE_URL` | Yes | | Postgres URL as the containers see it. With the `postgres` profile: `postgres://nimbus:<POSTGRES_PASSWORD>@postgres:5432/nimbus`. |
| `HOST_DATABASE_URL` | With the `backup` profile | | The same database as seen from the host. The backup worker runs on the host network. With the `postgres` profile: `postgres://nimbus:<POSTGRES_PASSWORD>@127.0.0.1:54340/nimbus`. |
| `POSTGRES_PASSWORD` | With the `postgres` profile | | Password of the bundled Postgres. Generate with `openssl rand -hex 24`. Put the same value in both database URLs. |
| `REDIS_URL` | Yes | | Redis for the job queues, health-check schedule and heartbeats. The app refuses to start without it. |
| `CACHE_URL` | No | | A second Redis database for short-lived reads (storage meter, health alarm). Without it, reads go to the source. |
| `TUS_URL` | Yes | | Where browsers send resumable uploads (tusd). Dev: `http://localhost:1080/files/`. |
| `TUS_HOOK_SECRET` | Yes (production) | | Only tusd may call the upload hooks. Generate with `openssl rand -hex 24`. Optional in dev; without it the hook endpoint accepts any caller. |

## Reverse proxy and HTTPS

Read by `production_script/setup-nginx.sh`, not by the app.

| Variable | Required | Default | What it does |
|---|---|---|---|
| `CERTBOT_EMAIL` | With `setup-nginx.sh` | | Let's Encrypt account email, for expiry notices. |
| `S3_DOMAIN` | With the `minio` profile | | The bundled storage's public name, also pointing at the server. Browsers download files from it directly. Leave empty with your own S3. |
| `TRUST_CLOUDFLARE` | No | `1` | Trust Cloudflare's published ranges to name the visitor's IP. `0` turns it off. |
| `TRUSTED_PROXIES` | No | | Other proxies in front of nginx (load balancer, tunnel), as comma-separated IPs or CIDRs. Re-run `setup-nginx.sh` after a change. |

## File storage

| Variable | Required | Default | What it does |
|---|---|---|---|
| `S3_ENDPOINT` | No | | The storage URL. Empty for AWS S3. With the bundled MinIO: `https://<S3_DOMAIN>`. |
| `S3_REGION` | No | `us-east-1` | The bucket's region. R2 uses `auto`. |
| `S3_BUCKET` | Yes | | The bucket. It must exist before you start (the bundled MinIO's `minio-init` creates it). |
| `S3_ACCESS_KEY` | Yes | | Access key. The bundled MinIO uses `nimbus`, and it is also the MinIO console login. |
| `S3_SECRET_KEY` | Yes | | Secret key. With the bundled MinIO, generate it with `openssl rand -hex 24`. |
| `S3_FORCE_PATH_STYLE` | No | `false` | `true` for path-style URLs: MinIO, Garage, SeaweedFS. |

Values per provider and the CORS rule the bucket needs are in [install.md](install.md#your-own-s3-storage).

## Sign-in

| Variable | Required | Default | What it does |
|---|---|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | No | | Google sign-in. The button appears once both are set. Callback: `https://<DOMAIN>/api/auth/callback/google`. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | No | | GitHub sign-in. The button appears once both are set. Callback: `https://<DOMAIN>/api/auth/callback/github`. |
| `OIDC_ISSUER` | No | | One OpenID Connect provider. Set here, it wins over and locks **Admin → Authentication**. Redirect URL: `<BETTER_AUTH_URL>/api/auth/callback/oidc`. |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | With `OIDC_ISSUER` | | The OIDC client. |
| `OIDC_NAME` | No | `SSO` | The button says "Sign in with" this name. |
| `OIDC_ONLY` | No | `false` | `true` hides password, Google and GitHub sign-in. The owner keeps a password. |
| `ANDROID_RELEASE_SHA256` | No | | The Android release app's signing certificate. Passkeys made in that app may sign in. |

Provider setup is in [sso.md](sso.md).

## Email

Set `EMAIL_TRANSPORT` to manage email from env, and **Admin → System → Email** turns read-only. Leave it unset to configure email in the admin panel, where secrets are stored encrypted.

| Variable | Required | Default | What it does |
|---|---|---|---|
| `EMAIL_TRANSPORT` | No | | `none`, `smtp` or `resend`. |
| `EMAIL_FROM` | With a transport | | Looks like `Nimbus <nimbus@example.com>`. |
| `SMTP_HOST` | With `smtp` | | SMTP server. |
| `SMTP_PORT` | No | `587` | SMTP port. |
| `SMTP_SECURE` | No | `false` | `true` for TLS from the start (port 465). |
| `SMTP_USER`, `SMTP_PASSWORD` | No | | SMTP login. Empty for none. |
| `RESEND_API_KEY` | With `resend` | | Resend API key. |

## Backups

| Variable | Required | Default | What it does |
|---|---|---|---|
| `BACKUP_ENCRYPTION_KEY` | Yes, for backups | | Encrypts every database dump and, if on, every file copy. Generate with `openssl rand -base64 32`. Keep a copy offline: without it no backup can be restored. |
| `BACKUP_S3_BUCKET` | No | | Set it to manage backup storage from env, and **Admin → System → Backups → Settings** turns read-only. Leave it unset to configure storage there. |
| `BACKUP_S3_PROVIDER` | No | `other` | `aws`, `r2`, `b2`, `wasabi`, `minio` or `other`. |
| `BACKUP_S3_ENDPOINT` | No | | Empty for AWS S3. |
| `BACKUP_S3_REGION` | No | `us-east-1` | The backup bucket's region. |
| `BACKUP_S3_FOLDER` | No | `nimbus` | Folder inside the bucket. |
| `BACKUP_S3_FORCE_PATH_STYLE` | No | `false` | `true` for path-style URLs. |
| `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY` | No | | The backup bucket's key. |

How backups run and restore is in [backups.md](backups.md).

## Secrets

| Variable | Required | Default | What it does |
|---|---|---|---|
| `SECRETS_ROOT_KEY` | Yes, for Secrets | | Wraps each project's data key, which seals every value. Generate with `openssl rand -base64 32`. Keep a copy offline: if it's lost or changed, every stored secret is unreadable. Backups hold the sealed values, not this key. |
| `SECRETS_ROOT_KEY_PREVIOUS` | No | | Only while rotating the root key: the key you are moving away from. See [install.md](install.md#rotating-secrets_root_key). |
| `SECRETS_BLOCK_PRIVATE` | No | | `1` limits Secrets database connections, server push and the SSH terminal to public addresses. By default they may reach private ones. Nimbus's own Postgres and Redis are always refused. Webhooks and domain watch follow **Admin → Sharing → Secrets → Allow private addresses** instead. |
| `ACME_ALLOW_CUSTOM_DIRECTORY` | No | | `1` lets project admins use an ACME directory other than Let's Encrypt (Pebble, ZeroSSL). |
| `ACME_DNS_RESOLVER` | No | | `host[:port]`: the resolver the DNS challenge TXT checks ask. |
| `ACME_DNS_WAIT_SECONDS` | No | `90` | How long DNS challenges wait. |
| `ACME_DNS_API_BASE` | No | | Overrides the DNS provider's API address for DNS challenges. |
| `SSH_TERMINAL_URL` | No | | The WebSocket address the browser opens for the SSH terminal. By default it is `/ssh-ws` on the app's address. |
| `SSH_TERMINAL_PORT` | No | `3406` | Port of the `ssh-terminal` service. |
| `SSH_TERMINAL_IDLE_MS` | No | `1800000` (30 minutes) | An idle terminal session is closed after this long. |
| `SSH_TERMINAL_MAX` | No | `100` | At most this many terminal sessions run at once. |
| `SSH_TERMINAL_APP_URL` | No | `WEBDAV_APP_URL`, else `http://localhost:3000` | Where the `ssh-terminal` service reaches the app. |
| `SECRETS_CLI_DIR` | No | `packages/` in the repo | The folder holding the CLIs the server hands out. The Docker image sets `/opt/nimbus-cli`. |

Using Secrets from your apps is in [secrets.md](secrets.md).

## Office viewer

To open Word, Excel and PowerPoint files, run a Collabora Online server on its own HTTPS name. Set its URL in **Admin → System → Office**, and set `WOPI_BASE_URL` in `.env`. Add `--o:welcome.enable=false` to Collabora's `extra_params` so it doesn't show its welcome dialog each time someone opens a file (on the web and in the Android app). Without Collabora, Nimbus uses its built-in document and spreadsheet viewers.

| Variable | Required | Default | What it does |
|---|---|---|---|
| `WOPI_BASE_URL` | With Collabora | | Where Collabora reaches Nimbus. In production, `https://<DOMAIN>`. In dev, where Collabora runs in Docker, `http://host.docker.internal:3000`. Collabora refuses WOPI hosts it doesn't know. |

## API rate limits

The mobile app and other API clients may make 1,200 requests a minute per member, and 120 a minute per IP on the public `/api/v1/instance` check. Over that they get a 429 ("Too many requests"). Change either in `.env`:

```
API_RATE_LIMIT_USER=1200
API_RATE_LIMIT_INSTANCE_IP=120
```

| Variable | Required | Default | What it does |
|---|---|---|---|
| `API_RATE_LIMIT_USER` | No | `1200` | Requests a minute on `/api/v1` per signed-in member. |
| `API_RATE_LIMIT_INSTANCE_IP` | No | `120` | Requests a minute per IP on `/api/v1/instance`. |

A bad or missing value falls back to the default.

## AI service (nimbus-ml)

The `ml` profile. Turn the features on in **Admin → System → AI**; models download from there.

| Variable | Required | Default | What it does |
|---|---|---|---|
| `ML_TOKEN` | With `ml` | | Shared secret between the app and nimbus-ml. Generate with `openssl rand -hex 24`. `setup.sh` fills it. |
| `ML_URL` | No | `http://ml:8000` (compose) | Where the app reaches nimbus-ml. It wins over the URL saved in **Admin → System → AI**. |
| `NIMBUS_ML_MEMORY` | No | `3g` | Memory limit of the ml container. 3g fits the default models; use 4g or more for the multilingual photo search model (it needs about 2.5 GB). |

## WebDAV

The `webdav` service always runs. See [webdav.md](webdav.md).

| Variable | Required | Default | What it does |
|---|---|---|---|
| `WEBDAV_URL` | No | `<BETTER_AUTH_URL>/dav` | The address members are shown for mounting. |
| `WEBDAV_PORT` | No | `3404` | Port of the `webdav` service. |
| `WEBDAV_APP_URL` | No | `http://localhost:3000` | Where the `webdav` service reaches the app. |

## S3-compatible API

The `s3api` profile. See [s3-api.md](s3-api.md).

| Variable | Required | Default | What it does |
|---|---|---|---|
| `S3API_DOMAIN` | With `s3api` | | The S3 API's public name, for example `s3api.<DOMAIN>`. It must differ from `DOMAIN` and `S3_DOMAIN`. Empty means off. `setup.sh` fills it. |
| `S3API_PORT` | No | `3407` | Port of the `s3api` service. |
| `S3API_APP_URL` | No | `WEBDAV_APP_URL`, else `http://localhost:3000` | Where the `s3api` service reaches the app. |

## Container registry

The `registry`, `scan` and `build` profiles. `setup.sh` fills these. See [registry.md](registry.md).

| Variable | Required | Default | What it does |
|---|---|---|---|
| `REGISTRY_DOMAIN` | With `registry` | | The registry's public name, for example `registry.<DOMAIN>`. Empty means the registry is off. |
| `REGISTRY_PORT` | No | `3408` | Port of the `registry` service. |
| `REGISTRY_APP_URL` | No | `WEBDAV_APP_URL`, else `http://localhost:3000` | Where the `registry` service reaches the app. |
| `REGISTRY_SCAN_URL` | With `scan` | | Where the app and worker reach the scanner: `http://registry-scan:4954`. |
| `REGISTRY_SCAN_SECRET` | With `scan` | | Shared secret with the scanner. The scanner won't start without it. |
| `REGISTRY_SCAN_REGISTRY` | With `scan` | | Where the scanner reads images: `registry:3408`. |
| `REGISTRY_SCAN_PORT` | No | `4954` | Port of the scanner, inside the compose network. |
| `BUILDKIT_HOST` | With `build` | | `tcp://buildkitd:1234`. Lets the app show whether builds are available. |
| `BUILD_CPUS` | No | `1` | CPU cores builds may use. |
| `BUILD_MEM` | No | `2g` | RAM builds may use. |
| `BUILD_CACHE_GB` | No | `10` | Layer cache size in GB the app shows and enforces. |
| `BUILD_CACHE_MB` | No | `10240` | The same cache size for BuildKit's garbage collection. `setup.sh` sets it from `BUILD_CACHE_GB`. |
| `BUILDKIT_APPARMOR` | No | `unconfined` | `nimbus-buildkit` on hosts that restrict user namespaces (Ubuntu 23.10 and newer). `setup.sh` installs the profile and sets it. |
| `BUILD_WORK_DIR` | No | `/work` (compose) | The build runner's work folder. |
| `BUILD_DISK_PATHS` | No | `/work,/` | Disks the build guard watches for free space. |
| `BUILD_RECHECK_MS` | No | `30000` | How often a waiting build checks whether the server has room. |
| `BUILD_WAIT_GIVE_UP_MS` | No | `1800000` (30 minutes) | How long a build waits before it gives up. |
| `REGISTRY_BUILD_REGISTRY` | No | `registry:3408` (compose) | Where the build runner pushes. |
| `REGISTRY_BUILD_APP_URL` | No | `http://app:3000` (compose) | Where the build runner reaches the app. |

## Other

| Variable | Required | Default | What it does |
|---|---|---|---|
| `OCR_DATA_DIR` | No | | Where OCR language data is kept. The Docker image sets `/data/tessdata` (a compose volume). |
| `NODE_ENV` | | | The image sets `production`. Build with `NODE_ENV=production`; see [troubleshooting.md](troubleshooting.md#next-build-fails). |
| `VERCEL` | No | | Set by Vercel. Zips are then built in the browser instead of on the server. |

Variables named `E2E_*`, `API_URL`, `API_EMAIL`, `API_EMAIL2`, `API_PASSWORD`, `GITHUB_API_URL` and `DYN_*` are read only by the test suites and check scripts.

## Local dev services

`local_server/.env` overrides the defaults of the dev compose file. Not for production.

| Variable | Default | What it does |
|---|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `nimbus` | Dev Postgres login and database. |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` | `nimbus`, `nimbus-secret`, `nimbus` | Dev MinIO login and bucket. |
| `APP_ORIGIN` | `http://localhost:3000` | The app's address. |
| `TUS_HOOK_URL` | `http://host.docker.internal:3000/api/tus-hooks` | Where tusd calls the app. Add `?secret=<TUS_HOOK_SECRET>` when the app sets `TUS_HOOK_SECRET`. |
| `POSTGRES_PORT` | `5432` | Host port. |
| `S3_PORT`, `S3_CONSOLE_PORT` | `9100`, `9101` | MinIO API and console host ports. |
| `TUS_PORT` | `1080` | tusd host port. |
| `REDIS_PORT` | `6380` | Redis host port. |
| `ML_PORT` | `8100` | nimbus-ml host port (`--profile ml`). |

## Settings in the admin panel

These are stored in the database and changed in the app, not in env. Admin settings changes are recorded in **Admin → Audit log**.

| Page | Covers |
|---|---|
| Admin → Members, Approvals | Roles, storage, recovery, approving new sign-ups |
| Admin → Sign-ups & invites | Who can create an account, invite links |
| Admin → Authentication | How people sign in, the OIDC provider (unless `OIDC_ISSUER` is set) |
| Admin → Storage → Quotas, Uploads, Trash, Versions, Usage | Storage limits and policies |
| Admin → Sharing → Public links, Transfers, Vaults, Secrets | Sharing policies; Secrets options such as switching the CLI off and "Allow private addresses" |
| Admin → System → Email | Email (unless `EMAIL_TRANSPORT` is set) |
| Admin → System → Health | Check interval and which checks run; the Secrets root key |
| Admin → System → Backups | Backup storage (unless `BACKUP_S3_BUCKET` is set) and schedule |
| Admin → System → Office | The Collabora URL, PDF editing limits |
| Admin → System → AI | nimbus-ml features and its URL (unless `ML_URL` is set) |
| Admin → System → Text in images | OCR |
| Admin → System → Documents | The Documents section |
| Admin → System → Photos map | The Places map |
| Admin → System → WebDAV | WebDAV on or off for everyone |
| Admin → System → S3 API | The S3-compatible API |
| Admin → System → Registry | Registry limits, pull-through mirrors, build concurrency and guard thresholds |
| Admin → System → Appearance | How Nimbus looks for everyone |
