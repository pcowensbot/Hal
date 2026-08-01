import express from 'express';
import crypto from 'crypto';
import prisma from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Generate a secure API key
function generateApiKey() {
  return 'hal_' + crypto.randomBytes(32).toString('hex');
}

// Hash API key for storage
function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

// Get all devices for current user
router.get('/', async (req, res) => {
  try {
    const devices = await prisma.device.findMany({
      where: { userId: req.user.userId },
      select: {
        id: true,
        name: true,
        description: true,
        lastUsedAt: true,
        requestCount: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(devices);
  } catch (error) {
    console.error('Get devices error:', error);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

// Create a new device and generate API key
router.post('/', async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Device name is required' });
    }

    // Generate unique API key
    const apiKey = generateApiKey();
    const apiKeyHash = hashApiKey(apiKey);

    const device = await prisma.device.create({
      data: {
        userId: req.user.userId,
        name: name.trim(),
        description: description?.trim() || null,
        apiKeyHash,
      },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
      },
    });

    // Return the plain API key ONLY on creation (won't be shown again)
    res.json({
      ...device,
      apiKey, // Show API key only once
      message: 'Device created successfully. Save this API key securely - it will not be shown again!',
    });
  } catch (error) {
    console.error('Create device error:', error);
    res.status(500).json({ error: 'Failed to create device' });
  }
});

// Delete a device
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Verify device belongs to user
    const device = await prisma.device.findFirst({
      where: {
        id,
        userId: req.user.userId,
      },
    });

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    await prisma.device.delete({
      where: { id },
    });

    res.json({ message: 'Device deleted successfully' });
  } catch (error) {
    console.error('Delete device error:', error);
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

// Get API history for a device
router.get('/:id/history', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = 50,
      startDate,
      endDate,
      status
    } = req.query;

    // Verify device belongs to user
    const device = await prisma.device.findFirst({
      where: {
        id,
        userId: req.user.userId,
      },
    });

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Build where clause
    const where = { deviceId: id };

    // Date filtering
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    // Status filtering (success/error)
    if (status === 'success') {
      where.status = { gte: 200, lt: 400 };
    } else if (status === 'error') {
      where.status = { gte: 400 };
    }

    // Search filtering (search in prompt, response, endpoint, model)
    if (search) {
      where.OR = [
        { prompt: { contains: search, mode: 'insensitive' } },
        { response: { contains: search, mode: 'insensitive' } },
        { endpoint: { contains: search, mode: 'insensitive' } },
        { model: { contains: search, mode: 'insensitive' } },
        { error: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Valid sort fields
    const validSortFields = ['createdAt', 'endpoint', 'status', 'durationMs', 'model'];
    const orderField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 100); // Max 100 per page

    // Get total count for pagination
    const total = await prisma.deviceApiLog.count({ where });

    // Get logs
    const logs = await prisma.deviceApiLog.findMany({
      where,
      orderBy: { [orderField]: orderDirection },
      skip,
      take,
      select: {
        id: true,
        endpoint: true,
        method: true,
        model: true,
        prompt: true,
        response: true,
        status: true,
        durationMs: true,
        tokenCount: true,
        error: true,
        createdAt: true,
      },
    });

    res.json({
      logs,
      pagination: {
        page: parseInt(page),
        limit: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    console.error('Get device history error:', error);
    res.status(500).json({ error: 'Failed to fetch device history' });
  }
});

// Clear device history
router.delete('/:id/history', async (req, res) => {
  try {
    const { id } = req.params;

    // Verify device belongs to user
    const device = await prisma.device.findFirst({
      where: {
        id,
        userId: req.user.userId,
      },
    });

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    await prisma.deviceApiLog.deleteMany({
      where: { deviceId: id },
    });

    res.json({ message: 'Device history cleared' });
  } catch (error) {
    console.error('Clear device history error:', error);
    res.status(500).json({ error: 'Failed to clear device history' });
  }
});

// Update device info (name/description only)
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    // Verify device belongs to user
    const device = await prisma.device.findFirst({
      where: {
        id,
        userId: req.user.userId,
      },
    });

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const updated = await prisma.device.update({
      where: { id },
      data: {
        name: name?.trim() || device.name,
        description: description?.trim() || device.description,
      },
      select: {
        id: true,
        name: true,
        description: true,
        lastUsedAt: true,
        requestCount: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Update device error:', error);
    res.status(500).json({ error: 'Failed to update device' });
  }
});

export default router;
