# Install Nimbus on a server

This guide puts Nimbus on one Linux server with Docker. [docker-compose.yml](../docker-compose.yml) always runs the app, the background worker, the WebDAV proxy, the SSH terminal bridge, Redis and tusd (resumable uploads). Postgres and file storage can run there too, or you can bring your own. nginx on the server sits in front, with HTTPS from Let's Encrypt.

Every variable named here is described in [configuration.md](configuration.md). To update a running install, see [upgrading.md](upgrading.md). If something doesn't start, see [troubleshooting.md](troubleshooting.md).

## What you need

- A Linux server (Debian or Ubuntu for the nginx script) with Docker and Docker Compose v2.20 or newer. At least 2 GB of RAM. Building the image takes a few minutes.
- A DNS name for the app pointing at the server's public IP (A record), for example `nimbus.example.com`. If MinIO runs on the server, a second one for storage, for example `s3.nimbus.example.com`: browsers download previews and files from it directly.
- Ports 80 and 443 open in the firewall. Nothing else needs to be public.

Optional features add more names, each with its own A record pointing at the server:

| Feature | Name | Default |
|---|---|---|
| Self-hosted push (ntfy) | `ntfy.<DOMAIN>` | fixed |
| S3-compatible API | `S3API_DOMAIN` | `s3api.<DOMAIN>` |
| Container registry | `REGISTRY_DOMAIN` | `registry.<DOMAIN>` |

## Ports

Nimbus binds only to 127.0.0.1, on ports chosen to stay clear of other apps:

| Service | Host port | Runs when |
|---|---|---|
| App | 3400 | always |
| tusd | 3401 | always |
| WebDAV proxy | 3404 | always |
| SSH terminal (WebSocket) | 3406 | always |
| S3-compatible API | 3407 | `s3api` profile |
| Container registry | 3408 | `registry` profile |
| Redis | 6340 | always |
| Postgres | 54340 | `postgres` profile |
| MinIO API / console | 3402 / 3403 | `minio` profile |
| ntfy | 3405 | `push` profile |

The AI service (`ml` profile), image scanning (`scan` profile) and image builds (`build` profile) publish no host port.

`setup.sh` checks that the ones you need are free. If one is taken, change it in `docker-compose.yml` and in the templates under `production_script/nginx/`.

## Quick setup

```bash
git clone <this repo> nimbus && cd nimbus
./setup.sh
```

Run it as a user that can use Docker. If Docker isn't reachable, the script says so; add yourself to the docker group with `sudo usermod -aG docker $USER` and log in again.

The script asks:

1. Your app domain.
2. **Database:** run Postgres in Docker, or use your own ([details](#your-own-postgres)).
3. **File storage:** run MinIO in Docker, or use your own S3-compatible storage ([details](#your-own-s3-storage)).
4. Optional: email, Google and GitHub sign-in, the backup worker, self-hosted push (ntfy), the AI service (nimbus-ml), the S3-compatible API and the container registry (with image scanning and image builds).
5. Whether to set up nginx and HTTPS for you, or print what to point your own proxy at.

It writes `.env` with fresh secrets, starts the right services and waits for the app on `http://127.0.0.1:3400/sign-in`. If nginx is already set up for these domains and HTTPS works, the nginx step checks that and skips.

Run it again after `git pull` to update, and keep the existing `.env` when it asks. See [upgrading.md](upgrading.md).

## Postgres and storage: here or your own

`COMPOSE_PROFILES` in `.env` picks the optional services. Docker Compose reads it on its own, so a plain `docker compose up -d` always starts the same set:

| `COMPOSE_PROFILES` | Runs |
|---|---|
| `postgres,minio` | everything on this server (the default) |
| `minio` | your own Postgres, MinIO here |
| `postgres` | Postgres here, your own S3 |
| *(empty)* | your own Postgres and S3 |

Add any of these to the list:

| Profile | Adds | Notes |
|---|---|---|
| `backup` | The backup worker | Gets the Docker socket. See [backups.md](backups.md). |
| `push` | ntfy, a push server for the Android app | Port 3405, served at `ntfy.<DOMAIN>` |
| `ml` | nimbus-ml, the optional AI service (speech, photo and face search) | CPU only. `mem_limit` 3 GB, change it with `NIMBUS_ML_MEMORY`. |
| `s3api` | The S3-compatible API | See [s3-api.md](s3-api.md) |
| `registry` | The container registry | See [registry.md](registry.md) |
| `scan` | Trivy image scanning (about 1 GB) | Needs `registry` |
| `build` | BuildKit image builds | Needs `registry` and 2 GB or more of free RAM |

Switching later? Move the data across first (a database dump, or copying the bucket), then change `.env` and run:

```bash
docker compose up -d --remove-orphans
```

### Bundled Postgres image

The bundled Postgres is `pgvector/pgvector:pg17` (Debian), which replaced `postgres:17-alpine`. The two sort text differently, so after switching an existing install, rebuild the indexes once:

```sh
docker compose up -d postgres
docker compose exec postgres psql -U nimbus -d nimbus -c 'REINDEX DATABASE nimbus' \
  -c 'CREATE EXTENSION IF NOT EXISTS vector'
```

A cluster created by the Alpine image records no collation version, so Postgres has nothing to warn about, and `ALTER DATABASE ... REFRESH COLLATION VERSION` fails with "invalid collation version change". Only run it if Postgres later logs a collation version mismatch.

## Your own Postgres

Nimbus is developed and tested on Postgres 17; use a recent version. It can be a managed one (Neon, Supabase, RDS, DigitalOcean, …) or one already running on the server.

- Create an **empty database** and a user that owns it. A migration runs `create extension pg_trgm`, so the user needs permission for that. Managed services allow it.
- Put its URL in `.env` twice:

  ```bash
  COMPOSE_PROFILES=minio   # no "postgres"
  DATABASE_URL='postgres://nimbus:PASSWORD@db.example.com:5432/nimbus?sslmode=require'
  HOST_DATABASE_URL='postgres://nimbus:PASSWORD@db.example.com:5432/nimbus?sslmode=require'
  ```

  `HOST_DATABASE_URL` is the same database as seen from the server itself. The backup worker uses it because it runs on the host network.
- **Postgres on the same server** (outside Docker): inside a container, `localhost` is the container itself. Use `host.docker.internal` in `DATABASE_URL` and `127.0.0.1` in `HOST_DATABASE_URL`. `setup.sh` does this for you if you type `localhost`. Postgres must also listen on the Docker bridge (`listen_addresses = '*'`, or the bridge IP) and allow `172.16.0.0/12` in `pg_hba.conf`.
- Add `?sslmode=require` when the provider asks for TLS (most managed ones do).

## Your own S3 storage

Any S3-compatible storage works. The bucket must exist before you start. These are the values for `.env` (or for `setup.sh`'s questions):

| Provider | `S3_ENDPOINT` | `S3_REGION` | `S3_FORCE_PATH_STYLE` |
|---|---|---|---|
| AWS S3 | *(empty)* | your bucket's region, e.g. `eu-central-1` | `false` |
| Cloudflare R2 | `https://<account-id>.r2.cloudflarestorage.com` | `auto` | `false` |
| Backblaze B2 | `https://s3.<region>.backblazeb2.com` | e.g. `us-west-004` | `false` |
| Wasabi | `https://s3.<region>.wasabisys.com` | e.g. `eu-central-1` | `false` |
| MinIO, Garage, SeaweedFS elsewhere | its public HTTPS URL | `us-east-1` (or its own) | `true` |

```bash
COMPOSE_PROFILES=postgres   # no "minio"
S3_DOMAIN=                  # empty: nginx only serves the app
S3_ENDPOINT='https://<account-id>.r2.cloudflarestorage.com'
S3_REGION='auto'
S3_BUCKET='nimbus'
S3_ACCESS_KEY='...'
S3_SECRET_KEY='...'
S3_FORCE_PATH_STYLE=false
```

Two things the bucket needs:

- **CORS.** Previews, thumbnails and zip listings fetch files straight from the browser, so allow your app's origin. Without it, previews fail with "check the storage bucket's CORS rule". `setup.sh` prints this rule at the end when you use your own storage.

  ```json
  [
    {
      "AllowedOrigins": ["https://nimbus.example.com"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["Range"],
      "ExposeHeaders": ["Content-Range", "Content-Length", "ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
  ```

  AWS: bucket → Permissions → CORS, or `aws s3api put-bucket-cors --bucket <bucket> --cors-configuration '{"CORSRules": <the array>}'`. R2: bucket → Settings → CORS policy. B2 and Wasabi: their bucket settings, or the same `aws s3api` command with `--endpoint-url`.
- **Keep it private.** Nimbus hands out short-lived signed links. The bucket itself should never be public.

The bundled MinIO needs none of this: compose sets its CORS origin to `https://<DOMAIN>`, and the `minio-init` service creates the bucket.

## Credentials

Everything secret lives in `.env` at the repo root.

- `setup.sh` writes it readable only by you (`chmod 600`), and `.gitignore` and `.dockerignore` keep it out of git and out of the image. Containers get the values at start.
- `setup.sh` generates the secrets Nimbus makes for itself: the Postgres and MinIO passwords, `TUS_HOOK_SECRET` (only tusd may call the upload hooks), `BETTER_AUTH_SECRET` (signs sessions and seals secrets saved through the admin panel), `BACKUP_ENCRYPTION_KEY`, `SECRETS_ROOT_KEY` and `ML_TOKEN`. It hides what you type for passwords and keys.
- **Your own storage:** give Nimbus an access key limited to its one bucket, with read, write, list and delete, not an account-wide key. On AWS that's an IAM user with a policy on `arn:aws:s3:::<bucket>` and `arn:aws:s3:::<bucket>/*`. On R2 it's an API token with "Object Read & Write" for that bucket. On B2 it's an application key restricted to the bucket.
- **Your own Postgres:** a user that owns only the Nimbus database, not the superuser.
- Values that contain `$`, `#` or spaces must be in single quotes in `.env`, as `setup.sh` writes them. A value can't contain a single quote.
- **Don't regenerate secrets on a running install.** The database and MinIO keep the passwords they started with, and a new `BETTER_AUTH_SECRET` signs everyone out and makes secrets saved in the admin panel unreadable. `setup.sh` offers to keep `.env` and stops if it would orphan old data.
- **Back up `BACKUP_ENCRYPTION_KEY` somewhere off the server.** Without it, no backup can be restored.
- **Back up `SECRETS_ROOT_KEY` too.** It wraps the keys that seal every value in Secrets. If it is lost or changed, every stored secret is unreadable, and backups don't contain it.
- Rotating a storage key: create the new key, put it in `.env`, run `docker compose up -d`, then delete the old key.

### Rotating `SECRETS_ROOT_KEY`

No secret is re-encrypted; only the keys that wrap them are.

1. Make a new key (`openssl rand -base64 32`, or Admin → System → Health → Secrets root key → Rotate → Make a new key) and keep a copy offline.
2. In `.env`, set `SECRETS_ROOT_KEY_PREVIOUS` to the **current** value and `SECRETS_ROOT_KEY` to the new one. Run `docker compose up -d` so the app and the worker both restart. Everything still opens, because the app tries the new key and then the previous one.
3. Admin → System → Health → Secrets root key now shows both fingerprints and how many values are still sealed with the old key. Press **Re-wrap**. The worker seals each project key and share link again under the new key and shows progress. Stopping it midway is fine: press the button again and it carries on.
4. When it says everything is sealed with the new key, delete `SECRETS_ROOT_KEY_PREVIOUS` from `.env` and restart. Keep the old key until you have taken a fresh backup, since older database backups still need it.

How apps read secrets out of Nimbus is in [secrets.md](secrets.md).

## Setting it up by hand

1. Copy the template and fill it in. The comments in it say what goes where:

   ```bash
   cp production_script/.env.example .env && chmod 600 .env
   openssl rand -hex 24      # POSTGRES_PASSWORD, S3_SECRET_KEY, TUS_HOOK_SECRET, ML_TOKEN (one each)
   openssl rand -base64 32   # BETTER_AUTH_SECRET, BACKUP_ENCRYPTION_KEY, SECRETS_ROOT_KEY (one each)
   ```

   With bundled Postgres, put `POSTGRES_PASSWORD` into both database URLs. With bundled MinIO, set `S3_ENDPOINT=https://<S3_DOMAIN>`. Keep comments on their own lines: Docker Compose reads `KEY=  # note` as the value `# note`.

2. Start it:

   ```bash
   docker compose up -d --build
   docker compose ps        # migrate (and minio-init) show "Exited (0)", the rest "Up"
   curl -I http://127.0.0.1:3400/sign-in
   ```

3. Once DNS points at the server, put nginx in front:

   ```bash
   sudo ./production_script/setup-nginx.sh
   ```

## nginx and HTTPS

`production_script/setup-nginx.sh` reads `DOMAIN`, `S3_DOMAIN`, `CERTBOT_EMAIL` and `COMPOSE_PROFILES` from `.env`. It:

- installs nginx and certbot if they're missing;
- writes `/etc/nginx/sites-available/nimbus` from the templates in [production_script/nginx/](../production_script/nginx/), with the storage site only when `S3_DOMAIN` is set, the ntfy site with the `push` profile, the S3 API site with `s3api` and the registry site with `registry`;
- gets certificates and turns on the HTTP → HTTPS redirect. Certbot renews them on its own.

Run it again any time. If everything already works, it says so and changes nothing. After an update that changes the templates (like `/dav` or `/ssh-ws`), it rewrites the site and keeps the existing certificate. It stops if another nginx site already uses one of the domains, and it removes nginx's `default` site.

### Visitor IPs behind a proxy

Rate limits, sign-in limits and the audit log need the visitor's real IP. nginx takes it from `X-Forwarded-For` only when the connection comes from a trusted proxy, written to `/etc/nginx/snippets/nimbus-realip.conf`.

| Variable | Default | Effect |
|---|---|---|
| `TRUST_CLOUDFLARE` | `1` | Trust Cloudflare's published ranges. `0` turns this off. |
| `TRUSTED_PROXIES` | empty | Other proxies in front of nginx (load balancer, tunnel), as comma-separated IPs or CIDRs |

Re-run `setup-nginx.sh` after changing either.

If the registry domain is on Cloudflare, make its record **DNS only** (grey cloud): Cloudflare's proxy caps a request at 100 MB, which large image layers go over.

### Your own reverse proxy

If you say no to nginx in `setup.sh`, it prints what to point your proxy at. All upstreams are on 127.0.0.1, with HTTPS in front:

| Public address | Upstream | Needs |
|---|---|---|
| `https://<DOMAIN>/files/` | `127.0.0.1:3401` | Resumable uploads: no body size limit, no request buffering, `X-Forwarded-Host` and `X-Forwarded-Proto` |
| `https://<DOMAIN>/dav` | `127.0.0.1:3404` | WebDAV: no body size limit, no buffering |
| `https://<DOMAIN>/ssh-ws` | `127.0.0.1:3406` | WebSocket upgrade, no buffering |
| `https://<DOMAIN>/v2/` | `127.0.0.1:3408` | Registry (with `registry`): no body limit, no request or response buffering |
| `https://<DOMAIN>/` | `127.0.0.1:3400` | No response buffering: zips stream |
| `https://<S3_DOMAIN>/` | `127.0.0.1:3402` | Bundled MinIO: pass the `Host` header through unchanged |
| `https://<S3API_DOMAIN>/` | `127.0.0.1:3407` | Pass the `Host` header through unchanged; no body limit |
| `https://<REGISTRY_DOMAIN>/` | `127.0.0.1:3408` | No body limit, no request or response buffering |
| `https://ntfy.<DOMAIN>/` | `127.0.0.1:3405` | With `push` |

The ready nginx configs in `production_script/nginx/` show the exact settings, including the long read timeouts on `/files/`, `/dav`, `/v2/` and `/ssh-ws`, the `client_max_body_size 64m` for forms and actions, and the `OPTIONS /` answer Windows' "Map network drive" needs. Set `X-Real-IP` to the visitor's address: the app reads it.

## After the first start

Open `https://<DOMAIN>` and sign up. **The first account becomes the owner**, so do this right away. Everyone who signs up after that waits for an admin to approve them under **Members**. Then:

- **Admin → System → Health** should be all green. It checks the database, Redis, storage, uploads and the worker. See [troubleshooting.md](troubleshooting.md#the-health-page).
- **Account → Two-factor authentication**: turn it on for the owner.
- **Admin → System → Email**: set up email if you didn't in `.env`, or members can't reset passwords.
- Copy `BACKUP_ENCRYPTION_KEY` and `SECRETS_ROOT_KEY` from `.env` somewhere off this server.

## Next steps

- [Backups](backups.md): the backup worker, where backups go, and restoring.
- [Single sign-on](sso.md): Google, GitHub and OIDC.
- [WebDAV](webdav.md): mount Nimbus as a drive.
- [S3-compatible API](s3-api.md): use folders as S3 buckets.
- [Container registry](registry.md): `docker push` and `docker pull`, scanning and builds.
- [Secrets](secrets.md): connect your apps to Nimbus Secrets.
- [Configuration](configuration.md): every environment variable.
