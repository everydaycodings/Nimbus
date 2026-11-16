# Nimbus

Open-source, self-hosted file storage you own. A Google Drive replacement that runs on your own
server, keeps files in your own S3-compatible bucket, and has an end-to-end encrypted Vault for
the files even the server operator shouldn't read.

- **What it is:** [PRODUCT.md](PRODUCT.md)
- **What's built:** [ROADMAP.md](ROADMAP.md)
- **How it's built and why:** the **[system design guide (PDF)](docs/nimbus-system-design.pdf)**, with
  hand-drawn diagrams, and the shorter [architecture overview](docs/architecture.md)
- **All documentation:** [docs/README.md](docs/README.md)

## Features

| Area | What you get | Guide |
|---|---|---|
| Files | Upload files and folders (resumable), previews, versions, search with OCR, trash, starred, tags | [Architecture](docs/architecture.md) |
| Sharing | Share with members, public links, file requests, Transfer, comments, access log | [Sharing](docs/sharing.md) |
| Vault | Files encrypted in your browser, names included, with a passphrase the server never sees | [Vault](docs/vault.md) |
| Sign-in | Email and password, Google, GitHub, OIDC single sign-on, passkeys, two-factor, sign in by QR | [Sign-in and SSO](docs/sso.md) |
| Drive mount | Mount Nimbus as a drive over WebDAV on Windows, macOS, Linux, rclone and phones | [WebDAV](docs/webdav.md) |
| S3 API | Use Nimbus as an S3-compatible endpoint for aws-cli, rclone and SDKs | [S3 API](docs/s3-api.md) |
| Secrets | Keys, passwords and certificates for your apps, SSH CA, database logins, KMS | [Secrets](docs/secrets.md) |
| Registry | A private Docker/OCI container registry with builds and scans | [Registry](docs/registry.md) |
| Backups | Verified database backups, incremental file mirror, point-in-time restore | [Backups](docs/backups.md) |
| Android | Photo backup, offline files, Vault, files in other apps, in-app updates | [Android](docs/android.md) |
| AI (optional) | Transcripts, captions, search by what's in a photo, faces | [Machine learning](docs/ml.md) |
| CLI | The `nimbus` command | [CLI](docs/cli.md) |

## Quick start

On a Linux server with Docker Compose v2.20+, 2 GB of RAM, ports 80 and 443 open, and a DNS name
pointing at it:

```bash
git clone https://github.com/everydaycodings/Nimbus.git && cd Nimbus
./setup.sh
```

The script asks a few questions, writes the config and starts everything. The first account you
create becomes the owner of the instance; everyone after that waits for approval under **Admin → People → Approvals**.

- [Install](docs/install.md): requirements, your own Postgres or S3, HTTPS with nginx, setting it up by hand
- [Configuration](docs/configuration.md): every environment variable
- [Upgrading](docs/upgrading.md) and [Troubleshooting](docs/troubleshooting.md)

## Develop

```bash
cd local_server && docker compose up -d && cd ..   # Postgres, MinIO, tusd, Redis
cp apps/web/.env.example apps/web/.env.local        # then set BETTER_AUTH_SECRET
npm install && npm run db:migrate
npm run dev                                         # http://localhost:3000
npm run worker                                      # second terminal, required
```

[CONTRIBUTING.md](CONTRIBUTING.md) covers the monorepo layout, migrations, tests and commit style.
[DESIGN.md](DESIGN.md) is the design system. Found a security issue? See [SECURITY.md](SECURITY.md).

## License

Nimbus is free software under the [GNU Affero General Public License v3.0](LICENSE). You can use,
change and share it. If you run a modified version for other people over a network, you must
offer them its source code too.
