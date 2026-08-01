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
| OS | Ubuntu 22.04/24.04 (any systemd Linux works) | — |
| CPU / RAM | 4 cores / 8 GB | 8+ cores / 32 GB |
| Disk | 50 GB SSD | 200 GB+ |
| GPU | none (CPU works with small models) | NVIDIA 8–32 GB VRAM |

Which model fits your card → [docs/models.md](docs/models.md). Running HAL in a Proxmox VM → [docs/proxmox-gpu-passthrough.md](docs/proxmox-gpu-passthrough.md).

> **Older (pre-Turing) GPUs:** Pascal and Volta cards — GTX 10-series, Tesla P100/V100, Titan V, Quadro GV100 — need a source-built Ollama because stock releases ≥0.30 dropped them. The whole Volta (sm_70) family should work; **only the Tesla V100 has been verified** (it's what the reference deployment runs). See *Older GPUs* in [docs/models.md](docs/models.md).

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

Want to spread it out — SSL on a separate reverse-proxy host, HAL in a VM with GPU passthrough, models served to several machines? That's exactly how the reference deployment runs. See the *advanced layouts* sections of the install docs and the Proxmox guide.

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
| [docs/gpu-broker.md](docs/gpu-broker.md) | Experimental multi-project GPU job broker |

## Contributing

Issues and pull requests are welcome. HAL is licensed under the **AGPL-3.0**: you can run it, modify it, and share it freely — but if you distribute a modified version or offer it as a network service, you must publish your changes under the same license. Improvements flow back to everyone. That's the deal.

## License

[GNU Affero General Public License v3.0](LICENSE)
