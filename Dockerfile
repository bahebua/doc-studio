# syntax=docker/dockerfile:1.7
#
# Multi-stage build for Doc Studio.
#
# Stage 1 — `builder`: install deps + produce the production bundle.
# Stage 2 — `runner`: a tiny Node image running the built-in
#           dev-proxy alongside a static file server so cURL requests
#           made from the SPA can escape CORS the same way they do in
#           `npm run dev`. Nginx alone would leave the multipart
#           request runner offline.
#
# Build:   docker build -t doc-studio .
# Run:     docker run --rm -p 8080:8080 doc-studio
# Compose: docker compose up -d

# ---------- Stage 1: build ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Copy manifests first for better layer caching. Use `npm install` (not
# `npm ci`) so the build tolerates transitive optional-dep drift between
# platforms — the lockfile is regenerated on Windows and doesn't always
# carry every Linux-scoped optional entry.
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund

# Now the rest of the source. `.dockerignore` keeps node_modules /
# dist / build.log out of context.
COPY . .

RUN npm run build

# ---------- Stage 2: runtime ----------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    PROXY_ALLOW_INSECURE=1

# Only what the runtime needs: built bundle, the tiny production
# server, and its dependency (undici for TLS-bypass + streaming).
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/vite-plugins/dev-proxy.ts ./vite-plugins/dev-proxy.ts
COPY server ./server
COPY package.json ./package.json

# Install only the runtime bits we need.
RUN npm install --omit=dev --no-audit --no-fund \
    undici@^8.7.0 \
    express@^4.19.2 \
    tsx@^4.19.1

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "server/index.ts"]
