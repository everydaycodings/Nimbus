# Nimbus documentation

Start with [Install](install.md) if you're setting up a server, or [Contributing](../CONTRIBUTING.md)
if you want to work on the code.

## Run a server

| Guide | What it covers |
|---|---|
| [Install](install.md) | Requirements, `setup.sh`, your own Postgres or S3, credentials, nginx and HTTPS, setting it up by hand |
| [Configuration](configuration.md) | Every environment variable, and which settings live in the Admin pages |
| [Backups](backups.md) | Database backups with verification, file mirror, point-in-time restore, rebuilding a dead server |
| [Upgrading](upgrading.md) | Updating, migrations, rolling back, useful commands |
| [Troubleshooting](troubleshooting.md) | Common problems and where to look |

## Use Nimbus

| Guide | What it covers |
|---|---|
| [Sharing](sharing.md) | Members, public links, file requests, Transfer, comments, access log |
| [Vault](vault.md) | End-to-end encrypted files: what's protected, what isn't, recovery |
| [Sign-in and SSO](sso.md) | Google, GitHub, OIDC, passkeys, two-factor, device link, approvals |
| [Android](android.md) | Install, sign in, photo backup, offline files, Vault, building the app |
| [WebDAV](webdav.md) | Mount Nimbus as a drive on Windows, macOS, Linux and phones |
| [S3 API](s3-api.md) | Access keys, supported operations, aws-cli, rclone and SDK examples |
| [Container registry](registry.md) | `docker login`, push and pull, builds, scans, badges |
| [Secrets](secrets.md) | Connecting apps to Secrets, CLI, machine tokens, REST API, SSH |
| [CLI](cli.md) | The `nimbus` command, Node and Go builds |
| [Machine learning](ml.md) | Optional nimbus-ml: transcripts, photo search, faces |

## How it's built

| Guide | What it covers |
|---|---|
| [Architecture](architecture.md) | Services, data flows and background jobs at a glance |
| [System design guide (PDF)](nimbus-system-design.pdf) | The long version with hand-drawn diagrams and the reasoning behind each choice |
| [Contributing](../CONTRIBUTING.md) | Dev setup, migrations, tests, commit style |
| [Security](../SECURITY.md) | Reporting a vulnerability, security design summary |
