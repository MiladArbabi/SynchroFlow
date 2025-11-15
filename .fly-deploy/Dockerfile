FROM node:20.19.5-slim

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY knexfile.ts ./
COPY dist/ ./dist/

RUN npm ci --only=production

EXPOSE 8080

CMD ["node", "dist/src/server.js"]
