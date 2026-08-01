import express from 'express';
import crypto from 'crypto';
import prisma from '../config/database.js';
import { authenticateToken, authenticateDevice } from '../middleware/auth.js';

const router = express.Router();

// POST /api/sessions/sync — Push completed sessions (device API key auth)
router.post('/sync', authenticateDevice, async (req, res) => {
  try {
    const { sessions } = req.body;
    const userId = req.device.userId;

    if (!Array.isArray(sessions) || sessions.length === 0) {
      return res.status(400).json({ error: 'sessions array is required' });
    }

    if (sessions.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 sessions per sync' });
    }

    const results = [];

    for (const session of sessions) {
      const {
        externalId,
        title,
        workingDir,
        model,
        duration,
        messages,
        filesModified,
        filesCreated,
        filesDeleted,
        commandsRun,
        toolCalls,
        tags,
      } = session;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        results.push({ externalId, status: 'skipped', reason: 'no messages' });
        continue;
      }

      // Idempotency check
      if (externalId) {
        const existing = await prisma.sessionMeta.findUnique({
          where: { externalId },
          select: { conversationId: true },
        });
        if (existing) {
          results.push({ externalId, status: 'exists', conversationId: existing.conversationId });
          continue;
        }
      }

      const tokenCount = session.tokenCount || null;

      // Create conversation + messages + session meta in a transaction
      const conversation = await prisma.$transaction(async (tx) => {
        const convo = await tx.conversation.create({
          data: {
            userId,
            title: title || 'API Session',
            source: 'opencode',
            messages: {
              create: messages.map((msg, index) => ({
                role: msg.role || 'user',
                content: msg.content || '',
                modelUsed: msg.role === 'assistant' ? (model || 'unknown') : 'user',
                createdAt: msg.timestamp ? new Date(msg.timestamp) : new Date(Date.now() + index),
              })),
            },
            sessionMeta: {
              create: {
                externalId: externalId || null,
                workingDir: workingDir || null,
                filesModified: filesModified || [],
                filesCreated: filesCreated || [],
                filesDeleted: filesDeleted || [],
                commandsRun: commandsRun || [],
                toolCalls: toolCalls || [],
                tokenCount,
                modelUsed: model || null,
                duration: duration || null,
                tags: tags || [],
              },
            },
          },
        });
        return convo;
      });

      results.push({ externalId, status: 'created', conversationId: conversation.id });
    }

    res.json({ synced: results });
  } catch (error) {
    console.error('Session sync error:', error);
    res.status(500).json({ error: 'Failed to sync sessions' });
  }
});

// GET /api/sessions/token-stats — Token usage stats for current user's devices
router.get('/token-stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const devices = await prisma.device.findMany({
      where: { userId },
      select: { id: true, name: true },
    });
    const deviceIds = devices.map(d => d.id);

    if (deviceIds.length === 0) {
      return res.json({ totalTokens: 0, totalRequests: 0, today: { tokens: 0, requests: 0 }, devices: [] });
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [allTime, today, perDevice] = await Promise.all([
      prisma.deviceApiLog.aggregate({
        where: { deviceId: { in: deviceIds }, endpoint: '/v1/chat/completions' },
        _sum: { tokenCount: true },
        _count: true,
      }),
      prisma.deviceApiLog.aggregate({
        where: {
          deviceId: { in: deviceIds },
          endpoint: '/v1/chat/completions',
          createdAt: { gte: todayStart },
        },
        _sum: { tokenCount: true },
        _count: true,
      }),
      prisma.deviceApiLog.groupBy({
        by: ['deviceId'],
        where: { deviceId: { in: deviceIds }, endpoint: '/v1/chat/completions' },
        _sum: { tokenCount: true },
        _count: true,
      }),
    ]);

    const deviceMap = new Map(devices.map(d => [d.id, d.name]));

    res.json({
      totalTokens: allTime._sum.tokenCount || 0,
      totalRequests: allTime._count,
      today: {
        tokens: today._sum.tokenCount || 0,
        requests: today._count,
      },
      devices: perDevice.map(d => ({
        id: d.deviceId,
        name: deviceMap.get(d.deviceId) || 'Unknown',
        tokens: d._sum.tokenCount || 0,
        requests: d._count,
      })),
    });
  } catch (error) {
    console.error('Token stats error:', error);
    res.status(500).json({ error: 'Failed to fetch token stats' });
  }
});

// GET /api/sessions/log-days-by-device — Days grouped by device for sidebar
router.get('/log-days-by-device', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const devices = await prisma.device.findMany({
      where: { userId },
      select: { id: true, name: true },
    });

    if (devices.length === 0) {
      return res.json({ devices: [] });
    }

    const deviceIds = devices.map(d => d.id);

    const logs = await prisma.deviceApiLog.groupBy({
      by: ['deviceId', 'createdAt'],
      where: {
        deviceId: { in: deviceIds },
        endpoint: '/v1/chat/completions',
      },
      _count: true,
    });

    // Group by (deviceId, date)
    const deviceDayMap = new Map();
    for (const log of logs) {
      const dateStr = new Date(log.createdAt).toISOString().split('T')[0];
      const key = `${log.deviceId}:${dateStr}`;
      deviceDayMap.set(key, (deviceDayMap.get(key) || 0) + log._count);
    }

    const result = devices.map(device => {
      const days = [];
      for (const [key, count] of deviceDayMap) {
        const [devId, date] = key.split(':');
        if (devId === device.id) {
          days.push({ date, count });
        }
      }
      days.sort((a, b) => b.date.localeCompare(a.date));
      return { id: device.id, name: device.name, days };
    }).filter(d => d.days.length > 0);

    res.json({ devices: result });
  } catch (error) {
    console.error('Log days by device error:', error);
    res.status(500).json({ error: 'Failed to fetch log days by device' });
  }
});

// GET /api/sessions/log-days — Days with API activity + counts for sidebar
router.get('/log-days', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { month } = req.query;

    const devices = await prisma.device.findMany({
      where: { userId },
      select: { id: true },
    });
    const deviceIds = devices.map(d => d.id);

    if (deviceIds.length === 0) {
      return res.json({ days: [] });
    }

    let dateFilter = {};
    if (month) {
      const [year, mon] = month.split('-').map(Number);
      dateFilter = {
        createdAt: {
          gte: new Date(year, mon - 1, 1),
          lt: new Date(year, mon, 1),
        },
      };
    }

    const logs = await prisma.deviceApiLog.groupBy({
      by: ['createdAt'],
      where: {
        deviceId: { in: deviceIds },
        endpoint: '/v1/chat/completions',
        ...dateFilter,
      },
      _count: true,
    });

    const dayMap = new Map();
    for (const log of logs) {
      const dateStr = new Date(log.createdAt).toISOString().split('T')[0];
      dayMap.set(dateStr, (dayMap.get(dateStr) || 0) + log._count);
    }

    const days = Array.from(dayMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => b.date.localeCompare(a.date));

    res.json({ days });
  } catch (error) {
    console.error('Log days error:', error);
    res.status(500).json({ error: 'Failed to fetch log days' });
  }
});

// GET /api/sessions/logs — List log entries for a specific date
router.get('/logs', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { date, deviceId, search, timeFrom, timeTo, page = '1', limit = '50' } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'date parameter required (YYYY-MM-DD)' });
    }

    const devices = await prisma.device.findMany({
      where: { userId },
      select: { id: true },
    });
    const deviceIds = devices.map(d => d.id);

    if (deviceIds.length === 0) {
      return res.json({ logs: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } });
    }

    // If deviceId specified, validate it belongs to user
    const filteredDeviceIds = deviceId && deviceIds.includes(deviceId)
      ? [deviceId]
      : deviceIds;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [year, mon, day] = date.split('-').map(Number);
    const dayStart = new Date(year, mon - 1, day);
    const dayEnd = new Date(year, mon - 1, day + 1);

    const where = {
      deviceId: { in: filteredDeviceIds },
      endpoint: '/v1/chat/completions',
      createdAt: {
        gte: dayStart,
        lt: dayEnd,
      },
    };

    if (timeFrom) {
      const [h, m] = timeFrom.split(':').map(Number);
      where.createdAt.gte = new Date(year, mon - 1, day, h, m);
    }
    if (timeTo) {
      const [h, m] = timeTo.split(':').map(Number);
      where.createdAt.lt = new Date(year, mon - 1, day, h, m);
    }

    if (search) {
      where.OR = [
        { prompt: { contains: search, mode: 'insensitive' } },
        { response: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.deviceApiLog.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip,
        take: limitNum,
        select: {
          id: true,
          model: true,
          prompt: true,
          response: true,
          status: true,
          durationMs: true,
          tokenCount: true,
          metadata: true,
          createdAt: true,
          device: { select: { name: true } },
        },
      }),
      prisma.deviceApiLog.count({ where }),
    ]);

    res.json({
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error('List logs error:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// POST /api/sessions/share — Create a shared log link
router.post('/share', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId, logIds } = req.body;

    if (!deviceId || !logIds || !Array.isArray(logIds) || logIds.length === 0) {
      return res.status(400).json({ error: 'deviceId and logIds array required' });
    }

    // Validate device belongs to user
    const device = await prisma.device.findFirst({
      where: { id: deviceId, userId },
    });
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Validate all logs belong to this device
    const logCount = await prisma.deviceApiLog.count({
      where: { id: { in: logIds }, deviceId },
    });
    if (logCount !== logIds.length) {
      return res.status(400).json({ error: 'Some log IDs are invalid' });
    }

    const slug = crypto.randomBytes(16).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const shared = await prisma.sharedApiLog.create({
      data: {
        slug,
        userId,
        deviceId,
        logIds,
        expiresAt,
      },
    });

    res.json({ slug: shared.slug, url: `/share/${shared.slug}` });
  } catch (error) {
    console.error('Create share error:', error);
    res.status(500).json({ error: 'Failed to create share link' });
  }
});

// GET /api/sessions — List user's API sessions (JWT auth)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { search, tag, model, dateFrom, dateTo, page = '1', limit = '50' } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where = {
      userId,
      source: 'opencode',
      deletedAt: null,
    };

    if (search) {
      where.title = { contains: search, mode: 'insensitive' };
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const sessionMetaWhere = {};
    if (tag) {
      sessionMetaWhere.tags = { array_contains: tag };
    }
    if (model) {
      sessionMetaWhere.modelUsed = model;
    }

    if (Object.keys(sessionMetaWhere).length > 0) {
      where.sessionMeta = sessionMetaWhere;
    }

    const [sessions, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          sessionMeta: true,
          _count: { select: { messages: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.conversation.count({ where }),
    ]);

    res.json({
      sessions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error('List sessions error:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// GET /api/sessions/:id — Get full session with messages + metadata (JWT auth)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const session = await prisma.conversation.findFirst({
      where: {
        id,
        userId,
        source: 'opencode',
        deletedAt: null,
      },
      include: {
        sessionMeta: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            starredNotes: {
              where: { userId },
              select: { id: true },
            },
          },
        },
      },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(session);
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// DELETE /api/sessions/:id — Soft delete a session (JWT auth)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const session = await prisma.conversation.findFirst({
      where: { id, userId, source: 'opencode', deletedAt: null },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await prisma.conversation.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: userId },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

export default router;
