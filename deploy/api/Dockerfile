FROM node:20.19.5-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy built API code (we'll build it first)
COPY dist/ ./dist/

# Copy necessary config files
COPY tsconfig.json ./
COPY knexfile.ts ./

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the server
CMD ["npm", "start"]
