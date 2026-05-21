# syntax = docker/dockerfile:1

ARG NODE_VERSION=20.19.5
FROM node:${NODE_VERSION}-slim as base
LABEL fly_launch_runtime="NodeJS"
WORKDIR /app
ENV NODE_ENV=production

FROM base as build
RUN apt-get update -qq && \
    apt-get install -y python-is-python3 pkg-config build-essential libpqxx-dev
COPY --link . .
RUN npm install --ignore-scripts
RUN npx tsc -p modules/shared/tsconfig.build.json
RUN SKIP_DEPS=1 npm --workspace ./apps/backend run build

FROM base
COPY --from=build /app /app
EXPOSE 8080
CMD ["node", "apps/backend/dist/server.js"]