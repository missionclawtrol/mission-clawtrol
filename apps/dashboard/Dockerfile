# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY apps/dashboard/package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY apps/dashboard/ ./

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Create non-root user
RUN addgroup -S app && adduser -S app -G app

# Copy built application from builder stage
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Switch to non-root user
USER app

# Expose port (adapter-node default)
EXPOSE 3000

# Health check
HEALTHCHECK CMD wget -qO- http://localhost:3000/api/health || exit 1

# Start the application
CMD ["node", "build"]
