# syntax = docker/dockerfile:1

ARG NODE_VERSION=20.19.5
FROM node:${NODE_VERSION}-slim

LABEL fly_launch_runtime="NodeJS"

WORKDIR /app

ENV NODE_ENV=production

COPY --link . .

RUN npm install --ignore-scripts

EXPOSE 8080

CMD ["node", "apps/backend/dist/server.js"]