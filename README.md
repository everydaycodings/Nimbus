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
npm run worker                                      # health checks, in a second terminal
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
