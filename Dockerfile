# Single-container cached demo for the highlight generator.
#
# Serves the built SPA + REST + WebSocket + pre-rendered media on ONE port,
# replaying the baked `out/3654414` run. No Python, ffmpeg, or AWS at runtime.
# Build/run env (CACHED_ONLY, DEMO_STREAM_ID, ...) is documented in
# frontend/mock-server/server.mjs and .kiro/steering/local-first.md.

# --- Stage 1: build the Vite SPA (uses frontend/.env.production) ------------
FROM node:20-slim AS build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Stage 2: runtime — the Node server, its lone dep (ws), SPA + media -----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    CACHED_ONLY=1 \
    DEMO_STREAM_ID=3654414 \
    DEMO_PACING=1 \
    PUBLIC_BASE_URL="" \
    PUBLIC_DIR=/app/frontend/dist \
    PORT=8080

# Server code + the only external runtime dependency it imports (`ws`, which
# has no transitive deps). Node resolves `ws` up from mock-server/ to
# frontend/node_modules, so the repo layout is preserved.
COPY frontend/mock-server /app/frontend/mock-server
COPY --from=build /app/frontend/node_modules/ws /app/frontend/node_modules/ws
COPY --from=build /app/frontend/dist /app/frontend/dist

# The one pre-rendered run served by the demo (REPO_ROOT/out/<id>).
COPY out/3654414 /app/out/3654414

EXPOSE 8080
CMD ["node", "frontend/mock-server/server.mjs"]
