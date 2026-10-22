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

Nimbus runs on one Linux server with Docker. [docker-compose.yml](docker-compose.yml) runs the
app, the background worker, Postgres, Redis, MinIO (file storage) and tusd (resumable uploads).
nginx on the server sits in front with HTTPS from Let's Encrypt.

### What you need

- A Linux server (Debian or Ubuntu for the nginx script) with Docker and Docker Compose.
  At least 2 GB of RAM; building the image takes a few minutes.
- Two DNS names pointing at the server's public IP (A records), for example:
  - `nimbus.example.com` for the app
  - `s3.nimbus.example.com` for file storage. Browsers download previews and files from it
    directly.
- Ports 80 and 443 open in the firewall. Nothing else needs to be public.

Nimbus binds only to 127.0.0.1, on ports chosen to stay clear of other apps:

| Service | Host port |
|---------|-----------|
| App | 3400 |
| tusd | 3401 |
| MinIO API / console | 3402 / 3403 |
| Postgres | 54340 |
| Redis | 6340 |

Check that they're free with `ss -ltn | grep -E ':(3400|3401|3402|3403|54340|6340) '`. If one is
taken, change it in `docker-compose.yml` and in `production_script/nginx/nimbus.conf.template`.

### Quick setup

```bash
git clone <this repo> nimbus && cd nimbus
./setup.sh
```

The script checks Docker and the ports, then asks for your two domains and, optionally, email,
Google/GitHub sign-in and backups. It writes `.env` with fresh secrets and starts Nimbus. Then it
asks whether to set up nginx and HTTPS for you (step 3 below) or print what to point your own
proxy at. Run it again after `git pull` to update, and keep the existing `.env` when it asks.

Prefer to do it by hand? Follow steps 1–3.

### 1. Get the code and fill in `.env`

```bash
git clone <this repo> nimbus && cd nimbus
cp production_script/.env.example .env
```

Open `.env` and set `DOMAIN`, `S3_DOMAIN` and `CERTBOT_EMAIL`, then fill each secret:

```bash
openssl rand -hex 24      # POSTGRES_PASSWORD, S3_SECRET_KEY, TUS_HOOK_SECRET (one each)
openssl rand -base64 32   # BETTER_AUTH_SECRET, BACKUP_ENCRYPTION_KEY (one each)
```

Keep comments in `.env` on their own lines. Docker Compose reads `KEY=  # note` as the value
`# note`. Save `BACKUP_ENCRYPTION_KEY` somewhere off the server: without it, no backup can be
restored.

### 2. Start Nimbus

```bash
docker compose up -d --build
docker compose ps        # migrate and minio-init show "Exited (0)", the rest "Up"
```

The first start builds the image, creates the bucket and applies the database migrations.
Check the app answers on the server itself with `curl -I http://127.0.0.1:3400/sign-in`.

### 3. Put nginx in front

Once both DNS names point at the server:

```bash
sudo ./production_script/setup-nginx.sh
```

It installs nginx and certbot, writes `/etc/nginx/sites-available/nimbus` from
[production_script/nginx/nimbus.conf.template](production_script/nginx/nimbus.conf.template),
gets certificates for both names and turns on the HTTP → HTTPS redirect. Certbot renews them
on its own.

Already running nginx for other sites? The script only adds the `nimbus` site, but it does
remove nginx's `default` site. Run it again any time to rewrite the config.

### 4. Create the owner account

Open `https://<DOMAIN>` and sign up. **The first account becomes the owner**, so do this right
away. Then:

- **Admin → System → Health** should be all green. It checks the database, Redis, storage, uploads and
  the worker.
- **Account → Two-factor authentication**: turn it on for the owner.
- **Admin → System → Email**: set up email if you didn't in `.env`, or members can't reset passwords.

### Backups (optional, recommended)

The backup worker dumps the database and mirrors files to S3-compatible storage of your
choice (AWS, R2, B2, …). It drives the server's Docker to run `pg_dump` and to check each dump in
a throwaway database. That means it gets the Docker socket, which is root-level access to the
server, so it's opt-in:

```bash
docker compose --profile backup up -d
```

Then choose where and when under **Admin → System → Backups**. Use storage somewhere other
than this server.

To restore, read the notes at the top of `scripts/backup-restore.ts` (database) and
`scripts/backup-restore-files.ts` (files), and run them inside the image, which has the keys
from `.env`:

```bash
docker compose --profile backup run --rm -v "$PWD/restore:/restore" backup-worker \
  node scripts/backup-restore.ts /restore/<backup>.dump.enc <url of an empty database>
docker compose --profile backup run --rm backup-worker node scripts/backup-restore-files.ts
```

### Updating

```bash
git pull
docker compose up -d --build   # add --profile backup if you run backups
```

Migrations run on every start, before the app.

### Useful commands

```bash
docker compose logs -f app worker            # follow logs
docker compose restart app                   # restart one service
docker compose exec postgres psql -U nimbus  # database shell
ssh -L 3403:127.0.0.1:3403 <server>          # then open http://localhost:3403 for the MinIO console
```

The MinIO console login is `nimbus` with your `S3_SECRET_KEY`.

### Office viewer (optional)

To open Word, Excel and PowerPoint files, run a Collabora Online server on its own HTTPS name.
Set its URL in **Admin → System → Office**, and set `WOPI_BASE_URL=https://<DOMAIN>` in `.env`. Without
it, Nimbus uses its built-in document and spreadsheet viewers.
