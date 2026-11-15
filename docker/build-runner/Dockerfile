# The image build runner (compose profile "build"): the Nimbus app image plus buildctl, git, ssh,
# tar/unzip and cosign, running apps/web/scripts/registry-build.ts. Build context: the repository root.
# `nimbus-app` is the app image (compose passes it as an additional build context, built first).
FROM moby/buildkit:v0.34.2 AS buildkit

FROM nimbus-app
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client tar unzip ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=buildkit /usr/bin/buildctl /usr/local/bin/buildctl
# cosign v2 (signatures as sha256-<digest>.sig tags), pinned and checked.
ARG COSIGN_VERSION=2.6.5
ARG TARGETARCH
RUN case "$TARGETARCH" in \
      amd64) sha=c3b4f5410e608af03a5eb0aaac84a4313d8da131248e08ff1759ac70c79d1644 ;; \
      arm64) sha=426193b4c5da4d4d643e822f48fe0cc8a476ca1782a272704831f5a0cef716d7 ;; \
      *) echo "unsupported arch $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /usr/local/bin/cosign "https://github.com/sigstore/cosign/releases/download/v${COSIGN_VERSION}/cosign-linux-${TARGETARCH}" \
    && echo "$sha  /usr/local/bin/cosign" | sha256sum -c - \
    && chmod +x /usr/local/bin/cosign
RUN mkdir -p /work && chown node:node /work
USER node
ENV BUILD_WORK_DIR=/work
WORKDIR /app/apps/web
CMD ["node", "scripts/registry-build.ts"]
