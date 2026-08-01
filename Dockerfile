# HAL — single-image build: React client compiled in, Express serves everything.
# Build:  docker compose build          (or: docker build -t hal .)
# Docling document processing adds ~2 GB (CPU torch) — enable with:
#         WITH_DOCLING=1 docker compose build

# ---- Stage 1: build the React client ----
FROM node:20-bookworm-slim AS client-build
WORKDIR /app/client
COPY client/package.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# ---- Stage 2: server dependencies + Prisma client ----
FROM node:20-bookworm-slim AS server-build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
# Chromium comes from apt in the runtime stage — skip Puppeteer's download
ENV PUPPETEER_SKIP_DOWNLOAD=1
COPY server/package.json ./
RUN npm install
COPY server/ ./
RUN npx prisma generate

# ---- Stage 3: runtime ----
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
        openssl ca-certificates curl \
        chromium fonts-liberation \
        python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Optional: Docling document processing (PDF/DOCX → knowledge base).
# CPU-only torch keeps the image sane; GPU users who want fast Docling
# should use the bare-metal install instead.
ARG WITH_DOCLING=0
RUN if [ "$WITH_DOCLING" = "1" ]; then \
        python3 -m venv /app/.venv/docling && \
        /app/.venv/docling/bin/pip install --no-cache-dir \
            torch --index-url https://download.pytorch.org/whl/cpu && \
        /app/.venv/docling/bin/pip install --no-cache-dir docling; \
    fi
ENV DOCLING_PYTHON=/app/.venv/docling/bin/python3

WORKDIR /app
COPY --from=server-build /app/server ./server
COPY --from=client-build /app/client/dist ./client/dist
COPY public ./public
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p public/uploads public/generated-images

EXPOSE 3000
WORKDIR /app/server
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD curl -fsS http://localhost:${PORT:-3000}/api/health || exit 1
ENTRYPOINT ["/entrypoint.sh"]
