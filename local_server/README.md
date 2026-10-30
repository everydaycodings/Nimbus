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
| Redis    | 6380 | required: background jobs and health checks (`npm run worker`) |
| Mailpit SMTP | 1025 | no auth, no TLS; catches every email |
| Mailpit inbox | 8025 | http://localhost:8025 |
| Collabora | 9980 | optional, `--profile office` (see below) |

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

To stop anything but tusd calling the hooks, set `TUS_HOOK_SECRET` in the app's env and put the
same value in the hook URL (tusd can't add headers of its own), in `local_server/.env`:

```sh
TUS_HOOK_URL=http://host.docker.internal:3000/api/tus-hooks?secret=<TUS_HOOK_SECRET>
```

Without `TUS_HOOK_SECRET` the hook endpoint accepts any caller, which is fine for local dev only.

## Office viewer (optional)

Collabora Online (CODE) opens Word, Excel, PowerPoint and OpenDocument files read-only:

```sh
docker compose --profile office up -d
```

Then set **Collabora URL** to `http://localhost:9980` in `/admin/settings`, and in `.env.local`:

```sh
# Where Collabora reaches the app. It runs in Docker, so not localhost.
WOPI_BASE_URL=http://host.docker.internal:3000
```

The URL in admin settings must be reachable from the browser (it's loaded in an iframe) and from
the app (it reads `/hosting/discovery`). `WOPI_BASE_URL` must match `aliasgroup1` in
`compose.yml`; Collabora refuses WOPI hosts it doesn't know. Leave the setting blank and the
built-in docx and spreadsheet viewers are used instead.

## S3 CORS (any bucket other than this dev MinIO)

Previews, thumbnails and zip listings fetch presigned URLs straight from the browser, so the
bucket must allow `GET` from the app's origin and expose `Content-Range` (zip listings read
byte ranges). The dev MinIO gets this from `MINIO_API_CORS_ALLOW_ORIGIN`. Without it, previews
fail with "check the storage bucket's CORS rule". For AWS S3, Cloudflare R2 or Backblaze B2:

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

```sh
aws s3api put-bucket-cors --bucket <bucket> --cors-configuration \
  '{"CORSRules": <the array above>}'
```

R2 takes the same array in the dashboard under the bucket's Settings > CORS policy.

## Search indexer

The browser reads text from files (PDFs, documents, sheets, and OCR for images) as they're
uploaded or when their folder is opened. `npm run worker` sweeps every minute for files no
browser has read yet, for example everything uploaded before search existed. For one sweep
without the worker:

```sh
npm run indexer
```

It uses `.env.local` for Postgres and S3, and the OCR languages from `/admin/settings`.
Tesseract downloads each language's data from the jsDelivr CDN the first time.

## WebDAV

`npm run webdav` serves `/dav` on port 3404 and forwards each request to `/api/dav` on the dev
server (Next can't route PROPFIND, MKCOL and the rest). Make an app password in Account →
Connect a device, then for example:

```sh
curl -u you@example.com:APP-PASSWORD -X PROPFIND -H "Depth: 1" http://localhost:3404/dav/
```

`.env.local` sets `WEBDAV_URL=http://localhost:3404/dav` so Account shows that address. In
production nginx forwards `/dav` to the `webdav` compose service and the address is
`https://<domain>/dav`.

## Reset

```sh
docker compose down -v   # wipes the database, files and redis
```

ponytail: tusd needs a long-running server, so resumable uploads only work where it runs
(Docker deploys). Vercel deploys need a hosted tusd or a fallback to plain uploads.
