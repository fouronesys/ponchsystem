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
    FRONTEND_DIST_DIR=/app/public

COPY --chown=node:node --from=build /app/artifacts/api-server/dist ./dist
COPY --chown=node:node --from=build /app/artifacts/control-asistencia/dist/public ./public
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 80
USER node
CMD ["./docker-entrypoint.sh"]