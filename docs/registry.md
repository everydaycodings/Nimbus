# Container registry

Nimbus has an optional private Docker registry (OCI) for you and your team. `docker push` and `docker pull` work as with any registry, and the image layers are kept in your Nimbus storage. Helm charts, oras artifacts, cosign signatures and buildx caches work too.

In the examples, `registry.example.com` is the registry address, `acme` is a registry name and `app` is a repository.

## Overview

| Item | Value |
|---|---|
| Address | `https://<REGISTRY_DOMAIN>`, for example `registry.example.com` |
| Pulls on the main domain | `https://<DOMAIN>/v2/` |
| Image names | `registry.example.com/<registry name>/<repository>:<tag>` |
| Username | Your registry name (it is not checked) |
| Password | A registry token (`NMCR…`) |
| Without a token | Pull public repositories only |

## Turn it on (admins)

1. Run `setup.sh` and answer yes to "Turn on the container registry?". It adds the `registry` profile, asks for a subdomain (default `registry.<DOMAIN>`) and saves it as `REGISTRY_DOMAIN` in `.env`.
2. Add a DNS A record for that subdomain pointing at this server.
3. Run `sudo production_script/setup-nginx.sh`. It serves the subdomain over HTTPS.

The `registry` service listens on port 3408. See [install.md](install.md) and [configuration.md](configuration.md) for the rest of the setup.

If the domain is on Cloudflare, make the registry record **DNS only** (grey cloud). Cloudflare's proxy caps a request at 100 MB, and large image layers go over that.

Setup then asks about two more optional parts: image scanning and image builds. Both are described below.

### Admin settings

**Admin → System → Registry** has:

| Setting | What it does |
|---|---|
| Allow the container registry | Turns it on or off for everyone |
| Allow public repositories | Off: no repository can be made public |
| Registry downloads straight from storage | Pulls fetch layers from storage directly |
| Registry requests per second | Limit per token |
| Registry bandwidth per token | Download speed cap |
| Who can create registry orgs | |
| Registry storage per name | Storage limit per member and per org, separate from Drive quota |
| Registry mirrors | Pull-through mirrors |
| Registry garbage collection | Run it now, or as a dry run |
| Registry repositories, Registry tokens | Every repository and token on the server |
| Build limits | When a build waits or is stopped (see [Builds](#builds)) |

## Get started

1. Open **Container registry** and claim a registry name. It is 2 to 39 characters: lowercase letters, numbers and single hyphens. `mirror`, `v2`, `token`, `library` and `admin` are reserved.
2. Open **Access** and make a token.
3. Sign in and push:

```sh
docker login registry.example.com -u acme     # paste the token as the password
docker tag app:1.0 registry.example.com/acme/app:1.0
docker push registry.example.com/acme/app:1.0
docker pull registry.example.com/acme/app:1.0
```

Pushing to a repository that doesn't exist yet makes it.

## Tokens

Make tokens under **Access**.

| Access | What it can do |
|---|---|
| Pull | Download images |
| Push | Download and upload images, but not delete them |
| Push + Delete | Download, upload and delete tags and images |

- A token can reach all your repositories, or only the ones you pick.
- It expires after 30, 90 or 365 days, or never.
- The token is shown once. Copy it right away.
- Each member can have up to 50 tokens.
- After 20 wrong tokens from one IP address, that address is blocked for 15 minutes.

You can save a new token straight to Nimbus Secrets, and Secrets can hand out short-lived pull tokens as a dynamic secret. See [secrets.md](secrets.md).

## Repositories and access

Repositories are private until you make them public. An admin can turn public repositories off for the whole server.

Access can be shared three ways:

| Who | Roles |
|---|---|
| Org members | Owner, Write, Read |
| Teams in an org | Read, Write, Admin, per repository |
| Collaborators on one repository | Read, Write, Admin |

Each repository's **Settings** has:

- Cleanup rules, with a dry-run preview of what they would delete.
- Immutable tags, which can't be overwritten or deleted.
- Rename. The old name redirects to the new one for 30 days.
- Archive. An archived repository can be pulled but not changed until you unarchive it.
- The server's cosign public key, for checking signed builds.

Deleted tags wait in the registry's **Trash** for 7 days, then go for good.

Each repository also has an activity log (pushes, deletes and access changes, kept for 90 days) and webhooks. A webhook sends a signed JSON POST on push, delete and scan, keeps a delivery log and has a Test button.

## Pull-through mirrors

An admin sets up mirrors of other registries in **Admin → System → Registry**. Anyone signed in can pull through a mirror, and nobody can push to it:

```sh
docker pull registry.example.com/mirror/dockerhub/library/nginx
```

Cached tags refresh from the upstream after 5 minutes. If the upstream is down, the cache answers. A cached image is removed after a set number of days without a pull.

## Image scanning

Image scanning needs the `scan` profile (about 1 GB). Setup asks about it after the registry.

- Trivy scans each pushed image and rescans every day.
- Each repository shows its vulnerabilities and packages (from the image's SBOM or from the scan), a compare view between two tags and base-image advice.
- Image policies, set per registry name on the **Access** tab, can require no critical findings, signed images or no blocked licenses. They can refuse pulls of images that fail.

## Builds

Image builds need the `build` profile and 2 GB or more of free RAM. Setup asks for the CPU and RAM builds may use (`BUILD_CPUS`, `BUILD_MEM`) and the size of the layer cache in GB (`BUILD_CACHE_GB`). Older cache is removed.

Builds run in a rootless BuildKit container under those limits. A build waits while the server is busy, and is stopped if the server runs low on memory or disk, so it can't take Nimbus down. The thresholds are on **Admin → System → Registry**. **Admin → System → Health** shows the server's memory, load and disk.

Built images are scanned, signed with the server's cosign key and get an SBOM and provenance attached.

### Build from a git repository

Open a repository's **Builds** tab and connect a source:

- **GitHub**: needs a fine-grained token with Contents (read), Webhooks (read and write) and Commit statuses (read and write). Nimbus adds the push webhook and posts commit statuses.
- **Any git URL**: over `https://` with a token, or over SSH with a key. After connecting, Nimbus shows a payload URL and a secret once. Add them as a webhook for push and tag events in your git server.

| Git server | Where to add the webhook |
|---|---|
| Gitea | Settings, Webhooks, Add webhook, Gitea. Content type JSON, paste the secret, trigger on push events. |
| GitLab | Settings, Webhooks. Paste the URL, and the secret as the Secret token. Tick Push events and Tag push events. |

Forgejo, Gogs and other git servers work too. The secret can be sent as an `X-Nimbus-Token` header, an `X-Gitlab-Token` header, a `?token=` parameter or an HMAC signature header (`X-Gitea-Signature`, `X-Gogs-Signature`, `X-Forgejo-Signature`).

### Rules

Rules say which pushes build and what tags the image gets. Ready-made rules:

| Rule | Source | Tags |
|---|---|---|
| Branch main → latest + sha | Branch `main` | `latest`, `{sha}` |
| Every branch → branch name | Any branch | `{branch}` |
| Semver tags → version, major.minor, major | Tags like `v1.2.3` | `{version}`, `{major}.{minor}`, `{major}` |

Tag placeholders: `{branch}`, `{tag}`, `{sha}`, `{version}`, `{major}`, `{minor}` and `{patch}`. A tag whose placeholder has no value is skipped (no `{branch}` on a tag build, no `{version}` on a tag that isn't semver). Prerelease tags only get `{version}`.

Rules can also set the Dockerfile path, build arguments and build secrets. Build secrets point at values in Nimbus Secrets ([secrets.md](secrets.md)). They are never stored in the rule, and the builder gets them only while it runs.

### Saved git connections

A git token or SSH key is saved once, encrypted, under **Access**, and reused by any number of repositories.

| Kind | Fits |
|---|---|
| GitHub | GitHub sources |
| GitLab, Gitea, Git token | Git sources with an `https://` address |
| SSH key | Git sources with an SSH address |

- Personal connections belong to your registry name. Org connections belong to the org: org owners manage them, and the org's repository admins can pick them without seeing the secret.
- You can replace a connection's token, and every repository using it picks up the new one.
- Nimbus warns 7 days before a connection's token expires.

### Build from a folder

The `nimbus` CLI (see [secrets.md](secrets.md#cli) for install) uploads a folder and builds it on the server, following the log:

```sh
export NIMBUS_SERVER=https://nimbus.example.com
export NIMBUS_REGISTRY_TOKEN=NMCR...                 # a Push token
nimbus registry build . -t acme/app:1.0
nimbus registry build . -t acme/app:1.0 -t acme/app:latest -f docker/Dockerfile \
  --platform linux/arm64 --build-arg VERSION=1.0
```

`--token NMCR...` and `--server URL` can be passed instead of the variables. `.dockerignore` is honoured.

### Build host notes

On Ubuntu 23.10 and newer, user namespaces are restricted, and rootless BuildKit needs them. Setup installs a small AppArmor profile that allows them for the BuildKit container only ([docker/buildkit/apparmor-nimbus-buildkit](../docker/buildkit/apparmor-nimbus-buildkit)) and sets `BUILDKIT_APPARMOR=nimbus-buildkit` in `.env`.

Building for another architecture (arm64 on an x86 server) needs QEMU:

```sh
docker run --privileged --rm tonistiigi/binfmt --install arm64
```

## Status badge

Each repository's Builds tab has a badge for a README:

```markdown
![build](https://nimbus.example.com/api/registry/badge/acme/app.svg)
```

| Parameter | Effect |
|---|---|
| `tag=latest` | Status of the last build for that tag |
| `show=size` | Image size of the tag (default `latest`) instead of the build status |
| `token=…` | Needed for a private repository |

The badge shows `passing`, `failing`, `stopped` or `none`. A private repository's badge URL carries a secret token. Without the right token it shows `none`, the same as a repository that doesn't exist. Repository admins can make a new token, which stops the old URL.

## Storage and cleanup

- Layers are stored once, however many repositories use them.
- Garbage collection runs every day, online, with no read-only window. It removes untagged manifests nothing needs, then layers nothing uses. Anything newer than 24 hours is kept, so a push in progress is safe. An admin can run it now, or as a dry run, from **Admin → System → Registry**.
- Unfinished uploads are cleaned up by the worker.
- Storage limits per member and per org are on **Admin → System → Registry**.

The worker must be running for garbage collection, trash purge, scans and webhooks.
