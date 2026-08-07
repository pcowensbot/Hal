// LLM Provider Abstraction Layer
// Supports: ollama, openai-compatible (vLLM, SGLang, LiteLLM, etc.)
//
// Set LLM_PROVIDER env var:
//   "ollama"  — Ollama backend (default, supports think param via native API)
//   "openai"  — Any OpenAI-compatible API (vLLM, SGLang, LiteLLM, etc.)
//
// Both providers use the OpenAI chat/completions format as the common protocol.

import prisma from '../config/database.js';

const LLM_PROVIDER = process.env.LLM_PROVIDER || 'ollama';
const LLM_BASE_URL = process.env.LLM_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
// Replica pool for data-parallel serving (docs/scaling.md, Stage 1.5) —
// comma-separated backends all serving the same model(s). When set, requests
// are routed by consumer affinity; when unset, behavior is identical to a
// single LLM_BASE_URL.
const LLM_BASE_URLS = (process.env.LLM_BASE_URLS || '')
  .split(',')
  .map(s => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);
// How long a replica sits benched after a connection-level failure before
// its consumers are routed back to it.
const BACKEND_COOLDOWN_MS = parseInt(process.env.LLM_BACKEND_COOLDOWN_MS) || 30_000;
const LLM_API_KEY = process.env.LLM_API_KEY || ''; // For vLLM/LiteLLM auth
const FALLBACK_MODEL = process.env.LLM_DEFAULT_MODEL || process.env.OLLAMA_MODEL || 'qwen3.5:27b-q4_K_M';
const DEFAULT_CTX = parseInt(process.env.LLM_CONTEXT_LENGTH) || 32768;
// 3-minute ceiling on backend calls — prevents Node workers from pinning
// forever on vLLM queue backpressure or a hung Ollama.
const FETCH_TIMEOUT_MS = parseInt(process.env.LLM_FETCH_TIMEOUT_MS) || 180_000;

class LLMService {
  constructor() {
    this.provider = LLM_PROVIDER;
    this.baseUrls = LLM_BASE_URLS.length ? LLM_BASE_URLS : [LLM_BASE_URL.replace(/\/+$/, '')];
    this.baseUrl = this.baseUrls[0]; // kept for single-backend callers/introspection
    this.apiKey = LLM_API_KEY;
    this._backendDownUntil = new Map(); // url → epoch ms until which it's benched
  }

  // -------------------------------------------------------------------------
  // Model management
  // -------------------------------------------------------------------------

  async getDefaultModel() {
    try {
      const settings = await prisma.settings.findUnique({ where: { id: 1 } });
      return settings?.defaultModel || FALLBACK_MODEL;
    } catch {
      return FALLBACK_MODEL;
    }
  }

  /**
   * List available models from the backend
   */
  async listModels() {
    try {
      // Replicas serve the same models — first reachable backend answers.
      const data = await this._withBackend('system', async (baseUrl) => {
        const url = this.provider === 'ollama'
          ? `${baseUrl}/api/tags`
          : `${baseUrl}/v1/models`;

        const response = await fetch(url, {
          headers: this._headers(),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`Model list failed: ${response.status}`);

        return response.json();
      });

      if (this.provider === 'ollama') {
        return (data.models || []).map(m => ({
          id: m.name,
          object: 'model',
          owned_by: 'ollama',
          created: Math.floor(new Date(m.modified_at).getTime() / 1000) || 0,
        }));
      }

      // OpenAI format — already in the right shape
      return data.data || [];
    } catch (error) {
      console.error('List models error:', error.message);
      return [];
    }
  }

  /**
   * Get loaded/running models (Ollama only, returns empty for other providers)
   */
  async getLoadedModels() {
    if (this.provider !== 'ollama') return [];
    // Aggregate across all replicas — each holds its own resident copy, and
    // the dashboard should reflect that. Unreachable replicas contribute [].
    const perBackend = await Promise.all(this.baseUrls.map(async (baseUrl) => {
      try {
        const res = await fetch(`${baseUrl}/api/ps`, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.models || []).map(m => ({
          name: m.name,
          size: m.size,
          sizeVram: m.size_vram,
          expiresAt: m.expires_at,
          ...(this.baseUrls.length > 1 ? { backend: baseUrl } : {}),
        }));
      } catch {
        return [];
      }
    }));
    return perBackend.flat();
  }

  // -------------------------------------------------------------------------
  // Chat completions — OpenAI format (used by all routes)
  // -------------------------------------------------------------------------

  /**
   * Non-streaming chat completion.
   * Returns OpenAI-format response regardless of provider.
   */
  async chatCompletion({ model, messages, tools, tool_choice, temperature, think, affinity, ...rest }) {
    if (!model) model = await this.getDefaultModel();

    // If think is set and we're on Ollama, use native API for extended thinking
    if (think !== undefined && this.provider === 'ollama') {
      return this._ollamaNativeChat({ model, messages, tools, tool_choice, temperature, think, ...rest }, affinity);
    }

    const body = {
      model,
      messages,
      stream: false,
      ...rest,
    };
    if (tools) body.tools = tools;
    if (tool_choice) body.tool_choice = tool_choice;
    if (temperature !== undefined) body.temperature = temperature;

    // Provider-specific options
    if (this.provider === 'ollama') {
      if (!body.options) body.options = {};
      body.options.num_ctx = DEFAULT_CTX;
    } else {
      // vLLM/SGLang support max_tokens
      if (!body.max_tokens) body.max_tokens = 4096;
    }

    return this._withBackend(affinity, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText);
        console.error(`LLM chat error (${response.status}):`, errText);
        throw new LLMError('LLM backend returned an error', response.status);
      }

      return response.json();
    });
  }

  /**
   * Streaming chat completion.
   * Returns the raw response for piping SSE to the client.
   * Handles Ollama native API when think is set.
   */
  async chatCompletionStream({ model, messages, tools, tool_choice, temperature, think, affinity, ...rest }) {
    if (!model) model = await this.getDefaultModel();

    const useNativeApi = think !== undefined && this.provider === 'ollama';

    const body = {
      model,
      messages: useNativeApi ? this._normalizeMessagesForOllamaNative(messages) : messages,
      stream: true,
      ...rest,
    };
    if (tools) body.tools = tools;
    if (tool_choice) body.tool_choice = tool_choice;
    if (temperature !== undefined) body.temperature = temperature;

    if (useNativeApi) {
      // Ollama native API for think support
      body.think = think;
      if (!body.options) body.options = {};
      body.options.num_ctx = DEFAULT_CTX;
    } else if (this.provider === 'ollama') {
      if (!body.options) body.options = {};
      body.options.num_ctx = DEFAULT_CTX;
      body.stream_options = { include_usage: true };
    } else {
      body.stream_options = { include_usage: true };
      if (!body.max_tokens) body.max_tokens = 4096;
    }

    // Failover applies only up to the first byte — fetch resolves at response
    // headers, so a replica that dies mid-stream can't be retried (the client
    // already saw partial output). Connection-refused/timeout before headers
    // fails over cleanly.
    return this._withBackend(affinity, async (baseUrl) => {
      const endpoint = useNativeApi
        ? `${baseUrl}/api/chat`
        : `${baseUrl}/v1/chat/completions`;

      // For streams we only want to bound the initial-response wait — once the
      // backend starts emitting chunks, an ongoing generation shouldn't be cut
      // off by the 180s ceiling. Clear the timer after the fetch resolves.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText);
        console.error(`LLM stream error (${response.status}):`, errText);
        throw new LLMError('LLM backend returned an error', response.status);
      }

      return {
        body: response.body,
        isNativeOllama: useNativeApi,
        model,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Simple generation (non-chat, Ollama-only — falls back to chat for others)
  // -------------------------------------------------------------------------

  async generate({ model, prompt, system, temperature, affinity }) {
    if (!model) model = await this.getDefaultModel();

    if (this.provider === 'ollama') {
      const data = await this._withBackend(affinity, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify({
            model,
            prompt,
            system: system || null,
            stream: false,
            options: { temperature: temperature || 0.7, num_ctx: DEFAULT_CTX },
          }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
          console.error(`LLM generate error: ${response.status}`);
          throw new LLMError('LLM backend returned an error', response.status);
        }

        return response.json();
      });
      return {
        content: data.response,
        model: data.model,
        eval_count: data.eval_count,
        eval_duration: data.eval_duration,
      };
    }

    // For OpenAI-compatible providers, use chat format
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

    const result = await this.chatCompletion({ model, messages, temperature, affinity });
    return {
      content: result.choices?.[0]?.message?.content || '',
      model: result.model,
      eval_count: result.usage?.completion_tokens,
    };
  }

  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------

  async checkHealth() {
    try {
      const models = await this.listModels();
      return models.length > 0;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Backend routing — consumer affinity across replica backends
  // -------------------------------------------------------------------------
  //
  // With LLM_BASE_URLS set to N replicas serving the same model, each request
  // routes by its affinity key (device on /v1 and /api/llm, user on chat) via
  // rendezvous hashing: the same consumer always lands on the same replica —
  // keeping that replica's prompt cache hot — while consumers as a whole
  // spread evenly. A replica that fails at the connection level is benched
  // for BACKEND_COOLDOWN_MS and the request retries on the next-ranked
  // replica; only the benched replica's consumers move, everyone else stays
  // put (the rendezvous property).

  _hash(str) {
    // FNV-1a 32-bit — stable, dependency-free, plenty for ranking a few URLs
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** All backends, ranked for this affinity key (highest-random-weight). */
  _backendOrder(affinity) {
    if (this.baseUrls.length === 1) return [...this.baseUrls];
    const key = affinity || 'default';
    return this.baseUrls
      .map(url => ({ url, score: this._hash(`${key}|${url}`) }))
      .sort((a, b) => b.score - a.score)
      .map(e => e.url);
  }

  _isBackendUp(url) {
    return (this._backendDownUntil.get(url) || 0) <= Date.now();
  }

  _markBackendDown(url) {
    if (this.baseUrls.length === 1) return;
    this._backendDownUntil.set(url, Date.now() + BACKEND_COOLDOWN_MS);
    console.error(`LLM backend benched for ${BACKEND_COOLDOWN_MS}ms after connection failure: ${url}`);
  }

  /**
   * Run request(baseUrl) against the affinity-preferred backend, failing over
   * to the next replica on connection-level errors only (refused, DNS,
   * timeout). HTTP error responses surface as LLMError and do NOT fail over —
   * a 404 model or 400 payload would fail identically on every replica.
   */
  async _withBackend(affinity, request) {
    const ranked = this._backendOrder(affinity);
    const up = ranked.filter(u => this._isBackendUp(u));
    const order = up.length ? up : ranked; // everything benched → try anyway
    let lastError;
    for (const url of order) {
      try {
        return await request(url);
      } catch (error) {
        if (error instanceof LLMError) throw error;
        this._markBackendDown(url);
        lastError = error;
      }
    }
    throw new LLMError(
      `All LLM backends unreachable (last error: ${lastError?.message || 'unknown'})`,
      503,
    );
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  _headers() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /**
   * Ollama's native /api/chat rejects `function.arguments` as a JSON-encoded
   * string — it requires an object. OpenAI-format tool history (what we get
   * from external API consumers) carries arguments as a string, so
   * parse them on the way in. Ollama tolerates everything else (`content:
   * null`, `tool_call_id`, tool_call `id`/`type`).
   */
  _normalizeMessagesForOllamaNative(messages) {
    if (!Array.isArray(messages)) return messages;
    return messages.map(m => {
      if (!m || m.role !== 'assistant' || !Array.isArray(m.tool_calls)) return m;
      const tool_calls = m.tool_calls.map(tc => {
        if (!tc?.function || typeof tc.function.arguments !== 'string') return tc;
        try {
          return { ...tc, function: { ...tc.function, arguments: JSON.parse(tc.function.arguments) } };
        } catch {
          return tc;
        }
      });
      return { ...m, tool_calls };
    });
  }

  /**
   * Ollama native /api/chat for think parameter support.
   * Converts response to OpenAI format.
   */
  async _ollamaNativeChat({ model, messages, tools, tool_choice, temperature, think, ...rest }, affinity) {
    const body = {
      model,
      messages: this._normalizeMessagesForOllamaNative(messages),
      stream: false,
      think,
      options: { temperature: temperature || 0.7, num_ctx: DEFAULT_CTX },
      ...rest,
    };
    if (tools) body.tools = tools;
    if (tool_choice) body.tool_choice = tool_choice;

    const data = await this._withBackend(affinity, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        console.error(`Ollama native chat error: ${response.status}`);
        throw new LLMError('LLM backend returned an error', response.status);
      }

      return response.json();
    });
    return this._ollamaToOpenAI(data, model);
  }

  /**
   * Convert Ollama native response to OpenAI format
   */
  _ollamaToOpenAI(data, model) {
    const message = data.message || {};
    const result = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: data.model || model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: message.content || '',
        },
        finish_reason: data.done_reason || 'stop',
      }],
      usage: {
        prompt_tokens: data.prompt_eval_count || 0,
        completion_tokens: data.eval_count || 0,
        total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
    };

    if (message.tool_calls) {
      result.choices[0].message.tool_calls = message.tool_calls;
    }
    if (message.thinking) {
      result.choices[0].message.reasoning = message.thinking;
    }

    return result;
  }
}

/**
 * Custom error with HTTP status code
 */
class LLMError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'LLMError';
    this.statusCode = statusCode;
  }
}

// Export singleton + error class
const llmService = new LLMService();
export { LLMError };
export default llmService;
