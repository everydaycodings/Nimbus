# Nimbus

Open-source, self-hosted file storage you own. See [PRODUCT.md](PRODUCT.md) for what it is,
[ROADMAP.md](ROADMAP.md) for what's built, and [DESIGN.md](DESIGN.md) for the design system.

## Run it locally

```bash
cd local_server && docker compose up -d && cd ..   # Postgres, MinIO, tusd, Redis
cp .env.example .env.local                          # then set BETTER_AUTH_SECRET
npm install
npm run db:migrate
npm run dev
npm run worker                                      # required: emails, cleanup, indexing, health checks; second terminal
```

Open http://localhost:3000. The first account you create becomes the owner of the instance.
Everyone who signs up after that waits for an admin to approve them under **Members**.

### Google and GitHub sign-in (optional)

Set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` in
`.env.local`. Use these callback URLs when creating the OAuth apps:

- Google: `http://localhost:3000/api/auth/callback/google`
- GitHub: `http://localhost:3000/api/auth/callback/github`

A provider's button only appears once both of its keys are set.

### Single sign-on with OIDC (optional)

One OpenID Connect provider (Authentik, Keycloak, Zitadel, …) can be set up in
**Admin → Authentication**, or in env, which wins and locks the admin form:

```
OIDC_ISSUER=https://auth.example.com/application/o/nimbus/
OIDC_CLIENT_ID=nimbus
OIDC_CLIENT_SECRET=...
OIDC_NAME=Authentik        # the button says "Sign in with Authentik"
OIDC_ONLY=false            # true hides password, Google and GitHub (the owner keeps a password)
```

Register `<your Nimbus URL>/api/auth/callback/oidc` as the redirect URL, as a
confidential client with the `openid email profile` scopes (PKCE is used).
New people who sign in with it skip approval unless sign-ups are closed, and it
links to an existing account only when that account's email is confirmed.

- **Authentik:** Applications → Create with provider → OAuth2/OpenID. The issuer
  is `https://<authentik>/application/o/<app-slug>/`.
- **Keycloak:** create a client in your realm with Client authentication on. The
  issuer is `https://<keycloak>/realms/<realm>`.

## What a vault protects

Vault files are encrypted in the browser before upload, names included, with a passphrase the
server never sees. Someone with the database and the bucket learns only how many files a vault
holds, their rough sizes and when they changed. Lose both the passphrase and the recovery key
and the files are gone; an admin can only delete the vault. A vault doesn't protect against a
compromised server sending tampered JavaScript to the browser.

## Database

- `npm run db:generate` creates a migration after changing `lib/db/schema.ts`
- `npm run db:migrate` applies migrations
- `npm run db:studio` opens Drizzle Studio

## Deploy to production

Nimbus runs on one Linux server with Docker. [docker-compose.yml](docker-compose.yml) always runs
the app, the background worker, the WebDAV proxy, Redis and tusd (resumable uploads). Postgres and file storage can
run there too, or you can bring your own. nginx on the server sits in front with HTTPS from
Let's Encrypt.

### What you need

- A Linux server (Debian or Ubuntu for the nginx script) with Docker and Docker Compose v2.20 or
  newer. At least 2 GB of RAM; building the image takes a few minutes.
- A DNS name for the app pointing at the server's public IP (A record), e.g.
  `nimbus.example.com`. If MinIO runs on the server, a second one for storage, e.g.
  `s3.nimbus.example.com`: browsers download previews and files from it directly.
- Ports 80 and 443 open in the firewall. Nothing else needs to be public.

Nimbus binds only to 127.0.0.1, on ports chosen to stay clear of other apps:

| Service | Host port | Runs when |
|---------|-----------|-----------|
| App | 3400 | always |
| tusd | 3401 | always |
| WebDAV proxy | 3404 | always |
| Redis | 6340 | always |
| Postgres | 54340 | `postgres` profile |
| MinIO API / console | 3402 / 3403 | `minio` profile |

`setup.sh` checks that the ones you need are free. If one is taken, change it in
`docker-compose.yml` and in the templates under `production_script/nginx/`.

### Quick setup

```bash
git clone <this repo> nimbus && cd nimbus
./setup.sh
```

The script asks:

1. Your app domain.
2. **Database:** run Postgres in Docker, or use your own ([details](#your-own-postgres)).
3. **File storage:** run MinIO in Docker, or use your own S3-compatible storage
   ([details](#your-own-s3-storage)).
4. Optional: email, Google/GitHub sign-in, and the backup worker.
5. Whether to set up nginx and HTTPS for you, or print what to point your own proxy at.

It writes `.env` with fresh secrets, starts the right services and waits for the app. If nginx
is already set up for these domains and HTTPS works, the nginx step checks that and skips.

Run it again after `git pull` to update, and keep the existing `.env` when it asks.

### Postgres and storage: here or your own

`COMPOSE_PROFILES` in `.env` picks the optional services. Docker Compose reads it on its own, so a
plain `docker compose up -d` always starts the same set:

| `COMPOSE_PROFILES` | Runs |
|--------------------|------|
| `postgres,minio` | everything on this server (the default) |
| `minio` | your own Postgres, MinIO here |
| `postgres` | Postgres here, your own S3 |
| *(empty)* | your own Postgres and S3 |

Add `backup` to any of them to run the backup worker. Switching later? Move the data across
first (a database dump, or copying the bucket), then change `.env` and run
`docker compose up -d --remove-orphans`.

#### Your own Postgres

Nimbus is developed and tested on Postgres 17; use a recent version. It can be a managed one (Neon, Supabase, RDS, DigitalOcean, …) or one
already running on the server.

- Create an **empty database** and a user that owns it. A migration runs
  `create extension pg_trgm`, so the user needs permission for that. Managed services allow it.
- Put its URL in `.env` twice:

  ```bash
  COMPOSE_PROFILES=minio   # no "postgres"
  DATABASE_URL='postgres://nimbus:PASSWORD@db.example.com:5432/nimbus?sslmode=require'
  HOST_DATABASE_URL='postgres://nimbus:PASSWORD@db.example.com:5432/nimbus?sslmode=require'
  ```

  `HOST_DATABASE_URL` is the same database as seen from the server itself. The backup worker
  uses it because it runs on the host network.
- **Postgres on the same server** (outside Docker): inside a container, `localhost` is the
  container itself. Use `host.docker.internal` in `DATABASE_URL` and `127.0.0.1` in
  `HOST_DATABASE_URL`; `setup.sh` does this for you if you type `localhost`. Postgres must also
  listen on the Docker bridge (`listen_addresses = '*'`, or the bridge IP) and allow
  `172.16.0.0/12` in `pg_hba.conf`.
- Add `?sslmode=require` when the provider asks for TLS (most managed ones do).

#### Your own S3 storage

Any S3-compatible storage works. The bucket must exist before you start. These are the values
for `.env` (or for `setup.sh`'s questions):

| Provider | `S3_ENDPOINT` | `S3_REGION` | `S3_FORCE_PATH_STYLE` |
|----------|---------------|-------------|-----------------------|
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

- **CORS.** Previews, thumbnails and zip listings fetch files straight from the browser, so
  allow your app's origin. Without it, previews fail with "check the storage bucket's CORS rule".

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

  AWS: bucket → Permissions → CORS, or
  `aws s3api put-bucket-cors --bucket <bucket> --cors-configuration '{"CORSRules": <the array>}'`.
  R2: bucket → Settings → CORS policy. B2 and Wasabi: their bucket settings, or the same
  `aws s3api` command with `--endpoint-url`.
- **Keep it private.** Nimbus hands out short-lived signed links; the bucket itself should
  never be public.

### Credentials

Everything secret lives in `.env` at the repo root:

- `setup.sh` writes it readable only by you (`chmod 600`), and `.gitignore` and
  `.dockerignore` keep it out of git and out of the image. Containers get the values at start.
- `setup.sh` generates the secrets Nimbus makes for itself: the Postgres and MinIO passwords,
  `TUS_HOOK_SECRET` (only tusd may call the upload hooks), `BETTER_AUTH_SECRET` (signs sessions
  and seals secrets saved through the admin panel) and `BACKUP_ENCRYPTION_KEY`. It hides what
  you type for passwords and keys.
- **Your own storage:** give Nimbus an access key limited to its one bucket, with read, write,
  list and delete, not an account-wide key. On AWS that's an IAM user with a policy on
  `arn:aws:s3:::<bucket>` and `arn:aws:s3:::<bucket>/*`. On R2 it's an API token with
  "Object Read & Write" for that bucket. On B2 it's an application key restricted to the bucket.
- **Your own Postgres:** a user that owns only the Nimbus database, not the superuser.
- Values that contain `$`, `#` or spaces must be in single quotes in `.env`, as `setup.sh`
  writes them. A value can't contain a single quote.
- **Don't regenerate secrets on a running install.** The database and MinIO keep the passwords
  they started with, and a new `BETTER_AUTH_SECRET` signs everyone out and makes secrets saved
  in the admin panel unreadable. `setup.sh` offers to keep `.env` and stops if it would orphan
  old data.
- **Back up `BACKUP_ENCRYPTION_KEY` somewhere off the server.** Without it, no backup can be
  restored.
- Rotating a storage key: create the new key, put it in `.env`, run `docker compose up -d`,
  then delete the old key.

### Setting it up by hand

1. Copy the template and fill it in. The comments in it say what goes where:

   ```bash
   cp production_script/.env.example .env && chmod 600 .env
   openssl rand -hex 24      # POSTGRES_PASSWORD, S3_SECRET_KEY, TUS_HOOK_SECRET (one each)
   openssl rand -base64 32   # BETTER_AUTH_SECRET, BACKUP_ENCRYPTION_KEY (one each)
   ```

   With bundled Postgres, put `POSTGRES_PASSWORD` into both database URLs. With bundled MinIO,
   set `S3_ENDPOINT=https://<S3_DOMAIN>`. Keep comments on their own lines: Docker Compose
   reads `KEY=  # note` as the value `# note`.

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

   It installs nginx and certbot if they're missing, and writes `/etc/nginx/sites-available/nimbus`
   from the templates in [production_script/nginx/](production_script/nginx/), with the storage
   site only when `S3_DOMAIN` is set. Then it gets certificates and turns on the HTTP → HTTPS
   redirect. Certbot renews them on its own. Run it again any time: if everything already works,
   it says so and changes nothing. After an update that changes the templates (like `/dav`), it
   rewrites the site and keeps the existing certificate. It stops if another nginx site already uses one of the
   domains, and it removes nginx's `default` site.

### After the first start

Open `https://<DOMAIN>` and sign up. **The first account becomes the owner**, so do this right
away. Then:

- **Admin → System → Health** should be all green. It checks the database, Redis, storage,
  uploads and the worker.
- **Account → Two-factor authentication**: turn it on for the owner.
- **Admin → System → Email**: set up email if you didn't in `.env`, or members can't reset
  passwords.

### Backups (optional, recommended)

The backup worker dumps the database and mirrors files to S3-compatible storage of your
choice (AWS, R2, B2, …). It drives the server's Docker to run `pg_dump` and to check each dump in
a throwaway database. That means it gets the Docker socket, which is root-level access to the
server, so it's opt-in: say yes in `setup.sh`, or add `backup` to `COMPOSE_PROFILES` and run
`docker compose up -d`.

Then choose where and when under **Admin → System → Backups**. Use storage somewhere other
than this server.

To restore, read the notes at the top of `scripts/backup-restore.ts` (database) and
`scripts/backup-restore-files.ts` (files), and run them inside the image, which has the keys
from `.env`:

```bash
docker compose run --rm -v "$PWD/restore:/restore" backup-worker \
  node scripts/backup-restore.ts /restore/<backup>.dump.enc <url of an empty database>
docker compose run --rm backup-worker node scripts/backup-restore-files.ts
```

### Updating

```bash
git pull
./setup.sh                    # keep the existing .env; or just: docker compose up -d --build
```

Migrations run on every start, before the app. Browser tabs left open from before the update
fail with "This page couldn't load" (the log says `Failed to find Server Action`) until reloaded.

### Useful commands

```bash
docker compose logs -f app worker            # follow logs
docker compose restart app                   # restart one service
docker compose exec postgres psql -U nimbus  # database shell (bundled Postgres)
ssh -L 3403:127.0.0.1:3403 <server>          # then open http://localhost:3403 for the MinIO console
```

The MinIO console login is your `S3_ACCESS_KEY` (`nimbus`) and `S3_SECRET_KEY`.

### Office viewer (optional)

To open Word, Excel and PowerPoint files, run a Collabora Online server on its own HTTPS name.
Set its URL in **Admin → System → Office**, and set `WOPI_BASE_URL=https://<DOMAIN>` in `.env`.
Without it, Nimbus uses its built-in document and spreadsheet viewers.

### WebDAV (mount as a drive)

Members can mount their files at `https://<DOMAIN>/dav` from GNOME Files (`davs://<DOMAIN>/dav`),
Dolphin (`webdavs://`), rclone, Windows' "Map network drive", macOS Finder and phone apps. They
sign in with their email and an app password from **Account → Connect a device**; the guide there
has the steps for each. nginx forwards `/dav` to the `webdav` service, so there's nothing to set
up. Turn it off for everyone in **Admin → System → WebDAV**, or for one member on their page.

davfs2 can't list folders on Linux 7 kernels; use rclone there to mount it as a folder.
