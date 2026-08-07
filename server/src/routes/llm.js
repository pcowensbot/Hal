import express from 'express';
import { authenticateDevice } from '../middleware/auth.js';
import prisma from '../config/database.js';
import llmService from '../services/llm.js';
import { checkAndUpdateApiLimit, logApiRequest } from '../lib/apiUsage.js';

const router = express.Router();

// All routes require device authentication
router.use(authenticateDevice);

/**
 * POST /api/llm/chat
 * Device LLM Chat endpoint
 */
router.post('/chat', async (req, res) => {
  const startTime = Date.now();
  try {
    const { message, model: requestedModel, context = [], system } = req.body;
    const model = requestedModel || await llmService.getDefaultModel();

    const rateLimitResult = await checkAndUpdateApiLimit(req.device.userId);
    if (!rateLimitResult.allowed) {
      await logApiRequest(req.device, {
        endpoint: '/chat',
        method: 'POST',
        model,
        prompt: message,
        status: 429,
        durationMs: Date.now() - startTime,
        error: rateLimitResult.error,
      });
      return res.status(429).json({
        error: rateLimitResult.error,
        limitType: rateLimitResult.limitType,
        current: rateLimitResult.current,
        limit: rateLimitResult.limit,
      });
    }

    if (!message || message.trim().length === 0) {
      await logApiRequest(req.device, {
        endpoint: '/chat',
        method: 'POST',
        model,
        prompt: message,
        status: 400,
        durationMs: Date.now() - startTime,
        error: 'Message is required',
      });
      return res.status(400).json({ error: 'Message is required' });
    }

    // Build conversation messages
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    if (context && Array.isArray(context)) messages.push(...context);
    messages.push({ role: 'user', content: message.trim() });

    // Call LLM via provider abstraction
    const data = await llmService.chatCompletion({ model, messages, affinity: `device:${req.device.id}` });
    const durationMs = Date.now() - startTime;

    const assistantContent = data.choices?.[0]?.message?.content || '';
    const tokenCount = data.usage?.completion_tokens;

    await logApiRequest(req.device, {
      endpoint: '/chat',
      method: 'POST',
      model: data.model || model,
      prompt: message.trim(),
      response: assistantContent,
      status: 200,
      durationMs,
      tokenCount,
      metadata: { contextLength: context.length },
    });

    res.json({
      message: assistantContent,
      model: data.model || model,
      device: {
        id: req.device.id,
        name: req.device.name,
      },
      context: [...messages, { role: 'assistant', content: assistantContent }],
      done: true,
      eval_count: tokenCount,
    });
  } catch (error) {
    console.error('LLM chat error:', error);
    await logApiRequest(req.device, {
      endpoint: '/chat',
      method: 'POST',
      model: req.body?.model || 'unknown',
      prompt: req.body?.message,
      status: 500,
      durationMs: Date.now() - startTime,
      error: error.message,
    });
    res.status(500).json({
      error: 'Failed to process chat request',
    });
  }
});

/**
 * POST /api/llm/generate
 * Simple text generation endpoint
 */
router.post('/generate', async (req, res) => {
  const startTime = Date.now();
  try {
    const { prompt, model: requestedModel, system } = req.body;
    const model = requestedModel || await llmService.getDefaultModel();

    const rateLimitResult = await checkAndUpdateApiLimit(req.device.userId);
    if (!rateLimitResult.allowed) {
      await logApiRequest(req.device, {
        endpoint: '/generate',
        method: 'POST',
        model,
        prompt,
        status: 429,
        durationMs: Date.now() - startTime,
        error: rateLimitResult.error,
      });
      return res.status(429).json({
        error: rateLimitResult.error,
        limitType: rateLimitResult.limitType,
        current: rateLimitResult.current,
        limit: rateLimitResult.limit,
      });
    }

    if (!prompt || prompt.trim().length === 0) {
      await logApiRequest(req.device, {
        endpoint: '/generate',
        method: 'POST',
        model,
        prompt,
        status: 400,
        durationMs: Date.now() - startTime,
        error: 'Prompt is required',
      });
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const result = await llmService.generate({ model, prompt: prompt.trim(), system, affinity: `device:${req.device.id}` });
    const durationMs = Date.now() - startTime;

    await logApiRequest(req.device, {
      endpoint: '/generate',
      method: 'POST',
      model: result.model || model,
      prompt: prompt.trim(),
      response: result.content,
      status: 200,
      durationMs,
      tokenCount: result.eval_count,
    });

    res.json({
      response: result.content,
      model: result.model || model,
      device: {
        id: req.device.id,
        name: req.device.name,
      },
      done: true,
      eval_count: result.eval_count,
    });
  } catch (error) {
    console.error('LLM generate error:', error);
    await logApiRequest(req.device, {
      endpoint: '/generate',
      method: 'POST',
      model: req.body?.model || 'unknown',
      prompt: req.body?.prompt,
      status: 500,
      durationMs: Date.now() - startTime,
      error: error.message,
    });
    res.status(500).json({
      error: 'Failed to generate text',
    });
  }
});

/**
 * GET /api/llm/models
 * List available LLM models
 */
router.get('/models', async (req, res) => {
  const startTime = Date.now();
  try {
    const models = await llmService.listModels();
    const durationMs = Date.now() - startTime;

    await logApiRequest(req.device, {
      endpoint: '/models',
      method: 'GET',
      status: 200,
      durationMs,
      response: `${models.length} models available`,
    });

    res.json({
      models,
      device: {
        id: req.device.id,
        name: req.device.name,
      },
    });
  } catch (error) {
    console.error('List models error:', error);
    await logApiRequest(req.device, {
      endpoint: '/models',
      method: 'GET',
      status: 500,
      durationMs: Date.now() - startTime,
      error: error.message,
    });
    res.status(500).json({
      error: 'Failed to list models',
    });
  }
});

export default router;
