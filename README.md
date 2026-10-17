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
```

Open http://localhost:3000. The first account you create becomes the owner of the instance.
Everyone who signs up after that waits for an admin to approve them under **Members**.

### Google and GitHub sign-in (optional)

Set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` in
`.env.local`. Use these callback URLs when creating the OAuth apps:

- Google: `http://localhost:3000/api/auth/callback/google`
- GitHub: `http://localhost:3000/api/auth/callback/github`

A provider's button only appears once both of its keys are set.

## Database

- `npm run db:generate` creates a migration after changing `lib/db/schema.ts`
- `npm run db:migrate` applies migrations
- `npm run db:studio` opens Drizzle Studio
