FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 mcp

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build --chown=mcp:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=mcp:nodejs /app/dist ./dist

# Writable data directory for SQLite
RUN mkdir -p /app/data && chown mcp:nodejs /app/data

USER mcp
EXPOSE 3000

ENV NODE_ENV=production
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=3000
ENV TURSO_DATABASE_URL=file:/app/data/local.db

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/healthz',r=>{process.exit(r.statusCode===200?0:1)})"

CMD ["node", "dist/index.js"]
