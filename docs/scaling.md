# Scaling HAL — Concurrency and Multi-GPU Roadmap

HAL's reference deployment is one server, one GPU, one Ollama — and for a
household or a small team that is genuinely enough. This doc is the road past
that: what actually limits concurrent users, what each upgrade stage buys you,
and what hardware to point money at when you want **10–20 people (and their
agents) hitting HAL's API at the same time**.

> **Honesty up front:** everything through the single-GPU sections is validated
> on the reference deployment. The multi-GPU stages are *designed but not yet
> validated* — the reference hardware is a single V100. The architecture
> supports every stage below (that part is verified in code, and the backend
> seam is exercised in production daily); the throughput numbers are
> back-of-envelope estimates, clearly marked, to be replaced with measurements
> as hardware becomes available. If you run HAL on multi-GPU hardware, open an
> issue and tell us what you measured — that's the fastest way to turn this
> roadmap into documentation.

---

## The architectural seam: HAL doesn't care what serves the tokens

The one design decision that makes everything below possible: HAL talks to its
LLM backend through an OpenAI-shaped provider abstraction, configured entirely
in `.env`:

```bash
# Default — single-box Ollama
LLM_PROVIDER="ollama"
LLM_BASE_URL="http://localhost:11434"

# Any OpenAI-compatible inference server — vLLM, SGLang, LiteLLM, TGI
LLM_PROVIDER="openai"
LLM_BASE_URL="http://inference-box:8000"
# LLM_API_KEY="..."   # if the backend has auth enabled
```

Everything downstream rides through unchanged: the chat UI, streaming, the
`/v1` device proxy, per-device model pins and defaults, usage logging. The
dashboard's model list follows the backend too (`/api/tags` for Ollama,
`/v1/models` for everything else). Swapping the backend is a config change and
a restart — HAL itself needs **zero code changes** for any stage on this page.

So the scaling question is never "can HAL do it" — it's "what should be behind
`LLM_BASE_URL`, and on what silicon."

---

## Where the ceiling is today (one GPU + Ollama)

Ollama is a superb single-box backend — model management, GGUF quants,
automatic layer offload — but it is not built for high concurrency:

- **Requests are processed in a small number of parallel slots**
  (`OLLAMA_NUM_PARALLEL`). Each slot needs its **own KV cache**, so VRAM cost
  of your context length multiplies by the slot count: 64K context × 4 slots
  reserves 4× the KV memory of one slot. On a card that's already carrying a
  27B model, that math runs out fast.
- **No continuous batching.** Requests beyond the slot count queue. One agent
  streaming a long completion holds a slot for the duration.
- **Humans are bursty, agents are not.** Five humans chatting feels instant on
  one card because they rarely collide. Two coding agents + a batch job + three
  humans is where queueing becomes visible.

Realistic single-GPU capacity (validated in production on a V100-32GB with
`qwen3.6:27b` @ 64K): a handful of interactive humans plus one or two agentic
consumers is comfortable. Ten-plus *simultaneous* streams is not what this
stage is for.

### Stage 0 — squeeze the card you have (free)

Before buying anything:

1. **`OLLAMA_KEEP_ALIVE=-1`** — keep the model resident; cold loads are
   10s-class. (The installer's systemd drop-in already does this.)
2. **Budget context deliberately.** KV cache is the silent VRAM eater. 32K is
   plenty for chat; reserve 64K for boxes with headroom. See
   [models.md](models.md).
3. **Tune `OLLAMA_NUM_PARALLEL`** to your VRAM: 2–4 slots at a moderate
   context often beats 1 slot at a huge one for multi-user feel — measure with
   your real workload.
4. **Pin heavy agents to a fast model.** A per-device `pinnedModel` of
   `qwen3-coder:30b` (MoE, 0–2s/turn) keeps agent traffic cheap while chat
   stays on the all-rounder — see [DEVICE_API.md](DEVICE_API.md).

---

## Stage 1 — more GPUs, still Ollama

Adding cards under Ollama buys **capacity and flexibility, not concurrency**:

- **Bigger models:** Ollama splits a model's layers across GPUs automatically
  (or spreads them evenly with `OLLAMA_SCHED_SPREAD=1`). Two 24 GB cards run a
  model neither could alone. This is pipeline-style splitting — it does *not*
  make one request faster, and cross-GPU traffic can even cost a little speed.
- **More resident models:** with `OLLAMA_MAX_LOADED_MODELS`, the chat
  all-rounder lives on GPU 0 and the coder model on GPU 1 — no more
  evict/reload thrash when different consumers want different models.
- **The two-instance hack:** run two Ollama instances, each pinned to a card
  with `CUDA_VISIBLE_DEVICES`, and put nginx `least_conn` in front; point
  `LLM_BASE_URL` at nginx. Crude, doubles your slot count, works today. Its
  limit: both instances need their own copy of the model in VRAM, and you still
  don't have continuous batching.

Stage 1 is the right stop if your problem is "I want a bigger/second model,"
not "I have 20 concurrent users."

---

## Stage 2 — vLLM: the actual concurrency unlock

For 10–20 simultaneous streams the answer is an inference server built for
exactly that. [vLLM](https://github.com/vllm-project/vllm) (SGLang is the
comparable alternative) brings the two things Ollama lacks:

- **Continuous batching** — new requests join the running batch at the next
  token boundary instead of queueing behind whole requests. This is *the*
  feature that turns "20 users" from a queue into a batch.
- **PagedAttention** — KV cache allocated page-wise, so memory serves the
  context actually in use, not the theoretical maximum per slot.

Plus **tensor parallelism** (`--tensor-parallel-size N`): the model's weights
shard across N GPUs which compute each token cooperatively — more aggregate
memory bandwidth per token, which is what token throughput actually is.

```bash
# Example: Qwen 27B-class, 4-bit AWQ, sharded across 2 GPUs
vllm serve Qwen/Qwen3-27B-Instruct-AWQ \
  --tensor-parallel-size 2 \
  --max-model-len 65536 \
  --port 8000
```

```bash
# HAL side — the whole migration:
LLM_PROVIDER="openai"
LLM_BASE_URL="http://inference-box:8000"
LLM_DEFAULT_MODEL="Qwen/Qwen3-27B-Instruct-AWQ"
```

**What changes operationally, honestly:**

| | Ollama | vLLM |
|---|---|---|
| Model source | `ollama pull` (GGUF) | Hugging Face weights (safetensors; AWQ/GPTQ/INT8 quants) |
| Models per server | many, hot-swapped on demand | **one per instance** — model switching means another instance or a router |
| Multi-GPU | layer split (capacity) | tensor parallel (capacity **and** throughput) |
| Concurrency | slot-based | continuous batching |
| Ease | superb | you now operate an inference server |

The "one model per instance" point matters for HAL: the dashboard's
switch-model-per-conversation luxury assumes Ollama. Under vLLM you either
standardize on one model, run a second instance for the second model, or put
**[LiteLLM](https://github.com/BerriAI/litellm)** in front as a router — it
speaks OpenAI on both sides, maps model names to backends, and HAL points at
it exactly like any other backend. A hybrid also works fine: vLLM for the
primary model, the old Ollama for small/occasional ones, LiteLLM routing by
model name.

---

## Sizing: what serves 10–20 concurrent users

Back-of-envelope, to be validated — the arithmetic that matters is
**VRAM = weights + KV cache**, and KV is the concurrency budget:

- A 27B-class model is ~17 GB of weights at 4-bit, ~55 GB at FP16.
- Its KV cache runs very roughly **0.1–0.25 GB per 1K tokens** of active
  context per stream (architecture-dependent; GQA models sit at the low end,
  FP8 KV cache halves it).
- So 20 concurrent conversations at 8–16K active context want roughly
  **20–60 GB of KV headroom** on top of the weights. One 32 GB card can't;
  two 40 GB cards can.

| Cluster | Total VRAM | Comfortable serving target (estimate) |
|---|---|---|
| **2× A100 SXM4 40 GB, TP=2** | 80 GB | 27–32B at 4-bit + ~55 GB KV → **10–20 concurrent 8–16K streams**, interactive speeds. The sweet spot for this doc's title question. |
| **4× A100 SXM4 40 GB, TP=4** | 160 GB | 70B-class at 4-bit with generous KV, or a 27B at bf16 + huge concurrency. Team-of-50 territory. |
| **4× V100 SXM2 32 GB, TP=4** | 128 GB | 27–32B at **FP16** (~55 GB) + ~70 GB KV. See the V100 section below — real, with caveats. |

Per-stream generation speed under load lands wherever aggregate memory
bandwidth divided by active streams puts it — the validation checklist at the
bottom is how we'd turn these rows into measured numbers.

---

## Hardware notes: the A100 SXM4 build

If buying hardware for this today, the recommendation is **2–4× NVIDIA A100
SXM4 40 GB** on a used HGX baseboard — in practice, a second-hand 4-GPU HGX
A100 server (the "Redstone" platform generation from Supermicro, Gigabyte,
Inspur and friends).

Why SXM4 rather than PCIe cards:

- **NVLink (600 GB/s) between all GPUs.** Tensor parallelism synchronizes
  GPUs every layer; over PCIe that chatter taxes throughput, over NVLink it
  disappears. If GPUs will cooperate on one model, the fabric matters.
- **Used SXM4 pricing** has fallen hard precisely *because* modules need a
  baseboard — complete used 4-GPU servers regularly undercut the equivalent
  loose PCIe cards. Check current listings; this market moves.
- **Ampere (sm_80) is the floor worth buying.** bf16, modern quant kernels,
  and — the lesson this project learned the hard way maintaining Volta builds —
  a long support runway. Don't *buy into* an architecture that toolchains are
  actively dropping (see the V100 section for what that looks like).

Practicalities: SXM4 modules are 400 W each — a 4-GPU chassis wants a 240 V
circuit and makes server noise; this is garage/rack equipment, not office
furniture. PCIe alternatives if SXM logistics don't fit: A100 40 GB PCIe
(NVLink only in bridged pairs), L40S / RTX 6000 Ada (Ada: adds FP8, lower
power, no NVLink), or the budget path of paired used RTX 3090/4090s (24 GB,
sm_86/89 — fine for a 2-way 27B at 4-bit).

---

## The V100 cluster path — "run what you have"

A stack of V100s absolutely can serve real concurrent load, and this repo's
audience owns V100s, so let's treat it seriously. **4× V100 SXM2 32 GB is
128 GB of VRAM with genuine NVLink** (SXM2, 300 GB/s) — used 4× SXM2 servers
(Dell C4140, Gigabyte T181/T180 class, Supermicro 1029GQ) sell for scrap-metal
prices compared to what they do.

The structure is there end-to-end: HAL's backend seam doesn't know or care
that the silicon is Volta, and tensor parallelism over SXM2 NVLink is exactly
the topology vLLM was built for. The honest caveats — same story as our
[Volta Ollama builds](models.md#older-gpus-pascal--volta-read-this-before-upgrading-ollama),
one layer up the stack:

- **Modern vLLM dropped Volta** just like stock Ollama ≥0.30 did (its current
  engine assumes sm_80+ attention kernels). Running this path means **pinning
  an older vLLM release that still ships sm_70 support** — trailing features,
  not trailing correctness. Community sm_70 builds of newer stacks are the
  same game we already play with Ollama.
- **No bf16 on Volta, and modern 4-bit kernels increasingly assume sm_75+** —
  plan around **FP16 weights**, which is why the sizing row above runs a 27B
  at ~55 GB instead of ~17 GB. With 128 GB total, that still leaves a wide KV
  budget.
- **EOL horizon:** driver branch 580 is the end of the line for Volta. A V100
  cluster is a *run-what-you-own* play with a known sunset, not a purchase
  recommendation — buy Ampere+, run Volta if it's already on your shelf.

Status: **designed, not validated** — the reference deployment has one V100,
not four. If you have a multi-V100 box and want to be the validation story,
open an issue; we will absolutely work through it with you.

---

## What this means inside HAL (the actual roadmap)

Stages 0–2 need **no HAL changes** — that's the point of the seam. Items on
HAL's own list to make multi-backend life nicer, roughly in order:

1. **Backend health fan-out** — `/api/health` and the dashboard currently
   check one `LLM_BASE_URL`; teach them to enumerate a router's backends.
2. **Per-device backend routing** — `pinnedModel` already routes per consumer;
   a natural extension lets a device pin imply a different backend (today
   LiteLLM covers this externally).
3. **Measured sizing tables** — replace every "estimate" on this page with
   numbers from real 2×/4× GPU runs (community hardware reports welcome).
4. **Broker awareness** — the experimental [GPU broker](gpu-broker.md)
   currently assumes one GPU's VRAM ledger; multi-GPU means per-device
   accounting.

## Validation checklist (when the hardware lands)

What we'd measure, in order, on any multi-GPU rig — and what a community
report ideally includes:

1. Single-stream generation speed (tok/s) — TP=1 vs TP=N, same model/quant.
2. Aggregate tok/s and per-stream floor at 5 / 10 / 20 concurrent streams,
   realistic mixed prompts (chat + one long-context agent).
3. Time-to-first-token at each concurrency step (queueing shows up here first).
4. KV headroom in practice: max concurrent 16K-context streams before
   preemption/eviction.
5. Tool-calling correctness under batching pressure (HAL's agent consumers
   care more about this than raw speed).
6. Failure modes: backend restart mid-stream, model reload, one-GPU-lost.

---

*TL;DR — one GPU + Ollama serves a household; tuned, it serves a small team.
The moment "simultaneous" is the operative word, put vLLM behind
`LLM_BASE_URL` on 2–4 NVLinked GPUs — A100 SXM4 40 GB if buying, V100 SXM2
if you already own them — and HAL rides along without a code change.*
