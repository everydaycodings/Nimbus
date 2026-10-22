# One image for the app, the worker, the backup worker and migrations; the
# docker-compose.yml picks the command.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Placeholders: modules check these on load while Next collects routes; nothing connects.
RUN NODE_ENV=production DATABASE_URL=postgres://build@localhost/build REDIS_URL=redis://localhost \
    npm run build && npm prune --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
# The backup worker runs pg_dump and its scratch database through Docker.
COPY --from=docker:29-cli /usr/local/bin/docker /usr/local/bin/docker
# Owned by node: tesseract caches language data next to the app.
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
