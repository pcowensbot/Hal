#!/usr/bin/env bash
# HAL one-line installer — Docker path.
#
#   curl -fsSL https://raw.githubusercontent.com/pcowensbot/Hal/main/install.sh | bash
#
# What it does:
#   1. Installs Docker (+ compose plugin) if missing
#   2. Detects an NVIDIA GPU and installs nvidia-container-toolkit if needed
#   3. Clones the repo (if you didn't already), generates .env with random secrets
#   4. Picks a model that fits your VRAM, builds + starts the stack
#   5. Prints your first-run invite code and the URL to open
#
# Prefer bare metal (no Docker)? Use install-baremetal.sh instead.
set -euo pipefail

REPO_URL="https://github.com/pcowensbot/Hal.git"
INSTALL_DIR="${HAL_INSTALL_DIR:-$HOME/hal}"

log()  { printf '\033[1;36m[hal-install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[hal-install]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[hal-install]\033[0m %s\n' "$*" >&2; exit 1; }

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "Run as root or install sudo first."
  SUDO="sudo"
fi

command -v curl >/dev/null 2>&1 || die "curl is required."

# --- 1. Docker ---------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "Docker not found — installing via get.docker.com..."
  curl -fsSL https://get.docker.com | $SUDO sh
  $SUDO systemctl enable --now docker
else
  log "Docker already installed: $(docker --version)"
fi
docker compose version >/dev/null 2>&1 || $SUDO docker compose version >/dev/null 2>&1 \
  || die "Docker Compose v2 plugin missing — install docker-compose-plugin and re-run."

# Everything below drives docker through sudo so it works even before a
# fresh `docker` group membership takes effect (that needs a re-login).
dc() { $SUDO docker compose "$@"; }
if [ -n "$SUDO" ] && ! id -nG "$USER" | grep -qw docker; then
  $SUDO usermod -aG docker "$USER" || true
  warn "Added $USER to the docker group — takes effect on your next login."
fi

# --- 2. NVIDIA GPU -----------------------------------------------------------
GPU=0
VRAM_MB=0
PRETURING=0
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
  GPU=1
  VRAM_MB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | sort -n | tail -1)
  log "NVIDIA GPU detected (${VRAM_MB} MiB VRAM)"
  CAP=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader 2>/dev/null | sort -n | head -1 || echo "")
  if [ -n "$CAP" ] && awk "BEGIN{exit !($CAP < 7.5)}"; then
    PRETURING=1
    warn "GPU compute capability $CAP is pre-Turing (Pascal/Volta) — the containerized stock"
    warn "Ollama can NOT use it; inference will run on CPU. For GPU inference on these cards"
    warn "use the bare-metal installer with a source-built Ollama (docs/models.md, Older GPUs)."
    warn "All Volta (sm_70) cards should work there — only the Tesla V100 has been verified."
  fi
  if ! $SUDO docker info 2>/dev/null | grep -qi nvidia; then
    log "Installing nvidia-container-toolkit..."
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
      | $SUDO gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
      | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
      | $SUDO tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null
    $SUDO apt-get update -qq && $SUDO apt-get install -y -qq nvidia-container-toolkit
    $SUDO nvidia-ctk runtime configure --runtime=docker
    $SUDO systemctl restart docker
  fi
else
  if lspci 2>/dev/null | grep -qi 'nvidia'; then
    warn "NVIDIA hardware found but no working driver (nvidia-smi failed)."
    warn "HAL will run on CPU. Install the driver (sudo apt install ubuntu-drivers-common && sudo ubuntu-drivers install; reboot) and re-run for GPU inference."
  else
    warn "No NVIDIA GPU detected — running on CPU (slow, but works with small models)."
  fi
fi

# --- 3. Repo + .env ----------------------------------------------------------
if [ -f docker-compose.yml ] && [ -f install.sh ]; then
  INSTALL_DIR="$(pwd)"
  log "Running from an existing checkout: $INSTALL_DIR"
else
  command -v git >/dev/null 2>&1 || { log "Installing git..."; $SUDO apt-get update -qq && $SUDO apt-get install -y -qq git; }
  if [ ! -d "$INSTALL_DIR/.git" ]; then
    log "Cloning HAL into $INSTALL_DIR..."
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi
  cd "$INSTALL_DIR"
fi

# Pick a default model that fits the card (see docs/models.md)
if   [ "$VRAM_MB" -ge 30000 ]; then MODEL="qwen3.6:27b"
elif [ "$VRAM_MB" -ge 22000 ]; then MODEL="qwen3.6:27b"
elif [ "$VRAM_MB" -ge 14000 ]; then MODEL="qwen2.5:14b-instruct-q4_K_M"
elif [ "$VRAM_MB" -ge 7000  ]; then MODEL="qwen3:8b"
else                                MODEL="qwen3:4b"
fi
[ "$GPU" -eq 1 ] || MODEL="qwen3:4b"
# Pre-Turing: stock (containerized) Ollama runs on CPU — size the model for CPU
[ "$PRETURING" -eq 1 ] && MODEL="qwen3:4b"

if [ ! -f .env ]; then
  log "Generating .env (random secrets, model: $MODEL)..."
  {
    echo "JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | xxd -p)"
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 16 2>/dev/null || head -c16 /dev/urandom | xxd -p)"
    echo "HAL_MODEL=$MODEL"
    echo "HAL_PORT=3000"
    echo "OLLAMA_CONTEXT_LENGTH=32768"
    echo "WITH_DOCLING=0"
    [ "$GPU" -eq 1 ] && echo "COMPOSE_FILE=docker-compose.yml:docker-compose.gpu.yml"
  } > .env
  chmod 600 .env
else
  MODEL=$(grep -oP '^HAL_MODEL=\K.*' .env || echo "$MODEL")
  log "Keeping existing .env (model: $MODEL)"
fi

# --- 4. Build + start --------------------------------------------------------
log "Building and starting the stack (first build takes a few minutes)..."
dc up -d --build

log "Pulling model '$MODEL' (this is the long part — grab a coffee)..."
dc exec -T ollama ollama pull "$MODEL"

log "Waiting for HAL to come up..."
for i in $(seq 1 60); do
  if curl -fsS "http://localhost:$(grep -oP '^HAL_PORT=\K.*' .env || echo 3000)/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
  [ "$i" -eq 60 ] && { warn "HAL didn't answer in 120s — check: docker compose logs hal"; }
done

# --- 5. Done -----------------------------------------------------------------
PORT=$(grep -oP '^HAL_PORT=\K.*' .env || echo 3000)
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo ""
log "HAL is up."
echo ""
echo "  Open:   http://${IP:-localhost}:${PORT}"
echo ""
dc logs hal 2>/dev/null | grep -B1 -A5 'FIRST-RUN SETUP' | tail -8 || \
  echo "  Invite code: run    docker compose logs hal | grep -A4 FIRST-RUN"
echo ""
echo "  Sign up with that invite code — the first account becomes the admin."
echo "  Docs: docs/install-docker.md · docs/models.md · README.md"
