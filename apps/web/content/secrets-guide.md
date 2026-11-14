# Connect your apps to Nimbus Secrets

Secrets lives in the web app, but your apps, servers and pipelines live somewhere else. This guide shows every way to get a secret out of Nimbus and into a running program, and how to keep it safe on the way. The commands and API calls in it were checked against a running Nimbus server. The Docker, systemd, CI and Kubernetes files are templates: adapt the names and paths.

In the examples, `https://nimbus.example.com` is your Nimbus address, `web` is a project slug and `production` is an environment slug. A new project has the environments Development, Staging and Production, with the slugs `development`, `staging` and `production`. A slug is the lowercase name, with spaces turned into dashes (the project "docs verify" is `docs-verify`). A project's UUID works wherever a slug does.

## Overview

| You want to | Use | Credential |
|---|---|---|
| Run a program with its secrets as environment variables | `nimbus run -- cmd` | Machine token, or your own CLI sign-in |
| Write a `.env` or JSON file and keep it fresh | `nimbus agent` | Machine token |
| Fetch secrets once in a script or CI job | `nimbus export`, or `nimbus.sh` | Machine token |
| Read secrets from code with no extra tools | REST API | Machine token |
| Get notified when something changes | Webhooks | A shared signing secret |
| Have Nimbus copy the `.env` to a server | Server push | An SSH key on that server |
| Log in to servers without copying keys | SSH certificates | Your CLI sign-in |
| Get a database login that expires by itself | Dynamic secrets | Read-write machine token or your CLI sign-in |
| Encrypt or sign data without holding the key | KMS | Machine token with a KMS scope |
| Hand one value to a person outside Nimbus | Share link | None (the link is the credential) |

Two kinds of credential exist, and they behave differently:

- **Machine tokens** (`nms_…`) are for programs. They are made per project, see only what you chose, and never need the Secrets unlock.
- **Your CLI sign-in** (`nmu_…`) is made by `nimbus login`. It acts as you, follows your project role, and stops working with `423 locked` when your Secrets section is locked.

## CLI

The `nimbus` command comes in three forms. Pick one:

| Form | Install | Has |
|---|---|---|
| Node CLI | Node 20 or newer | Everything |
| Go binary | One static file, no runtime | Everything, plus `version` |
| `nimbus.sh` | `curl` and `bash`, plus `jq` or `python3` | `run`, `export`, `agent`, `ssh cert`, `dynamic`, `kms` with a token (no `login`, `share`, `webhooks`, `push`) |

### Install

Your server hands out every form. No sign-in is needed to download, and nothing comes from npm.

Node CLI, as a package (puts `nimbus` on your PATH):

```bash
npm install -g https://nimbus.example.com/api/v1/secrets/cli/download/nimbus-cli.tgz
nimbus --help
```

Or as one file, nothing installed:

```bash
curl -fsSL -o nimbus.mjs https://nimbus.example.com/api/v1/secrets/cli/download/nimbus.mjs
node nimbus.mjs whoami
```

Go binary: your server hands out builds for Linux, macOS and Windows (amd64 and arm64) at `/api/v1/secrets/cli/download/nimbus-<os>-<arch>`. The page in the app lists the ones it has. No sign-in is needed to download.

```bash
curl -fsSL -o /usr/local/bin/nimbus \
  https://nimbus.example.com/api/v1/secrets/cli/download/nimbus-linux-amd64
chmod +x /usr/local/bin/nimbus
nimbus version
```

<!-- app:downloads -->

The Docker image builds all of these. If you run Nimbus from a checkout and the list above is empty, build them once with `npm run cli:build` (Docker is needed for the Go builds; Go itself is not).

Shell script, nothing to install:

```bash
curl -fsSL https://nimbus.example.com/api/v1/secrets/cli/nimbus.sh \
  | NIMBUS_SERVER=https://nimbus.example.com NIMBUS_TOKEN=nms_… \
    bash -s -- run --project web --env production -- ./start.sh
```

An admin can switch the CLI off for the whole server (Admin, Secrets). Sign-ins and downloads then answer `403`.

### Sign in

On your own computer, sign in as yourself:

```bash
nimbus login --server https://nimbus.example.com
# Open https://nimbus.example.com/secrets/cli?code=ABCD-1234
# and confirm the code ABCD-1234
```

Open the link in a browser where you are signed in to Nimbus and press Approve. The code lasts about two minutes and works once. The terminal then stores a token in `~/.config/nimbus/config.json` (mode 600). `nimbus whoami` shows who you are and `nimbus logout` revokes the token. In the app, the devices signed in as you are listed here with a Sign out button each.

<!-- app:devices -->

On servers and in CI skip `login` and set `NIMBUS_TOKEN` to a [machine token](#machine-tokens).

### Pick a project and environment

Every command takes `--project`, `--env` and `--path` (a folder, default `/`). To avoid repeating them, write a `.nimbus.json` in your repository:

```bash
nimbus init --project web --env development
cat .nimbus.json
```

```json
{ "project": "web", "env": "development", "path": "/" }
```

It holds no secrets, so commit it. A machine token tied to one project and one environment needs none of this. All three forms read it, `nimbus.sh` included.

### Commands

```bash
# Run a program with the secrets as environment variables
nimbus run --env development -- npm start

# See the names (values are masked unless you add --plain)
nimbus secrets
nimbus secrets --plain

# Write them out: dotenv (default), json or yaml (nimbus.sh too)
nimbus export --env production --format dotenv > .env
nimbus export --env production --format json

# Keep a file up to date; run a command each time it changes
nimbus agent --env production --out /srv/app/.env --on-change "systemctl restart app"
nimbus agent --env production --out /srv/app/.env --once      # write once and exit
```

- `run` starts your command with the secrets added to its environment, forwards Ctrl-C and `SIGTERM` to it, and exits with its code (128 plus the signal number when it was killed).
- `export` and `agent` quote every value, so spaces, `#`, quotes and newlines survive any dotenv parser.
- `agent` checks every 30 seconds (`--interval SECONDS`, minimum 1) using `If-None-Match`, so a quiet check costs almost nothing. It writes to a temporary file in the same folder and renames it, with mode 600, so a reader never sees half a file. `--on-change` runs through `sh -c` with `NIMBUS_OUT` set to the file. A locked section or a network error is logged and retried; a bad token or wrong flags stop it.
- Secrets that point at another environment (`${production.KEY}`) follow it: when `production` changes, every environment whose values reference it (directly or through another environment) gets a new version too, so the agent, `ETag`, the watch call, automatic pushes and webhooks all notice.
- `nimbus.sh agent` works the same way (`--out`, `--on-change`, `--interval`, `--format`, `--once`).
- Values are returned with `${KEY}` references already expanded. When you are signed in as yourself, your personal overrides are applied too. Machine tokens have none.

### More commands

```bash
# SSH certificate from the project's CA (valid 1 to 8 hours)
nimbus ssh cert --project web --principal deploy --ttl 2
ssh -i ~/.ssh/nimbus_cert -o CertificateFile=~/.ssh/nimbus_cert-cert.pub deploy@HOST

# Short-lived database user
nimbus dynamic list --project web
nimbus dynamic get orders-db --project web --ttl 30m --format env
nimbus dynamic revoke LEASE_ID --project web

# KMS
nimbus kms keys --project web
echo -n "card 4242" | nimbus kms encrypt --key pay --project web
nimbus kms decrypt --key pay --project web --text 'nkms:v1:pay:1:…'

# One-time share link (your CLI sign-in; 1 hour to 30 days, 1 to 100 views)
nimbus share "the wifi password" --expires 1h --views 1
nimbus share --password < ./recovery-codes.txt     # makes up a password, prints it on stderr
nimbus share list
nimbus share revoke SHARE_ID

# Webhooks and server push (project admins)
nimbus webhooks --env production
nimbus webhooks add https://ci.example.com/hooks/nimbus --env production
nimbus webhooks test WEBHOOK_ID --env production
nimbus push list
nimbus push set --env production --host app1.example.com --user deploy --path /srv/app/.env \
  --key ~/.ssh/nimbus_push --command "systemctl restart app" --auto
nimbus push run --env production
```

`ssh cert`, `dynamic` and `kms` work the same in `nimbus.sh`. `share`, `webhooks` and `push` are in the Node CLI and the Go binary. Details for each are in [SSH](#ssh), [Dynamic secrets, KMS and share links](#dynamic-secrets-kms-and-share-links), [Webhooks](#webhooks) and [Server push over SSH](#server-push-over-ssh).

### Config files and environment variables

| Name | Meaning |
|---|---|
| `NIMBUS_TOKEN` | The token to use. Wins over the saved sign-in. |
| `NIMBUS_SERVER` | The server address. Wins over `.nimbus.json` and the saved sign-in. `--server` wins over this. |
| `NIMBUS_PROJECT` | Default project (after `--project`, before `.nimbus.json`). |
| `NIMBUS_ENV` | Default environment (same order). |
| `NIMBUS_CONFIG_DIR` | Where the sign-in is kept. Default `$XDG_CONFIG_HOME/nimbus`, then `~/.config/nimbus`. |

Files: `~/.config/nimbus/config.json` (server and token, written by `login`) and `.nimbus.json` in the working directory (project, env, path, optionally `server`).

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Error, including a failed `kms verify` |
| 2 | Wrong usage or a missing flag, server or format |
| 3 | Your Secrets section is locked. Unlock it in the web app. |
| 4 | Not signed in, or the token was rejected |
| 127 | `run` could not start the command |
| 128+n | `run` only: the command died from signal n |

## Machine tokens

A machine token lets one program read a project without a person signing in. Make one in the project: **Access**, **Machine tokens**, **New token**. You need to be a project admin.

| Setting | What it does |
|---|---|
| Name | Shown in the audit log as `token: <name>`. Use one name per program. |
| Environments | The environments it can reach. Pick as few as you can. |
| Folder | `/` is everything. `/app` is that folder and below. |
| Access | Read only, or Read and write. Read and write allows `POST /secrets` and dynamic credentials. |
| Expires | 7, 30, 90 or 365 days, or never. (The API accepts 1 to 3650 days.) |
| Allowed IPs | Up to 20 addresses or IPv4 ranges like `10.0.0.0/8`. Empty allows any address. |
| KMS operations | `kms:encrypt`, `kms:decrypt`, `kms:sign`, `kms:verify`. None by default. |

The token is shown once, right after you create it. Nimbus keeps only a hash, so a lost token cannot be recovered: revoke it and make another. The Machine tokens tab shows each token's prefix, scope, expiry and when and where it was last used. **Revoke** stops it at once.

Good habits:

- One token per app and environment, read only unless the app must write.
- Set an expiry and rotate before it. Put the token in your platform's secret store (GitHub secret, Kubernetes Secret, systemd credential), never in the repository.
- Set Allowed IPs for servers with fixed addresses. Behind a proxy, Nimbus reads the client address from `X-Forwarded-For`.
- A token cannot create SSH certificates, and cannot reach another project.

An admin can turn machine tokens off for the server. Existing tokens then answer `403`.

## REST API

Base: `https://nimbus.example.com/api/v1/secrets`. Bodies are JSON. Send the token on every call:

```bash
export NIMBUS_SERVER=https://nimbus.example.com
export NIMBUS_TOKEN=nms_…
alias nget='curl -sS -H "Authorization: Bearer $NIMBUS_TOKEN"'
```

### Who am I

```bash
nget $NIMBUS_SERVER/api/v1/secrets/whoami
```

```json
{ "type": "machine", "name": "ci", "server": "https://nimbus.example.com",
  "scope": { "project": "web", "env": "production", "path": "/", "access": "ro" } }
```

`env` appears when the token has exactly one environment. This call works while Secrets is locked.

### Projects and environments

```bash
nget $NIMBUS_SERVER/api/v1/secrets/projects
nget $NIMBUS_SERVER/api/v1/secrets/projects/web/envs
```

A machine token sees only its own project and the environments it may use.

### Read secrets

```bash
nget "$NIMBUS_SERVER/api/v1/secrets/secrets?project=web&env=production&path=/&expand=true"
```

```json
[ { "key": "DATABASE_URL", "value": "postgres://…", "type": "url", "comment": "" } ]
```

- `project` and `env` can be left out when the token has only one of each. `path` defaults to `/`.
- Only the secrets directly in `path` are returned, not those in subfolders. Ask for each folder you need.
- `expand=true` resolves `${KEY}` and `${env.folder.KEY}` references. Without it you get the stored text.
- `type` is `string`, `number`, `bool`, `url`, `json` or `pem`.
- Every successful read is written to the audit log with the token name and IP.

### ETag and 304

Every read carries `ETag: "42"` and `X-Secrets-Version: 42`. The number goes up whenever anything in that environment changes. Send it back to skip the download:

```bash
curl -i -H "Authorization: Bearer $NIMBUS_TOKEN" -H 'If-None-Match: "42"' \
  "$NIMBUS_SERVER/api/v1/secrets/secrets?project=web&env=production"
# HTTP/1.1 304 Not Modified
```

A `304` has no body and is not written to the audit log.

### Version and watch

```bash
# Cheap check, nothing secret leaves, not audited
nget "$NIMBUS_SERVER/api/v1/secrets/secrets/version?project=web&env=production"
# {"version":42,"etag":"\"42\""}

# Long poll: waits until the version is not 42, or 25 seconds pass (1 to 60)
nget "$NIMBUS_SERVER/api/v1/secrets/secrets/watch?project=web&env=production&version=42&timeout=25"
# {"version":43,"changed":true}   or   {"version":42,"changed":false}
```

When `changed` is true, read the secrets again. Loop: watch, read, repeat. Server-sent events are not used.

### Write secrets

Needs a read-write token (or a member who can edit):

```bash
curl -sS -X POST -H "Authorization: Bearer $NIMBUS_TOKEN" -H 'content-type: application/json' \
  -d '{"project":"web","env":"production","path":"/","set":{"FEATURE_X":"on"},"delete":["OLD_KEY"]}' \
  $NIMBUS_SERVER/api/v1/secrets/secrets
# {"created":["FEATURE_X"],"updated":[],"deleted":["OLD_KEY"]}
```

In an environment that needs approval nothing is written. You get `202 {"pending":true,"request":"<id>"}` and the change waits in **Change requests**.

### Other endpoints

| Call | Purpose | See |
|---|---|---|
| `GET /dynamic?project=` | List database connections | [Dynamic secrets](#dynamic-secrets-kms-and-share-links) |
| `POST /dynamic` | Issue a short-lived database user | same |
| `PATCH /dynamic`, `DELETE /dynamic` | Extend or revoke a lease | same |
| `GET /kms/keys?project=` | List KMS keys | same |
| `POST /kms/encrypt`, `decrypt`, `sign`, `verify` | Use a key | same |
| `POST /ssh/cert` | SSH certificate (your CLI sign-in only) | [SSH](#ssh) |
| `GET`, `POST`, `DELETE /shares` | List, make and revoke your share links (your CLI sign-in only) | [Share links](#share-links) |
| `GET`, `POST /projects/{p}/envs/{e}/webhooks` | List and add webhooks (admins) | [Webhooks](#webhooks) |
| `PATCH`, `DELETE /projects/{p}/envs/{e}/webhooks/{id}`, `POST …/{id}/test` | Change, remove, test one | same |
| `GET /projects/{p}/push` | Every server push in the project (admins) | [Server push](#server-push-over-ssh) |
| `GET`, `PUT`, `DELETE /projects/{p}/envs/{e}/push` | Show, set up, remove one (admins) | same |
| `POST /projects/{p}/envs/{e}/push` | Push now (admins, or a read-write machine token with that environment) | same |

### Errors

Every error looks like this:

```json
{ "error": { "code": "forbidden", "message": "This token can't use that environment." } }
```

| Status | code | Meaning |
|---|---|---|
| 400 | `bad_request` | A missing or wrong parameter, such as no environment |
| 401 | `unauthorized` | Missing, wrong, expired or revoked token |
| 403 | `forbidden` | Outside the token's environment or folder, read-only token, wrong role, IP not allowed, or tokens or the CLI turned off |
| 404 | `not_found` | No such project, environment or folder |
| 423 | `locked` | Your Secrets section is locked. The body adds `unlockUrl`. Only for your CLI sign-in; machine tokens are never locked. |
| 429 | `rate_limited` | Too many requests. Wait `Retry-After` seconds (60). |
| 5xx | `server_error` | Try again |

### Rate limits

A token may make 600 requests a minute from one address. Wrong tokens are limited to 30 a minute per address, so guessing is slow. Use `ETag` or the watch call instead of tight loops; `agent` checks every 30 seconds by default.

## Code snippets

There is no SDK. Plain HTTP is all you need. Every snippet reads `NIMBUS_SERVER`, `NIMBUS_TOKEN` and optionally `NIMBUS_PROJECT` and `NIMBUS_ENV`.

### Node.js (fetch, Node 18 or newer)

```js
// nimbus.mjs
const server = process.env.NIMBUS_SERVER;
const token = process.env.NIMBUS_TOKEN;

export async function getSecrets(path = "/") {
  const q = new URLSearchParams({ path, expand: "true" });
  if (process.env.NIMBUS_PROJECT) q.set("project", process.env.NIMBUS_PROJECT);
  if (process.env.NIMBUS_ENV) q.set("env", process.env.NIMBUS_ENV);
  const res = await fetch(`${server}/api/v1/secrets/secrets?${q}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    throw new Error(`Nimbus ${res.status}: ${error?.message ?? res.statusText}`);
  }
  return Object.fromEntries((await res.json()).map((s) => [s.key, s.value]));
}

// Load into process.env before the rest of the app starts
Object.assign(process.env, await getSecrets());
```

Use it first thing in your entry file: `import "./nimbus.mjs"`. Imports run in order, so put it before modules that read `process.env`.

### Python (requests)

```python
# nimbus.py
import os
import requests

def get_secrets(path="/"):
    params = {"path": path, "expand": "true"}
    for var, key in (("NIMBUS_PROJECT", "project"), ("NIMBUS_ENV", "env")):
        if os.environ.get(var):
            params[key] = os.environ[var]
    r = requests.get(
        f"{os.environ['NIMBUS_SERVER']}/api/v1/secrets/secrets",
        params=params,
        headers={"Authorization": f"Bearer {os.environ['NIMBUS_TOKEN']}"},
        timeout=10,
    )
    r.raise_for_status()
    return {s["key"]: s["value"] for s in r.json()}

# Load into the process environment at startup
os.environ.update(get_secrets())
```

With only the standard library:

```python
import json, os, urllib.request

req = urllib.request.Request(
    f"{os.environ['NIMBUS_SERVER']}/api/v1/secrets/secrets?expand=true",
    headers={"Authorization": f"Bearer {os.environ['NIMBUS_TOKEN']}"},
)
with urllib.request.urlopen(req, timeout=10) as r:
    os.environ.update({s["key"]: s["value"] for s in json.load(r)})
```

### Go

```go
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
)

type secret struct{ Key, Value string }

func loadSecrets() error {
	q := url.Values{"path": {"/"}, "expand": {"true"}}
	if p := os.Getenv("NIMBUS_PROJECT"); p != "" {
		q.Set("project", p)
	}
	if e := os.Getenv("NIMBUS_ENV"); e != "" {
		q.Set("env", e)
	}
	req, _ := http.NewRequest("GET", os.Getenv("NIMBUS_SERVER")+"/api/v1/secrets/secrets?"+q.Encode(), nil)
	req.Header.Set("Authorization", "Bearer "+os.Getenv("NIMBUS_TOKEN"))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("nimbus: %s", res.Status)
	}
	var list []struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	if err := json.NewDecoder(res.Body).Decode(&list); err != nil {
		return err
	}
	for _, s := range list {
		os.Setenv(s.Key, s.Value)
	}
	return nil
}

func main() {
	if err := loadSecrets(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("loaded")
}
```

### Shell, without the CLI

```bash
set -a
eval "$(curl -fsS -H "Authorization: Bearer $NIMBUS_TOKEN" \
  "$NIMBUS_SERVER/api/v1/secrets/secrets?expand=true" \
  | jq -r '.[] | "\(.key)=\(.value | @sh)"')"
set +a
exec ./start.sh
```

### Notes for all of them

- Secrets are fetched when the program starts. To pick up changes, restart the program, or call `watch` in a loop and reload.
- Never log the values, and never put them on a command line where `ps` shows them.
- On a fetch failure, fail startup with a clear message. Do not fall back to old values from the repository.

## Docker and Docker Compose

### nimbus run as the entrypoint

The Go binary is one static file, so it fits any image:

```dockerfile
FROM node:22-alpine
ADD https://nimbus.example.com/api/v1/secrets/cli/download/nimbus-linux-amd64 /usr/local/bin/nimbus
RUN chmod +x /usr/local/bin/nimbus
WORKDIR /app
COPY . .
ENTRYPOINT ["nimbus", "run", "--"]
CMD ["node", "server.js"]
```

Pass the token at run time, not in the image:

```yaml
# docker-compose.yml
services:
  app:
    build: .
    environment:
      NIMBUS_SERVER: https://nimbus.example.com
      NIMBUS_TOKEN: ${NIMBUS_TOKEN}      # from your shell or a .env next to this file
      NIMBUS_PROJECT: web
      NIMBUS_ENV: production
```

`nimbus run` forwards `SIGTERM`, so `docker stop` works. The values exist only in that process's environment. Use the `arm64` build on ARM hosts. On an image that already has Node, `npm install -g https://nimbus.example.com/api/v1/secrets/cli/download/nimbus-cli.tgz` works too, and `nimbus.sh` needs only `bash`, `curl` and `jq` (`apk add bash curl jq`).

### A shared .env written by the agent

When the app reads a file (or several containers share one), run the agent as its own service writing into a shared volume. The app reads the file at start-up, so start it after the agent has written once:

```yaml
services:
  secrets:
    build: .                      # the image from above, so it has `nimbus`
    entrypoint: ["nimbus", "agent", "--out", "/nimbus/app.env", "--interval", "30"]
    environment:
      NIMBUS_SERVER: https://nimbus.example.com
      NIMBUS_TOKEN: ${NIMBUS_TOKEN}
      NIMBUS_PROJECT: web
      NIMBUS_ENV: production
    volumes: [envfile:/nimbus]
    healthcheck:
      test: ["CMD", "test", "-s", "/nimbus/app.env"]
      interval: 5s
  app:
    image: my-app
    command: ["sh", "-c", "set -a; . /nimbus/app.env; exec node server.js"]
    depends_on:
      secrets: { condition: service_healthy }
    volumes: [envfile:/nimbus:ro]
volumes:
  envfile:
```

A container does not notice that the file changed. To restart it on change, run the agent on the Docker host instead, where the hook can call Compose, and use `env_file` in the compose file:

```bash
nimbus agent --project web --env production --out ./app.env \
  --on-change "docker compose up -d --force-recreate app"
```

```yaml
services:
  app:
    image: my-app
    env_file: ./app.env
```

## Server sync

### The agent as a systemd service

Install the Go binary and keep a file fresh. Save a token in a root-only file first:

```bash
sudo install -m 0755 nimbus-linux-amd64 /usr/local/bin/nimbus
sudo install -d -m 0700 /etc/nimbus
printf 'NIMBUS_TOKEN=nms_…\nNIMBUS_SERVER=https://nimbus.example.com\nNIMBUS_PROJECT=web\nNIMBUS_ENV=production\n' \
  | sudo tee /etc/nimbus/agent.env >/dev/null
sudo chmod 600 /etc/nimbus/agent.env
```

```ini
# /etc/systemd/system/nimbus-agent.service
[Unit]
Description=Nimbus Secrets agent
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=/etc/nimbus/agent.env
ExecStart=/usr/local/bin/nimbus agent --out /etc/myapp/app.env --on-change "systemctl restart myapp"
Restart=always
RestartSec=10
# The agent writes next to its output file, so that folder must be writable
ReadWritePaths=/etc/myapp
ProtectSystem=strict
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nimbus-agent
journalctl -u nimbus-agent -f      # shows "nimbus: wrote /etc/myapp/app.env" on each change
```

Then point your app's unit at the file with `EnvironmentFile=/etc/myapp/app.env`. The agent writes the file mode 600. The first run fails if the token is bad, and keeps retrying when the server is unreachable or locked.

### Server push over SSH

If you would rather not install anything on the server, let Nimbus copy the file. In the project: **Access**, **Server push**. Pick the environment and fill in host, port, SSH user and the file path on the server. Choose a stored SSH key (from the project's SSH tab) or paste a private key without a passphrase. Optionally add a command to run afterwards, such as `systemctl restart myapp`.

Nimbus writes the `.env` to a temporary file with mode 600, renames it into place so readers never see half a file, and then runs your command. It pushes when you press Push and again whenever a secret in that environment changes, if you tick the automatic option. The first host key it sees is remembered and checked on later pushes. Use a key that can only write that one file. The last result is shown on the tab. Nothing needs to reach Nimbus from the server, but Nimbus must reach the server's SSH port, which needs the worker to be running.

The same from the command line, as a project admin (`--key` reads a private key file; `--key-id` picks a stored one):

```bash
nimbus push set --project web --env production --host app1.example.com --user deploy \
  --path /srv/app/.env --key-id SSH_KEY_ID --command "systemctl restart app" --auto
nimbus push list --project web
nimbus push run --project web --env production
```

A deploy job can push with a **read-write machine token** that includes the environment: `POST /api/v1/secrets/projects/web/envs/production/push` (or `nimbus push run`). That is the only push call a machine token may make: it runs the stored target and cannot read or change it.

## CI/CD

Store a read-only machine token as a CI secret named `NIMBUS_TOKEN`. Scope it to the environment the job needs and add the CI provider's addresses to Allowed IPs only if they are fixed.

### GitHub Actions

```yaml
name: deploy
on: { push: { branches: [main] } }
jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      NIMBUS_SERVER: https://nimbus.example.com
      NIMBUS_TOKEN: ${{ secrets.NIMBUS_TOKEN }}
      NIMBUS_PROJECT: web
      NIMBUS_ENV: production
    steps:
      - uses: actions/checkout@v4

      # Option 1: run one step with the secrets as environment variables
      - name: Build and deploy
        run: |
          curl -fsSL "$NIMBUS_SERVER/api/v1/secrets/cli/nimbus.sh" \
            | bash -s -- run -- ./deploy.sh

      # Option 2: the Go binary, then any command
      - name: Install nimbus
        run: |
          curl -fsSL -o nimbus "$NIMBUS_SERVER/api/v1/secrets/cli/download/nimbus-linux-amd64"
          chmod +x nimbus && sudo mv nimbus /usr/local/bin/
      - run: nimbus run -- ./migrate.sh
```

Values fetched this way are not hidden from the job log by GitHub. Do not `echo` them. To mask one that later steps might print, add `echo "::add-mask::$VALUE"` before using it.

### GitLab CI

```yaml
deploy:
  image: alpine:3.20
  variables:
    NIMBUS_SERVER: https://nimbus.example.com
    NIMBUS_PROJECT: web
    NIMBUS_ENV: production
  before_script:
    - apk add --no-cache bash curl jq
  script:
    # NIMBUS_TOKEN is a masked, protected CI/CD variable
    - curl -fsSL "$NIMBUS_SERVER/api/v1/secrets/cli/nimbus.sh" | bash -s -- run -- ./deploy.sh
```

With Node CLI from a registry: `npx @nimbus/cli run --env production -- npm run deploy`.

If the job answers `403 forbidden`, check the token's environment, folder and Allowed IPs. `401` means expired or revoked.

## Kubernetes

There is no operator. This pattern uses what exists: an init container writes the secrets to a shared in-memory volume before the app starts, and an optional sidecar keeps the file fresh.

Build a tiny image that holds the `nimbus` binary:

```dockerfile
FROM alpine:3.20
ADD https://nimbus.example.com/api/v1/secrets/cli/download/nimbus-linux-amd64 /usr/local/bin/nimbus
RUN chmod +x /usr/local/bin/nimbus
USER 65534
ENTRYPOINT ["nimbus"]
```

Put the token in a Kubernetes Secret:

```bash
kubectl create secret generic nimbus-token --from-literal=NIMBUS_TOKEN=nms_…
```

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: web }
spec:
  selector: { matchLabels: { app: web } }
  template:
    metadata: { labels: { app: web } }
    spec:
      volumes:
        - name: nimbus
          emptyDir: { medium: Memory }
      initContainers:
        - name: nimbus-init
          image: registry.example.com/nimbus-cli:latest
          args: ["agent", "--once", "--out", "/nimbus/app.env"]
          envFrom: [{ secretRef: { name: nimbus-token } }]
          env:
            - { name: NIMBUS_SERVER, value: "https://nimbus.example.com" }
            - { name: NIMBUS_PROJECT, value: web }
            - { name: NIMBUS_ENV, value: production }
          volumeMounts: [{ name: nimbus, mountPath: /nimbus }]
      containers:
        - name: app
          image: registry.example.com/web:latest
          # Source the file, then start the app
          command: ["sh", "-c", "set -a; . /nimbus/app.env; exec node server.js"]
          volumeMounts: [{ name: nimbus, mountPath: /nimbus, readOnly: true }]
        - name: nimbus-sidecar          # optional: keeps the file fresh
          image: registry.example.com/nimbus-cli:latest
          args: ["agent", "--out", "/nimbus/app.env"]
          envFrom: [{ secretRef: { name: nimbus-token } }]
          env:
            - { name: NIMBUS_SERVER, value: "https://nimbus.example.com" }
            - { name: NIMBUS_PROJECT, value: web }
            - { name: NIMBUS_ENV, value: production }
          volumeMounts: [{ name: nimbus, mountPath: /nimbus }]
```

Notes:

- `agent --once` exits after the first write, so the init container finishes and the app only starts once the file exists. If the fetch fails, the pod stays in `Init` and retries.
- The app reads the file only at start. The sidecar updates the file, but the process does not notice. Either re-read the file in your app, or roll the pods when a [webhook](#webhooks) arrives (`kubectl rollout restart deployment/web`).
- `medium: Memory` keeps the file off the node's disk. The file is mode 600 and owned by the user that runs the agent, so run the app container as that same user, or set `securityContext.fsGroup`.
- The agent's temporary file lives next to its output, so the volume must be writable for the agent.

## Webhooks

A webhook calls your URL when a secret changes. It names the keys that changed, never the values, so use it as a signal to fetch again or to roll a deployment.

Make one in the project: **Access**, **Webhooks**. Pick the environment, enter an `https://` URL and create it. The signing secret (`whsec_…`) is shown once. Press Test to send a `test` event. The tab keeps a delivery log.

Project admins can do the same from the command line, or with the [API](#other-endpoints) and their CLI sign-in (machine tokens can't manage webhooks):

```bash
nimbus webhooks add https://ci.example.com/hooks/nimbus --project web --env production
# 3b0c…
# Signing secret (shown once): whsec_…
nimbus webhooks list --project web --env production
nimbus webhooks test 3b0c… --project web --env production    # exits 1 if it failed
nimbus webhooks remove 3b0c… --project web --env production
```

Nimbus sends a `POST` with these headers:

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `User-Agent` | `Nimbus-Secrets` |
| `X-Nimbus-Event` | `secrets.changed` or `test` |
| `X-Nimbus-Delivery` | A unique id for this delivery |
| `X-Nimbus-Signature` | `sha256=` followed by the hex HMAC-SHA256 of the raw body, keyed with your `whsec_…` secret |

Payload:

```json
{
  "event": "secrets.changed",
  "project": { "id": "6f1d…", "slug": "web", "name": "Web" },
  "env": { "slug": "production", "name": "Production" },
  "keys": ["DATABASE_URL", "STRIPE_KEY"],
  "at": "2026-11-14T10:00:00.000Z"
}
```

`keys` is sorted and capped at 200 names. When an environment changed only because one it references did (`${production.DB_URL}` in staging, say), its webhooks still fire, with `keys: []`. Answer with any 2xx within 10 seconds. Redirects are not followed. A failed delivery is retried by the worker queue up to 8 times with growing waits (30 seconds, doubling).

Always verify the signature against the raw body, before parsing it.

### Verify in Node.js

```js
import { createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";

const SECRET = process.env.NIMBUS_WEBHOOK_SECRET; // whsec_…

http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const want = "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
    const got = String(req.headers["x-nimbus-signature"] ?? "");
    const ok = got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
    if (!ok) return res.writeHead(401).end();
    const event = JSON.parse(body);
    console.log(event.event, event.env.slug, event.keys);
    res.writeHead(204).end();
  });
}).listen(8080);
```

### Verify in Python

```python
import hashlib, hmac, json, os
from http.server import BaseHTTPRequestHandler, HTTPServer

SECRET = os.environ["NIMBUS_WEBHOOK_SECRET"].encode()  # whsec_…

class Hook(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("content-length", 0)))
        want = "sha256=" + hmac.new(SECRET, body, hashlib.sha256).hexdigest()
        got = self.headers.get("x-nimbus-signature", "")
        if not hmac.compare_digest(got, want):
            self.send_response(401); self.end_headers(); return
        event = json.loads(body)
        print(event["event"], event["env"]["slug"], event["keys"])
        self.send_response(204); self.end_headers()

HTTPServer(("", 8080), Hook).serve_forever()
```

## SSH

Instead of copying public keys to every server, let the project's SSH certificate authority sign short-lived certificates. Servers trust the CA once. People then ask for a certificate that lasts 1 to 8 hours.

### Set up the CA and trust it on servers

1. In the project open **SSH**, then **SSH CA**, and press **Set up the SSH CA** (project admins).
2. On each server run the script shown under "Set up a server to trust it" as root. It saves the CA public key as `/etc/ssh/nimbus_ca.pub`, adds `TrustedUserCAKeys /etc/ssh/nimbus_ca.pub` to `sshd_config` and reloads sshd.
3. Optional: to limit who may log in as which account, add `AuthorizedPrincipalsFile /etc/ssh/principals/%u` to `sshd_config` and list the allowed principals, one per line, in `/etc/ssh/principals/<account>`.

After you rotate the CA, servers need the new public key.

### Get a certificate

Developers and project admins can ask for a certificate. Viewers and members limited to some environments cannot.

From the command line:

```bash
nimbus ssh cert --project web --principal deploy --ttl 2
# Certificate valid until 2026-11-14T12:00:00.000Z: /home/you/.ssh/nimbus_cert-cert.pub
# ssh -i /home/you/.ssh/nimbus_cert -o CertificateFile=/home/you/.ssh/nimbus_cert-cert.pub deploy@HOST
```

Without `--key`, Nimbus makes a new ed25519 key pair, returns the private key once and the CLI saves it with mode 600. To sign a key you already have, pass its public half and the certificate is written next to it:

```bash
nimbus ssh cert --project web --principal deploy,root --ttl 8 --key ~/.ssh/id_ed25519.pub
ssh -i ~/.ssh/id_ed25519 -o CertificateFile=~/.ssh/id_ed25519-cert.pub deploy@HOST
```

`--principal` takes 1 to 10 comma-separated account names. `--out FILE` sets where a new key goes. This works with your own sign-in only. Machine tokens get `403`.

In the web app press **Issue certificate** on the SSH CA tab. The tab lists every certificate issued, with its serial number, key id (your email), principals and expiry.

### Browser terminal and saved hosts

On the **SSH** tab, hosts store a name, address, user and a key or a certificate from the CA. **Open terminal** starts a shell in the browser (xterm.js). It needs an unlocked Secrets session and the Developer or Admin role. Start, end, host and duration are audited, and the host key seen first is pinned. **Export** gives a `~/.ssh/config` block. Self-hosters: the terminal needs the `ssh-terminal` service from `docker-compose.yml` and the `/ssh-ws` block in nginx (see the README).

## Certificates

Use **Certificates** in the project to store certificates, run a private CA and order public ones.

### Private CA

Create a root CA, then an intermediate under it, and add templates that say which names may be signed and for how long. Issue server (TLS) and client (mTLS) certificates from a template, or sign your own request (CSR) so the private key never leaves your machine.

To make machines trust it, download the **CA chain** from the CA's card and install it:

```bash
# Debian and Ubuntu
sudo cp nimbus-ca-chain.pem /usr/local/share/ca-certificates/nimbus-ca.crt
sudo update-ca-certificates
# RHEL and Fedora
sudo cp nimbus-ca-chain.pem /etc/pki/ca-trust/source/anchors/ && sudo update-ca-trust
# One program only
NODE_EXTRA_CA_CERTS=/path/nimbus-ca-chain.pem node app.js
curl --cacert nimbus-ca-chain.pem https://internal.example
```

Certificates from an intermediate CA carry a **CRL address**: `https://nimbus.example.com/pki/crl/<ca id>.crl` (DER) or `.pem`. It is public, so clients can fetch it without signing in. Each CA's card shows it with a Copy button. Clients may cache it for up to five minutes. Use the address as the CRL in your proxy or client configuration.

### Public certificates (ACME)

The ACME part orders free certificates from Let's Encrypt (production or staging) or another ACME server. You choose how to prove ownership of the name, and the worker renews 30 days before expiry. A finished certificate is stored like any other, so it can be downloaded as a certificate, full chain or chain, and loaded by your web server. The worker must be running for orders and renewals.

## Dynamic secrets, KMS and share links

### Dynamic database credentials and rotation

Instead of one database password everyone shares, Nimbus creates a database user that exists for minutes or hours.

1. A project admin adds a connection (PostgreSQL, MySQL or MariaDB, Redis ACL or MongoDB) under **Dynamic secrets**, with an admin login Nimbus uses to create users and a role template.
2. A Developer or Admin, or a read-write machine token, asks for credentials.

```bash
# CLI
nimbus dynamic get orders-db --project web --ttl 30m
# DB_HOST="db"  DB_PORT="5432"  DB_NAME="app"  DB_USER="nim_1a2b…"  DB_PASSWORD="…"
# DB_URL="postgres://…"  DB_LEASE_ID="…"  DB_EXPIRES_AT="…"      (the lease id and end time also go to stderr)
eval "$(nimbus dynamic get orders-db --project web --ttl 30m)"
nimbus dynamic get orders-db --format url        # just the connection URL
nimbus dynamic revoke LEASE_ID --project web

# REST
curl -sS -X POST -H "Authorization: Bearer $NIMBUS_TOKEN" -H 'content-type: application/json' \
  -d '{"project":"web","connection":"orders-db","ttl":"30m"}' \
  $NIMBUS_SERVER/api/v1/secrets/dynamic
```

`ttl` is seconds or `90`, `30m`, `2h`, `7d`. It is cut to the connection's maximum, so read `ttl` and `expiresAt` in the answer. Nimbus removes the user at the end of the lease, within about a minute. `PATCH /dynamic` with `{"lease": "<id>", "ttl": "1h"}` moves the end to now plus `ttl`, never past the maximum counted from when the lease was issued, and answers `409` for a `ttl` that would not make it last longer. Every issue, renewal and revoke is audited with the token name and IP.

**Rotation** is for a database password that must live in a normal secret. In **Dynamic secrets, Rotation**, attach a secret to a database user, then rotate on an interval or press Rotate now. The new password becomes a new secret version (action "rotate" in the history). It skips change requests, and project admins are told. If rotation fails the secret keeps its old value and admins are told. Programs that read the secret at start-up need to restart or use the watch call to see the new value.

### KMS

Keep a key in Nimbus and send it data to encrypt or sign, so your apps never hold the key. A project admin makes named keys in the **KMS** tab: `aes` (AES-256-GCM) for encrypt and decrypt, `ed25519` and `p256` for sign and verify. Rotate a key and new work uses the new version, while old ciphertext still opens. Binary data travels as base64. Results are text such as `nkms:v1:pay:2:…`.

The token needs the matching scope (`kms:encrypt` and so on), set when you create it.

```bash
# CLI
echo -n "4242 4242 4242 4242" | nimbus kms encrypt --key pay --project web
# nkms:v1:pay:2:AbC…
nimbus kms decrypt --key pay --project web --text 'nkms:v1:pay:2:AbC…' --context order-7
nimbus kms sign --key release --in app.tar.gz
nimbus kms verify --key release --in app.tar.gz --signature 'nkms:v1:release:1:…'   # exit 1 if invalid

# REST
curl -sS -X POST -H "Authorization: Bearer $NIMBUS_TOKEN" -H 'content-type: application/json' \
  -d "{\"project\":\"web\",\"key\":\"pay\",\"data\":\"$(printf 'hello' | base64)\",\"context\":\"order-7\"}" \
  $NIMBUS_SERVER/api/v1/secrets/kms/encrypt
# {"ciphertext":"nkms:v1:pay:2:…","version":2}
```

`context` is bound into the encryption, so decryption needs the same text. Data can be up to 1 MB. `404` means no such key, `409` the key is disabled or the wrong kind, and `400` data that cannot be opened. Calls are audited with sizes, never the data.

### Share links

To give one value to a person without an account, use a share link. Open a secret's menu in the web app and choose Share, or start from **Share links** in a project. Choose when it expires (1 hour to 30 days), how many times it can be opened (1 to 10) and an optional password. The link opens once and then burns. Nimbus keeps only the sealed text and a hash of the link, and revoking a link kills it at once. An admin can turn them off.

From the command line, signed in as yourself (machine tokens can't make links, since a link belongs to a person):

```bash
nimbus share "s3cret value" --expires 2h --views 1
# https://nimbus.example.com/s/ns_…
echo -n "s3cret value" | nimbus share --password --expires 7d   # password printed on stderr
nimbus share --password=correct-horse "s3cret value"
nimbus share list
nimbus share revoke SHARE_ID
```

`--expires` takes `90m`, `12h` or `7d` (default 1 day) and `--views` 1 to 100. Over the API: `POST /api/v1/secrets/shares` with `{"text":"…","minutes":120,"maxViews":1,"password":"…"}` answers `{"token":"ns_…","url":"https://…/s/ns_…"}`; `GET` lists your links and `DELETE ?id=` revokes one. Every one is audited.

## Security notes

- **Unlock versus tokens.** Your Secrets section locks after a period without activity. Your CLI sign-in follows that lock and answers `423` while locked, and polling does not keep it open. Machine tokens are never locked, which is why they are scoped, can expire and can be limited by IP.
- **Least access.** One token per program, read only, the fewest environments and the narrowest folder. Revoke tokens that are not used; the tab shows when each was last used.
- **What is audited.** Every secret read through the API or CLI (not `304` or the version check), every write, token creation, dynamic credential, KMS call, SSH certificate, share link, webhook and server push call, with the token name and IP. Values are never written to the audit log.
- **Never log values.** Do not print secrets in CI logs, application logs or error reports. Do not pass them as command-line arguments. Prefer environment variables or a file with mode 600.
- **Leaks.** Nimbus can scan for secrets that have been exposed (the Leaks page in the top bar). If a token or secret leaks, revoke the token, rotate the value, then check the audit log.
- **Transport.** Use `https://` for your server. A token sent over plain HTTP can be read by anyone on the path.
- **The `.env` file** the agent writes is mode 600. Keep it out of images, backups and version control.
