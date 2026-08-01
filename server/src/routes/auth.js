import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../config/database.js';
import redisClient from '../config/redis.js';
import { authenticateToken } from '../middleware/auth.js';
import { validatePassword, hashPassword } from '../lib/password.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}
// 30d → 24h. Proper 1h-access + 14d-refresh split is a client-side change
// (auto-refresh on 401, separate token store) — deferred to Phase 7.
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

function generateToken(payload) {
  const jti = crypto.randomUUID();
  return jwt.sign({ ...payload, jti }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Revoke all sessions for a user by setting a Redis flag.
 * TTL matches max token lifetime so it auto-cleans.
 */
export async function revokeUserSessions(userId) {
  try {
    await redisClient.set(`revoked:user:${userId}`, '1', { EX: 30 * 24 * 3600 });
  } catch {
    // Redis down — revocation won't take effect until Redis recovers
  }
}

/**
 * Clear the user revocation flag (e.g., after re-enabling an account).
 */
export async function clearUserRevocation(userId) {
  try {
    await redisClient.del(`revoked:user:${userId}`);
  } catch {
    // Non-critical
  }
}

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Find user with custom role and group memberships
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        customRole: true,
        groupMemberships: {
          include: {
            group: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({ error: 'Your account has been disabled. Please contact an administrator.' });
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Build permissions object from custom role
    const permissions = user.customRole ? {
      canManageUsers: user.customRole.canManageUsers,
      canManageGroups: user.customRole.canManageGroups,
      canManageRoles: user.customRole.canManageRoles,
      canViewAllConvos: user.customRole.canViewAllConvos,
      canManageSystem: user.customRole.canManageSystem,
      canCreateInvites: user.customRole.canCreateInvites,
      canDeleteConvos: user.customRole.canDeleteConvos,
    } : {};

    // Clear any previous revocation (user is actively logging in)
    await clearUserRevocation(user.id);

    // Generate JWT with session ID for revocation support
    const token = generateToken({
      userId: user.id,
      role: user.role,
      roleId: user.roleId,
      isSystemAdmin: user.isSystemAdmin,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        role: user.role, // Legacy
        isSystemAdmin: user.isSystemAdmin,
        customRole: user.customRole ? {
          id: user.customRole.id,
          name: user.customRole.name,
          color: user.customRole.color,
        } : null,
        permissions,
        avatar: user.avatar,
        groups: user.groupMemberships.map(gm => ({
          id: gm.group.id,
          name: gm.group.name,
          color: gm.group.color,
          isGroupAdmin: gm.isGroupAdmin,
          canViewAll: gm.canViewAll,
        })),
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Validate token and return current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        customRole: true,
        groupMemberships: {
          include: {
            group: true,
          },
        },
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    // Build permissions from custom role
    const permissions = user.customRole ? {
      canManageUsers: user.customRole.canManageUsers,
      canManageGroups: user.customRole.canManageGroups,
      canManageRoles: user.customRole.canManageRoles,
      canViewAllConvos: user.customRole.canViewAllConvos,
      canManageSystem: user.customRole.canManageSystem,
      canCreateInvites: user.customRole.canCreateInvites,
      canDeleteConvos: user.customRole.canDeleteConvos,
    } : {};

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        role: user.role,
        isSystemAdmin: user.isSystemAdmin,
        isActive: user.isActive,
        avatar: user.avatar,
        customRole: user.customRole ? {
          id: user.customRole.id,
          name: user.customRole.name,
          color: user.customRole.color,
        } : null,
        permissions,
        groups: user.groupMemberships.map(gm => ({
          id: gm.group.id,
          name: gm.group.name,
          color: gm.group.color,
          isGroupAdmin: gm.isGroupAdmin,
          canViewAll: gm.canViewAll,
        })),
      },
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// Refresh token — issue a new JWT, revoke the old one
router.post('/refresh', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, isActive: true, role: true, roleId: true, isSystemAdmin: true },
    });

    if (!user || !user.isActive) {
      return res.status(403).json({ error: 'Account is inactive' });
    }

    // Revoke the old token's session ID
    if (req.user.jti) {
      try {
        await redisClient.set(`revoked:${req.user.jti}`, '1', { EX: 30 * 24 * 3600 });
      } catch {
        // Non-critical
      }
    }

    // Issue new token
    const token = generateToken({
      userId: user.id,
      role: user.role,
      roleId: user.roleId,
      isSystemAdmin: user.isSystemAdmin,
    });

    res.json({ token });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// Logout — revoke current session
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    if (req.user.jti) {
      await redisClient.set(`revoked:${req.user.jti}`, '1', { EX: 30 * 24 * 3600 });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Signup (requires invite code)
router.post('/signup', async (req, res) => {
  try {
    const { inviteCode, email, password, firstName } = req.body;

    if (!inviteCode || !email || !password || !firstName) {
      return res.status(400).json({ error: 'All fields including invite code are required' });
    }

    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ error: pwError });

    // Verify invite code with role and group info
    const invite = await prisma.inviteCode.findUnique({
      where: { code: inviteCode },
      include: {
        assignedRole: true,
        assignedGroup: true,
      },
    });

    if (!invite) {
      return res.status(401).json({ error: 'Invalid invite code' });
    }

    if (!invite.isActive) {
      return res.status(401).json({ error: 'This invite code has been deactivated' });
    }

    if (invite.usedAt) {
      return res.status(401).json({ error: 'This invite code has already been used' });
    }

    if (invite.expiresAt && new Date() > invite.expiresAt) {
      return res.status(401).json({ error: 'This invite code has expired' });
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Check if this is the first user (should be system admin)
    const userCount = await prisma.user.count();
    const isFirstUser = userCount === 0;

    // Get the role to assign
    let roleId = invite.roleId;
    if (!roleId) {
      // Fall back to Member role if no role specified on invite
      const memberRole = await prisma.customRole.findUnique({
        where: { name: 'Member' },
      });
      roleId = memberRole?.id;
    }

    // Get admin role for first user
    if (isFirstUser) {
      const adminRole = await prisma.customRole.findUnique({
        where: { name: 'Admin' },
      });
      roleId = adminRole?.id;
    }

    // Create user with new role system
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        firstName,
        role: isFirstUser ? 'SUPER_ADMIN' : 'MEMBER', // Legacy field
        roleId,
        isSystemAdmin: isFirstUser,
      },
      include: {
        customRole: true,
      },
    });

    // Mark invite code as used
    await prisma.inviteCode.update({
      where: { id: invite.id },
      data: {
        usedAt: new Date(),
        usedById: user.id,
      },
    });

    // Add user to group if specified on invite
    if (invite.groupId) {
      await prisma.groupMember.create({
        data: {
          userId: user.id,
          groupId: invite.groupId,
          isGroupAdmin: invite.makeGroupAdmin,
          canViewAll: invite.makeGroupAdmin, // Group admins can view all by default
        },
      });
    }

    // Fetch user with groups for response
    const userWithGroups = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        customRole: true,
        groupMemberships: {
          include: { group: true },
        },
      },
    });

    // Build permissions
    const permissions = userWithGroups.customRole ? {
      canManageUsers: userWithGroups.customRole.canManageUsers,
      canManageGroups: userWithGroups.customRole.canManageGroups,
      canManageRoles: userWithGroups.customRole.canManageRoles,
      canViewAllConvos: userWithGroups.customRole.canViewAllConvos,
      canManageSystem: userWithGroups.customRole.canManageSystem,
      canCreateInvites: userWithGroups.customRole.canCreateInvites,
      canDeleteConvos: userWithGroups.customRole.canDeleteConvos,
    } : {};

    // Generate JWT with session ID
    const token = generateToken({
      userId: user.id,
      role: user.role,
      roleId: user.roleId,
      isSystemAdmin: user.isSystemAdmin,
    });

    res.status(201).json({
      token,
      user: {
        id: userWithGroups.id,
        email: userWithGroups.email,
        firstName: userWithGroups.firstName,
        role: userWithGroups.role,
        isSystemAdmin: userWithGroups.isSystemAdmin,
        customRole: userWithGroups.customRole ? {
          id: userWithGroups.customRole.id,
          name: userWithGroups.customRole.name,
          color: userWithGroups.customRole.color,
        } : null,
        permissions,
        avatar: userWithGroups.avatar,
        groups: userWithGroups.groupMemberships.map(gm => ({
          id: gm.group.id,
          name: gm.group.name,
          color: gm.group.color,
          isGroupAdmin: gm.isGroupAdmin,
          canViewAll: gm.canViewAll,
        })),
      },
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// Update Avatar
router.post('/avatar', authenticateToken, async (req, res) => {
  try {
    const { avatar } = req.body;
    const userId = req.user.userId;

    if (!avatar) {
      return res.status(400).json({ error: 'Avatar data required' });
    }

    // Validate avatar is base64 image data
    if (!avatar.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid avatar format' });
    }

    // Update user avatar
    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatar },
      select: {
        id: true,
        email: true,
        firstName: true,
        role: true,
        avatar: true,
      },
    });

    res.json({
      success: true,
      message: 'Avatar updated successfully',
      user,
    });
  } catch (error) {
    console.error('Avatar update error:', error);
    res.status(500).json({ error: 'Failed to update avatar' });
  }
});

// Remove Avatar
router.delete('/avatar', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Remove user avatar
    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatar: null },
      select: {
        id: true,
        email: true,
        firstName: true,
        role: true,
        avatar: true,
      },
    });

    res.json({
      success: true,
      message: 'Avatar removed successfully',
      user,
    });
  } catch (error) {
    console.error('Avatar remove error:', error);
    res.status(500).json({ error: 'Failed to remove avatar' });
  }
});

// Update Profile Name
router.patch('/profile', authenticateToken, async (req, res) => {
  try {
    const { firstName } = req.body;
    const userId = req.user.userId;

    if (!firstName || !firstName.trim()) {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }

    // Update user name
    const user = await prisma.user.update({
      where: { id: userId },
      data: { firstName: firstName.trim() },
      select: {
        id: true,
        email: true,
        firstName: true,
        role: true,
        avatar: true,
      },
    });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user,
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Change Password (NEW ENDPOINT)
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }

    const pwError = validatePassword(newPassword);
    if (pwError) return res.status(400).json({ error: pwError });

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const newPasswordHash = await hashPassword(newPassword);

    // Update password in database
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    // Revoke all existing sessions for this user — current device included.
    // Caller must log back in with the new password. Simpler + safer than
    // shipping a fresh JWT in the response (which the client doesn't wire up).
    await revokeUserSessions(userId);

    console.log(`Password changed successfully for user: ${userId}`);

    res.json({
      success: true,
      message: 'Password changed. Please log in again with your new password.',
      reauthRequired: true,
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Delete user account
router.post('/delete-account', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const { deleteType, password } = req.body; // deleteType: 'complete' or 'archive'

    if (!deleteType || !password) {
      return res.status(400).json({ error: 'Delete type and password required' });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        conversations: {
          include: {
            messages: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    let archiveData = null;

    if (deleteType === 'archive') {
      // Create archive of all conversations
      archiveData = {
        user: {
          email: user.email,
          firstName: user.firstName,
          deletedAt: new Date().toISOString()
        },
        conversations: user.conversations.map(conv => ({
          id: conv.id,
          title: conv.title,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
          messages: conv.messages.map(msg => ({
            role: msg.role,
            content: msg.content,
            createdAt: msg.createdAt,
            modelUsed: msg.modelUsed
          }))
        }))
      };
    }

    // Revoke all sessions before deleting
    await revokeUserSessions(userId);

    // Delete user (cascade will delete all related data)
    await prisma.user.delete({
      where: { id: userId }
    });

    console.log(`User self-delete: user=${userId} type=${deleteType}`);

    res.json({
      success: true,
      message: 'Account deleted successfully',
      archive: archiveData
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

export default router;
