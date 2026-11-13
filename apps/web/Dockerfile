# One image for the app, the worker, the backup worker and migrations; the
# docker-compose.yml picks the command. Build context is the repo root.
FROM node:24-slim AS prune
WORKDIR /app
COPY . .
# Only web and what it depends on: other apps' changes don't rebuild this image.
RUN npx -y turbo@2.11.10 prune web --docker

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
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
# The backup worker runs pg_dump and its scratch database through Docker.
COPY --from=docker:29-cli /usr/local/bin/docker /usr/local/bin/docker
# OCR language data (a compose volume), owned by node.
ENV OCR_DATA_DIR=/data/tessdata
RUN mkdir -p /data/tessdata && chown -R node:node /data
# Owned by node: other caches next to the app.
COPY --from=build --chown=node:node /app ./
# Bundled Android APKs (gitignored; the folder keeps a .gitkeep so this never fails).
COPY --from=prune --chown=node:node /app/apps/web/android/ ./apps/web/android/
WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["../../node_modules/.bin/next", "start"]
