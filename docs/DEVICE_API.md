# Device API — HAL as your LAN's LLM server

Any machine on your network — coding agents, scripts, bots, home automation,
another server — can use HAL's GPU as its LLM backend through a **device API
key**. HAL exposes two surfaces for this:

| Surface | Use it for |
|---|---|
| **`/v1` — OpenAI-compatible** (primary) | Anything that speaks the OpenAI API: OpenCode and other coding agents, OpenAI SDKs, LangChain, MCP clients, LiteLLM. Streaming, tool calling, per-device policy. |
| **`/api/llm` — simple JSON** (legacy) | Tiny clients where an OpenAI SDK is overkill — a microcontroller, a shell script, a robot. One POST, one JSON reply. |

Both authenticate the same way and both log to the same per-device audit trail.

---

## 1. Create a device key

1. Log in to HAL → **Dashboard → Devices**
2. **Create New Device** — name it after the consumer ("OpenCode — laptop",
   "Kitchen assistant"), description optional
3. **Copy the key immediately** — it's shown once, then only its SHA-256 hash
   is stored:

   ```
   hal_a1b2c3d4e5f6...
   ```

Send it on every request:

```
Authorization: Bearer hal_YOUR_API_KEY
```

Base URL: `http://your-hal-server:3000` (or your HTTPS domain — use HTTPS for
anything that leaves your LAN).

---

## 2. The `/v1` OpenAI-compatible API

### Endpoints

```
POST /v1/chat/completions    # chat, streaming, tool calls
GET  /v1/models              # models available to point at
GET  /v1/logs                # your own request logs (see §4)
```

### Point your tool at HAL

Generic OpenAI-style config — works for most tools:

```json
{
  "baseURL": "http://your-hal-server:3000/v1",
  "apiKey": "hal_YOUR_API_KEY",
  "model": "qwen3.6:27b"
}
```

Python (OpenAI SDK):

```python
from openai import OpenAI

client = OpenAI(base_url="http://your-hal-server:3000/v1",
                api_key="hal_YOUR_API_KEY")

resp = client.chat.completions.create(
    model="qwen3.6:27b",
    messages=[{"role": "user", "content": "Explain DNS in two sentences."}],
    stream=True,
)
for chunk in resp:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

cURL:

```bash
curl -X POST http://your-hal-server:3000/v1/chat/completions \
  -H "Authorization: Bearer hal_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3.6:27b","messages":[{"role":"user","content":"say hi"}]}'
```

Supported request features: `stream` (SSE), `tools` + `tool_choice` (function
calling), sampling params (`temperature`, `seed`, …), and `think`
(enable/disable reasoning blocks on models that support thinking — an
extension beyond the OpenAI schema, passed through to the backend).

If you omit `model`, HAL resolves one for you — see the pin/default ladder
below.

### Per-device model pin (`pinnedModel`)

Set a **pinned model** on the device row and that model is used **regardless
of what the client sends**. Model resolution, most specific wins:

1. Device `pinnedModel` — beats everything
2. `model` in the request
3. Dashboard default model
4. `LLM_DEFAULT_MODEL` env fallback

Use pins to give a coding agent the fast agentic model while chat keeps the
all-rounder, or to hold a production consumer on a known-good model while you
test upgrades. Coordinate before swapping a pinned model — the consumer can't
override it.

### Per-device defaults (`defaults`)

A JSON object of request parameters merged **under** every request from that
device — request-level values win. Example device row:

```json
{ "think": false, "temperature": 0.3, "seed": 42 }
```

Every call from that device now gets deterministic, no-reasoning-blocks
behavior even when the calling tool can't pass custom params. This is the
lever for tools whose provider config is rigid.

### Correlation IDs (`X-Request-Id`)

Send `X-Request-Id: <your-id>` (alphanumeric / `-` / `_`, max 128 chars) and
HAL echoes it on the response and persists it into that request's log row
(`metadata.requestId`) — join your logs to HAL's when debugging.

---

## 3. Limits & payload caps

| Limit | Default | Where |
|---|---|---|
| `/v1` requests per key | 30/min | `V1_RATE_LIMIT_WINDOW_MS` / `V1_RATE_LIMIT_MAX_REQUESTS` |
| `/api/*` requests | 60/min | `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS` |
| Per-user daily / monthly call quotas | unset | Per-user, set by an admin in the dashboard |
| `/v1` request body | 2 MB | Express body limit on `/v1` |
| `/v1` `messages` payload | 100 KB | `V1_MAX_MESSAGES_BYTES` — raise it (e.g. `2000000`) if agents send big file context |

Exceeding a quota returns `429` with detail:

```json
{ "error": "Daily API limit reached (500 calls). Resets at midnight.",
  "limitType": "daily", "current": 500, "limit": 500 }
```

An oversize `messages` payload returns `413` with the byte counts in the
message.

---

## 4. `GET /v1/logs` — pull your own audit logs

Read-only, scoped to the calling key. Debug your own traffic without admin
access or psql.

```
GET /v1/logs?limit=50&before=2026-05-01T00:00:00Z
```

- `limit` — default 50, max 200
- `before` — ISO timestamp cursor; pass the previous response's `nextCursor`

```json
{
  "object": "list",
  "data": [
    {
      "id": "…",
      "endpoint": "/v1/chat/completions",
      "model": "qwen3.6:27b",
      "status": 200,
      "durationMs": 1832,
      "tokenCount": 1240,
      "metadata": { "requestId": "my-batch-job-001", "streaming": true },
      "createdAt": "2026-05-02T06:14:22.012Z"
    }
  ],
  "nextCursor": "2026-05-02T06:14:22.012Z"
}
```

Prompt/response *bodies* appear only if the device has `logPromptContent`
enabled — private by default.

---

## 5. The legacy `/api/llm` endpoints

Minimal JSON endpoints for clients that don't want an OpenAI SDK. Same
`Authorization` header.

### `POST /api/llm/chat`

```json
{
  "message": "Should I charge my battery?",
  "system": "You are Vector, a helpful robot",
  "context": [],
  "model": "qwen3:8b"
}
```

`model` and `system` are optional (model falls back to the dashboard default).
`context` is an OpenAI-style message array — send back the `context` from the
previous response to continue a conversation:

```json
{
  "message": "I don't have access to your battery data…",
  "model": "qwen3:8b",
  "device": { "id": "device-uuid", "name": "Vector Bot" },
  "context": [ …full message history including this reply… ],
  "done": true,
  "eval_count": 150
}
```

```python
import requests

URL = "http://your-hal-server:3000/api/llm/chat"
HEADERS = {"Authorization": "Bearer hal_YOUR_API_KEY"}

context = []
for question in ["What's 2+2?", "And doubled?"]:
    r = requests.post(URL, headers=HEADERS,
                      json={"message": question, "context": context}).json()
    context = r["context"]          # carries the conversation forward
    print(r["message"])
```

### `POST /api/llm/generate`

One-shot generation, no conversation state:

```json
{ "prompt": "Write a haiku about robots", "system": "You are a poet" }
```

→ `{ "response": "…", "model": "…", "device": {…}, "done": true, "eval_count": 45 }`

### `GET /api/llm/models`

→ `{ "models": [ { "name": "qwen3.6:27b", … } ], "device": {…} }`

---

## 6. Errors

| Status | Meaning |
|---|---|
| `401` | Missing API key |
| `403` | Invalid or deleted key |
| `400` | Validation — empty `message`/`prompt`, malformed body |
| `413` | `messages` payload over `V1_MAX_MESSAGES_BYTES` |
| `429` | Per-minute rate limit or per-user daily/monthly quota (see §3) |
| `500` | Backend failure — check `GET /v1/logs`, then HAL's logs (`pm2 logs hal`) |

---

## 7. Key hygiene

1. **One key per consumer** — revoking one tool shouldn't break the others,
   and per-device logs stay meaningful
2. Store keys in env vars / secret stores, never in git
3. HTTPS for anything beyond your LAN
4. Watch **Last Used** and request counts in the dashboard; delete keys for
   decommissioned consumers
5. Rotate by creating a new device and deleting the old one

---

## Related

- **[gpu-broker.md](gpu-broker.md)** — the experimental queued job broker
  (`/api/gpu/*`) for sharing the GPU across whole projects
- **[models.md](models.md)** — which model to pin for which consumer
- **[scaling.md](scaling.md)** — when one GPU stops being enough for all of
  your devices at once
