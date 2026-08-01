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
const LLM_API_KEY = process.env.LLM_API_KEY || ''; // For vLLM/LiteLLM auth
const FALLBACK_MODEL = process.env.LLM_DEFAULT_MODEL || process.env.OLLAMA_MODEL || 'qwen3.5:27b-q4_K_M';
const DEFAULT_CTX = parseInt(process.env.LLM_CONTEXT_LENGTH) || 32768;
// 3-minute ceiling on backend calls — prevents Node workers from pinning
// forever on vLLM queue backpressure or a hung Ollama.
const FETCH_TIMEOUT_MS = parseInt(process.env.LLM_FETCH_TIMEOUT_MS) || 180_000;

class LLMService {
  constructor() {
    this.provider = LLM_PROVIDER;
    this.baseUrl = LLM_BASE_URL;
    this.apiKey = LLM_API_KEY;
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
      const url = this.provider === 'ollama'
        ? `${this.baseUrl}/api/tags`
        : `${this.baseUrl}/v1/models`;

      const response = await fetch(url, {
        headers: this._headers(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Model list failed: ${response.status}`);

      const data = await response.json();

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
    try {
      const res = await fetch(`${this.baseUrl}/api/ps`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.models || []).map(m => ({
        name: m.name,
        size: m.size,
        sizeVram: m.size_vram,
        expiresAt: m.expires_at,
      }));
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Chat completions — OpenAI format (used by all routes)
  // -------------------------------------------------------------------------

  /**
   * Non-streaming chat completion.
   * Returns OpenAI-format response regardless of provider.
   */
  async chatCompletion({ model, messages, tools, tool_choice, temperature, think, ...rest }) {
    if (!model) model = await this.getDefaultModel();

    // If think is set and we're on Ollama, use native API for extended thinking
    if (think !== undefined && this.provider === 'ollama') {
      return this._ollamaNativeChat({ model, messages, tools, tool_choice, temperature, think, ...rest });
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

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
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
  }

  /**
   * Streaming chat completion.
   * Returns the raw response for piping SSE to the client.
   * Handles Ollama native API when think is set.
   */
  async chatCompletionStream({ model, messages, tools, tool_choice, temperature, think, ...rest }) {
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

    const endpoint = useNativeApi
      ? `${this.baseUrl}/api/chat`
      : `${this.baseUrl}/v1/chat/completions`;

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
  }

  // -------------------------------------------------------------------------
  // Simple generation (non-chat, Ollama-only — falls back to chat for others)
  // -------------------------------------------------------------------------

  async generate({ model, prompt, system, temperature }) {
    if (!model) model = await this.getDefaultModel();

    if (this.provider === 'ollama') {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
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

      const data = await response.json();
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

    const result = await this.chatCompletion({ model, messages, temperature });
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
  async _ollamaNativeChat({ model, messages, tools, tool_choice, temperature, think, ...rest }) {
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

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`Ollama native chat error: ${response.status}`);
      throw new LLMError('LLM backend returned an error', response.status);
    }

    const data = await response.json();
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
