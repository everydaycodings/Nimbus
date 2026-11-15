# Image scanning for the registry (compose profile "scan"): Trivy with a small HTTP front
# (apps/web/scripts/registry-scan.ts). Build context: the repository root.
FROM aquasec/trivy:0.75.0
RUN apk add --no-cache nodejs
COPY apps/web/scripts/registry-scan.ts /app/registry-scan.ts
ENV TRIVY_CACHE_DIR=/cache TRIVY_NO_PROGRESS=true
VOLUME /cache
EXPOSE 4954
ENTRYPOINT ["node", "--experimental-strip-types", "/app/registry-scan.ts"]
