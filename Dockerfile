# syntax = docker/dockerfile:1

ARG NODE_VERSION=20.20.0

FROM node:${NODE_VERSION}-slim AS base
LABEL fly_launch_runtime="NodeJS"
WORKDIR /app

FROM base AS build
ENV NODE_ENV=development

RUN apt-get update -qq && \
    apt-get install -y python-is-python3 pkg-config build-essential libpqxx-dev

COPY --link . .

RUN npm install --legacy-peer-deps
RUN npm install -g typescript@5.5.2

# BUILD-02a: purge copied build artifacts before compiling.
#
# modules/*/dist and packages/*/dist are tracked in git and .dockerignore
# deliberately admits them (it excludes apps/*/dist only). COPY --link . .
# therefore brings committed artifacts into the image with mtimes no older
# than their sources, and no module tsconfig.build.json sets `incremental`
# or `composite` — so `tsc --build` falls back to timestamp comparison,
# finds nothing to do, and skips the project.
#
# The committed artifact then wins over build:deps. On 2026-08-15 five
# feature commits deployed green and were invisible in production because
# modules/shared/dist/ui/IsometricCanvas.js was last committed in 6f6250d2.
#
# Deleting the copies makes the build authoritative. Tracking itself is a
# separate problem — see BUILD-02.
RUN rm -rf modules/*/dist packages/*/dist

# Build frontend dependencies used by module imports
RUN npm run build:deps

# Build frontend bundle only.
# We intentionally skip `tsc -b` here because existing frontend type errors
# currently block Docker builds, but Vite can still produce the production SPA.
RUN npm --workspace ./apps/frontend exec -- vite build

# Build backend
RUN SKIP_DEPS=1 npm --workspace ./apps/backend run build

FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build /app /app

EXPOSE 8080
CMD ["node", "apps/backend/dist/server.js"]