# Troubleshooting

Start with the Health page and the logs. Most problems show up in one of them. This guide lists the problems Nimbus itself tells you about, and how to fix each.

Install steps are in [install.md](install.md), variables in [configuration.md](configuration.md), updates in [upgrading.md](upgrading.md).

## Logs

```bash
docker compose ps                            # what runs; migrate (and minio-init) should be "Exited (0)"
docker compose logs -f app worker            # follow the app and the worker
docker compose logs migrate app              # why the app didn't start
docker compose logs -f backup-worker         # backups (backup profile)
docker compose restart app                   # restart one service
```

Any service name from `docker-compose.yml` works with `logs`: `tusd`, `webdav`, `ssh-terminal`, `s3api`, `registry`, `registry-scan`, `buildkitd`, `build-runner`, `ml`, `ntfy`, `postgres`, `redis`, `minio`.

## The Health page

**Admin → System → Health** checks every service Nimbus depends on, on a schedule, and tells admins when one goes down. After an install it should be all green.

| Check | What it does |
|---|---|
| Database | Runs a query against Postgres. |
| File storage | Writes, reads back and deletes a small test file in the bucket. |
| Redis | Pings Redis, which keeps the check schedule. |
| Uploads | Asks tusd, the resumable upload server, whether it's answering. |
| Email | Signs in to the SMTP server, or checks the Resend API key. Sends nothing. |
| Office viewer | Fetches Collabora's discovery file from the server set under Office documents. |
| Search indexer | Looks for a recent indexer sweep from the worker. |
| AI service | Asks nimbus-ml for its status. Only checked while an AI feature is on. |
| Documents | Looks for a recent documents sweep from the worker. Only checked while Documents is on. |
| Sign-in providers | Checks that each Google or GitHub sign-in has both its client ID and secret. |
| Backups | Writes and deletes a test file in the backup bucket, and looks for a failed or overdue backup. |
| Image builds | Connects to BuildKit and looks for the build runner's heartbeat. Only checked when setup turned image builds on. |

A failing check links to the admin page where it is fixed, when there is one (Email, Office, AI, Documents, Backups, Registry). The page also shows the server's memory, load and disk, and the Secrets root key status.

## The worker isn't running

The worker is required. It sends emails, cleans up storage, indexes search and runs the health checks. Without it, the Health page says **"Scheduled checks aren't running."** or **"Scheduled checks stopped. The last one ran …"**, and nobody is told when a service goes down.

In Docker, the `worker` service always runs. Check it:

```bash
docker compose ps worker
docker compose logs -f worker
```

In local development, run it in a second terminal next to `npm run dev`:

```bash
npm run worker
```

The backup worker is separate. If the Backups check says "The backup worker isn't running", add `backup` to `COMPOSE_PROFILES` and run `docker compose up -d` (in dev: `npm run worker:backup`, which needs Docker). See [backups.md](backups.md).

## REDIS_URL is not set

The app refuses to start without Redis:

```
REDIS_URL is not set. Nimbus needs Redis; local_server/compose.yml runs one on port 6380.
```

In Docker, compose sets it. In dev, set `REDIS_URL=redis://localhost:6380/0` in `apps/web/.env.local` and start `local_server`.

## The app didn't come up

`setup.sh` waits for `http://127.0.0.1:3400/sign-in`. If it never answers, it stops with "The app didn't come up". Read the logs:

```bash
docker compose logs migrate app
```

The app only starts after `migrate` finishes. A failed migration, or a `DATABASE_URL` the containers can't reach, stops it there.

## Can't talk to Docker

`setup.sh` stops with "Can't talk to Docker" when your user can't use it. Start Docker, or add yourself to the docker group and log in again:

```bash
sudo usermod -aG docker $USER
```

## Port already in use

Production binds to 127.0.0.1 on ports 3400–3408, 6340 and 54340 (see [install.md](install.md#ports)). `setup.sh` checks them before the first start and stops with:

```
Port 3400 is already in use. Change it in docker-compose.yml and production_script/nginx/*.template, then run this again.
```

Change the host side of the `ports:` line (the part before the colon) and the matching `proxy_pass` in the nginx templates, then re-run `setup.sh` or `setup-nginx.sh`.

In local development, `local_server` uses 5432, 9100, 9101, 1080 and 6380 (8100 for `--profile ml`). Override any of them with the `*_PORT` variables in `local_server/.env`, and change the matching URL in `apps/web/.env.local`, for example `REDIS_URL` or `S3_ENDPOINT`.

## `next build` fails

Build with `NODE_ENV=production`. A shell that has `NODE_ENV=development` set breaks `next build`. The Docker image builds this way:

```bash
NODE_ENV=production npm run build -w web
```

## Previews fail: "check the storage bucket's CORS rule"

Previews, thumbnails and zip listings fetch files straight from the browser. With your own S3, the bucket needs a CORS rule that allows your app's origin. The rule is in [install.md](install.md#your-own-s3-storage). The bundled MinIO sets it for you.

## "This page couldn't load" after an update

Browser tabs left open from before the update fail with "This page couldn't load", and the log says `Failed to find Server Action`. Reload the tab.

## Uploads aren't accepted in local development

tusd calls `http://host.docker.internal:3000/api/tus-hooks` on each upload, so `npm run dev` must be running. If you set `TUS_HOOK_SECRET` in `apps/web/.env.local`, put the same value in `TUS_HOOK_URL` in `local_server/.env` (`...?secret=<TUS_HOOK_SECRET>`).

## The containers can't reach Postgres on the same server

Inside a container, `localhost` is the container itself. Use `host.docker.internal` in `DATABASE_URL` and `127.0.0.1` in `HOST_DATABASE_URL`. Postgres must also listen on the Docker bridge (`listen_addresses = '*'`, or the bridge IP) and allow `172.16.0.0/12` in `pg_hba.conf`. See [install.md](install.md#your-own-postgres).

## Collation warnings after switching the Postgres image

The bundled Postgres moved from `postgres:17-alpine` to `pgvector/pgvector:pg17`, which sorts text differently. Run `REINDEX DATABASE nimbus` once, as in [install.md](install.md#bundled-postgres-image). Only run `ALTER DATABASE ... REFRESH COLLATION VERSION` if Postgres later logs a collation version mismatch; on an Alpine-made cluster it fails with "invalid collation version change".

## nginx or HTTPS setup failed

`setup.sh` warns when a domain doesn't resolve yet ("doesn't resolve yet. Add its DNS A record before HTTPS can work."). The most common cause of a failed nginx step is DNS not pointing at the server yet. Fix the record, then run:

```bash
sudo ./production_script/setup-nginx.sh
```

It also stops if another nginx site already uses one of the domains, and when `CERTBOT_EMAIL` is empty in `.env`.

## Rate limits and visitor IPs

API clients get a 429 ("Too many requests") above `API_RATE_LIMIT_USER` (1,200 a minute per member) or `API_RATE_LIMIT_INSTANCE_IP` (120 a minute per IP on `/api/v1/instance`). See [configuration.md](configuration.md#api-rate-limits).

If every visitor shows the same IP, a proxy in front of nginx isn't trusted. Add it to `TRUSTED_PROXIES` (Cloudflare is trusted unless `TRUST_CLOUDFLARE=0`) and re-run `setup-nginx.sh`.

## Large registry pushes fail behind Cloudflare

Cloudflare's proxy caps a request at 100 MB, which large image layers go over. Make the registry record **DNS only** (grey cloud). See [registry.md](registry.md).

## Image builds won't start

On Ubuntu 23.10 and newer, user namespaces are restricted, which rootless BuildKit needs. `setup.sh` installs a small AppArmor profile for the BuildKit container ([docker/buildkit/apparmor-nimbus-buildkit](../docker/buildkit/apparmor-nimbus-buildkit)) and sets `BUILDKIT_APPARMOR=nimbus-buildkit`. If that didn't install, it warns "builds won't start". Building for another architecture needs QEMU:

```bash
docker run --privileged --rm tonistiigi/binfmt --install arm64
```

## More

- WebDAV clients: [webdav.md](webdav.md)
- S3 API clients: [s3-api.md](s3-api.md)
- Sign-in providers: [sso.md](sso.md)
- Secrets CLI and tokens: [secrets.md](secrets.md)
