# Choosing a Model

HAL uses [Ollama](https://ollama.com) as its LLM backend. Any model Ollama can run,
HAL can serve — but not every model is a good fit. HAL leans hard on tool calling
(its OpenAI-compatible `/v1` proxy serves agentic tools like coding agents), so
model choice matters more than raw benchmark scores.

This guide covers what we've verified on a reference deployment. Pull commands are
exact tags — pick one, run it, point HAL at it.

## TL;DR — pick by VRAM

| VRAM | Recommended model | Pull command |
|------|-------------------|--------------|
| 32 GB | `qwen3.6:27b` | `ollama pull qwen3.6:27b` |
| 24 GB | `qwen3.6:27b` (reduce context) or `qwen3-coder:30b` for agentic speed | `ollama pull qwen3.6:27b` |
| 16 GB | `devstral:24b-small-2505-q4_K_M` | `ollama pull devstral:24b-small-2505-q4_K_M` |
| 12 GB | `qwen2.5:14b-instruct-q4_K_M` | `ollama pull qwen2.5:14b-instruct-q4_K_M` |
| 8 GB | `qwen3:8b` or `llama3.1:8b-instruct-q4_K_M` | `ollama pull qwen3:8b` |
| < 8 GB / older cards | `qwen3:4b` or `mistral:7b` | `ollama pull qwen3:4b` |

For smoke tests and CI canaries (is Ollama up? does the pipeline work end to end?),
keep `qwen3:0.6b` around — 522 MB-class tiny model, loads in a blink, useless for
real chat but perfect for "is this thing on?" checks.

## Adding models — pulling them down for HAL to pick up

The installer pulls exactly one model. Everything else is one command away —
HAL automatically lists **every model Ollama has on disk**, so pulling a model
*is* installing it:

**Bare-metal install:**

```bash
ollama pull qwen3:8b            # or any tag from ollama.com/library
ollama list                     # confirm it landed
```

**Docker install** (run from your HAL directory):

```bash
docker compose exec ollama ollama pull qwen3:8b
docker compose exec ollama ollama list
```

The new model shows up in HAL's model picker immediately — no restart needed.
To make it the default for everyone: **Dashboard → Models** (admin), or leave
the default alone and switch per-conversation in the chat UI. To free the disk
space back: `ollama rm <model>` (same `docker compose exec` wrapper on Docker).

Browse what's available at [ollama.com/library](https://ollama.com/library) —
anything there works, subject to your VRAM (chart above).

## What matters for HAL specifically

Four things separate a good HAL model from a frustrating one:

1. **Tool calling quality.** HAL's `/v1` proxy serves agentic tools — coding
   agents, MCP clients, automation. The model has to emit well-formed structured
   tool calls, every time. A model that mangles JSON arguments 5% of the time is
   a model that breaks your agent 5% of the time.

2. **Tool restraint.** Just as important and much rarer: knowing when *not* to
   call a tool. A model with poor restraint will fire tool calls in response to
   "good morning" and ruin chat UX. Some otherwise-excellent agentic models fail
   this badly (see `qwen3-coder:30b` below).

3. **Vision.** HAL's chat supports image attachments. If you want that to work,
   pick a model with vision support — most of the models on this list don't have it.

4. **Context length.** Long agentic sessions and big pasted documents eat context
   fast. More context costs VRAM (next section).

### Model notes

- **`qwen3.6:27b`** — the flagship all-rounder. Excellent tool calling *and*
  excellent tool restraint, vision support, thinking mode, 256K native context.
  ~17 GB on disk, ~20 GB VRAM at 64K context. Best choice for 24–32 GB cards.
  Requires Ollama ≥ 0.31.
- **`qwen3-coder:30b`** — MoE with only 3.3B active parameters, which makes it
  the *fastest* agentic option here (0–2s per turn). Perfect structured tool
  calls. But: zero tool restraint (it will call tools when it shouldn't) and no
  vision. Great as a dedicated coding-agent backend (OpenCode and similar) on
  24 GB+; a poor choice as your general chat model.
- **`qwen3.5:27b-q4_K_M`** — previous-generation all-rounder, still solid.
  ~20 GB VRAM.
- **`qwen2.5:32b-instruct-q4_K_M`** — strong tool calling, non-thinking. ~19 GB.
- **`devstral:24b-small-2505-q4_K_M`** — coding-focused, fits 16–24 GB.
- **`qwen2.5:14b-instruct-q4_K_M`** — good middle ground for 12–16 GB cards.
- **`qwen3:8b`, `llama3.1:8b-instruct-q4_K_M`** — solid picks for 8 GB cards.
- **`qwen3:4b`, `mistral:7b`** — small or older cards. Note `mistral:7b` clamps
  to its native 32K max context no matter what you request.
- **`qwen3:0.6b`** — tiny canary. Smoke tests only.

## Context length vs VRAM

The model weights are only part of the VRAM bill. The KV cache grows with context
length, so the *same* model can need several more GB at 64K context than at 32K.
If a model that "should fit" is spilling to CPU (slow generation, high RAM use),
try halving the context before reaching for a smaller model.

HAL requests context via the `LLM_CONTEXT_LENGTH` env var (in HAL's `.env`):

```
LLM_CONTEXT_LENGTH=65536
```

Rules of thumb:

- 32K is plenty for chat.
- 64K is comfortable for agentic coding sessions.
- Models clamp to their own native maximum regardless of what you ask for
  (e.g. `mistral:7b` tops out at 32K).

## IMPORTANT: context length and the /v1 proxy

Here's the gotcha that costs people an afternoon: **Ollama's OpenAI-compatible
`/v1` endpoint ignores per-request `num_ctx`.** HAL's native chat path can pass
context options through, but anything going through the `/v1` proxy — external
tools, coding agents, MCP clients — gets whatever context Ollama's server-wide
default is (historically a small one).

If you use HAL's `/v1` proxy at all, set the context length server-wide on Ollama
itself via a systemd drop-in. Create
`/etc/systemd/system/ollama.service.d/context-length.conf`:

```ini
[Service]
Environment="OLLAMA_CONTEXT_LENGTH=65536"
# Optional: keep the model resident in VRAM instead of unloading after idle.
# Recommended if HAL is the GPU's main tenant — eliminates cold-start latency.
Environment="OLLAMA_KEEP_ALIVE=-1"
```

Then apply it:

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

Match the value to your VRAM budget (remember the KV cache math above). Models
with smaller native maximums will still clamp down safely.

## How HAL picks a model

Model selection has three layers, most specific wins:

1. **Per-device `pinnedModel`** (Device API) — pins a specific model for one
   device/API client. Overrides everything else for that device. Use this to give
   a coding agent `qwen3-coder:30b` while chat stays on the all-rounder.
2. **DB setting `defaultModel`** — set from the admin dashboard. The normal way
   to pick your model; overrides the env var.
3. **`LLM_DEFAULT_MODEL` env var** — the fallback when no DB setting exists
   (e.g. a fresh install before first admin login).

## Quantization in 30 seconds

The `q4_K_M` suffix means 4-bit K-quant, medium variant — and it's the sweet spot
for self-hosting: roughly a quarter of the full-precision memory footprint with
quality loss that's barely measurable in practice. Going lower (q3, q2) saves a
little more VRAM but degrades noticeably, especially for tool calling; going
higher (q5, q6, q8) costs a lot of VRAM for gains you'll rarely notice. When a
tag doesn't specify a quant, Ollama's default is usually q4_K_M-class anyway.

## Older GPUs (Pascal / Volta): read this before upgrading Ollama

Stock Ollama ≥ 0.30 **dropped support for pre-Turing GPUs** — Pascal (sm_60:
GTX 10-series, Tesla P100) and Volta (sm_70: Tesla V100 in all variants, Titan V,
Quadro GV100). These cards still run modern models perfectly well; upstream just
stopped shipping kernels for them.

If you have one of these cards:

- **Driver: stay on the 580 branch** — it's the last NVIDIA driver branch that
  supports Pascal/Volta (≥590 dropped them). `ubuntu-drivers install` picks
  correctly on Ubuntu 24.04/26.04 (verified — it only offers 580 for a V100).
  **On 22.04 do NOT trust the "recommended" pick** — jammy recommends the
  legacy **390** branch for a V100 (verified), which is useless for modern
  inference. The HAL installer works around this by installing the newest
  branch that claims the card; if installing manually, pin it:
  `sudo apt install nvidia-driver-580-server`.

### Volta (sm_70): we include the binary

**HAL ships a prebuilt Volta Ollama** on the
[Releases page](https://github.com/pcowensbot/Hal/releases) — CUDA kernels for
compute capability 7.0, currently `ollama-0.32.4-volta`. The bare-metal
installer detects a Volta card and installs it automatically. Manual install:

```bash
sudo systemctl stop ollama
sudo tar -C /usr/local -xzf ollama-0.32.4-volta-linux-amd64-sm70.tgz
sudo systemctl start ollama
ollama --version   # → 0.32.4-volta
```

The **Tesla V100 is fully vetted** — it's what the reference deployment runs in
production, daily. The rest of the family (Titan V, Quadro GV100, all V100
variants) should work identically; if yours doesn't, **open an issue** and
we'll work through it. The tarball is built on Ubuntu 22.04 for glibc
portability and runs on 22.04/24.04/26.04. A 32 GB V100 remains a genuinely great HAL card: it runs
`qwen3.6:27b` at 64K context with room to spare.

**Pascal (sm_60)** has no prebuilt binary yet — you must **build Ollama from
source** with the CUDA architecture flags for your card. If there's demand,
sm_60 builds may follow — open an issue and say so.

Care and feeding of a custom build:

- **Never upgrade via the ollama.com installer.** It will silently replace the
  Volta build with a stock binary, and GPU inference breaks with no obvious
  error — inference just quietly falls back to CPU or fails to load. Upgrades
  mean installing the next Volta build from Releases (or rebuilding from source).
- Keep a backup of your known-good binary and library payload
  (`/usr/local/bin/ollama`, `/usr/local/lib/ollama`) before any change so you
  can roll back.
