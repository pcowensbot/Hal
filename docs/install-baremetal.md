# Install HAL — Bare Metal (no Docker)

Everything native under systemd: PostgreSQL, Redis, Node, Ollama, PM2. This is the right path if you want maximum performance, direct control of every service, or you just don't want Docker in the mix.

**The fast way** — the installer automates every step on this page:

```bash
curl -fsSL https://raw.githubusercontent.com/pcowensbot/Hal/main/install-baremetal.sh | bash
```

It's safe to re-run (each step skips work already done), and if it installs an NVIDIA driver it will ask you to reboot and run it again. Options via env vars: `HAL_MODEL=qwen3.6:27b`, `HAL_PORT=3000`, `WITH_DOCLING=1`, `HAL_INSTALL_DIR=~/hal`.

The rest of this page is the same procedure by hand — useful for non-Ubuntu distros, unusual setups, or understanding what the script did. Allow ~1–2 hours; most of that is the model download.

---

## 0. Hardware & OS

- **CPU** — 4 cores minimum, 8+ recommended
- **RAM** — 8 GB minimum, 32 GB+ recommended for multi-user
- **Storage** — 50 GB SSD minimum (models + DB + uploads grow — 200 GB+ recommended)
- **GPU** — NVIDIA, 8 GB VRAM minimum for a pleasant experience (see [models.md](models.md)); CPU-only works with small models
- **OS** — Ubuntu 22.04, 24.04, or 26.04 LTS — all three validated end-to-end. Other distros are currently untested.
- **Network** — a reachable IP; if exposing to the internet, plan for SSL termination (section 11)

Running inside a Proxmox VM? Set up GPU passthrough first: [proxmox-gpu-passthrough.md](proxmox-gpu-passthrough.md).

---

## 1. Base packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential ca-certificates openssl
```

Run everything as the regular Linux user who will own the HAL process (not root — PM2 runs as your user).

## 2. NVIDIA driver (skip if CPU-only)

```bash
sudo apt install -y ubuntu-drivers-common   # server images don't ship it
sudo ubuntu-drivers autoinstall
sudo reboot
# after reboot:
nvidia-smi   # expect a table showing your GPU
```

Ollama bundles its own CUDA runtime — no separate CUDA toolkit needed.

> **Pre-Turing GPUs** (Pascal / Volta: GTX 10-series, Tesla P100/V100, Titan V, Quadro GV100): stock Ollama ≥0.30 dropped support for these cards. **For Volta (sm_70) HAL includes a prebuilt binary** — the installer sets it up automatically (V100 fully vetted; other Volta cards should work, open an issue if not). Pascal still needs a source build. See *Older GPUs* in [models.md](models.md).

## 3. PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql

DB_PASS=$(openssl rand -hex 16)
echo "Save this DB password: $DB_PASS"
sudo -u postgres psql <<EOF
CREATE DATABASE hal;
CREATE USER hal_user WITH PASSWORD '${DB_PASS}';
GRANT ALL PRIVILEGES ON DATABASE hal TO hal_user;
\c hal
GRANT ALL ON SCHEMA public TO hal_user;
EOF
```

Verify: `psql "postgresql://hal_user:${DB_PASS}@localhost:5432/hal" -c '\dt'` (an empty table list is correct — migrations haven't run yet).

## 4. Redis

```bash
sudo apt install -y redis-server
sudo systemctl enable --now redis-server
redis-cli ping   # → PONG
```

## 5. Node 20+

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # v20.x
```

## 6. Ollama + a model

```bash
curl -fsSL https://ollama.com/install.sh | sh
sudo systemctl enable --now ollama
```

Set the context length **on the Ollama service** (its OpenAI-compatible `/v1` endpoint ignores per-request context settings — this is the only reliable place):

```bash
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/hal.conf <<'EOF'
[Service]
Environment="OLLAMA_CONTEXT_LENGTH=32768"
Environment="OLLAMA_KEEP_ALIVE=-1"
EOF
sudo systemctl daemon-reload && sudo systemctl restart ollama
```

Pick a model that fits your VRAM — full guidance in [models.md](models.md):

| VRAM | Model |
|------|-------|
| 24–32 GB | `ollama pull qwen3.6:27b` |
| 14–24 GB | `ollama pull qwen2.5:14b-instruct-q4_K_M` |
| 8 GB | `ollama pull qwen3:8b` |
| less / CPU | `ollama pull qwen3:4b` |

Smoke test: `ollama run <model> "say hi in one word"`. Remember the exact model name — it goes in `.env` next.

## 7. Clone the repo

```bash
git clone https://github.com/pcowensbot/Hal.git hal
cd hal
```

## 8. Configure `.env`

```bash
cd server
cp .env.example .env
chmod 600 .env
```

Edit `server/.env` and set at minimum:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `postgresql://hal_user:<DB_PASS from step 3>@localhost:5432/hal?connection_limit=10&pool_timeout=20` |
| `JWT_SECRET` | Output of `openssl rand -hex 32` — **server refuses to boot without this** |
| `LLM_DEFAULT_MODEL` | Exact model name from step 6 |
| `LLM_CONTEXT_LENGTH` | Match the Ollama drop-in (32768 default) |
| `NODE_ENV` | `production` |
| `PORT` | `3000` (or your choice) |

> **Production tip:** keep the real `.env` at `/etc/hal/.env` (mode 600) and symlink it to `server/.env` — secrets stay out of the working tree and survive `git clean -fdx`.

## 9. Install, migrate, seed, mint the bootstrap invite

```bash
cd server
npm install
npx prisma migrate deploy      # applies all migrations
npm run db:seed                # default roles (Admin / Manager / Member / Guest)
node scripts/bootstrap-invite.js   # prints your one-time signup code — COPY IT
```

Why the invite step: signup requires an invite code, but nobody exists yet to mint one. The first account to sign up auto-promotes to administrator.

## 10. Build the client

```bash
cd ../client
npm install
npm run build      # outputs to client/dist, served by Express
```

## 11. (Optional) Reverse proxy + SSL

Skip for LAN-only. For anything internet-facing, terminate SSL in front of HAL — nginx on the same box, or (advanced layout) a dedicated proxy host/container in front, with the cert living on the proxy and the HAL box staying HTTP on the LAN.

Express ships with `trust proxy = 1` (one proxy hop). Don't add more hops without bumping that in `server/src/index.js`, or rate limits will key off the proxy IP.

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

`/etc/nginx/sites-available/hal.conf` (replace `hal.example.com`; replace `192.0.2.10:3000` with the HAL server's IP:port, or `127.0.0.1:3000` if nginx runs on the same box):

```nginx
upstream hal_app {
    server 192.0.2.10:3000;
    keepalive 32;
}

server {
    listen 80;
    server_name hal.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name hal.example.com;

    ssl_certificate     /etc/letsencrypt/live/hal.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hal.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # Above HAL's own 15 MB attachment limit
    client_max_body_size 20m;

    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection        "";

    # SSE streaming chat — buffering MUST be off or tokens arrive in chunks
    location ~ ^/api/chat/.*/(messages/)?stream$ {
        proxy_pass http://hal_app;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    # OpenAI-compatible /v1 — also streams, same treatment
    location /v1/ {
        proxy_pass http://hal_app;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    location / {
        proxy_pass http://hal_app;
        proxy_read_timeout 180s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/hal.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d hal.example.com
```

Then on the HAL side: set `CORS_ORIGINS=https://hal.example.com` and `PUBLIC_URL=https://hal.example.com` in `server/.env`, restart (`pm2 restart hal --update-env`), and firewall the HAL port so only the proxy can reach it.

## 12. Start with PM2

```bash
cd ..    # repo root
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup    # prints a `sudo ...` command — run it to auto-start on boot, then `pm2 save` again
```

Check: `pm2 list` shows `hal` online; `curl -sI http://localhost:3000/api/health` → 200.

## 13. First user signup

Browse to `http://<box-ip>:3000`, click **Sign Up**, paste the bootstrap invite code, pick an email + 12-char password. You're now the administrator — mint further invites from **Dashboard → Users**.

## 14. Nightly backups (recommended)

Without backups you have no recovery path. A minimal nightly `pg_dump` setup:

```bash
sudo tee /usr/local/bin/hal-pg-backup.sh >/dev/null <<'EOF'
#!/bin/bash
set -euo pipefail
BACKUP_DIR=/var/backups/hal
mkdir -p "$BACKUP_DIR"
sudo -u postgres pg_dump -Fc hal > "$BACKUP_DIR/hal-$(date +%F).dump"
find "$BACKUP_DIR" -name 'hal-*.dump' -mtime +7 -delete
EOF
sudo chmod +x /usr/local/bin/hal-pg-backup.sh

sudo tee /etc/systemd/system/hal-pg-backup.service >/dev/null <<'EOF'
[Unit]
Description=HAL nightly PostgreSQL backup
[Service]
Type=oneshot
ExecStart=/usr/local/bin/hal-pg-backup.sh
EOF

sudo tee /etc/systemd/system/hal-pg-backup.timer >/dev/null <<'EOF'
[Unit]
Description=Run HAL DB backup nightly
[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true
[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload && sudo systemctl enable --now hal-pg-backup.timer
```

Copy the dumps off-box on whatever schedule you trust. Restore with `pg_restore -d hal <file>`.

## 15. (Optional) Docling document processing

Enables PDF/DOCX → markdown import into the knowledge base. Pulls PyTorch — a few GB of Python deps; on a CUDA box it will use the GPU.

```bash
sudo apt install -y python3-venv python3-pip
python3 -m venv .venv/docling        # from the repo root
./.venv/docling/bin/pip install docling
```

HAL finds it automatically at `<repo>/.venv/docling`; override with `DOCLING_PYTHON` in `.env`.

---

## Smoke tests

- **Auth:** signup + login work, profile loads
- **Chat:** send "hi" — tokens stream in live
- **Knowledge base:** star an assistant message, confirm it appears in Knowledge
- **Device API:** Dashboard → Devices → create a key, then:

  ```bash
  curl -X POST http://localhost:3000/v1/chat/completions \
    -H "Authorization: Bearer hal_<your_key>" \
    -H "Content-Type: application/json" \
    -d '{"model":"<your model>","messages":[{"role":"user","content":"say hi"}]}'
  ```

- **GPU monitoring:** Dashboard → System shows GPU utilization/VRAM/temp (needs `nvidia-smi` accessible to the HAL process user)

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Boot error mentioning JWT_SECRET | Unset or < 32 chars | `openssl rand -hex 32` → `.env`, restart |
| `prisma migrate deploy` fails: "relation does not exist" | Ran `db push` against an empty DB | `migrate deploy` is the only supported path |
| "Invalid invite code" at signup | Typo or already used (codes are single-use) | Re-run `node scripts/bootstrap-invite.js` |
| `nvidia-smi` works but Ollama runs on CPU | Daemon started before driver, or pre-Turing GPU | `sudo systemctl restart ollama`; check `journalctl -u ollama`; see [models.md](models.md) *Older GPUs* |
| Rate limits hitting legit users behind a proxy | Proxy not sending `X-Forwarded-For` | Fix the proxy config |
| `pm2 list` shows `errored` | Env / DB / Redis | `pm2 logs hal --err --lines 100` |
| Chat never streams | LLM backend unreachable | `curl http://localhost:11434/api/tags`; `systemctl status ollama` |

## What you don't need

- **OpenAI or Anthropic API keys** — HAL talks only to your local Ollama (or vLLM). The `/v1` endpoint is HAL *serving* an OpenAI-shaped API to your other tools, not HAL calling OpenAI.
- **A GPU** — small models run on CPU. Slowly, but they run.
