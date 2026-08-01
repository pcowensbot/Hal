import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../config/database.js';
import redisClient from '../config/redis.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

/**
 * Middleware to authenticate JWT tokens
 * Extracts token from Authorization header and verifies it
 * Adds userId and role to req.user
 */
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    // Check if session has been revoked (if jti is present)
    if (decoded.jti) {
      try {
        const revoked = await redisClient.get(`revoked:${decoded.jti}`);
        if (revoked) {
          return res.status(403).json({ error: 'Session has been revoked' });
        }
      } catch {
        // Redis down — allow through (fail-open for availability)
      }
    }

    // Check if user is still active
    if (decoded.userId) {
      try {
        const isRevoked = await redisClient.get(`revoked:user:${decoded.userId}`);
        if (isRevoked) {
          return res.status(403).json({ error: 'Account has been deactivated' });
        }
      } catch {
        // Redis down — allow through
      }
    }

    req.user = {
      id: decoded.userId,
      userId: decoded.userId,
      role: decoded.role,
      roleId: decoded.roleId,
      isSystemAdmin: decoded.isSystemAdmin,
      jti: decoded.jti,
    };

    next();
  });
};

/**
 * Strict session-revocation check for privileged routes. Fails CLOSED on
 * Redis errors — we'd rather 503 than let a revoked session through to an
 * admin endpoint. Returns an Express response (caller should early-return).
 * Returns null on success (no revocation, safe to continue).
 */
async function strictRevocationCheck(req, res) {
  if (req.user?.jti) {
    try {
      if (await redisClient.get(`revoked:${req.user.jti}`)) {
        return res.status(403).json({ error: 'Session has been revoked' });
      }
    } catch {
      return res.status(503).json({ error: 'Session store unavailable — try again shortly' });
    }
  }
  if (req.user?.userId) {
    try {
      if (await redisClient.get(`revoked:user:${req.user.userId}`)) {
        return res.status(403).json({ error: 'Account has been deactivated' });
      }
    } catch {
      return res.status(503).json({ error: 'Session store unavailable — try again shortly' });
    }
  }
  return null;
}

/**
 * Middleware factory: gate a route on a single capability. Always does a
 * fresh DB read for role + capabilities (JWT role claim may be stale after
 * a demotion). SUPER_ADMIN and system admin bypass the capability check.
 *
 *   router.post('/users/:id/reset-password', requireCapability('canManageUsers'), handler);
 *
 * Must be used after authenticateToken.
 */
export const requireCapability = (capability) => async (req, res, next) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const revocationBlock = await strictRevocationCheck(req, res);
    if (revocationBlock) return;

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        role: true,
        isSystemAdmin: true,
        roleId: true,
        customRole: true,
      },
    });

    if (!user) {
      return res.status(403).json({ error: 'User no longer exists' });
    }

    // Refresh req.user with live DB values — subsequent handlers should
    // prefer req.user.role over the JWT claim.
    req.user.role = user.role;
    req.user.isSystemAdmin = user.isSystemAdmin;
    req.user.capabilities = user.customRole || null;

    if (user.role === 'SUPER_ADMIN' || user.isSystemAdmin) return next();

    if (user.customRole?.[capability]) return next();

    return res.status(403).json({ error: `Permission required: ${capability}` });
  } catch (error) {
    console.error('Capability check error:', error);
    res.status(500).json({ error: 'Permission check failed' });
  }
};

/**
 * Middleware: any management capability (users OR groups OR system). Does a
 * fresh DB read and fails closed on Redis errors, same as requireCapability.
 *
 * Used as the coarse gate on /api/parent/* and /api/admin/* for legacy
 * reasons. Prefer requireCapability(specificCap) for sensitive routes —
 * having any management cap shouldn't imply being able to reset arbitrary
 * user passwords.
 */
export const requireParent = async (req, res, next) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const revocationBlock = await strictRevocationCheck(req, res);
    if (revocationBlock) return;

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        role: true,
        isSystemAdmin: true,
        roleId: true,
        customRole: true,
      },
    });

    if (!user) {
      return res.status(403).json({ error: 'User no longer exists' });
    }

    req.user.role = user.role;
    req.user.isSystemAdmin = user.isSystemAdmin;
    req.user.capabilities = user.customRole || null;

    if (user.role === 'PARENT' || user.role === 'SUPER_ADMIN') return next();
    if (user.isSystemAdmin) return next();

    const cr = user.customRole;
    if (cr && (cr.canManageUsers || cr.canManageGroups || cr.canManageSystem)) {
      return next();
    }

    return res.status(403).json({ error: 'Admin access required' });
  } catch (error) {
    console.error('Permission check error:', error);
    res.status(500).json({ error: 'Permission check failed' });
  }
};

/**
 * Middleware to authenticate device API keys
 * Extracts API key from Authorization header (Bearer hal_xxx...)
 * Adds device info to req.device
 */
export const authenticateDevice = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const apiKey = authHeader && authHeader.split(' ')[1]; // Bearer hal_xxx...

    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }

    if (!apiKey.startsWith('hal_')) {
      return res.status(401).json({ error: 'Invalid API key format' });
    }

    // Hash the provided API key
    const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    // Find device with this API key hash
    const device = await prisma.device.findUnique({
      where: { apiKeyHash },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            role: true,
          },
        },
      },
    });

    if (!device) {
      return res.status(403).json({ error: 'Invalid API key' });
    }

    // Update last used time and increment request count
    await prisma.device.update({
      where: { id: device.id },
      data: {
        lastUsedAt: new Date(),
        requestCount: { increment: 1 },
      },
    });

    // Add device info to request
    req.device = {
      id: device.id,
      name: device.name,
      userId: device.userId,
      logPromptContent: device.logPromptContent,
      defaults: device.defaults,
      pinnedModel: device.pinnedModel,
      user: device.user,
    };

    next();
  } catch (error) {
    console.error('Device authentication error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

export default authenticateToken;
