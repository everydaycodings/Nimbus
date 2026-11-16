# Contributing to Nimbus

This guide covers running Nimbus from a checkout, the scripts you'll use, how the repo is laid out, and how changes are written up. To run Nimbus on a server instead, see [docs/install.md](docs/install.md). Every environment variable is in [docs/configuration.md](docs/configuration.md). For how the pieces fit together, read [docs/architecture.md](docs/architecture.md).

## What you need

- Node.js. The Docker image builds on Node 24, and the scripts run `.ts` files with plain `node`, so use a current Node (24 is what's tested).
- npm. The repo pins `npm@11.11.0` in `packageManager` and uses npm workspaces.
- Docker with Docker Compose, for the dev services in `local_server/`.

## Run it locally

```bash
cd local_server && docker compose up -d && cd ..   # Postgres, MinIO, tusd, Redis, Mailpit
cp apps/web/.env.example apps/web/.env.local        # then set BETTER_AUTH_SECRET
npm install
npm run db:migrate
npm run dev
npm run worker                                      # required; run it in a second terminal
```

Open http://localhost:3000. The first account you create becomes the owner of the instance. Everyone who signs up after that waits for an admin to approve them under **Members**.

`BETTER_AUTH_SECRET` can be made with `openssl rand -base64 32`. The app's `.env.local` lives in `apps/web/`, not at the root. `local_server/README.md` lists the dev values for Postgres, S3, tusd and Redis.

### The worker

`npm run worker` is not optional. It sends email, deletes S3 objects, purges the trash, reads text from files for search, makes server-side thumbnails and video copies, and runs the health checks. Without it, those jobs wait in Redis. See [Background jobs](docs/architecture.md#background-jobs) for the full list.

### Other processes

Some features need a small process beside `npm run dev`, because Next can't route their methods or upgrade WebSockets:

| Script | Port | Needed for |
|---|---|---|
| `npm run webdav` | 3404 | WebDAV at `/dav` |
| `npm run ssh-terminal` | 3406 | The browser SSH terminal in Secrets |
| `npm run s3api -w web` | 3407 | The S3-compatible API |
| `npm run registry -w web` | 3408 | The container registry |
| `npm run worker:backup` | none | Admin → Backups (needs Docker) |
| `npm run indexer` | none | One search-indexing sweep without the worker |

`npm run cli:build` builds the Secrets CLI: the Node package, then the Go binaries in a `golang:1.23` container (Docker is needed; Go is not).

### Dev ports

`local_server/docker-compose.yml` publishes these. Override any `*_PORT` in `local_server/.env` if one clashes.

| Service | Host port | Notes |
|---|---|---|
| Postgres | 5432 | `pgvector/pgvector:pg17`, user, password and database `nimbus` |
| MinIO S3 | 9100 | bucket `nimbus`, created by `minio-init` |
| MinIO console | 9101 | `nimbus` / `nimbus-secret` |
| tusd | 1080 | resumable uploads at `/files/` |
| Redis | 6380 | required: background jobs and health checks |
| Mailpit SMTP | 1025 | catches every email |
| Mailpit inbox | 8025 | http://localhost:8025 |
| Collabora | 9980 | optional, `docker compose --profile office up -d` |
| nimbus-ml | 8100 | optional, `docker compose --profile ml up -d`, up to 3 GB RAM |

tusd calls `http://host.docker.internal:3000/api/tus-hooks`, so uploads only work while `npm run dev` is running. `docker compose down -v` in `local_server/` wipes the database, files and Redis.

### Google, GitHub and OIDC sign-in (optional)

Set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` in `.env.local`. Use these callback URLs when creating the OAuth apps:

- Google: `http://localhost:3000/api/auth/callback/google`
- GitHub: `http://localhost:3000/api/auth/callback/github`

A provider's button only appears once both of its keys are set. One OpenID Connect provider can be set up in **Admin → Authentication** or with the `OIDC_*` variables; see [docs/configuration.md](docs/configuration.md).

## Database

The schema is in `apps/web/lib/db/schema.ts`. Migrations are made by Drizzle Kit and live in `apps/web/drizzle/`.

| Script | Does |
|---|---|
| `npm run db:generate` | Creates a migration after you change `schema.ts` |
| `npm run db:migrate` | Applies migrations |
| `npm run db:studio` | Opens Drizzle Studio |
| `npm run db:seed [email]` | Dev only: fills an account (the owner by default) with sample folders and files, with no bytes behind them |

Commit the generated SQL together with the schema change. In production the `migrate` compose service applies migrations before the app starts.

## Checks

| Script | Does |
|---|---|
| `npm run lint` | ESLint in every workspace (through Turborepo) |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm run format` | Prettier on the web app's `.ts` and `.tsx` files |
| `npm run build` | Builds every workspace |

`next build` fails when the shell has `NODE_ENV=development`. Build with `NODE_ENV=production npm run build`.

## Unit tests

Unit tests use Node's built-in test runner and sit next to the code as `*.test.ts`. There is no root `test` script, so run them per workspace:

```bash
cd apps/web && node --test lib/*.test.ts    # also lib/secrets, lib/registry, lib/s3api, ...
npm test -w @nimbus/shared
npm test -w @nimbus/cli
npm test -w mobile
```

A few web tests (for example `lib/tree.test.ts` and `lib/doc-transfer.test.ts`) and the `*.int.test.ts` files talk to the dev Postgres, so start `local_server` first.

## End-to-end tests

`npm run test:e2e` runs a Playwright suite (`apps/web/e2e/`) against a Nimbus that's already running: `npm run dev`, the worker and tusd. It covers upload, sharing, public links, vaults, two-factor, passkeys, comments, transfers, documents, Secrets and more.

It signs in as two existing, approved members without two-factor. Point it elsewhere with:

| Variable | Default |
|---|---|
| `E2E_URL` | `http://localhost:3000` |
| `E2E_EMAIL` | `browser-test@example.invalid` |
| `E2E_EMAIL2` | `newbie@example.invalid` |
| `E2E_PASSWORD` | `browser-test-pass-123` (both members) |

Each test makes its own `e2e …` folder or vault and trashes or deletes it at the end. Tests run one at a time. The first run needs:

```bash
npx playwright install chromium
```

The Android app has its own Maestro flows: `npm run e2e:android` in `apps/mobile`.

## Repo layout

Turborepo runs `dev`, `build`, `lint` and `typecheck` across npm workspaces (`apps/*` and `packages/*`).

| Path | What it is |
|---|---|
| `apps/web` | The Next.js app, the API, and the scripts for the worker, WebDAV, S3 API, registry, SSH terminal and backups (`scripts/`) |
| `apps/mobile` | The Android app (Expo) |
| `packages/cli` | `@nimbus/cli`, the Node Secrets CLI |
| `packages/cli-go` | The same CLI as one Go binary |
| `packages/shared` | `@nimbus/shared`: code used by web and mobile (vault crypto, file rules, API types, photos, comments, PDF annotations) |
| `services/ml` | `nimbus-ml`, the optional Python AI service (speech, photo and face search) |
| `local_server` | Docker Compose for dev services |
| `docker` | Images and config for registry scanning and image builds |
| `production_script` | nginx templates and `setup-nginx.sh` |
| `docker-compose.yml`, `setup.sh` | Production stack and installer (see [docs/install.md](docs/install.md)) |
| `plans` | Build plans and status, for example `plans/android-app.md` |
| `docs` | Guides and the [system design guide (PDF)](docs/nimbus-system-design.pdf) |

`PRODUCT.md` says what Nimbus is, `ROADMAP.md` what's built, and `DESIGN.md` the design system.

## Plans

Bigger work starts as a plan in `plans/`. A plan lists the decisions, the steps and what's left, and is updated as work lands. `ROADMAP.md` records each finished phase, including what was left for later.

## Commits

Write one short sentence per commit, in plain English, saying what changed for the user. Start with the area when it helps:

```
Registry: repository page no longer crashes when a scan exists
Storage meter: S3 buckets as their own segment
Stop tracking .impeccable and .playwright-mcp files (already ignored)
```

Don't add `Co-Authored-By` or other attribution lines. The Android release workflow uses the tagged commit's message as the release notes and strips `Co-Authored-By` lines from it.

## Security issues

Don't open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
