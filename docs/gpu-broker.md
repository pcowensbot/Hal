# HAL GPU Broker API

> ⚠️ **EXPERIMENTAL** — the broker works (auth, queueing, priorities, LLM routing are
> live), but it is still in development. Known gaps: per-device `defaults` and
> `pinnedModel` are honored on the `/v1` proxy but **not yet merged into the broker
> execution path** (send `model` and options explicitly per job), and the non-LLM
> backends (speech-to-text, image enhancement) are stubs awaiting wiring.

> **Base URL:** `http://your-hal-server:3000`
> **Auth:** Bearer token with HAL device API key (`hal_xxx...`)
> **Updated:** 2026-05-02

HAL exposes a GPU broker API that manages shared access to a single shared GPU. Multiple projects can submit jobs that get queued, prioritized, and routed to the appropriate AI service.

---

## Authentication

All requests require a device API key in the Authorization header:

```
Authorization: Bearer hal_YOUR_DEVICE_API_KEY
```

Get an API key by creating a device in the HAL dashboard (Admin > API Devices).

---

## Services Available

| Service | Backend | VRAM | Status |
|---------|---------|------|--------|
| **LLM (dashboard default model)** | Ollama | model-dependent | Ready |
| **Whisper (STT)** | faster-whisper | ~4GB | Planned — service needs setup |
| **Image Enhance** | Real-ESRGAN | ~1GB | Planned — service needs setup |
| **Image Categorize** | CLIP | ~2GB | Planned — service needs setup |
| **Face Enhance** | GFPGAN | ~1GB | Planned — service needs setup |
| **Astro Stacking** | Python pipeline | ~2GB | Planned — service needs setup |
| **Panorama Stitch** | OpenCV | CPU | Planned — service needs setup |

---

## Endpoints

### GPU Status

```
GET /api/gpu/status
```

Returns GPU hardware stats, loaded models, and queue state.

**Response:**
```json
{
  "gpu": {
    "name": "Tesla V100-SXM2-32GB",
    "vram": { "totalMB": 32768, "usedMB": 15200, "freeMB": 17568 },
    "temperatureC": 42,
    "powerDrawW": 55.3,
    "utilizationPct": 12
  },
  "loadedModels": [
    { "name": "qwen3.6:27b", "size": 14000000000, "sizeVram": 15000000000 }
  ],
  "queue": {
    "active": null,
    "queued": 0,
    "completed": 12,
    "failed": 1
  }
}
```

---

### Job Queue

```
GET /api/gpu/queue
```

Returns the last 50 jobs (newest first).

```
GET /api/gpu/job/:id
```

Returns a specific job's status and result.

**Response:**
```json
{
  "id": 1,
  "type": "llm",
  "service": "ollama",
  "status": "completed",
  "createdAt": "2026-04-07T10:00:00Z",
  "startedAt": "2026-04-07T10:00:01Z",
  "completedAt": "2026-04-07T10:00:05Z",
  "result": { "...model response..." },
  "error": null
}
```

**Job statuses:** `queued` > `processing` > `completed` | `failed`

---

### LLM Chat Completion

```
POST /api/gpu/llm
```

Submit a chat completion request. Supports any model available in Ollama.

**Request:**
```json
{
  "model": "qwen3.6:27b",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello" }
  ],
  "priority": "interactive",
  "tools": [],
  "tool_choice": "auto"
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `model` | string | No | dashboard default model | Ollama model name |
| `messages` | array | Yes | — | OpenAI-format message array |
| `priority` | string | No | `interactive` | `interactive` (wait for result) or `batch` (return job ID) |
| `tools` | array | No | — | Tool definitions for function calling |
| `tool_choice` | string | No | — | Tool choice strategy (`auto`, `none`, etc.) |

**Interactive priority** waits up to 120s and returns the result directly.
**Batch priority** returns immediately with a job ID to poll.

**Interactive response** (same as OpenAI chat completion format):
```json
{
  "id": "chatcmpl-xxx",
  "choices": [
    {
      "message": { "role": "assistant", "content": "Hello! How can I help?" },
      "finish_reason": "stop"
    }
  ]
}
```

**Batch response:**
```json
{
  "jobId": 5,
  "status": "queued",
  "poll": "/api/gpu/job/5"
}
```

---

### OpenAI-Compatible Endpoint (Alternative)

If your tool speaks the OpenAI API natively (like OpenCode), skip the broker and
use HAL's `/v1` surface instead — same auth header, streaming + tool calls,
per-device model pins and defaults, correlation IDs, self-serve request logs.
Full reference: **[DEVICE_API.md](DEVICE_API.md)**.

```
POST /v1/chat/completions
GET  /v1/models
GET  /v1/logs
```

---

### Audio Transcription (Whisper)

```
POST /api/gpu/transcribe
```

Submit audio for speech-to-text transcription or translation.

**Request:**
```json
{
  "audio_url": "http://your-audio-host/recordings/file.wav",
  "language": "en",
  "task": "transcribe",
  "priority": "interactive"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `audio_url` | string | One of these | URL to audio file (accessible from HAL VM) |
| `audio_base64` | string | required | Base64-encoded audio data |
| `language` | string | No | ISO language code (auto-detect if omitted) |
| `task` | string | No | `transcribe` (default) or `translate` (to English) |
| `priority` | string | No | `interactive` or `batch` |

**Response:**
```json
{
  "text": "The transcribed text content",
  "language": "en",
  "duration": 12.5
}
```

---

### Image Enhancement (Real-ESRGAN)

```
POST /api/gpu/image/enhance
```

Batch upscale and denoise images.

**Request:**
```json
{
  "images": [
    "/path/to/photo1.jpg",
    "/path/to/photo2.jpg"
  ],
  "scale": 4,
  "denoise": true
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `images` | string[] | Yes | — | File paths or URLs to images |
| `scale` | number | No | 4 | Upscale factor (2 or 4) |
| `denoise` | boolean | No | true | Apply denoising |

Always returns as batch job (images take time).

---

### Image Categorization (CLIP)

```
POST /api/gpu/image/categorize
```

Auto-categorize photos using CLIP zero-shot classification.

**Request:**
```json
{
  "images": [
    "/path/to/photo1.jpg",
    "/path/to/photo2.jpg"
  ],
  "categories": ["landscape", "portrait", "astrophotography", "macro", "architecture", "wildlife"]
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `images` | string[] | Yes | — | File paths or URLs |
| `categories` | string[] | No | Default set | Custom category labels to classify against |

Default categories: landscape, portrait, astrophotography, macro, architecture, wildlife, street, food, other

---

### Face Enhancement (GFPGAN)

```
POST /api/gpu/image/faces
```

Enhance faces in photos (restoration, sharpening, detail recovery).

**Request:**
```json
{
  "images": ["/path/to/photo1.jpg"]
}
```

---

### Astrophotography Stacking

```
POST /api/gpu/image/stack
```

Stack multiple frames into a single enhanced astrophotography image.

**Request:**
```json
{
  "images": [
    "/path/to/light001.fit",
    "/path/to/light002.fit",
    "/path/to/light003.fit"
  ],
  "darks": ["/path/to/dark001.fit"],
  "flats": ["/path/to/flat001.fit"],
  "biases": ["/path/to/bias001.fit"],
  "method": "sigma-clip"
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `images` | string[] | Yes (min 2) | — | Light frames to stack |
| `darks` | string[] | No | [] | Dark calibration frames |
| `flats` | string[] | No | [] | Flat calibration frames |
| `biases` | string[] | No | [] | Bias calibration frames |
| `method` | string | No | `sigma-clip` | Stacking method: `median`, `mean`, `sigma-clip` |

---

### Panoramic Stitching

```
POST /api/gpu/image/panorama
```

Stitch multiple overlapping photos into a panorama.

**Request:**
```json
{
  "images": [
    "/path/to/pano_001.jpg",
    "/path/to/pano_002.jpg",
    "/path/to/pano_003.jpg"
  ]
}
```

---

## Priority System

| Priority | Behavior | Use Case |
|----------|----------|----------|
| `interactive` | Waits up to 120s for result | Real-time chat, live transcription |
| `batch` | Returns job ID immediately, poll for result | Photo processing, bulk transcription |

Interactive jobs are processed before batch jobs. Within the same priority, jobs are processed first-come-first-served.

---

## Polling Pattern for Batch Jobs

```python
import requests
import time

API = "http://your-hal-server:3000"
HEADERS = {"Authorization": "Bearer hal_YOUR_KEY"}

# Submit batch job
resp = requests.post(f"{API}/api/gpu/image/enhance", json={
    "images": ["/photos/img001.jpg", "/photos/img002.jpg"],
    "scale": 4
}, headers=HEADERS)

job_id = resp.json()["jobId"]

# Poll for completion
while True:
    status = requests.get(f"{API}/api/gpu/job/{job_id}", headers=HEADERS).json()
    if status["status"] in ("completed", "failed"):
        break
    time.sleep(2)

if status["status"] == "completed":
    result = status["result"]
else:
    print(f"Failed: {status['error']}")
```

---

## Node.js / TypeScript Example

```typescript
const API = "http://your-hal-server:3000";
const HEADERS = {
  "Authorization": "Bearer hal_YOUR_KEY",
  "Content-Type": "application/json"
};

// Interactive LLM call (waits for result)
const llmRes = await fetch(`${API}/api/gpu/llm`, {
  method: "POST",
  headers: HEADERS,
  body: JSON.stringify({
    model: "qwen3.6:27b",
    messages: [{ role: "user", content: "Explain DNS resolution" }],
    priority: "interactive"
  })
});
const completion = await llmRes.json();
console.log(completion.choices[0].message.content);

// Batch transcription (returns immediately)
const whisperRes = await fetch(`${API}/api/gpu/transcribe`, {
  method: "POST",
  headers: HEADERS,
  body: JSON.stringify({
    audio_url: "http://your-audio-host/recordings/episode01.wav",
    task: "transcribe",
    priority: "batch"
  })
});
const { jobId } = await whisperRes.json();
// Poll /api/gpu/job/${jobId} for result
```

---

## cURL Examples

```bash
# Check GPU status
curl -H "Authorization: Bearer hal_YOUR_KEY" \
  http://your-hal-server:3000/api/gpu/status

# LLM chat (interactive, waits for response)
curl -X POST -H "Authorization: Bearer hal_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}],"priority":"interactive"}' \
  http://your-hal-server:3000/api/gpu/llm

# Transcribe audio (batch)
curl -X POST -H "Authorization: Bearer hal_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"audio_url":"http://your-audio-host/recordings/ep01.wav","priority":"batch"}' \
  http://your-hal-server:3000/api/gpu/transcribe

# Enhance images (batch)
curl -X POST -H "Authorization: Bearer hal_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"images":["/photos/img001.jpg","/photos/img002.jpg"],"scale":4}' \
  http://your-hal-server:3000/api/gpu/image/enhance

# Check job result
curl -H "Authorization: Bearer hal_YOUR_KEY" \
  http://your-hal-server:3000/api/gpu/job/1
```

---

## Network Layout

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  HAL             │     │  Speech svc        │     │  Image svc      │
│  your-hal-server   │     │  your-audio-host   │     │  your-image-host   │
│                  │     │                  │     │                  │
│  GPU Broker API  │◄────│  Whisper client  │     │  Image pipeline  │
│  Ollama          │     │                  │     │  client          │
│  Tesla V100 32GB │◄────┼──────────────────┼─────│                  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

All API calls go to `http://your-hal-server:3000/api/gpu/*`.

---

## Notes for Claude Code Instances

- The LLM endpoint (`/api/gpu/llm`) is for programmatic access with queuing. For OpenAI-compatible tool integration (OpenCode, etc.), use `/v1/chat/completions` instead
- Image and audio services are not yet running — the API endpoints exist and will queue jobs, but the backend services (Whisper, Real-ESRGAN, CLIP, etc.) need to be installed on the HAL VM
- All image paths should be accessible from the HAL VM (your-hal-server). Use shared mounts or pass URLs
- The queue is in-memory — it resets on HAL server restart. For critical batch jobs, implement retry logic
