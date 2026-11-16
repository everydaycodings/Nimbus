# Backups

Nimbus can back up its database and every stored file to S3-compatible storage you choose (AWS, Cloudflare R2, Backblaze B2, Wasabi, MinIO or any other). A database backup is only kept once it has been restored into a throwaway database and proven to match the live one. This guide covers setup, the admin pages, restoring, and rebuilding a server from nothing.

Backups are optional, but recommended. Use storage somewhere other than the Nimbus server.

## What gets backed up

| Kind | What | How |
|---|---|---|
| Database | Every account, folder, share and setting | A full `pg_dump`, encrypted, restored into a scratch Postgres and checked before upload |
| Files | Every file and every version Nimbus knows about | An incremental mirror: each run copies only what's new since the last one |

Thumbnails and unfinished uploads are not backed up. They can be made again.

Each kind runs on its own schedule. Both are off until an admin turns them on.

## What is not in a backup

Some keys live only in `.env`. Backups don't contain them, and a restore is useless without them. Keep a copy of each somewhere off the server:

| Key | Without it |
|---|---|
| `BACKUP_ENCRYPTION_KEY` | No database backup can be decrypted, and neither can encrypted file copies |
| `BETTER_AUTH_SECRET` | Everyone is signed out, and secrets saved in the admin panel (email passwords, OIDC client secret, backup storage keys) can't be read |
| `SECRETS_ROOT_KEY` | Every value in [Secrets](secrets.md) is unreadable. Backups hold the sealed values, not this key |

Vault files are backed up as the ciphertext they are. Restoring them still needs each vault's passphrase or recovery key. See [vault.md](vault.md).

## Set it up

### 1. Start the backup worker

The backup worker drives the server's Docker to run `pg_dump` and to start a throwaway Postgres that checks each dump. That means it gets the Docker socket, which is root-level access to the server, so it is opt-in.

With Docker Compose, say yes to backups in `./setup.sh`, or add `backup` to `COMPOSE_PROFILES` in `.env` and run:

```bash
docker compose up -d
```

This starts the `backup-worker` service. It runs as root on the host network with `/var/run/docker.sock` mounted.

From a checkout (development), run it in its own terminal. It needs Docker:

```bash
npm run worker:backup
```

### 2. Set the encryption key

`BACKUP_ENCRYPTION_KEY` is 32 random bytes, base64. `setup.sh` generates it. To make one by hand:

```bash
openssl rand -base64 32
```

Every database dump is encrypted with it (AES-256-GCM). File copies are too, unless you turn that off. The Backups page warns when the worker doesn't have the key.

### 3. Choose storage

Pick the bucket under **Admin → System → Backups → Settings**: provider, endpoint, region, bucket, folder, path-style addresses, access key and secret key. Saving tests the connection first: the bucket must answer, and a probe object must go in and come out again. There is also a **Test connection** button. The keys are sealed with `BETTER_AUTH_SECRET` before they are stored.

Or set storage in env. It then wins, and the admin form turns read-only:

```
BACKUP_S3_PROVIDER=b2          # aws | r2 | b2 | wasabi | minio | other
BACKUP_S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
BACKUP_S3_REGION=us-west-004
BACKUP_S3_BUCKET=my-nimbus-backups
BACKUP_S3_FOLDER=nimbus        # prefix inside the bucket
BACKUP_S3_FORCE_PATH_STYLE=false
BACKUP_S3_ACCESS_KEY=...
BACKUP_S3_SECRET_KEY=...
```

Inside the bucket, backups are laid out like this:

```
<folder>/db/2026/10/nimbus-20261019T033000Z-1a2b3c4d.dump.enc
<folder>/files/<the file's key in Nimbus's bucket>
```

Changing the destination starts the file mirror over.

### 4. Turn on schedules

Under **Settings**, turn on Database and Files and choose when they run. See [Schedule](#schedule).

## Schedule

Each kind repeats every 1, 2, 3, 4, 6, 8, 12 or 24 hours from a start time, in a time zone you pick. Because the intervals divide 24, runs land at the same local times every day.

| Setting | Default |
|---|---|
| Database | Off; every 6 hours from 03:00 |
| Files | Off; every 24 hours from 02:00 |
| Time zone | UTC |
| Retries | 1, 15 minutes apart |

Without a database schedule, the database is only backed up when someone presses **Back up now**. Without a file schedule, new uploads aren't copied until then either.

**Pause schedules** on the Overview stops both until you press **Resume schedules**.

## How a database backup is checked

Each database run goes through these steps. It only uploads once the restore has passed, so a backup that doesn't restore never leaves the server.

1. **Snapshot.** Opens a repeatable-read transaction on the live database and fingerprints every table inside it: row counts, an order-independent checksum of every row, counts of indexes, constraints, functions, triggers and views, and sequence values.
2. **Dump.** Runs `pg_dump` at that same snapshot, encrypted as it streams to disk.
3. **Restore.** Decrypts the dump and restores it into a throwaway Postgres.
4. **Compare.** The restored copy's fingerprint must equal the live snapshot's.
5. **Upload.** Only now does the dump go to your storage.
6. **Stored file.** Downloads it again: the stored bytes must be the ones that were verified.
7. **Retention.** Deletes the dumps the retention rule no longer keeps.

A run ends as **Verified**, **Warning**, **Failed** or **Skipped**. It finishes with a warning, not a failure, when:

- the dump shrank by more than the **Warn when a dump shrinks by** setting (20% by default, compared with the last good one; blank turns it off), or
- the live data has rows that break a foreign key. If every table still matches exactly, the copy is faithful, but a restore would leave that constraint off until the orphan rows are fixed. The run names the constraint.

**Re-verify** on an older database backup downloads it, restores it into a scratch database again, and checks it still opens. It doesn't make a new backup.

## How a file backup works

Each file run:

1. **Source.** Compares every stored file and version with what the backup already holds.
2. **Copy.** Streams new ones across, hashed and (if on) encrypted on the way. **Files at a time** (4 by default) sets how many copy in parallel.
3. **Prune.** Files Nimbus purged are marked gone, and deleted from the backup after **Keep purged files** (30 days by default), in case they went by mistake.
4. **Sample re-read.** Downloads a random share of the backed-up files (1% by default, at least 20) and checks each against its original SHA-256.

**Encrypt copies** is on by default. It uses `BACKUP_ENCRYPTION_KEY`, so the backup provider can't read your files. Changing it applies only to files copied from then on.

## Retention

Retention applies to database dumps. Choose one of:

| Mode | Keeps |
|---|---|
| The newest N | The newest N good backups |
| Tiered (default) | Every backup from the last 48 hours, one a day for 30 days, one a week for 12 weeks and one a month for 12 months |

Whatever these say, two things are never deleted: pinned backups, and the newest good backup. Files of failed runs are kept for 7 days to look at, then deleted.

## Alerts

Admins get alerts in the bell, and by email unless they turned backup emails off under Account. Under **Settings → Alerts**, choose which events alert:

| Event | When | Default |
|---|---|---|
| A backup fails | After its retries run out | On |
| A backup has a warning | It shrank a lot, or the live data breaks a foreign key | On |
| Backups stop | No good backup in twice the interval | Off |

**Admin → System → Health** also shows backups. It turns red when backups are on but no storage is set up, when the backup worker isn't running, or when the last backup failed.

## The admin pages

Everything lives under **Admin → System → Backups**, in three tabs.

**Overview**

- Each kind's schedule, last good backup and next run, with **Back up now**. A manual run can carry a note and be pinned.
- **Pause schedules** / **Resume schedules**.
- Recent runs, database size and backup time trends, files in the backup, and the storage used.
- An estimated monthly cost for AWS, R2, B2 and Wasabi, from their standard list prices. It is an estimate.

**History**

- Every backup and re-verify, filterable by kind and status.
- Each run shows what it proved, step by step, and any differences between the live and restored copies.
- Pin or unpin a run, add notes ("Restored to staging and checked"), **Re-verify** a database backup, and **Download** it.

**Settings**

- Schedule, retention, storage, how files are copied and checked, retries and alerts.

### Confirming it's you

Downloading a database backup and changing the storage keys need a fresh check that it's really you. It unlocks for 10 minutes, for that session only:

| Your setup | You enter |
|---|---|
| Email is set up, and you have a password | Your password |
| Email is set up, and you sign in only with Google, GitHub or OIDC | A 6-digit code sent by email (one a minute, 5 tries, good for 10 minutes) |
| No email | A code from your authenticator app, so two-factor must be on |

With neither email nor two-factor, these actions stay locked. A download link is good for 5 minutes, and each download leaves a note on the run and an entry in the admin audit log.

## Restore a database backup

Get the `.dump.enc` file: **Download** it from History, or copy it straight from the backup bucket (`<folder>/db/…`).

Restore into an **empty** database. The script refuses a database that already has tables. Create a fresh one, restore into it, check it, then point `DATABASE_URL` at it.

With Docker Compose, run the script inside the backup worker image, which has the keys from `.env` and the Docker socket:

```bash
mkdir -p restore && cp ~/nimbus-20261019T033000Z-1a2b3c4d.dump.enc restore/
docker compose run --rm -v "$PWD/restore:/restore" backup-worker \
  node scripts/backup-restore.ts /restore/nimbus-20261019T033000Z-1a2b3c4d.dump.enc \
  postgres://nimbus:<password>@127.0.0.1:54340/nimbus_restored
```

From a checkout:

```bash
npm run backup:restore -- <file.dump.enc> <target database url>
```

What it does:

1. Decrypts the file. GCM checks it as it goes, so a changed, cut-off or wrongly keyed file stops here.
2. Restores it with a `pg_restore` that matches the target's Postgres major version (in Docker).
3. Fails on any restore error, using the same rules the backup's own check passed.
4. Prints how many tables it restored.

To only decrypt the file and restore it yourself:

```bash
npm run backup:restore -- <file.dump.enc> --out backup.dump
pg_restore --no-owner --dbname=<url> backup.dump
```

## Restore files

The file restore copies the mirror from the backup bucket back into Nimbus's bucket (`S3_BUCKET`), decrypting as it goes. Files already there are skipped, so it is safe to run again after an interruption. It exits with an error and lists any file that failed.

```bash
docker compose run --rm backup-worker node scripts/backup-restore-files.ts
```

From a checkout:

```bash
npm run backup:restore-files
```

It finds the backup bucket in `BACKUP_S3_*` env, or else in the backup settings stored in the database, so restore the database first. Encrypted copies need `BACKUP_ENCRYPTION_KEY`.

## Restore to a point in time (members)

This is not a server backup. It undoes changes in one member's own files, using the activity history.

Open a folder's ⋯ menu, or My files, and pick **Restore to a point in time…**. Choose a moment in the past and Nimbus previews what it will do:

- bring back items trashed since then,
- make older versions current again,
- undo renames and moves.

Files added since then are kept. A name that clashes gets "(restored)". You can **Undo** the restore for 7 days, from the toast or its Activity entry.

Limits:

- Only the owner of the folder can do it, and not inside a vault.
- It can't go further back than the admin's activity retention.
- It doesn't bring back files deleted forever. Those need a server restore.

## Rebuild a dead server from backups

This walkthrough uses only the scripts above. It assumes Docker Compose with Postgres and MinIO run by Nimbus. Adapt the paths and names.

You need:

- your old `.env`, or at least `BACKUP_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET` and `SECRETS_ROOT_KEY` from it,
- access to the backup bucket.

Steps:

1. **Install Nimbus on the new server** as in [install.md](install.md). Put your old `.env` at the repo root before running `./setup.sh`, and keep it when asked. If you only saved the keys, let `setup.sh` write a new `.env`, then set the three keys back to their old values. Turn on the `backup` profile.

2. **Start it**, so Postgres, MinIO and the bucket exist:

   ```bash
   docker compose up -d
   ```

   Don't sign up. The new database is filled by migrations, so it isn't empty and can't be restored into.

3. **Get the newest database dump** from `<folder>/db/<year>/<month>/` in the backup bucket, with any S3 tool, into `./restore/`. Dumps only reach the bucket after passing their restore check.

4. **Create an empty database and restore into it:**

   ```bash
   docker compose exec postgres createdb -U nimbus nimbus_restored
   docker compose run --rm -v "$PWD/restore:/restore" backup-worker \
     node scripts/backup-restore.ts /restore/<backup>.dump.enc \
     postgres://nimbus:<POSTGRES_PASSWORD>@127.0.0.1:54340/nimbus_restored
   ```

5. **Point Nimbus at it.** In `.env`, change the database name at the end of `DATABASE_URL` and `HOST_DATABASE_URL` from `nimbus` to `nimbus_restored`. Then:

   ```bash
   docker compose up -d
   ```

   Migrations run on every start, so a dump from an older version is brought up to date.

6. **Restore the files:**

   ```bash
   docker compose run --rm backup-worker node scripts/backup-restore-files.ts
   ```

   Run it again if it stops partway. It skips what is already there.

7. **Check.** Sign in, open **Admin → System → Health**, and open a few files. Thumbnails are drawn again as folders are opened.

8. **Turn backups back on.** They point at the same bucket, so the next file run only copies what's new.

## See also

- [install.md](install.md): installing and the `backup` profile
- [configuration.md](configuration.md): every env setting, including `BACKUP_*`
- [vault.md](vault.md): what restoring means for vault files
- [secrets.md](secrets.md): Secrets and `SECRETS_ROOT_KEY`
