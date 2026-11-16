# Nimbus CLI

The `nimbus` command talks to a Nimbus server from a terminal, a script or a CI job. It is the client for [Nimbus Secrets](secrets.md), plus one command for the container registry. It does not upload or download files: for that, use [WebDAV](webdav.md) or the [S3-compatible API](s3-api.md).

## The two packages

The repo has two implementations of the same command. Both follow one HTTP contract, `packages/cli/CONTRACT.md`, and give the same output and exit codes.

| | `packages/cli` | `packages/cli-go` |
|---|---|---|
| Language | TypeScript, one file (`src/cli.ts`) | Go, no dependencies outside the standard library |
| Needs | Node 20 or newer | Nothing: one static binary |
| Ships as | `nimbus-cli.tgz` (npm package) or `nimbus.mjs` (single file) | `nimbus-<os>-<arch>` for Linux, macOS and Windows, amd64 and arm64 |
| Extra commands | `registry build` | `version` |

Use the Node CLI on a machine that already has Node, or when you need `registry build`. Use the Go binary on servers, in containers and anywhere you don't want a runtime.

A third form, `packages/cli/nimbus.sh`, is a bash script for `run`, `export`, `agent`, `ssh cert`, `dynamic` and `kms` with a machine token. It needs `curl` and `bash`, plus `jq` or `python3`.

## Install

Your Nimbus server hands out every form, with no sign-in. Nothing comes from npm.

```bash
# Node CLI, as a package
npm install -g https://nimbus.example.com/api/v1/secrets/cli/download/nimbus-cli.tgz

# Node CLI, as one file
curl -fsSL -o nimbus.mjs https://nimbus.example.com/api/v1/secrets/cli/download/nimbus.mjs
node nimbus.mjs --help

# Go binary
curl -fsSL -o /usr/local/bin/nimbus \
  https://nimbus.example.com/api/v1/secrets/cli/download/nimbus-linux-amd64
chmod +x /usr/local/bin/nimbus
nimbus version

# Shell script
curl -fsSL https://nimbus.example.com/api/v1/secrets/cli/nimbus.sh -o nimbus.sh
```

The full install and sign-in steps are in [secrets.md](secrets.md#install). An admin can switch the CLI off for the whole server in Admin → Secrets.

## Commands

```text
nimbus <command>
  login [--server URL]   logout   whoami
  init [--project P --env E --path /]
  secrets [--plain]      list secrets (masked unless --plain)
  run [--env E] [--path /] -- <cmd...>
  export [--format dotenv|json|yaml]
  agent --out FILE [--on-change CMD] [--interval SECONDS] [--format F] [--once]
  ssh cert --project P --principal deploy[,root] [--ttl HOURS] [--key PUBKEY_FILE] [--out FILE]
  dynamic get NAME [--project P] [--ttl 1h] [--format env|json|url] [--prefix DB_]
  dynamic list | dynamic revoke LEASE_ID [--project P]
  kms encrypt|decrypt|sign|verify --key K [--project P] [--in FILE | --text S | stdin] [--context S]
      [--signature SIG (verify)] [--out FILE]; kms keys lists the project's keys
  share ["TEXT" | stdin] [--expires 1d] [--views 1] [--password[=PW]] [--label L]
  share list | share revoke ID
  webhooks [list] | webhooks add URL | webhooks remove ID | webhooks test ID   (--env E)
  push list | push run --env E | push remove --env E
  push set --env E --host H --user U --path FILE [--port 22] [--key FILE | --key-id ID]
      [--command CMD] [--auto]
  registry build DIR -t NAMESPACE/REPO[:TAG] [-t ...] [-f Dockerfile] [--platform linux/arm64]
      [--build-arg K=V] [--token NMCR...]          (Node CLI only)
  version                                          (Go binary only)
Common: --project P --env E --path /   Env: NIMBUS_TOKEN NIMBUS_SERVER
```

`nimbus --help` prints this list.

Every command except `registry build` and `version` belongs to Secrets. What each does, how to sign in, machine tokens, config files, environment variables and exit codes are all in [secrets.md](secrets.md):

| Commands | Section in secrets.md |
|---|---|
| `login`, `logout`, `whoami` | [Sign in](secrets.md#sign-in) |
| `init`, `secrets`, `run`, `export`, `agent` | [Commands](secrets.md#commands) |
| `ssh cert`, `dynamic`, `kms`, `share`, `webhooks`, `push` | [More commands](secrets.md#more-commands) |
| Environment variables and `.nimbus.json` | [Config files and environment variables](secrets.md#config-files-and-environment-variables) |
| Exit codes | [Exit codes](secrets.md#exit-codes) |

## registry build

Builds a container image on your Nimbus server from a local folder and pushes it to the Nimbus registry (see [registry.md](registry.md)). Node CLI only. The server's registry must be turned on, with builds enabled.

```bash
nimbus registry build . -t team/api:1.4 -t team/api:latest
```

- `DIR` must hold a `Dockerfile`, or the file named with `-f`.
- `-t NAMESPACE/REPO[:TAG]` names the image. Give it more than once for several tags; all must name the same repository. The tag defaults to `latest`.
- `--platform linux/arm64` builds for another platform. Repeat it, or separate with commas, for several.
- `--build-arg K=V` passes a build argument. Repeat it for more.
- `--token NMCR…` is a registry push token. Make one on the Registry page under Tokens. Or set `NIMBUS_REGISTRY_TOKEN`.
- The server address comes from `--server`, `NIMBUS_SERVER` or the saved `nimbus login`.

The CLI packs the folder as a tar.gz (honouring `.dockerignore`; `Dockerfile` and `.dockerignore` are always sent), uploads it (2 GB at most), and follows the build log until it ends. If the connection drops it picks up after the last line it saw. It exits 0 when the build succeeded, 1 when it failed, was cancelled or stopped (the reason is printed), 2 on wrong usage and 4 with no token or a rejected one. The registry pages in the app show the same command, with the repository filled in, for copying.

## version

```bash
nimbus version
```

Go binary only. Prints the version it was built with.

## Build from source

From the repo root:

```bash
npm run cli:build
```

This builds the Node CLI (`packages/cli/dist/cli.js` and `packages/cli/release/nimbus-cli.tgz`) and cross-compiles the Go binaries into `packages/cli-go/dist/` inside a `golang:1.23` container. Docker is needed; Go itself is not. The Docker image of Nimbus builds all of them, so a server started from it offers them without this step.

Each package on its own:

| In | Command | Does |
|---|---|---|
| `packages/cli` | `npm run build` | Compiles and packs `release/nimbus-cli.tgz` |
| `packages/cli` | `npm test` | Tests (`test/*.test.ts`) against a mock server |
| `packages/cli` | `npm run typecheck` | TypeScript check |
| `packages/cli-go` | `make` | Builds `dist/nimbus-<os>-<arch>[.exe]` for all six targets (needs Go) |
| `packages/cli-go` | `make test` | `go vet` and `go test` |

Set `VERSION` for `make` (`make VERSION=0.2.0`) to change what `nimbus version` prints. The default is `0.1.0`.

See also [install.md](install.md) and [configuration.md](configuration.md) for running the server itself.
