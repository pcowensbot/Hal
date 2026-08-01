import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import pinoHttp from 'pino-http';
import path from 'path';
import { fileURLToPath } from 'url';

// Import routes
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import parentRoutes from './routes/parent.js';
import imageRoutes from './routes/image.js';
import knowledgeRoutes from './routes/knowledge.js';
import deviceRoutes from './routes/devices.js';
import llmRoutes from './routes/llm.js';
import adminRoutes from './routes/admin.js';
import importRoutes from './routes/import.js';
import documentRoutes from './routes/documents.js';
import sessionRoutes from './routes/sessions.js';
import openaiRoutes from './routes/openai.js';
import gpuRoutes from './routes/gpu.js';
import shareRoutes from './routes/share.js';

// Import services
import llmService from './services/llm.js';
import redisClient from './config/redis.js';
import prisma from './config/database.js';
import { logger } from './lib/logger.js';
import crypto from 'crypto';

// Factory for a Redis-backed rate-limiter store. One per limiter (different
// prefix) so buckets don't collide. Cluster-safe: multiple pm2 workers
// (or nodes) share the same Redis counters. If Redis is unreachable, the
// store rejects sendCommand — express-rate-limit then fails open, which
// matches the existing fail-open posture for non-privileged endpoints.
function redisLimiterStore(prefix) {
  return new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
    prefix,
  });
}

// Rate-limit key: device API keys resolve to user ID (so rotating keys for
// the same user lands in the same bucket), other bearers fall back to a
// short hash (avoids leaking raw tokens as limiter-map keys), no auth falls
// back to IP. keyGenerator is async — supported since express-rate-limit 7.
async function rateLimitKeyByAuth(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return req.ip;
  const bearer = authHeader.split(' ')[1];
  if (!bearer) return req.ip;
  if (bearer.startsWith('hal_')) {
    try {
      const apiKeyHash = crypto.createHash('sha256').update(bearer).digest('hex');
      const device = await prisma.device.findUnique({
        where: { apiKeyHash },
        select: { userId: true },
      });
      if (device) return `user:${device.userId}`;
    } catch { /* fall through to hash */ }
  }
  return `token:${crypto.createHash('sha256').update(bearer).digest('hex').slice(0, 16)}`;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Trust the reverse proxy in front of HAL (nginx/Caddy/Traefik)
app.set('trust proxy', 1);

// Security headers. CSP is tuned for a React SPA served from the same
// origin: inline scripts/styles are allowed (React + the theme preload in
// index.html), data:/blob:/https: images are allowed (chat imports from
// oaiusercontent.com, generated images, data URLs). HSTS, X-Frame-Options,
// X-Content-Type-Options etc. come free. COEP is off since we don't use
// SharedArrayBuffer or cross-origin isolation.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-origin' },
}));

// CORS — restrict origins in production, allow all in dev
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : null; // null = allow all (dev mode)

app.use(cors({
  origin: CORS_ORIGINS || true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
// 15MB accommodates base64-encoded user-attached images in /api/chat/* payloads
// (base64 is ~33% larger than raw, so ~11MB raw image ceiling).
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));

// Request-scoped structured logging. Every request gets a unique req.id
// (via pino-http's genReqId) and an attached req.log so handlers can write
// correlated log lines. 4xx logs as warn, 5xx as error, else info.
app.use(pinoHttp({
  logger,
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} → ${res.statusCode}`,
  customErrorMessage: (req, res, err) => `${req.method} ${req.url} failed: ${err?.message || res.statusCode}`,
  // Default pino-http dumps every request + response header, which is noisy
  // and can leak auth tokens. Keep just the useful fields.
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url, remoteAddress: req.remoteAddress }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 60,
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  store: redisLimiterStore('rl:api:'),
});

app.use('/api/', limiter);

// Serve React app from client/dist
app.use(express.static(path.join(__dirname, '../../client/dist')));

// Serve static assets (uploads, generated images) from public
app.use('/uploads', express.static(path.join(__dirname, '../../public/uploads')));
app.use('/generated-images', express.static(path.join(__dirname, '../../public/generated-images')));

// Health check — returns 503 if any critical service (DB or LLM) is down.
// Redis is treated as non-critical (app still functions, just with fail-open
// on session revocation — see middleware/auth.js).
app.get('/api/health', async (req, res) => {
  const [dbResult, llmResult] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    llmService.checkHealth(),
  ]);

  const services = {
    database: dbResult.status === 'fulfilled' ? 'connected' : 'disconnected',
    redis: redisClient.isOpen ? 'connected' : 'disconnected',
    llm: llmResult.status === 'fulfilled' && llmResult.value ? 'connected' : 'disconnected',
  };

  const criticalDown = services.database === 'disconnected' || services.llm === 'disconnected';
  const status = criticalDown ? 'unhealthy' : 'healthy';

  res.status(criticalDown ? 503 : 200).json({
    status,
    timestamp: new Date().toISOString(),
    services,
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/parent', parentRoutes);
app.use('/api/image', imageRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/llm', llmRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/import', importRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/share', shareRoutes);

// GPU Broker API — rate limited per API key
const gpuLimiter = rateLimit({
  windowMs: parseInt(process.env.GPU_RATE_LIMIT_WINDOW_MS) || 60000,
  max: parseInt(process.env.GPU_RATE_LIMIT_MAX_REQUESTS) || 20,
  message: { error: { message: 'GPU broker rate limit exceeded', type: 'rate_limit_error' } },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyByAuth,
  store: redisLimiterStore('rl:gpu:'),
});
app.use('/api/gpu', gpuLimiter);
app.use('/api/gpu', gpuRoutes);

// OpenAI-compatible API proxy — stricter rate limit for inference endpoints
const v1Limiter = rateLimit({
  windowMs: parseInt(process.env.V1_RATE_LIMIT_WINDOW_MS) || 60000,
  max: parseInt(process.env.V1_RATE_LIMIT_MAX_REQUESTS) || 30,
  message: { error: { message: 'Too many requests, please slow down', type: 'rate_limit_error' } },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyByAuth,
  store: redisLimiterStore('rl:v1:'),
});
app.use('/v1', v1Limiter);
// 2MB cap on /v1 bodies — prevents runaway prompt sizes from hitting the
// LLM or ballooning memory. Individual prompt-content length is also bounded
// inside the route handlers.
app.use('/v1', express.json({ limit: '2mb' }));
app.use('/v1', openaiRoutes);

// Maintenance page (if needed)
app.get('/maintenance', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/maintenance.html'));
});

// Serve React app for all other routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  req.log?.error({ err }, 'Unhandled server error') || logger.error({ err }, 'Unhandled server error');
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'ollama';
const LLM_BASE_URL = process.env.LLM_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

const server = app.listen(PORT, () => {
  // Banner uses stdout.write so it bypasses the console → pino shim. Keeps
  // the ASCII art readable in terminals. Structured "server started" log
  // below goes through pino for log aggregators.
  process.stdout.write(`
╔════════════════════════════════════════╗
║   HAL - Home AI Box                    ║
║   Server running on port ${PORT}         ║
╚════════════════════════════════════════╝

🌐 Local:    http://localhost:${PORT}
${process.env.PUBLIC_URL ? `🔒 Public:   ${process.env.PUBLIC_URL}\n` : ''}
Services:
  📊 Database: PostgreSQL (localhost:5432)
  🔴 Redis:    localhost:6379
  🤖 LLM:      ${LLM_PROVIDER} @ ${LLM_BASE_URL}

Press Ctrl+C to stop

`);
  logger.info({
    port: PORT,
    llmProvider: LLM_PROVIDER,
    llmBaseUrl: LLM_BASE_URL,
    nodeEnv: process.env.NODE_ENV || 'development',
  }, 'Server started');
});

// Graceful shutdown — stop accepting new connections, drain in-flight requests.
// 30s cap so pm2 reload doesn't hang forever on a stuck stream.
const SHUTDOWN_TIMEOUT_MS = 30_000;
let shuttingDown = false;

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal, timeoutSec: SHUTDOWN_TIMEOUT_MS / 1000 }, 'Shutting down, draining in-flight requests');

  const forceExit = setTimeout(() => {
    logger.error('Drain timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close(async () => {
    try {
      await prisma.$disconnect();
    } catch (err) {
      logger.error({ err }, 'Prisma disconnect error');
    }
    try {
      if (redisClient.isOpen) await redisClient.quit();
    } catch (err) {
      logger.error({ err }, 'Redis quit error');
    }
    logger.info('Shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Last-resort handlers. We log + drain rather than crash silently; PM2
// will restart us if drain takes too long. uncaughtException is the more
// serious of the two — the process state is probably corrupt, so we exit
// after logging instead of trying to soldier on.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  gracefulShutdown('uncaughtException');
});
