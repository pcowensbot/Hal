# HAL Device API Documentation

## Overview

HAL now functions as a local LLM server for your IoT devices! Any device on your network can use HAL's GPU-powered LLM by using an API key.

## Features

✅ **Device Management UI** - Create and manage API keys through the dashboard
✅ **Secure API Keys** - SHA-256 hashed keys with `hal_` prefix
✅ **Usage Tracking** - Monitor API calls and last used time for each device
✅ **Multiple Endpoints** - Chat, generate, and list models
✅ **Authenticated Access** - Each device has its own API key tied to a user

---

## Getting Started

### 1. Create a Device API Key

1. Log in to HAL as a parent or user
2. Navigate to **Dashboard** → **My Devices**
3. Click **"Create New Device"**
4. Enter:
   - **Device Name**: e.g., "Vector Bot", "Kitchen Assistant"
   - **Description**: Optional description of what the device does
5. Click **"Create Device"**
6. **Save the API key!** It's only shown once and looks like:
   ```
   hal_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
   ```

### 2. Use the API Key

All API requests must include the API key in the `Authorization` header:

```
Authorization: Bearer hal_YOUR_API_KEY_HERE
```

---

## API Endpoints

Base URL: `http://your-hal-server:3000` (or your public HTTPS domain)

### 1. Chat Endpoint (Conversation)

**POST** `/api/llm/chat`

Best for: Maintaining conversation context with back-and-forth chat

**Request:**
```json
{
  "message": "What's the weather like?",
  "model": "llama3.1:8b",
  "context": [],
  "system": "You are a helpful home assistant"
}
```

**Response:**
```json
{
  "message": "I don't have access to weather data...",
  "model": "llama3.1:8b",
  "device": {
    "id": "device-uuid",
    "name": "Vector Bot"
  },
  "context": [...],
  "done": true,
  "eval_count": 150,
  "eval_duration": 2500000000
}
```

**Example (cURL):**
```bash
curl -X POST http://localhost:3000/api/llm/chat \
  -H "Authorization: Bearer hal_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Tell me a joke",
    "model": "llama3.1:8b"
  }'
```

**Example (Python):**
```python
import requests

url = "http://localhost:3000/api/llm/chat"
headers = {
    "Authorization": "Bearer hal_YOUR_API_KEY",
    "Content-Type": "application/json"
}
data = {
    "message": "Hello from my robot!",
    "model": "llama3.1:8b",
    "system": "You are a helpful robot assistant"
}

response = requests.post(url, json=data, headers=headers)
print(response.json()["message"])
```

---

### 2. Generate Endpoint (Simple)

**POST** `/api/llm/generate`

Best for: Simple text generation without conversation context

**Request:**
```json
{
  "prompt": "Write a haiku about robots",
  "model": "llama3.1:8b",
  "system": "You are a creative poet"
}
```

**Response:**
```json
{
  "response": "Metal hearts that beat\nSilicon dreams come alive\nFuture now arrives",
  "model": "llama3.1:8b",
  "device": {
    "id": "device-uuid",
    "name": "Vector Bot"
  },
  "done": true,
  "context": [...],
  "eval_count": 45,
  "eval_duration": 950000000
}
```

---

### 3. List Models

**GET** `/api/llm/models`

Get available LLM models

**Response:**
```json
{
  "models": [
    {
      "name": "llama3.1:8b",
      "size": 4661224676,
      "modified_at": "2024-01-15T10:30:00Z"
    }
  ],
  "device": {
    "id": "device-uuid",
    "name": "Vector Bot"
  }
}
```

---

## Request Parameters

### Chat Endpoint

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | Yes | User's message |
| `model` | string | No | Model name (default: `llama3.1:8b`) |
| `context` | array | No | Previous conversation messages |
| `system` | string | No | System prompt for the LLM |

### Generate Endpoint

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Text to generate from |
| `model` | string | No | Model name (default: `llama3.1:8b`) |
| `system` | string | No | System prompt for the LLM |

---

## Conversation Context

To maintain conversation history, save the `context` array from each response and send it with the next request:

```python
context = []

# First message
response = requests.post(url, json={
    "message": "What's 2+2?",
    "context": context
}, headers=headers)
context = response.json()["context"]

# Second message (remembers previous)
response = requests.post(url, json={
    "message": "What about 3+3?",
    "context": context
}, headers=headers)
```

---

## Error Handling

### Authentication Errors

**401 Unauthorized:**
```json
{
  "error": "API key required"
}
```

**403 Forbidden:**
```json
{
  "error": "Invalid API key"
}
```

### Validation Errors

**400 Bad Request:**
```json
{
  "error": "Message is required"
}
```

### Server Errors

**500 Internal Server Error:**
```json
{
  "error": "Failed to process chat request",
  "details": "Ollama API error..."
}
```

---

## Security Best Practices

1. **Never commit API keys to git**
2. **Store API keys in environment variables**
3. **Use HTTPS in production** (not HTTP)
4. **Rotate keys periodically** - delete old devices and create new ones
5. **Monitor usage** - Check "Last Used" and "Requests" in the dashboard
6. **Delete unused devices** - Remove API keys for decommissioned devices

---

## Use Cases

### 🤖 Vector Robot Integration
```python
# Vector Bot with HAL LLM
import requests

def ask_hal(question):
    response = requests.post(
        "http://hal-server:3000/api/llm/chat",
        headers={"Authorization": f"Bearer {API_KEY}"},
        json={"message": question, "system": "You are Vector, a helpful robot"}
    )
    return response.json()["message"]

# Vector can now use your local GPU!
answer = ask_hal("Should I charge my battery?")
```

### 🏠 Home Automation
```python
# Smart home assistant
def control_home(command):
    response = requests.post(
        "http://hal-server:3000/api/llm/generate",
        headers={"Authorization": f"Bearer {API_KEY}"},
        json={
            "prompt": f"Parse this smart home command: {command}",
            "system": "Extract device and action from commands"
        }
    )
    return response.json()["response"]
```

### 📱 Custom Chatbot
```python
# Build your own chatbot using HAL's GPU
class HalChatbot:
    def __init__(self, api_key):
        self.api_key = api_key
        self.context = []

    def chat(self, message):
        response = requests.post(
            "http://hal-server:3000/api/llm/chat",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={
                "message": message,
                "context": self.context
            }
        )
        data = response.json()
        self.context = data["context"]
        return data["message"]
```

---

## Rate Limiting

HAL applies the following rate limits:
- **60 requests per minute** per API key
- Applies to all `/api/*` endpoints

If you exceed the limit, you'll receive:
```json
{
  "error": "Too many requests, please try again later"
}
```

---

## Database Schema

Devices are stored with the following structure:

```sql
CREATE TABLE devices (
    id          UUID PRIMARY KEY,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR NOT NULL,
    description TEXT,
    api_key_hash VARCHAR UNIQUE NOT NULL,  -- SHA-256 hash
    last_used_at TIMESTAMP,
    request_count INTEGER DEFAULT 0,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);
```

---

## Next Steps

1. ✅ **Create a device** in the dashboard
2. ✅ **Save the API key** securely
3. ✅ **Test with cURL** to verify it works
4. ✅ **Integrate with your device** using the examples above
5. ✅ **Monitor usage** in the "My Devices" dashboard

---

## Support

Questions? Check:
- `server/src/routes/devices.js` - Device management code
- `server/src/routes/llm.js` - LLM API endpoints
- `server/src/middleware/auth.js` - Authentication logic

Enjoy using HAL as your local LLM server! 🚀🤖
