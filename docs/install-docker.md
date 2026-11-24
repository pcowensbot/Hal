# Install HAL — Docker

The whole stack — HAL, PostgreSQL, Redis, Ollama — in containers on one server. This is the easiest path and the one most people should take.

**The fast way:**

```bash
curl -fsSL https://raw.githubusercontent.com/pcowensbot/Hal/main/install.sh | bash
```

The installer: installs Docker if missing → detects an NVIDIA GPU and sets up `nvidia-container-toolkit` → clones the repo to `~/hal` → generates `.env` with random secrets → picks a model that fits your VRAM → builds and starts everything → pulls the model → prints your one-time invite code and the URL to open.

Sign up with the invite code; the first account becomes the administrator.

---

## Manual steps (what the installer does)

Prerequisites: Docker Engine + Compose v2. For GPU inference: NVIDIA driver on the host + [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).

```bash
git clone https://github.com/pcowensbot/Hal.git ~/hal && cd ~/hal

cp .env.docker.example .env
# edit .env: set JWT_SECRET and POSTGRES_PASSWORD (openssl rand -hex 32),
# pick HAL_MODEL for your VRAM (see models.md)
chmod 600 .env

# CPU-only:
docker compose up -d --build
# With an NVIDIA GPU:
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
# (add COMPOSE_FILE=docker-compose.yml:docker-compose.gpu.yml to .env so plain
#  `docker compose` commands include the GPU override from now on)

# Pull your model into the Ollama container:
docker compose exec ollama ollama pull qwen3:8b

# First-run invite code:
docker compose logs hal | grep -A4 'FIRST-RUN'
```

Open `http://<server-ip>:3000` and sign up.

## Day-2 operations

**Update HAL:**

```bash
cd ~/hal && git pull
docker compose up -d --build     # migrations run automatically on start
```

**Switch or add models:**

```bash
docker compose exec ollama ollama pull qwen3.6:27b
# then set it as default in Dashboard → Models (or HAL_MODEL in .env + restart)
```

**Logs / status:**

```bash
docker compose ps
docker compose logs -f hal
docker compose logs -f ollama
```

**Database backup / restore:**

```bash
# nightly-able one-liner (stick it in cron)
docker compose exec -T postgres pg_dump -U hal -Fc hal > hal-$(date +%F).dump

# restore
docker compose exec -T postgres pg_restore -U hal -d hal --clean < hal-2026-08-01.dump
```

**Enable Docling document processing** (PDF/DOCX → knowledge base; ~2 GB bigger image, CPU inference):

```bash
sed -i 's/^WITH_DOCLING=0/WITH_DOCLING=1/' .env
docker compose build hal && docker compose up -d hal
```

> Docling in Docker runs on CPU torch. If you want GPU-accelerated document processing, use the [bare-metal install](install-baremetal.md) instead.

## Reverse proxy + SSL

For internet exposure, put nginx/Caddy/Traefik in front of port 3000 and terminate TLS there. Two things matter:

1. **Streaming:** proxy buffering must be OFF for `/api/chat/*/stream` and `/v1/` or tokens arrive in chunks — see the sample nginx config in [install-baremetal.md](install-baremetal.md#11-optional-reverse-proxy--ssl) (same config works; upstream is `127.0.0.1:3000`).
2. **`.env`:** set `CORS_ORIGINS=https://your.domain` and `PUBLIC_URL=https://your.domain`, then `docker compose up -d hal`.

## Context length

`OLLAMA_CONTEXT_LENGTH` in `.env` sets the context window server-wide on the Ollama container (its OpenAI-compatible endpoint ignores per-request settings — this is the only reliable knob). Raising it costs VRAM; see [models.md](models.md) before going above 32768.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `hal` container restarts in a loop | `docker compose logs hal` — usually a missing `JWT_SECRET`/`POSTGRES_PASSWORD` in `.env` |
| Ollama runs on CPU despite a GPU | `docker compose exec ollama nvidia-smi` — if that fails, nvidia-container-toolkit isn't wired: `sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker`, and make sure the GPU override file is included |
| Chat says model not found | Model not pulled: `docker compose exec ollama ollama pull <model>`, and check the default in Dashboard → Models |
| Slow first response after idle | Model was evicted — the stack ships `OLLAMA_KEEP_ALIVE=-1` (resident), but only after first load |
| Pre-Turing GPU (Pascal / Volta: GTX 10-series, P100, V100, Titan V, GV100) not used | Stock Ollama (including the container) supports these cards through its CUDA 12 runner. Check the driver branch (580, not ≥590) and `docker logs` for the `inference compute` line. See *Older GPUs* in [models.md](models.md) |
