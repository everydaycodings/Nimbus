# local_server

Dev infrastructure for Nimbus. Not for production.

```sh
cd local_server
cp .env.example .env   # optional, defaults work out of the box
docker compose up -d
```

| Service  | Host port | Notes |
|----------|-----------|-------|
| Postgres | 5432 | user/pass/db `nimbus` |
| MinIO S3 | 9100 | bucket `nimbus` is created by `minio-init` |
| MinIO console | 9101 | http://localhost:9101 (`nimbus` / `nimbus-secret`) |
| tusd     | 1080 | resumable uploads at `/files/`, stores into the bucket |
| Redis    | 6380 | reserved for rate limiting and caching |
| Mailpit SMTP | 1025 | no auth, no TLS; catches every email |
| Mailpit inbox | 8025 | http://localhost:8025 |

Ports clash with something else? Override `*_PORT` in `.env`.

## App env (`.env.local` at the repo root)

```sh
DATABASE_URL=postgres://nimbus:nimbus@localhost:5432/nimbus
S3_ENDPOINT=http://localhost:9100
S3_REGION=us-east-1
S3_BUCKET=nimbus
S3_ACCESS_KEY=nimbus
S3_SECRET_KEY=nimbus-secret
S3_FORCE_PATH_STYLE=true
TUS_URL=http://localhost:1080/files/
REDIS_URL=redis://localhost:6380
# Optional: send through Mailpit. Leave EMAIL_TRANSPORT unset to configure email in /admin/email.
EMAIL_TRANSPORT=smtp
EMAIL_FROM=Nimbus <nimbus@localhost>
SMTP_HOST=localhost
SMTP_PORT=1025
```

tusd calls `http://host.docker.internal:3000/api/tus-hooks` on `pre-create` and `post-finish`,
so `npm run dev` must be running for uploads to be accepted.

## Reset

```sh
docker compose down -v   # wipes the database, files and redis
```

ponytail: tusd needs a long-running server, so resumable uploads only work where it runs
(Docker deploys). Vercel deploys need a hosted tusd or a fallback to plain uploads.
