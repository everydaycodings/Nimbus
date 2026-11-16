# Upgrade Nimbus

Updating is a `git pull` and a rebuild. Database migrations run on their own. This guide covers the update, the commands you need day to day, and what to do if an update goes wrong.

Installing for the first time is in [install.md](install.md).

## Before you update

Take a backup, so you can go back. With the backup worker on, check **Admin → System → Backups** for a recent good one, or press **Back up now** there. See [backups.md](backups.md).

## Updating

```bash
git pull
./setup.sh                    # keep the existing .env; or just: docker compose up -d --build
```

When `setup.sh` asks, keep the existing `.env`. A new `.env` makes new secrets, and the existing database won't accept the new password. If it would orphan old data, `setup.sh` stops.

`setup.sh` also asks the optional questions again (backups, push, AI, S3 API, registry, nginx), with your current answers as the defaults. Running nginx setup again rewrites the site when the templates changed (for example the `/dav` and `/ssh-ws` blocks) and keeps the existing certificate. Sites set up before the SSH terminal need it run again to get `/ssh-ws`:

```bash
sudo ./production_script/setup-nginx.sh
```

An `.env` from the first version of `setup.sh` (no `COMPOSE_PROFILES` line) is updated to the current format with the same secrets. The script also offers to remove the old `nimbus:latest` image; the current one is `nimbus-app:latest`.

Browser tabs left open from before the update fail with "This page couldn't load" (the log says `Failed to find Server Action`) until reloaded.

## How migrations run

Migrations are the SQL files in `apps/web/drizzle/`. They run on every start, before the app:

- In Docker, the `migrate` service runs `node scripts/migrate.ts` and exits. The `app` and `worker` services wait for it to finish successfully. After a start, `docker compose ps` shows `migrate` as "Exited (0)".
- In local development, run `npm run db:migrate`.

Both use the same bookkeeping table, so a migration that has run is never run again. If `migrate` fails, the app doesn't start; read its log:

```bash
docker compose logs migrate
```

After changing `apps/web/lib/db/schema.ts`, `npm run db:generate` creates a new migration. `npm run db:studio` opens Drizzle Studio.

## Rolling back

Migrations only go forward: there are no down migrations. An older version of the app may not work with a database a newer one migrated. To go back:

1. Restore the database backup you took before the update into a new, empty database. The steps are at the top of `apps/web/scripts/backup-restore.ts` and in [backups.md](backups.md):

   ```bash
   docker compose run --rm -v "$PWD/restore:/restore" backup-worker \
     node scripts/backup-restore.ts /restore/<backup>.dump.enc <url of an empty database>
   ```

2. Point `DATABASE_URL` (and `HOST_DATABASE_URL`) in `.env` at it.
3. Check out the version you ran before and rebuild:

   ```bash
   git checkout <commit or tag>
   docker compose up -d --build
   ```

Restoring needs the `BACKUP_ENCRYPTION_KEY` the backup was made with.

## Useful commands

```bash
docker compose logs -f app worker            # follow logs
docker compose restart app                   # restart one service
docker compose exec postgres psql -U nimbus  # database shell (bundled Postgres)
ssh -L 3403:127.0.0.1:3403 <server>          # then open http://localhost:3403 for the MinIO console
```

The MinIO console login is your `S3_ACCESS_KEY` (`nimbus`) and `S3_SECRET_KEY`.

Day to day, a plain `docker compose up -d` starts the same services, because Docker Compose reads `COMPOSE_PROFILES` from `.env`. After changing profiles, add `--remove-orphans`:

```bash
docker compose up -d --remove-orphans
```

More help is in [troubleshooting.md](troubleshooting.md). Every variable is in [configuration.md](configuration.md).
