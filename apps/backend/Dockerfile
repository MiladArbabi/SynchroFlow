FROM node:20.19.5-slim

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY knexfile.ts ./
COPY src/ ./src/

RUN npm ci
RUN npm run build
RUN npm ci --only=production

EXPOSE 8080

CMD ["node", "dist/src/server.js"]
