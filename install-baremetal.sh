#!/usr/bin/env bash
# HAL bare-metal installer — no Docker, everything native under systemd/PM2.
#
#   curl -fsSL https://raw.githubusercontent.com/pcowensbot/Hal/main/install-baremetal.sh | bash
#   (or ./install-baremetal.sh from a checkout)
#
# Target: Ubuntu 22.04 / 24.04 (Debian-family). Installs and configures:
#   PostgreSQL 16, Redis, Node 20, Ollama, PM2 — then builds and starts HAL.
# Safe to re-run; each step skips work that's already done.
set -euo pipefail

REPO_URL="https://github.com/pcowensbot/Hal.git"
INSTALL_DIR="${HAL_INSTALL_DIR:-$HOME/hal}"
HAL_PORT="${HAL_PORT:-3000}"

log()  { printf '\033[1;36m[hal-install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[hal-install]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[hal-install]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] && die "Run as a regular user with sudo, not as root (PM2 runs as your user)."
command -v sudo >/dev/null 2>&1 || die "sudo is required."
command -v apt-get >/dev/null 2>&1 || die "This installer targets Ubuntu/Debian. For other distros, follow docs/install-baremetal.md manually."

# --- 1. Base packages --------------------------------------------------------
log "Installing base packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq curl git build-essential ca-certificates openssl lsb-release

# --- 2. NVIDIA driver (optional) --------------------------------------------
GPU=0; VRAM_MB=0
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
  GPU=1
  VRAM_MB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | sort -n | tail -1)
  log "NVIDIA GPU ready (${VRAM_MB} MiB VRAM)"
  CAP=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader 2>/dev/null | sort -n | head -1 || echo "")
  if [ -n "$CAP" ] && awk "BEGIN{exit !($CAP < 7.5)}"; then
    warn "GPU compute capability $CAP is pre-Turing — stock Ollama ≥0.30 will NOT use it."
    warn "You need a source-built Ollama for this card. See docs/models.md (Older GPUs)."
  fi
elif lspci 2>/dev/null | grep -qi nvidia; then
  warn "NVIDIA hardware present but no driver. Installing (needs a reboot)..."
  sudo ubuntu-drivers autoinstall
  warn "Driver installed. REBOOT, then re-run this script — it picks up where it left off."
  exit 0
else
  warn "No NVIDIA GPU — HAL will run CPU-only (fine with small models)."
fi

# --- 3. PostgreSQL -----------------------------------------------------------
if ! command -v psql >/dev/null 2>&1; then
  log "Installing PostgreSQL..."
  sudo apt-get install -y -qq postgresql postgresql-contrib
fi
sudo systemctl enable --now postgresql

if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='hal'" | grep -q 1; then
  log "Database 'hal' already exists — keeping it (password unchanged)."
  DB_PASS=""
else
  DB_PASS=$(openssl rand -hex 16)
  log "Creating database 'hal' + user 'hal_user'..."
  sudo -u postgres psql -q <<SQL
CREATE DATABASE hal;
CREATE USER hal_user WITH PASSWORD '${DB_PASS}';
GRANT ALL PRIVILEGES ON DATABASE hal TO hal_user;
\c hal
GRANT ALL ON SCHEMA public TO hal_user;
SQL
fi

# --- 4. Redis ----------------------------------------------------------------
if ! command -v redis-cli >/dev/null 2>&1; then
  log "Installing Redis..."
  sudo apt-get install -y -qq redis-server
fi
sudo systemctl enable --now redis-server
redis-cli ping >/dev/null || die "Redis didn't answer PONG."

# --- 5. Node 20+ -------------------------------------------------------------
NODE_MAJOR=$(node --version 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || echo 0)
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  log "Installing Node 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
log "Node: $(node --version)"

# --- 6. Ollama + model -------------------------------------------------------
if ! command -v ollama >/dev/null 2>&1; then
  log "Installing Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh
fi
sudo systemctl enable --now ollama 2>/dev/null || true

# Context length must be set on the Ollama service itself — its OpenAI-compat
# /v1 endpoint ignores per-request num_ctx (see docs/models.md)
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/hal.conf >/dev/null <<'EOF'
[Service]
Environment="OLLAMA_CONTEXT_LENGTH=32768"
Environment="OLLAMA_KEEP_ALIVE=-1"
EOF
sudo systemctl daemon-reload && sudo systemctl restart ollama

if   [ "$VRAM_MB" -ge 30000 ]; then MODEL="qwen3.6:27b"
elif [ "$VRAM_MB" -ge 22000 ]; then MODEL="qwen3.6:27b"
elif [ "$VRAM_MB" -ge 14000 ]; then MODEL="qwen2.5:14b-instruct-q4_K_M"
elif [ "$VRAM_MB" -ge 7000  ]; then MODEL="qwen3:8b"
else                                MODEL="qwen3:4b"
fi
[ "$GPU" -eq 1 ] || MODEL="qwen3:4b"
MODEL="${HAL_MODEL:-$MODEL}"

if ! ollama list 2>/dev/null | grep -q "^${MODEL}"; then
  log "Pulling model '$MODEL' (the long part — see docs/models.md for alternatives)..."
  ollama pull "$MODEL"
fi

# --- 7. Repo -----------------------------------------------------------------
if [ -f ecosystem.config.js ] && [ -d server ]; then
  INSTALL_DIR="$(pwd)"
  log "Using existing checkout: $INSTALL_DIR"
else
  [ -d "$INSTALL_DIR/.git" ] || { log "Cloning HAL into $INSTALL_DIR..."; git clone "$REPO_URL" "$INSTALL_DIR"; }
  cd "$INSTALL_DIR"
fi

# --- 8. server/.env ----------------------------------------------------------
if [ ! -f server/.env ]; then
  [ -n "$DB_PASS" ] || die "server/.env missing but DB already existed — create server/.env from server/.env.example manually (you need the DB password)."
  log "Writing server/.env..."
  cat > server/.env <<EOF
DATABASE_URL="postgresql://hal_user:${DB_PASS}@localhost:5432/hal?connection_limit=10&pool_timeout=20"
REDIS_URL="redis://localhost:6379"
PORT=${HAL_PORT}
NODE_ENV=production
JWT_SECRET="$(openssl rand -hex 32)"
JWT_EXPIRES_IN="24h"
LLM_PROVIDER="ollama"
LLM_BASE_URL="http://localhost:11434"
LLM_DEFAULT_MODEL="${MODEL}"
LLM_CONTEXT_LENGTH=32768
OLLAMA_BASE_URL="http://localhost:11434"
OLLAMA_MODEL="${MODEL}"
EOF
  chmod 600 server/.env
else
  log "Keeping existing server/.env"
fi

# --- 9. Install, migrate, seed, invite ---------------------------------------
log "Installing server dependencies..."
(cd server && npm install --no-audit --no-fund)
log "Applying migrations + seeding roles..."
(cd server && npx prisma migrate deploy && node prisma/seed.js)
INVITE_OUTPUT=$(cd server && node scripts/bootstrap-invite.js)

# --- 10. Build client --------------------------------------------------------
log "Building the web client..."
(cd client && npm install --no-audit --no-fund && npm run build)

# --- 11. Docling (optional) --------------------------------------------------
if [ "${WITH_DOCLING:-0}" = "1" ]; then
  log "Setting up Docling document processing (~2+ GB of Python deps)..."
  sudo apt-get install -y -qq python3-venv python3-pip
  python3 -m venv .venv/docling
  ./.venv/docling/bin/pip install --no-cache-dir docling
else
  log "Skipping Docling (re-run with WITH_DOCLING=1 to enable document processing)."
fi

# --- 12. PM2 -----------------------------------------------------------------
command -v pm2 >/dev/null 2>&1 || { log "Installing PM2..."; sudo npm install -g pm2 >/dev/null; }
log "Starting HAL under PM2..."
pm2 startOrReload ecosystem.config.js
pm2 save
STARTUP_CMD=$(pm2 startup systemd -u "$USER" --hp "$HOME" 2>/dev/null | grep '^sudo' || true)
if [ -n "$STARTUP_CMD" ]; then
  log "Wiring PM2 into systemd (auto-start on boot)..."
  eval "$STARTUP_CMD" >/dev/null
  pm2 save
fi

# --- 13. Done ----------------------------------------------------------------
sleep 3
curl -fsS "http://localhost:${HAL_PORT}/api/health" >/dev/null \
  || warn "Health check didn't answer yet — check: pm2 logs hal --lines 50"

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo ""
log "HAL is installed."
echo ""
echo "  Open:   http://${IP:-localhost}:${HAL_PORT}"
echo ""
echo "$INVITE_OUTPUT" | grep -A5 'FIRST-RUN' || echo "$INVITE_OUTPUT"
echo ""
echo "  Sign up with that invite code — the first account becomes the admin."
echo "  Next steps:"
echo "    • Reverse proxy + SSL:  docs/install-baremetal.md (nginx section)"
echo "    • Model tuning:         docs/models.md"
echo "    • Nightly DB backups:   docs/install-baremetal.md (backups section)"
