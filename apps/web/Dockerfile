# One image for the app, the worker, the backup worker and migrations; the
# docker-compose.yml picks the command. Build context is the repo root.
FROM node:24-slim AS prune
WORKDIR /app
COPY . .
# Only web and what it depends on: other apps' changes don't rebuild this image.
RUN npx -y turbo@2.11.10 prune web --docker

# The Secrets CLIs this server hands out (lib/secrets/cli-files.ts): Go binaries for
# Linux, macOS and Windows on amd64 and arm64, and the Node CLI as one file and a tarball.
FROM golang:1.23 AS cli-go
WORKDIR /src
COPY packages/cli-go/ ./
RUN make

FROM node:24-slim AS cli-node
WORKDIR /cli
COPY packages/cli/ ./
RUN npm install --no-audit --no-fund && npm run build

# rclone, for Cloud Import (More → Cloud import): the official release, pinned, checked against its published SHA256SUMS.
# Debian's package is years behind and lacks Drive metadata. TARGETARCH (amd64, arm64) is rclone's own name for the build.
FROM node:24-slim AS rclone
ARG RCLONE_VERSION=1.68.2
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates unzip && rm -rf /var/lib/apt/lists/* \
    && cd /tmp && F=rclone-v${RCLONE_VERSION}-linux-${TARGETARCH}.zip \
    && curl -fsSLO https://downloads.rclone.org/v${RCLONE_VERSION}/$F \
    && curl -fsSL https://downloads.rclone.org/v${RCLONE_VERSION}/SHA256SUMS | grep " $F\$" | sha256sum -c - \
    && unzip -j $F '*/rclone' -d /usr/local/bin && chmod 0755 /usr/local/bin/rclone

# restic: a pinned release binary for Server Backup (encrypted, deduplicated snapshots in S3).
FROM debian:bookworm-slim AS restic
ARG TARGETARCH
ARG RESTIC_VERSION=0.18.1
RUN apt-get update && apt-get install -y --no-install-recommends curl bzip2 ca-certificates \
    && cd /tmp && U=https://github.com/restic/restic/releases/download/v${RESTIC_VERSION} F=restic_${RESTIC_VERSION}_linux_${TARGETARCH}.bz2 \
    && curl -fsSLO $U/$F && curl -fsSL $U/SHA256SUMS | grep " $F\$" | sha256sum -c - \
    && bunzip2 -c $F > /restic && chmod +x /restic

FROM node:24-slim AS build
WORKDIR /app
COPY --from=prune /app/out/json/ ./
RUN npm ci
COPY --from=prune /app/out/full/ ./
# Placeholders: modules check these on load while Next collects routes; nothing connects.
RUN NODE_ENV=production DATABASE_URL=postgres://build@localhost/build REDIS_URL=redis://localhost \
    npm run build -w web && npm prune --omit=dev

FROM node:24-slim
# ffmpeg: data-saver video copies (the worker) and embedded subtitles (the app).
# libheif-examples: heif-convert, for the media converter's HEIC photos (sharp's build can't read them).
# openssh-client: Server Backup pulls over ssh (ssh, ssh-keyscan).
# git, git-lfs: Git Backup mirrors repos and browses snapshots; ca-certificates so git can verify https.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git git-lfs ca-certificates libheif-examples openssh-client \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
# The backup worker runs pg_dump and its scratch database through Docker.
COPY --from=docker:29-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=restic /restic /usr/local/bin/restic
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone
# OCR language data (a compose volume), owned by node.
ENV OCR_DATA_DIR=/data/tessdata
RUN mkdir -p /data/tessdata && chown -R node:node /data
# Owned by node: other caches next to the app.
COPY --from=build --chown=node:node /app ./
# Bundled Android APKs (gitignored; the folder keeps a .gitkeep so this never fails).
COPY --from=prune --chown=node:node /app/apps/web/android/ ./apps/web/android/
ENV SECRETS_CLI_DIR=/opt/nimbus-cli
COPY --from=cli-go /src/dist/ /opt/nimbus-cli/cli-go/dist/
COPY --from=cli-node /cli/dist/ /opt/nimbus-cli/cli/dist/
COPY --from=cli-node /cli/release/ /opt/nimbus-cli/cli/release/
COPY packages/cli/nimbus.sh /opt/nimbus-cli/cli/nimbus.sh
WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["../../node_modules/.bin/next", "start"]
