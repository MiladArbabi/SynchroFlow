FROM node:20.20.0-slim
WORKDIR /app
COPY package*.json ./
COPY package-lock.json ./
COPY tsconfig.json ./
COPY knexfile.cjs ./
COPY src/ ./src/
RUN npm install
RUN npm run build
RUN npm prune --production
EXPOSE 8080
CMD ["node", "dist/src/server.js"]