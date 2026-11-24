# HAL — Your Own AI Server

**Self-hosted AI chat for your home or team. Your hardware, your models, your data. No cloud accounts, no API keys, no subscriptions.**

HAL is a complete AI assistant platform that runs on a single server: a fast chat UI with streaming responses, image understanding, a knowledge base, multi-user accounts with roles and invites — plus an OpenAI-compatible API so every other tool on your network (coding agents, scripts, bots) can use your GPU as *their* LLM backend too.

Everything runs locally against [Ollama](https://ollama.com). Nothing leaves your machine.

---

## Quick Start

**Option A — Docker (recommended):** one command installs Docker, detects your NVIDIA GPU, picks a model that fits your VRAM, and starts everything:

```bash
curl -fsSL https://raw.githubusercontent.com/pcowensbot/Hal/main/install.sh | bash
```

**Option B — Bare metal (no Docker):** native PostgreSQL/Redis/Node/Ollama under systemd + PM2, same one-line experience:

```bash
curl -fsSL https://raw.githubusercontent.com/pcowensbot/Hal/main/install-baremetal.sh | bash
```

Either way, the installer finishes by printing a **one-time invite code**. Open `http://<your-server>:3000`, sign up with the code, and you're the administrator. Invite everyone else from the dashboard.

Full walkthroughs (including doing every step by hand): [docs/install-docker.md](docs/install-docker.md) · [docs/install-baremetal.md](docs/install-baremetal.md)

### Requirements

| | Minimum | Comfortable |
|---|---|---|
| OS | Ubuntu 22.04 / 24.04 / 26.04 — all three validated end-to-end | — |
| CPU / RAM | 4 cores / 8 GB | 8+ cores / 32 GB |
| Disk | 50 GB SSD | 200 GB+ |
| GPU | none (CPU works with small models) | NVIDIA 8–32 GB VRAM |

Which model fits your card → [docs/models.md](docs/models.md), including how to pull more models for HAL to use. Running HAL in a Proxmox VM → [docs/proxmox-gpu-passthrough.md](docs/proxmox-gpu-passthrough.md).

> **Older (pre-Turing) GPUs:** stock Ollama works on Volta (sm_70 — Tesla V100, Titan V, Quadro GV100) through its CUDA 12 runner (verified with stock 0.40.4 on a Tesla V100). Stock also ships Pascal (sm_60/61) kernels, unverified by us. Stay on the 580 driver branch, the last one for these cards. See *Older GPUs* in [docs/models.md](docs/models.md).
>
> *Earlier versions of this README said stock Ollama dropped these cards. That was wrong; details in the Volta section below.*

---

## Features

**Chat**
- Streaming responses (SSE), markdown with tables and syntax-highlighted code, copy buttons
- Vision: attach images to chat (with a vision-capable model)
- Attach PDFs and documents (optional Docling processing)
- Artifacts panel — code/HTML the assistant produces is detected, previewable, downloadable, and savable to the knowledge base
- Conversation folders, sharing via public links, import of existing conversations

**Knowledge Base**
- Organize notes into books, star chat answers straight into it
- Import documents (PDF/DOCX → markdown via Docling)

**Multi-user**
- Invite-code signup, roles (Admin/Manager/Member/Guest + custom roles), groups
- Admin dashboard: users, invites, models, system + GPU monitoring
- Per-user usage tracking

**Your LAN's LLM server — the OpenAI-compatible `/v1` API**
- Create device API keys in the dashboard, then point any OpenAI-compatible tool (OpenCode, scripts, home automation, other services) at `http://your-hal-server:3000/v1`
- Per-device model pinning and default parameters, request logs viewable per device, correlation IDs
- Details: [docs/DEVICE_API.md](docs/DEVICE_API.md)

**Operations**
- Single server, boring stack: Node/Express, PostgreSQL, Redis, React
- Multi-GPU ready: point `LLM_BASE_URLS` at N same-model backends and HAL routes each consumer to a consistent replica, with failover ([docs/scaling.md](docs/scaling.md))
- Structured pino logging, health endpoint, rate limiting, helmet security headers
- Automatic DB migrations on start; nightly-backup recipe in the docs

## Experimental (in development)

- **GPU broker API** (`/api/gpu/*`) — queued, prioritized job sharing of one GPU across multiple projects/services. Works for LLM jobs; rough edges documented in [docs/gpu-broker.md](docs/gpu-broker.md).
- **Browser import extension** ([extension/](extension/)) — imports your Claude.ai / ChatGPT conversation history into HAL. Selector-fragile; expect tuning.

---

## Architecture

```
                ┌────────────────────── your server ──────────────────────┐
  Browser ────► │  HAL (Node/Express + React)                             │
                │   ├── PostgreSQL  (users, chats, knowledge)             │
  Other tools ► │   ├── Redis       (rate limits, revocation)             │
  via /v1       │   └── Ollama      (LLM inference on your GPU)           │
                └─────────────────────────────────────────────────────────┘
```

Want to spread it out — SSL on a separate reverse-proxy host, HAL in a VM with GPU passthrough, models served to several machines? That's exactly how the reference deployment runs. See the *advanced layouts* sections of the install docs and the Proxmox guide. Outgrowing one GPU — 10–20 concurrent users, multi-GPU serving, vLLM behind HAL? That's [docs/scaling.md](docs/scaling.md); the backend is swappable by design.

## Configuration

All server config lives in `server/.env` (bare metal) or `.env` next to `docker-compose.yml` (Docker). See [`server/.env.example`](server/.env.example) for the full surface: ports, model defaults, context length, CORS, rate limits. The default model can be changed anytime from the admin dashboard.

HAL speaks to any OpenAI-compatible backend — Ollama is the default, but `LLM_PROVIDER=openai` + `LLM_BASE_URL` points it at vLLM/SGLang/LiteLLM instead.

## Documentation

| Doc | What's in it |
|---|---|
| [docs/install-docker.md](docs/install-docker.md) | Docker path: manual steps, updating, backups, reverse proxy |
| [docs/install-baremetal.md](docs/install-baremetal.md) | Bare-metal path: every step by hand, nginx + SSL, nightly backups |
| [docs/models.md](docs/models.md) | Choosing a model for your VRAM, context-length tuning, older GPUs |
| [docs/proxmox-gpu-passthrough.md](docs/proxmox-gpu-passthrough.md) | Passing an NVIDIA GPU into a Proxmox VM |
| [docs/DEVICE_API.md](docs/DEVICE_API.md) | Device keys + the OpenAI-compatible `/v1` API |
| [docs/scaling.md](docs/scaling.md) | Concurrency + multi-GPU roadmap — serving 10–20 users, vLLM, A100/V100 clusters |
| [docs/gpu-broker.md](docs/gpu-broker.md) | Experimental multi-project GPU job broker |

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). First-time contributors sign a [CLA](CLA.md) (a licence grant, not a copyright assignment — you keep your copyright) so the project can maintain its dual-licence structure. Security issues: [SECURITY.md](SECURITY.md), privately please.

## Just here for the Volta Ollama binary?

**You probably don't need it.** Stock Ollama runs on Volta: its CUDA 12 runner
carries sm_70 kernels, and on a V100 `journalctl -u ollama | grep "inference compute"`
shows `compute=7.0` with `cuda_v12`. Use the normal ollama.com install and stay
on the 580 driver branch.

**Correction (2026-11-24):** earlier versions of this project said stock Ollama ≥0.30 dropped Pascal and Volta. That was wrong, and we never actually tested it. Stock Ollama's CUDA 12 runner (`lib/ollama/cuda_v12`) ships sm_60/61/70 kernels (checked in 0.32.4 and 0.40.4), and stock 0.40.4 runs on a Tesla V100 at compute 7.0, 100% GPU. Only its CUDA 13 runner skips these cards, and Ollama falls back to the CUDA 12 runner on its own. Thanks to the [volta-forever](https://github.com/nbald/volta-forever) project for catching it.

We keep our own build around as an optional, older alternative (we run a tuned
source build in production), and the recipe below still works if you want to
build Ollama yourself for sm_70.

**Grab the binary (optional):** [Releases](https://github.com/pcowensbot/Hal/releases) →
`ollama-0.32.4-volta-linux-amd64-sm70.tgz` (sha256 in the release notes).
Drop-in over an existing Ollama install:

```bash
sudo systemctl stop ollama
sudo tar -C /usr/local -xzf ollama-0.32.4-volta-linux-amd64-sm70.tgz
sudo systemctl start ollama
ollama --version    # → 0.32.4-volta
journalctl -u ollama | grep "inference compute"   # expect compute=7.0
```

Verified on **Tesla V100-SXM2-32GB** (daily production use: `qwen3.6:27b`,
64K context, full tool calling, 100% GPU). Titan V / Quadro GV100 / other V100
variants should work identically — if yours doesn't, open an issue and we'll
work through it. Built on Ubuntu 22.04 for glibc portability; runs on
22.04/24.04/26.04.

Running the ollama.com installer over this build replaces it with stock Ollama,
which also works on Volta. Back up `/usr/local/bin/ollama` and
`/usr/local/lib/ollama` first if you want to be able to switch back.

**Want to replicate the build?** The recipe, for the trust-nobody crowd:

```bash
# Toolchain: CUDA 12.6 TOOLKIT (the CUDA-13 driver runs CUDA-12 binaries fine)
# + Go 1.25.x — NOT 1.26.x (its toolchain currently segfaults on this codebase)
# + cmake ≥ 3.24 — Ubuntu 22.04's distro cmake (3.22) is too old; grab a
#   binary release from Kitware on jammy
sudo apt install -y cuda-toolkit-12-6 ninja-build git   # via NVIDIA's cuda-keyring repo

git clone https://github.com/ollama/ollama.git && cd ollama
git checkout v0.32.4

export PATH=/usr/local/cuda-12.6/bin:/usr/local/go/bin:$PATH
export CUDACXX=/usr/local/cuda-12.6/bin/nvcc
go mod edit -go=1.25.0 -toolchain=none   # go.mod says 1.26; no 1.26-only features used

# "70" explicitly (not "native") so artifacts run on any sm_70 card, 16 GB or 32 GB
cmake -B build . -DOLLAMA_LLAMA_BACKENDS=cuda_v12 -DCMAKE_CUDA_ARCHITECTURES=70
cmake --build build --parallel $(($(nproc)-2))
GOTOOLCHAIN=local go build -ldflags "-X github.com/ollama/ollama/version.Version=0.32.4-volta" -o ollama-volta .

# Verify the sm_70 kernels actually landed:
cuobjdump --list-elf build/lib/ollama/cuda_v12/libggml-cuda.so | head -3
# expect: ...sm_70.cubin
```

Build on the **oldest distro you intend to run on** (we build on 22.04) — a
binary built on a newer glibc won't load on older systems. Install layout
mirrors stock: binary → `/usr/local/bin/ollama`, payload →
`/usr/local/lib/ollama/` (bundle the CUDA 12.6 runtime libs alongside).

## License

HAL is **dual-licensed** — see [LICENSING.md](LICENSING.md) for the full picture:

- **[AGPL-3.0](LICENSE)** (free) — for almost everybody. Run it, modify it, use it at work, serve your whole team. The only obligation: if you distribute it or offer a modified HAL as a network service, you publish your changes under the same licence.
- **Commercial licence** (paid) — for shipping HAL inside proprietary products, hosting it as a service with private modifications, or organisations whose policy forbids AGPL. Revenue funds development and, eventually, a security bug bounty.

Every release is AGPL-3.0 and stays AGPL-3.0 — the commercial licence is an additional option, not a step toward closing the project.
