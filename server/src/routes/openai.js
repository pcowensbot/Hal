import express from 'express';
import { authenticateDevice } from '../middleware/auth.js';
import prisma from '../config/database.js';
import llmService, { LLMError } from '../services/llm.js';
import { checkAndUpdateApiLimit, logApiRequest } from '../lib/apiUsage.js';

const router = express.Router();

// Server-side ceilings so a misconfigured or hostile client can't run the
// backend out of VRAM / budget. Caller-supplied max_tokens above the
// ceiling is silently clamped down; messages-payload bytes over the cap
// reject the request outright.
const V1_MAX_TOKENS_CEILING = parseInt(process.env.V1_MAX_TOKENS_CEILING) || 4096;
const V1_MAX_MESSAGES_BYTES = parseInt(process.env.V1_MAX_MESSAGES_BYTES) || 100_000;

// All routes require device authentication
router.use(authenticateDevice);

function extractPrompt(messages) {
  if (!messages || !Array.isArray(messages)) return null;
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return JSON.stringify(messages.slice(-1));
  if (typeof lastUser.content === 'string') return lastUser.content;
  return JSON.stringify(lastUser.content);
}

// Standard correlation header — external API consumers send this so they
// can join their own logs to HAL's
// device_api_logs. Echoed back verbatim and persisted into log metadata.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
function extractRequestId(req) {
  const raw = req.headers['x-request-id'];
  if (!raw || typeof raw !== 'string') return null;
  return REQUEST_ID_PATTERN.test(raw) ? raw : null;
}

/**
 * Resolve the model to use for a request.
 * Hard-pinned devices always get their pinned model — meant for security
 * consumers who want to test model upgrades explicitly rather than
 * follow the dashboard default. Otherwise honors the requested model,
 * falling back to the dashboard default.
 */
async function resolveModel(requestedModel, device) {
  if (device?.pinnedModel) return device.pinnedModel;
  if (requestedModel) return requestedModel;
  return llmService.getDefaultModel();
}

// --- Routes ---

/**
 * GET /v1/models
 * List available models in OpenAI format
 */
router.get('/models', async (req, res) => {
  const startTime = Date.now();
  try {
    const models = await llmService.listModels();

    const durationMs = Date.now() - startTime;

    await logApiRequest(req.device, {
      endpoint: '/v1/models',
      method: 'GET',
      status: 200,
      durationMs,
      response: `${models.length} models available`,
    });

    res.json({ object: 'list', data: models });
  } catch (error) {
    console.error('Models list error:', error);
    await logApiRequest(req.device, {
      endpoint: '/v1/models',
      method: 'GET',
      status: 500,
      durationMs: Date.now() - startTime,
      error: error.message,
    });
    res.status(500).json({ error: { message: 'Failed to list models', type: 'server_error' } });
  }
});

/**
 * POST /v1/chat/completions
 * OpenAI-compatible chat completions — works with Ollama, vLLM, SGLang, etc.
 */
router.post('/chat/completions', async (req, res) => {
  const startTime = Date.now();

  // Merge per-device defaults (e.g. {think:false, temperature:0.3, seed:42})
  // under the request body. Request-level params win because spread order
  // favors the later object — so callers can still override on a per-call
  // basis when they need to.
  const deviceDefaults = req.device?.defaults || {};
  const mergedBody = { ...deviceDefaults, ...req.body };
  const { messages, model: requestedModel, stream, tools, tool_choice, think, ...rest } = mergedBody;

  const requestId = extractRequestId(req);
  if (requestId) res.setHeader('X-Request-Id', requestId);

  // Reject oversized prompts before doing any work (LLM inference, DB logging).
  const messagesBytes = messages ? Buffer.byteLength(JSON.stringify(messages), 'utf8') : 0;
  if (messagesBytes > V1_MAX_MESSAGES_BYTES) {
    return res.status(413).json({
      error: {
        message: `Messages payload exceeds ${V1_MAX_MESSAGES_BYTES} bytes (got ${messagesBytes}).`,
        type: 'invalid_request_error',
      },
    });
  }

  // Clamp caller-supplied max_tokens to prevent runaway generation cost.
  if (rest.max_tokens && rest.max_tokens > V1_MAX_TOKENS_CEILING) {
    rest.max_tokens = V1_MAX_TOKENS_CEILING;
  }

  // Rate limit check
  try {
    const rateLimitResult = await checkAndUpdateApiLimit(req.device.userId);
    if (!rateLimitResult.allowed) {
      await logApiRequest(req.device, {
        endpoint: '/v1/chat/completions',
        method: 'POST',
        model: requestedModel,
        prompt: extractPrompt(messages),
        status: 429,
        durationMs: Date.now() - startTime,
        error: rateLimitResult.error,
        metadata: requestId ? { requestId } : undefined,
      });
      return res.status(429).json({
        error: {
          message: rateLimitResult.error,
          type: 'rate_limit_error',
          code: rateLimitResult.limitType === 'daily' ? 'daily_limit' : 'monthly_limit',
        },
      });
    }
  } catch (error) {
    console.error('Rate limit check error:', error);
    return res.status(500).json({ error: { message: 'Rate limit check failed', type: 'server_error' } });
  }

  const model = await resolveModel(requestedModel, req.device);

  try {
    // --- Non-streaming ---
    if (!stream) {
      const data = await llmService.chatCompletion({ model, messages, tools, tool_choice, think, ...rest });
      const durationMs = Date.now() - startTime;

      const assistantContent = data.choices?.[0]?.message?.content || '';
      const toolCalls = data.choices?.[0]?.message?.tool_calls;
      const tokenCount = data.usage?.total_tokens;

      await logApiRequest(req.device, {
        endpoint: '/v1/chat/completions',
        method: 'POST',
        model: data.model || model,
        prompt: extractPrompt(messages),
        response: assistantContent || (toolCalls ? JSON.stringify(toolCalls) : ''),
        status: 200,
        durationMs,
        tokenCount,
        metadata: {
          ...(requestId ? { requestId } : {}),
          ...(tools ? { hasTools: true } : {}),
          ...(toolCalls ? { hasToolCalls: true, toolCallCount: toolCalls.length } : {}),
          ...(data.usage || {}),
        },
      });

      return res.json(data);
    }

    // --- Streaming ---
    const { body: upstreamBody, isNativeOllama, model: resolvedModel } = await llmService.chatCompletionStream({
      model, messages, tools, tool_choice, think, ...rest,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.socket?.setNoDelay(true);

    let bufferedContent = '';
    let bufferedToolCalls = [];
    let streamModel = resolvedModel;
    let chunkBuffer = '';
    let streamUsage = null;

    // upstreamBody is a Web ReadableStream (Node 20 native fetch). Read via
    // getReader — event-based .on('data') does not exist on Web streams.
    const reader = upstreamBody.getReader();
    const decoder = new TextDecoder();

    // If the client disconnects mid-stream, cancel the upstream read so
    // Ollama/vLLM can stop generating and free the worker.
    req.on('close', () => {
      reader.cancel().catch(() => {});
    });

    const processChunk = (text) => {
      if (isNativeOllama) {
        // Ollama native streaming — convert to SSE
        chunkBuffer += text;
        const lines = chunkBuffer.split('\n');
        chunkBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.model) streamModel = parsed.model;
            if (parsed.message?.content) bufferedContent += parsed.message.content;

            const delta = {};
            if (parsed.message?.content) delta.content = parsed.message.content;
            if (parsed.message?.tool_calls) delta.tool_calls = parsed.message.tool_calls;

            const sseChunk = {
              id: `chatcmpl-${Date.now()}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: parsed.model || model,
              choices: [{ index: 0, delta, finish_reason: parsed.done ? 'stop' : null }],
            };

            if (parsed.done && parsed.prompt_eval_count) {
              sseChunk.usage = {
                prompt_tokens: parsed.prompt_eval_count || 0,
                completion_tokens: parsed.eval_count || 0,
                total_tokens: (parsed.prompt_eval_count || 0) + (parsed.eval_count || 0),
              };
              streamUsage = sseChunk.usage;
            }

            res.write(`data: ${JSON.stringify(sseChunk)}\n\n`);

            if (parsed.done) {
              res.write('data: [DONE]\n\n');
            }
          } catch {
            // Ignore unparseable chunks
          }
        }
      } else {
        // OpenAI SSE format — pass through directly (works for Ollama /v1 AND vLLM)
        res.write(text);

        chunkBuffer += text;
        const lines = chunkBuffer.split('\n');
        chunkBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;

          try {
            const parsed = JSON.parse(payload);
            if (parsed.model) streamModel = parsed.model;

            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) bufferedContent += delta.content;
            if (parsed.usage) streamUsage = parsed.usage;
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!bufferedToolCalls[idx]) {
                  bufferedToolCalls[idx] = { id: tc.id || '', type: tc.type || 'function', function: { name: '', arguments: '' } };
                }
                if (tc.id) bufferedToolCalls[idx].id = tc.id;
                if (tc.function?.name) bufferedToolCalls[idx].function.name += tc.function.name;
                if (tc.function?.arguments) bufferedToolCalls[idx].function.arguments += tc.function.arguments;
              }
            }
          } catch {
            // Ignore unparseable SSE chunks
          }
        }
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        processChunk(decoder.decode(value, { stream: true }));
      }

      // Flush any tail buffer left over from the final chunk
      if (!isNativeOllama && chunkBuffer.trim()) {
        const remaining = chunkBuffer.trim();
        if (remaining.startsWith('data: ') && remaining.slice(6).trim() !== '[DONE]') {
          try {
            const parsed = JSON.parse(remaining.slice(6).trim());
            if (parsed.choices?.[0]?.delta?.content) {
              bufferedContent += parsed.choices[0].delta.content;
            }
          } catch {
            // ignore
          }
        }
      }

      res.end();

      const durationMs = Date.now() - startTime;
      const responseText = bufferedContent || (bufferedToolCalls.length > 0 ? JSON.stringify(bufferedToolCalls) : '');

      await logApiRequest(req.device, {
        endpoint: '/v1/chat/completions',
        method: 'POST',
        model: streamModel,
        prompt: extractPrompt(messages),
        response: responseText,
        status: 200,
        durationMs,
        tokenCount: streamUsage?.total_tokens || null,
        metadata: {
          streaming: true,
          ...(requestId ? { requestId } : {}),
          ...(think !== undefined ? { think } : {}),
          ...(tools ? { hasTools: true } : {}),
          ...(bufferedToolCalls.length > 0 ? { hasToolCalls: true, toolCallCount: bufferedToolCalls.length } : {}),
          ...(streamUsage || {}),
        },
      });
    } catch (err) {
      console.error('Upstream stream error:', err);
      if (!res.writableEnded) res.end();
      await logApiRequest(req.device, {
        endpoint: '/v1/chat/completions',
        method: 'POST',
        model: streamModel,
        prompt: extractPrompt(messages),
        status: 502,
        durationMs: Date.now() - startTime,
        error: err.message,
        metadata: { streaming: true, ...(requestId ? { requestId } : {}) },
      });
    } finally {
      try { reader.releaseLock(); } catch { /* already released */ }
    }
  } catch (error) {
    console.error('Chat completions error:', error);
    const statusCode = error instanceof LLMError ? error.statusCode : 500;
    await logApiRequest(req.device, {
      endpoint: '/v1/chat/completions',
      method: 'POST',
      model,
      prompt: extractPrompt(messages),
      status: statusCode,
      durationMs: Date.now() - startTime,
      error: error.message,
      metadata: requestId ? { requestId } : undefined,
    });
    if (!res.headersSent) {
      res.status(statusCode).json({ error: { message: 'Failed to process chat completion', type: 'server_error' } });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

/**
 * GET /v1/logs
 * Read-only, device-scoped log retrieval. Returns the calling device's own
 * DeviceApiLog rows (no other device's logs visible). Designed for broker
 * consumers to debug their own traffic
 * without poking psql or pinging HAL Claude.
 *
 * Query params:
 *   limit  — default 50, capped at LOGS_MAX_LIMIT
 *   before — ISO timestamp; returns rows older than this (cursor pagination)
 *
 * Prompt/response bodies are only returned if the device opted in to
 * logPromptContent — same private-by-default rule as the storage path.
 */
const LOGS_MAX_LIMIT = 200;
const LOGS_DEFAULT_LIMIT = 50;
router.get('/logs', async (req, res) => {
  const startTime = Date.now();
  try {
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, LOGS_MAX_LIMIT)
      : LOGS_DEFAULT_LIMIT;

    const where = { deviceId: req.device.id };
    if (req.query.before) {
      const beforeDate = new Date(req.query.before);
      if (!isNaN(beforeDate.getTime())) {
        where.createdAt = { lt: beforeDate };
      }
    }

    const rows = await prisma.deviceApiLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        endpoint: true,
        method: true,
        model: true,
        status: true,
        durationMs: true,
        tokenCount: true,
        error: true,
        metadata: true,
        createdAt: true,
        // Prompt/response only included if the device opted in. The columns
        // are nulled in storage when opt-out, but we double-gate here so a
        // future schema change can't accidentally leak them.
        ...(req.device.logPromptContent ? { prompt: true, response: true } : {}),
      },
    });

    const nextCursor = rows.length === limit ? rows[rows.length - 1].createdAt.toISOString() : null;

    await logApiRequest(req.device, {
      endpoint: '/v1/logs',
      method: 'GET',
      status: 200,
      durationMs: Date.now() - startTime,
      response: `${rows.length} log rows returned`,
    });

    res.json({ object: 'list', data: rows, nextCursor });
  } catch (error) {
    console.error('Logs endpoint error:', error);
    await logApiRequest(req.device, {
      endpoint: '/v1/logs',
      method: 'GET',
      status: 500,
      durationMs: Date.now() - startTime,
      error: error.message,
    });
    res.status(500).json({ error: { message: 'Failed to fetch logs', type: 'server_error' } });
  }
});

export default router;
