# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY artifacts ./artifacts
COPY lib ./lib
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production \
    PORT=20143 \
    BASE_PATH=/

RUN pnpm run build

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    PORT=80 \
    FRONTEND_DIST_DIR=/app/public \
    SQLITE_DATABASE_PATH=/app/data/attendance.sqlite

COPY --chown=node:node --from=build /app/artifacts/api-server/dist ./dist
COPY --chown=node:node --from=build /app/artifacts/control-asistencia/dist/public ./public
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/lib/db/node_modules ./lib/db/node_modules
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh
RUN mkdir -p ./data && \
    ln -s ../lib/db/node_modules/better-sqlite3 ./node_modules/better-sqlite3 && \
    chown node:node ./data && \
    chmod +x ./docker-entrypoint.sh

EXPOSE 80
VOLUME ["/app/data"]
# The CapRover volume is mounted after image creation and may be owned by root.
# The entrypoint fixes its ownership before dropping privileges to node.
USER root
CMD ["./docker-entrypoint.sh"]