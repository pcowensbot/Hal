import express from 'express';
import prisma from '../config/database.js';

const router = express.Router();

// GET /api/share/:slug — Public share view (no auth)
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    const shared = await prisma.sharedApiLog.findUnique({
      where: { slug },
      include: {
        device: { select: { name: true } },
        user: { select: { firstName: true } },
      },
    });

    if (!shared) {
      return res.status(404).json({ error: 'Share not found' });
    }

    if (shared.expiresAt && new Date() > shared.expiresAt) {
      return res.status(410).json({ error: 'Share link has expired' });
    }

    const logs = await prisma.deviceApiLog.findMany({
      where: { id: { in: shared.logIds } },
      orderBy: { createdAt: 'asc' },
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
      },
    });

    res.json({
      logs,
      deviceName: shared.device.name,
      sharedBy: shared.user.firstName,
      createdAt: shared.createdAt,
    });
  } catch (error) {
    console.error('Get share error:', error);
    res.status(500).json({ error: 'Failed to fetch shared logs' });
  }
});

export default router;
