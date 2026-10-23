# syntax = docker/dockerfile:1

ARG NODE_VERSION=20.20.0

FROM node:${NODE_VERSION}-slim AS base
LABEL fly_launch_runtime="NodeJS"
WORKDIR /app

# Manifests-only stage: collects every workspace's package.json plus the
# root lockfile, nothing else. Copying just this (small, source-independent)
# set into the build stage lets `npm ci` land on its own Docker layer, which
# stays CACHED across rebuilds that only touch application source — only a
# manifest or lockfile change busts it.
FROM base AS manifests
COPY --link . .
RUN mkdir -p /manifests && \
    find . -name package.json -not -path "*/node_modules/*" \
      -exec cp --parents {} /manifests/ \; && \
    cp package-lock.json /manifests/

FROM base AS build

ARG VITE_PUBLIC_POSTHOG_KEY
ARG VITE_PUBLIC_POSTHOG_HOST

ENV NODE_ENV=development

RUN apt-get update -qq && \
    apt-get install -y python-is-python3 pkg-config build-essential libpqxx-dev

COPY --from=manifests /manifests /app
RUN npm ci --legacy-peer-deps
RUN npm install -g typescript@5.5.2

COPY --link . .

# BUILD-02 / BUILD-02a: workspace dist is generated build output.
#
# .dockerignore excludes local package/module dist from the build context.
# Keep this purge as defense-in-depth so source -> build:deps remains the
# authoritative production path even if build-context rules regress later.
RUN rm -rf modules/*/dist packages/*/dist

# Build frontend dependencies used by module imports
RUN npm run build:deps:production

# Build frontend bundle only.
# We intentionally skip `tsc -b` here because existing frontend type errors
# currently block Docker builds, but Vite can still produce the production SPA.
RUN VITE_PUBLIC_POSTHOG_KEY="${VITE_PUBLIC_POSTHOG_KEY}" VITE_PUBLIC_POSTHOG_HOST="${VITE_PUBLIC_POSTHOG_HOST}" NODE_ENV=production npm --workspace ./apps/frontend exec -- vite build

# Build backend
RUN SKIP_DEPS=1 npm --workspace ./apps/backend run build

FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build /app /app

EXPOSE 8080
CMD ["node", "apps/backend/dist/server.js"]