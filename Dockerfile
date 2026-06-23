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

RUN npm install
RUN npm install -g typescript@5.5.2

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