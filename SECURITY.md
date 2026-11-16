# Security

Nimbus holds people's files, passwords and keys, so security reports are welcome and taken seriously.

## Report a vulnerability

Don't open a public issue, pull request or discussion for a vulnerability.

Report it privately through GitHub instead:

1. Go to [github.com/everydaycodings/Nimbus](https://github.com/everydaycodings/Nimbus).
2. Open the **Security** tab and choose **Report a vulnerability**.
3. Say what's affected, how to reproduce it, and what an attacker gains. A proof of concept helps.

This opens a private security advisory that only you and the maintainers can see. The fix and the advisory are published together once a release is out.

## Supported versions

Only the latest release gets security fixes. Releases are tagged `v*` (for example `v0.2.17`). Update with `git pull` and `./setup.sh`, as in [docs/install.md](docs/install.md). Android users get the matching APK from GitHub Releases or Obtainium.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Anything older | No |

## Security design

A short summary of what's in the code. The [system design guide (PDF)](docs/nimbus-system-design.pdf) covers it in depth.

### Accounts and sign-in

- Sign-in is handled by [Better Auth](https://www.better-auth.com/) (`apps/web/lib/auth.ts`): email and password, Google, GitHub and one OIDC provider.
- The first account becomes the owner. Later sign-ups wait as `pending` until an admin approves them.
- Accounts with the same email link across sign-in methods only when the existing account's email is verified, so pre-registering someone's email can't take over their Google or GitHub sign-in.
- The owner sets the password policy. Resetting a password signs out every other session.
- **Two-factor:** TOTP apps with backup codes, or a passkey as the second factor. Admins can require two-factor for password accounts.
- **Passkeys:** can be used to sign in and as a second factor. Admins can turn them off or require everyone to add one. They need HTTPS and a domain name.
- Secrets typed into the admin panel (SMTP password, Resend key) are sealed with AES-256-GCM under a key derived from `BETTER_AUTH_SECRET`.

### Vault: end-to-end encryption

Vault files are encrypted in the browser before upload, names included (`packages/shared/vault-crypto.ts`). The server stores only ciphertext and wrapped keys.

- A random AES-GCM vault key is wrapped twice: once with Argon2id of the passphrase (64 MiB, t=3), once with HKDF of a 32-byte recovery key shown at creation.
- Each file has its own key, wrapped by the vault key.
- Files are encrypted in 4 MiB chunks. Each chunk's nonce is its index, and its additional data holds the index and an is-last flag, so reordered or truncated files fail to decrypt.
- Keys live in memory only. A reload, the Lock button or idle time locks every vault.

Someone with the database and the bucket learns only how many files a vault holds, their rough sizes and when they changed. Lose both the passphrase and the recovery key and the files are gone. A vault doesn't protect against a compromised server sending tampered JavaScript to the browser. More in [docs/vault.md](docs/vault.md).

### Secrets: encryption at rest

- Each Secrets project has a random data key that seals every value with AES-256-GCM (`apps/web/lib/secrets/kms.ts`).
- The data key is wrapped by `SECRETS_ROOT_KEY` from the server's environment. The root key can be rotated with `SECRETS_ROOT_KEY_PREVIOUS`. Backups hold sealed values, not the root key.
- Key names, comments and tags stay readable so they can be searched. Values never are.
- The Secrets section has its own server-enforced unlock per session. It locks after a member's idle time (15 minutes by default), can take a PIN, and locks out after failed unlocks.
- Machine tokens are scoped per project. A CLI sign-in follows the member's role and stops working while their Secrets section is locked.

More in [docs/secrets.md](docs/secrets.md).

### Backups

Database dumps and, if turned on, file copies are encrypted with AES-256-GCM under `BACKUP_ENCRYPTION_KEY` before they leave the server. Backup actions ask the admin to confirm who they are again.

### Rate limits

- Better Auth limits sign-in and other auth endpoints per IP. The IP comes from the `X-Real-IP` header nginx sets, not the client-supplied `X-Forwarded-For`.
- Device sign-in codes are limited to 10 claims and 60 polls a minute per IP.
- The REST API (`/api/v1`) allows 1,200 requests a minute per member (`API_RATE_LIMIT_USER`) and 120 a minute per IP on public routes (`API_RATE_LIMIT_INSTANCE_IP`). Over the limit, it answers `429`.

### Audit log

- **Admin audit log** (Admin → Security → Audit log): approvals and rejections, role changes, storage and upload limits, two-factor resets, temporary passwords, vault deletes, WebDAV switches, app-password revokes, invite links, public-link revokes, database backup downloads, and every settings change with its old and new value (secret values only say "changed"). Rows keep the admin's and member's names after an account is deleted, and are kept a year.
- **Secrets audit log:** each project's Audit tab lists its changes, including SSH terminal sessions with host and duration.

### Network

- In production every port binds to `127.0.0.1`. Only nginx faces the internet, with HTTPS from Let's Encrypt.
- tusd's upload hooks are checked against `TUS_HOOK_SECRET`. Without it the hook endpoint accepts any caller, which is fine for local dev only.

See [docs/configuration.md](docs/configuration.md) for every security-related setting.
