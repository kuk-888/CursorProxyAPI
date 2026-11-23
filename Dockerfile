# Stage 1: Build TypeScript to clean ESM JavaScript
FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: Minimal production runtime (only 1 runtime dependency: @cursor/sdk)
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=6718 \
    DATA_DIR=/app/data \
    ENV_FILE_PATH=/app/data/.env \
    EMPTY_WORKSPACE_DIR=/tmp/cursor-proxy-api-empty

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY .env.example ./

# Run as the unprivileged `node` user (uid 1000) that ships with the base image.
# /app/data holds .env, gateway-keys.json and the admin session key; the SDK keeps its
# per-agent state under $HOME/.cursor, so HOME must be writable too.
ENV HOME=/home/node
RUN mkdir -p /app/data /tmp/cursor-proxy-api-empty /home/node/.cursor \
    && chown -R node:node /app/data /tmp/cursor-proxy-api-empty /home/node
USER node

EXPOSE 6718

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||6718)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/server.js"]
