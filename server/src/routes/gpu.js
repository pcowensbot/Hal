import express from 'express';
// Node 20+ has global fetch — node-fetch no longer needed
import { authenticateDevice } from '../middleware/auth.js';
import prisma from '../config/database.js';
import redisClient from '../config/redis.js';
import llmService from '../services/llm.js';

const router = express.Router();
const WHISPER_URL = process.env.WHISPER_URL || 'http://localhost:8178';
const COMFYUI_URL = process.env.COMFYUI_URL || 'http://localhost:8188';

// All GPU broker routes require device authentication
router.use(authenticateDevice);

// ---------------------------------------------------------------------------
// Redis-backed Job Queue with priority
//
// Keys:
//   gpu:job:{id}          — Hash with job data
//   gpu:queue             — Sorted set (score = priority*1e13 + timestamp for ordering)
//   gpu:active            — String with active job ID (or empty)
//   gpu:counter           — Auto-incrementing job ID counter
//   gpu:recent            — List of recent job IDs (capped at 200)
// ---------------------------------------------------------------------------

const JOB_PRIORITY = {
  interactive: 1,
  batch: 2,
};

const JOB_TTL = 3600; // Jobs expire from Redis after 1 hour

async function createJob(type, service, payload, priority = 'batch', deviceId) {
  const id = await redisClient.incr('gpu:counter');
  const priorityNum = JOB_PRIORITY[priority] || 2;
  const now = new Date().toISOString();

  const job = {
    id: String(id),
    type,
    service,
    payload: JSON.stringify(payload),
    priority: String(priorityNum),
    status: 'queued',
    deviceId,
    createdAt: now,
    startedAt: '',
    completedAt: '',
    result: '',
    error: '',
  };

  const key = `gpu:job:${id}`;
  await redisClient.hSet(key, job);
  await redisClient.expire(key, JOB_TTL);

  // Score: priority * 1e13 + timestamp ensures priority ordering, then FIFO within same priority
  const score = priorityNum * 1e13 + Date.now();
  await redisClient.zAdd('gpu:queue', { score, value: String(id) });

  // Track in recent list
  await redisClient.lPush('gpu:recent', String(id));
  await redisClient.lTrim('gpu:recent', 0, 199);

  return { ...job, id, payload };
}

async function getNextJob() {
  // Get lowest-scored (highest priority, oldest) queued job
  const results = await redisClient.zRange('gpu:queue', 0, 0);
  if (!results || results.length === 0) return null;

  const jobId = results[0];
  const job = await getJob(jobId);
  if (!job || job.status !== 'queued') {
    // Stale entry — remove and try again
    await redisClient.zRem('gpu:queue', jobId);
    return getNextJob();
  }
  return job;
}

async function getJob(id) {
  const data = await redisClient.hGetAll(`gpu:job:${id}`);
  if (!data || !data.id) return null;
  return {
    ...data,
    id: parseInt(data.id),
    priority: parseInt(data.priority),
    result: data.result ? tryParse(data.result) : null,
    payload: data.payload ? tryParse(data.payload) : null,
  };
}

async function updateJob(id, updates) {
  const key = `gpu:job:${id}`;
  const mapped = {};
  for (const [k, v] of Object.entries(updates)) {
    mapped[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '');
  }
  await redisClient.hSet(key, mapped);
  await redisClient.expire(key, JOB_TTL);
}

function tryParse(str) {
  try { return JSON.parse(str); } catch { return str; }
}

// Processing lock — only one processor per instance
let processing = false;

async function processQueue() {
  if (processing) return;

  const activeId = await redisClient.get('gpu:active');
  if (activeId) return; // Another instance is processing

  const job = await getNextJob();
  if (!job) return;

  processing = true;

  try {
    // Claim the job
    await redisClient.set('gpu:active', String(job.id), { EX: 300 }); // 5min safety TTL
    await redisClient.zRem('gpu:queue', String(job.id));
    await updateJob(job.id, { status: 'processing', startedAt: new Date().toISOString() });

    // Execute
    const result = await executeJob(job);
    await updateJob(job.id, { status: 'completed', result, completedAt: new Date().toISOString() });
  } catch (err) {
    await updateJob(job.id, { status: 'failed', error: err.message, completedAt: new Date().toISOString() });
  } finally {
    await redisClient.del('gpu:active');
    processing = false;
    // Process next job
    setImmediate(processQueue);
  }
}

async function executeJob(job) {
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
  switch (job.service) {
    case 'ollama':
      return executeOllamaJob({ ...job, payload });
    case 'whisper':
      return executeWhisperJob({ ...job, payload });
    case 'image-enhance':
      return executeImageJob({ ...job, payload }, 'enhance');
    case 'image-categorize':
      return executeImageJob({ ...job, payload }, 'categorize');
    case 'image-faces':
      return executeImageJob({ ...job, payload }, 'faces');
    case 'image-stack':
      return executeImageJob({ ...job, payload }, 'stack');
    case 'image-panorama':
      return executeImageJob({ ...job, payload }, 'panorama');
    default:
      throw new Error(`Unknown service: ${job.service}`);
  }
}

// ---------------------------------------------------------------------------
// Service Executors
// ---------------------------------------------------------------------------

async function executeOllamaJob(job) {
  const { model, messages, stream, tools, tool_choice, ...rest } = job.payload;
  const defaultModel = await llmService.getDefaultModel();

  return llmService.chatCompletion({
    model: model || defaultModel,
    messages,
    tools,
    tool_choice,
    ...rest,
  });
}

async function executeWhisperJob(job) {
  const { audio_url, audio_base64, language, task } = job.payload;

  const body = {};
  if (audio_url) body.audio_url = audio_url;
  if (audio_base64) body.audio = audio_base64;
  if (language) body.language = language;
  body.task = task || 'transcribe';

  const res = await fetch(`${WHISPER_URL}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Whisper service error (${res.status})`);
  }

  return await res.json();
}

async function executeImageJob(job, operation) {
  const endpoints = {
    enhance: '/api/enhance',
    categorize: '/api/categorize',
    faces: '/api/faces',
    stack: '/api/stack',
    panorama: '/api/panorama',
  };

  const endpoint = endpoints[operation];
  if (!endpoint) throw new Error(`Unknown image operation: ${operation}`);

  const res = await fetch(`${COMFYUI_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(job.payload),
  });

  if (!res.ok) {
    throw new Error(`Image service error (${res.status})`);
  }

  return await res.json();
}

// ---------------------------------------------------------------------------
// GPU Status
// ---------------------------------------------------------------------------

async function getGpuStatus() {
  const { execSync } = await import('child_process');
  try {
    const output = execSync(
      'nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,temperature.gpu,power.draw,utilization.gpu --format=csv,noheader,nounits',
      { encoding: 'utf-8', timeout: 5000 }
    );
    const parts = output.trim().split(',').map(s => s.trim());
    return {
      name: parts[0],
      vram: {
        totalMB: parseInt(parts[1]),
        usedMB: parseInt(parts[2]),
        freeMB: parseInt(parts[3]),
      },
      temperatureC: parseInt(parts[4]),
      powerDrawW: parseFloat(parts[5]),
      utilizationPct: parseInt(parts[6]),
    };
  } catch {
    return { error: 'nvidia-smi not available' };
  }
}

async function getLoadedModels() {
  return llmService.getLoadedModels();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /gpu/status
 */
router.get('/status', async (req, res) => {
  try {
    const [gpu, models] = await Promise.all([getGpuStatus(), getLoadedModels()]);

    const queuedCount = await redisClient.zCard('gpu:queue');
    const activeId = await redisClient.get('gpu:active');
    let activeJob = null;
    if (activeId) {
      const job = await getJob(activeId);
      if (job) activeJob = { id: job.id, type: job.type, service: job.service };
    }

    res.json({
      gpu,
      loadedModels: models,
      queue: {
        active: activeJob,
        queued: queuedCount,
      },
      services: {
        llm: 'connected',
        whisper: 'configured',
        comfyui: 'configured',
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch GPU status' });
  }
});

/**
 * GET /gpu/queue
 */
router.get('/queue', async (req, res) => {
  try {
    const queuedIds = await redisClient.zRange('gpu:queue', 0, -1);
    let interactiveCount = 0;
    let batchCount = 0;
    for (const id of queuedIds) {
      const priority = await redisClient.hGet(`gpu:job:${id}`, 'priority');
      if (priority === '1') interactiveCount++;
      else if (priority === '2') batchCount++;
    }

    const activeId = await redisClient.get('gpu:active');
    let active = null;
    if (activeId) {
      const job = await getJob(activeId);
      if (job) {
        active = {
          id: job.id,
          type: job.type,
          service: job.service,
          priority: job.priority,
          startedAt: job.startedAt || null,
        };
      }
    }

    const recentIds = await redisClient.lRange('gpu:recent', 0, 49);
    const jobs = [];

    for (const id of recentIds) {
      const job = await getJob(id);
      if (job) {
        jobs.push({
          id: job.id,
          type: job.type,
          service: job.service,
          status: job.status,
          priority: job.priority,
          createdAt: job.createdAt,
          startedAt: job.startedAt || null,
          completedAt: job.completedAt || null,
          error: job.error || null,
        });
      }
    }

    res.json({
      queue: {
        depth: queuedIds.length,
        active,
        byPriority: { interactive: interactiveCount, batch: batchCount },
      },
      jobs,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

/**
 * GET /gpu/job/:id
 */
router.get('/job/:id', async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.json({
    id: job.id,
    type: job.type,
    service: job.service,
    status: job.status,
    priority: job.priority,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    result: job.result,
    error: job.error || null,
  });
});

/**
 * POST /gpu/llm
 */
router.post('/llm', async (req, res) => {
  const { model, messages, priority, tools, tool_choice, ...rest } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  const job = await createJob('llm', 'ollama', { model, messages, tools, tool_choice, ...rest }, priority || 'interactive', req.device.id);

  await logGpuRequest(req.device.id, 'llm', model || 'default');
  setImmediate(processQueue);

  if ((priority || 'interactive') === 'interactive') {
    const result = await waitForJob(job.id, 120000);
    if (result.status === 'completed') {
      return res.json(result.result);
    } else if (result.status === 'failed') {
      return res.status(500).json({ error: result.error });
    } else {
      return res.json({ jobId: job.id, status: result.status, message: 'Job still processing, poll /gpu/job/' + job.id });
    }
  }

  res.json({ jobId: job.id, status: 'queued', poll: `/api/gpu/job/${job.id}` });
});

/**
 * POST /gpu/transcribe
 */
router.post('/transcribe', async (req, res) => {
  const { audio_url, audio_base64, language, task, priority } = req.body;

  if (!audio_url && !audio_base64) {
    return res.status(400).json({ error: 'audio_url or audio_base64 is required' });
  }

  const job = await createJob('transcribe', 'whisper', { audio_url, audio_base64, language, task }, priority || 'interactive', req.device.id);

  await logGpuRequest(req.device.id, 'transcribe', 'whisper');
  setImmediate(processQueue);

  if ((priority || 'interactive') === 'interactive') {
    const result = await waitForJob(job.id, 120000);
    if (result.status === 'completed') {
      return res.json(result.result);
    } else if (result.status === 'failed') {
      return res.status(500).json({ error: result.error });
    } else {
      return res.json({ jobId: job.id, status: result.status, poll: `/api/gpu/job/${job.id}` });
    }
  }

  res.json({ jobId: job.id, status: 'queued', poll: `/api/gpu/job/${job.id}` });
});

router.post('/image/enhance', async (req, res) => {
  const { images, scale, denoise } = req.body;
  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'images array is required' });
  }
  const job = await createJob('image-enhance', 'image-enhance', { images, scale: scale || 4, denoise: denoise !== false }, 'batch', req.device.id);
  await logGpuRequest(req.device.id, 'image-enhance', 'real-esrgan');
  setImmediate(processQueue);
  res.json({ jobId: job.id, status: 'queued', poll: `/api/gpu/job/${job.id}` });
});

router.post('/image/categorize', async (req, res) => {
  const { images, categories } = req.body;
  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'images array is required' });
  }
  const defaultCategories = ['landscape', 'portrait', 'astrophotography', 'macro', 'architecture', 'wildlife', 'street', 'food', 'other'];
  const job = await createJob('image-categorize', 'image-categorize', { images, categories: categories || defaultCategories }, 'batch', req.device.id);
  await logGpuRequest(req.device.id, 'image-categorize', 'clip');
  setImmediate(processQueue);
  res.json({ jobId: job.id, status: 'queued', poll: `/api/gpu/job/${job.id}` });
});

router.post('/image/faces', async (req, res) => {
  const { images } = req.body;
  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'images array is required' });
  }
  const job = await createJob('image-faces', 'image-faces', { images }, 'batch', req.device.id);
  await logGpuRequest(req.device.id, 'image-faces', 'gfpgan');
  setImmediate(processQueue);
  res.json({ jobId: job.id, status: 'queued', poll: `/api/gpu/job/${job.id}` });
});

router.post('/image/stack', async (req, res) => {
  const { images, darks, flats, biases, method } = req.body;
  if (!images || !Array.isArray(images) || images.length < 2) {
    return res.status(400).json({ error: 'images array with at least 2 frames is required' });
  }
  const job = await createJob('image-stack', 'image-stack', {
    images, darks: darks || [], flats: flats || [], biases: biases || [], method: method || 'sigma-clip',
  }, 'batch', req.device.id);
  await logGpuRequest(req.device.id, 'image-stack', 'astro-pipeline');
  setImmediate(processQueue);
  res.json({ jobId: job.id, status: 'queued', poll: `/api/gpu/job/${job.id}` });
});

router.post('/image/panorama', async (req, res) => {
  const { images } = req.body;
  if (!images || !Array.isArray(images) || images.length < 2) {
    return res.status(400).json({ error: 'images array with at least 2 photos is required' });
  }
  const job = await createJob('image-panorama', 'image-panorama', { images }, 'batch', req.device.id);
  await logGpuRequest(req.device.id, 'image-panorama', 'opencv');
  setImmediate(processQueue);
  res.json({ jobId: job.id, status: 'queued', poll: `/api/gpu/job/${job.id}` });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForJob(jobId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await getJob(jobId);
    if (!job) return { status: 'not_found' };
    if (job.status === 'completed' || job.status === 'failed') return job;
    await new Promise(r => setTimeout(r, 200));
  }
  const job = await getJob(jobId);
  return job || { status: 'not_found' };
}

async function logGpuRequest(deviceId, type, model) {
  try {
    await prisma.deviceApiLog.create({
      data: {
        deviceId,
        endpoint: `/gpu/${type}`,
        method: 'POST',
        model,
        status: 200,
        durationMs: 0,
        response: 'Job queued',
      },
    });
  } catch {
    // Non-critical
  }
}

// On startup, clean any stale active job marker (from crash)
(async () => {
  try {
    const staleActive = await redisClient.get('gpu:active');
    if (staleActive) {
      const job = await getJob(staleActive);
      if (job && job.status === 'processing') {
        await updateJob(staleActive, { status: 'failed', error: 'Server restarted during processing', completedAt: new Date().toISOString() });
      }
      await redisClient.del('gpu:active');
    }
  } catch {
    // Redis might not be ready yet
  }
})();

export default router;
