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
| **LLM (Devstral 24B)** | Ollama | ~15GB | Ready |
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
    { "name": "devstral:24b-small-2505-q4_K_M", "size": 14000000000, "sizeVram": 15000000000 }
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
  "model": "devstral:24b-small-2505-q4_K_M",
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
| `model` | string | No | `devstral:24b-small-2505-q4_K_M` | Ollama model name |
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

If your tool speaks the OpenAI API natively (like OpenCode), use this instead:

```
POST /v1/chat/completions
GET  /v1/models
GET  /v1/logs
```

Same auth header. Streaming and tool calls supported. Configure your tool:

```json
{
  "baseURL": "http://your-hal-server:3000/v1",
  "apiKey": "hal_YOUR_DEVICE_API_KEY",
  "model": "qwen3.5:27b-q4_K_M"
}
```

#### Per-device defaults

HAL applies any `Device.defaults` JSON object as default request params before invoking the model. Request-level params override device defaults, so callers can still pass per-call overrides.

Example device row:
```json
{ "think": false, "temperature": 0.3, "seed": 42 }
```

With those defaults, every `/v1/chat/completions` call from this device gets `think: false` (no Qwen reasoning blocks in the response), `temperature: 0.3`, and `seed: 42` — even if the client doesn't send them. Useful when the calling tool's provider config can't pass arbitrary params.

#### Per-device model pin

If `Device.pinnedModel` is set, that model is **always** used regardless of what the client sends or what the dashboard default is. Designed for security/operations consumers who want to test model upgrades explicitly rather than ride the dashboard default. Coordinate with the consumer before swapping a pinned model.

#### Correlation header (`X-Request-Id`)

Send `X-Request-Id: <your-id>` (alphanumeric / `-` / `_`, max 128 chars) on a `/v1/chat/completions` request. HAL:
- Echoes the value back on the response (`X-Request-Id` header)
- Persists it into `device_api_logs.metadata.requestId`

Lets you join your own logs to HAL's `device_api_logs` rows when debugging.

#### `GET /v1/logs` — pull your own audit logs

Read-only, scoped to the calling API key. No admin or psql access required.

```
GET /v1/logs?limit=50&before=2026-05-01T00:00:00Z
```

Query params:
- `limit` — default 50, capped at 200
- `before` — ISO timestamp; returns rows older than this (cursor pagination — pass back the previous response's `nextCursor`)

Response:
```json
{
  "object": "list",
  "data": [
    {
      "id": "...",
      "endpoint": "/v1/chat/completions",
      "method": "POST",
      "model": "qwen3.5:27b-q4_K_M",
      "status": 200,
      "durationMs": 1832,
      "tokenCount": 1240,
      "error": null,
      "metadata": { "requestId": "my-batch-job-001", "streaming": true },
      "createdAt": "2026-05-02T06:14:22.012Z"
    }
  ],
  "nextCursor": "2026-05-02T06:14:22.012Z"
}
```

Prompt/response bodies are only returned if the device has `logPromptContent` enabled (private-by-default).

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
    model: "devstral:24b-small-2505-q4_K_M",
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
