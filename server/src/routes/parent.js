import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import prisma from '../config/database.js';
import { authenticateToken, requireParent, requireCapability } from '../middleware/auth.js';
import { revokeUserSessions, clearUserRevocation } from './auth.js';
import { validatePassword, hashPassword } from '../lib/password.js';

const router = express.Router();

// All routes require parent authentication
router.use(authenticateToken);
router.use(requireParent);

// Get all users in system
router.get('/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        role: true,
        roleId: true,
        isSystemAdmin: true,
        customRole: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
        avatar: true,
        isActive: true,
        createdAt: true,
        groupMemberships: {
          include: {
            group: {
              select: {
                id: true,
                name: true,
                color: true,
              },
            },
          },
        },
        _count: {
          select: { conversations: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Toggle user active status (enable/disable)
router.patch('/users/:id/toggle-status', requireCapability('canManageUsers'), async (req, res) => {
  try {
    const { id } = req.params;
    const currentUser = req.user;

    // Get the target user
    const targetUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent disabling yourself
    if (targetUser.id === currentUser.userId) {
      return res.status(400).json({ error: 'Cannot disable your own account' });
    }

    // Prevent non-SUPER_ADMIN from disabling SUPER_ADMIN or PARENT
    if (currentUser.role !== 'SUPER_ADMIN' && (targetUser.role === 'SUPER_ADMIN' || targetUser.role === 'PARENT')) {
      return res.status(403).json({ error: 'Only super admin can disable parent accounts' });
    }

    // Toggle the status
    const updatedUser = await prisma.user.update({
      where: { id },
      data: { isActive: !targetUser.isActive },
      select: {
        id: true,
        email: true,
        firstName: true,
        role: true,
        avatar: true,
        isActive: true,
        createdAt: true,
      },
    });

    // Revoke sessions when disabling, clear revocation when enabling
    if (!updatedUser.isActive) {
      await revokeUserSessions(updatedUser.id);
    } else {
      await clearUserRevocation(updatedUser.id);
    }

    res.json({
      success: true,
      message: `User ${updatedUser.isActive ? 'enabled' : 'disabled'} successfully`,
      user: updatedUser,
    });
  } catch (error) {
    console.error('Toggle user status error:', error);
    res.status(500).json({ error: 'Failed to toggle user status' });
  }
});

// Reset user password (admin)
router.post('/users/:id/reset-password', requireCapability('canManageUsers'), async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    const pwError = validatePassword(newPassword);
    if (pwError) return res.status(400).json({ error: pwError });

    const targetUser = await prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id },
      data: { passwordHash },
    });

    // Force re-auth on all of the target user's existing sessions.
    await revokeUserSessions(id);

    res.json({ success: true, message: `Password reset for ${targetUser.firstName}` });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Get all conversations across household (excluding soft-deleted)
router.get('/conversations', async (req, res) => {
  try {
    const { userId, search } = req.query;

    const where = { deletedAt: null };
    if (userId) where.userId = userId;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { messages: { some: { content: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: [
        { starred: 'desc' },   // Starred conversations first
        { updatedAt: 'desc' }, // Then by most recent
      ],
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            role: true,
          },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { messages: true },
        },
      },
    });

    res.json(conversations);
  } catch (error) {
    console.error('Get all conversations error:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Get single conversation with messages (admin view)
router.get('/conversations/:id', async (req, res) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
        user: {
          select: {
            id: true,
            firstName: true,
            role: true,
          },
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json(conversation);
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// Get activity stats
router.get('/stats', async (req, res) => {
  try {
    const [totalUsers, totalConversations, pendingDeletions] = await Promise.all([
      prisma.user.count(),
      prisma.conversation.count({ where: { deletedAt: null } }),
      prisma.conversation.count({ where: { deletedAt: { not: null }, permanentDelete: false } }),
    ]);

    res.json({
      totalUsers,
      totalConversations,
      pendingDeletions,
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get API session usage stats (admin only)
router.get('/api-usage', async (req, res) => {
  try {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const [totalSessions, sessionsThisWeek, userBreakdown] = await Promise.all([
      prisma.conversation.count({
        where: { source: 'opencode', deletedAt: null },
      }),
      prisma.conversation.count({
        where: { source: 'opencode', deletedAt: null, createdAt: { gte: oneWeekAgo } },
      }),
      prisma.$queryRaw`
        SELECT
          u.id,
          u."firstName",
          COUNT(c.id)::int as "sessionCount",
          COALESCE(SUM(sm."tokenCount"), 0)::int as "totalTokens"
        FROM users u
        LEFT JOIN conversations c ON c."userId" = u.id AND c.source = 'opencode' AND c."deletedAt" IS NULL
        LEFT JOIN session_meta sm ON sm."conversationId" = c.id
        GROUP BY u.id, u."firstName"
        HAVING COUNT(c.id) > 0
        ORDER BY COUNT(c.id) DESC
      `,
    ]);

    const totalTokens = userBreakdown.reduce((sum, u) => sum + u.totalTokens, 0);

    res.json({
      totalSessions,
      sessionsThisWeek,
      totalTokens,
      userBreakdown,
    });
  } catch (error) {
    console.error('Get API usage stats error:', error);
    res.status(500).json({ error: 'Failed to fetch API usage stats' });
  }
});

// Live View — who's using HAL right now
router.get('/live', async (req, res) => {
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [activeUsers, recentChats, recentApiCalls] = await Promise.all([
      // Users with conversation activity in the last 5 minutes
      prisma.$queryRaw`
        SELECT DISTINCT u.id, u."firstName", u.email, u.role, u.avatar,
          MAX(c."updatedAt") as "lastActivity",
          'chat' as "activityType"
        FROM users u
        INNER JOIN conversations c ON c."userId" = u.id
        WHERE c."updatedAt" >= ${fiveMinAgo} AND c."deletedAt" IS NULL
        GROUP BY u.id, u."firstName", u.email, u.role, u.avatar
        ORDER BY "lastActivity" DESC
      `,

      // Recent chat messages (last hour)
      prisma.message.findMany({
        where: {
          createdAt: { gte: oneHourAgo },
          conversation: { deletedAt: null },
        },
        select: {
          id: true,
          role: true,
          createdAt: true,
          modelUsed: true,
          conversation: {
            select: {
              id: true,
              title: true,
              userId: true,
              user: {
                select: { id: true, firstName: true, avatar: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),

      // Recent API calls (last hour)
      prisma.deviceApiLog.findMany({
        where: {
          createdAt: { gte: oneHourAgo },
        },
        select: {
          id: true,
          endpoint: true,
          method: true,
          model: true,
          status: true,
          durationMs: true,
          tokenCount: true,
          createdAt: true,
          device: {
            select: {
              id: true,
              name: true,
              user: {
                select: { id: true, firstName: true, avatar: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    // Also find users with API activity in last 5 min
    const apiActiveUsers = await prisma.$queryRaw`
      SELECT DISTINCT u.id, u."firstName", u.email, u.role, u.avatar,
        MAX(d_log."createdAt") as "lastActivity",
        'api' as "activityType"
      FROM users u
      INNER JOIN devices d ON d."userId" = u.id
      INNER JOIN device_api_logs d_log ON d_log."deviceId" = d.id
      WHERE d_log."createdAt" >= ${fiveMinAgo}
      GROUP BY u.id, u."firstName", u.email, u.role, u.avatar
      ORDER BY "lastActivity" DESC
    `;

    // Merge active users, dedup by id keeping most recent
    const userMap = new Map();
    for (const u of [...activeUsers, ...apiActiveUsers]) {
      const existing = userMap.get(u.id);
      if (!existing || new Date(u.lastActivity) > new Date(existing.lastActivity)) {
        userMap.set(u.id, u);
      }
    }
    const mergedActiveUsers = [...userMap.values()].sort(
      (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    );

    res.json({
      activeUsers: mergedActiveUsers,
      recentChats,
      recentApiCalls,
    });
  } catch (error) {
    console.error('Live view error:', error);
    res.status(500).json({ error: 'Failed to fetch live view data' });
  }
});

// Search messages (for keyword monitoring)
router.get('/search', async (req, res) => {
  try {
    const { q, userId } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Search query required' });
    }

    const where = {
      content: {
        contains: q,
        mode: 'insensitive',
      },
      conversation: {
        deletedAt: null, // Don't search deleted conversations
      },
    };

    if (userId) {
      where.conversation.userId = userId;
    }

    const messages = await prisma.message.findMany({
      where,
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: {
        conversation: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
              },
            },
          },
        },
      },
    });

    res.json(messages);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get pending deletions (soft-deleted conversations)
router.get('/pending-deletions', async (req, res) => {
  try {
    const deletedConversations = await prisma.conversation.findMany({
      where: {
        deletedAt: { not: null },
        permanentDelete: false,
      },
      orderBy: { deletedAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            role: true,
          },
        },
        _count: {
          select: { messages: true },
        },
      },
    });

    res.json(deletedConversations);
  } catch (error) {
    console.error('Get pending deletions error:', error);
    res.status(500).json({ error: 'Failed to fetch pending deletions' });
  }
});

// Restore a deleted conversation
router.post('/conversations/:id/restore', async (req, res) => {
  try {
    const { id } = req.params;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (!conversation.deletedAt) {
      return res.status(400).json({ error: 'Conversation is not deleted' });
    }

    // Restore the conversation
    await prisma.conversation.update({
      where: { id },
      data: {
        deletedAt: null,
        deletedBy: null,
      },
    });

    res.json({ success: true, message: 'Conversation restored' });
  } catch (error) {
    console.error('Restore conversation error:', error);
    res.status(500).json({ error: 'Failed to restore conversation' });
  }
});

// Permanently delete a conversation
router.delete('/conversations/:id/permanent', async (req, res) => {
  try {
    const { id } = req.params;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Permanently delete (cascade will delete messages)
    await prisma.conversation.delete({
      where: { id },
    });

    res.json({ success: true, message: 'Conversation permanently deleted' });
  } catch (error) {
    console.error('Permanent delete error:', error);
    res.status(500).json({ error: 'Failed to permanently delete conversation' });
  }
});

// Get all roles
router.get('/roles', async (req, res) => {
  try {
    const roles = await prisma.customRole.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { users: true },
        },
      },
    });

    res.json(roles);
  } catch (error) {
    console.error('Get roles error:', error);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// Get all groups
router.get('/groups', async (req, res) => {
  try {
    const groups = await prisma.group.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { members: true },
        },
      },
    });

    res.json(groups);
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// Get all invite codes
router.get('/invites', async (req, res) => {
  try {
    const invites = await prisma.inviteCode.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        assignedRole: {
          select: { id: true, name: true, color: true },
        },
        assignedGroup: {
          select: { id: true, name: true, color: true },
        },
        usedBy: {
          select: { id: true, firstName: true, email: true },
        },
        createdBy: {
          select: { id: true, firstName: true },
        },
      },
    });

    res.json(invites);
  } catch (error) {
    console.error('Get invites error:', error);
    res.status(500).json({ error: 'Failed to fetch invite codes' });
  }
});

// Generate new invite code with role and optional group
router.post('/invites', async (req, res) => {
  try {
    const { expiresInDays, roleId, groupId, makeGroupAdmin } = req.body;
    const userId = req.user.userId;

    // Validate role ID is provided
    if (!roleId) {
      return res.status(400).json({ error: 'Role selection is required' });
    }

    // Verify role exists
    const role = await prisma.customRole.findUnique({
      where: { id: roleId },
    });

    if (!role) {
      return res.status(400).json({ error: 'Invalid role selected' });
    }

    // Verify group exists if specified
    if (groupId) {
      const group = await prisma.group.findUnique({
        where: { id: groupId },
      });

      if (!group) {
        return res.status(400).json({ error: 'Invalid group selected' });
      }
    }

    // Generate random 8-character code
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();

    // Calculate expiration if specified
    let expiresAt = null;
    if (expiresInDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + parseInt(expiresInDays));
    }

    const invite = await prisma.inviteCode.create({
      data: {
        code,
        createdById: userId,
        expiresAt,
        roleId,
        groupId: groupId || null,
        makeGroupAdmin: makeGroupAdmin || false,
      },
      include: {
        assignedRole: {
          select: { id: true, name: true, color: true },
        },
        assignedGroup: {
          select: { id: true, name: true, color: true },
        },
      },
    });

    res.status(201).json(invite);
  } catch (error) {
    console.error('Create invite error:', error);
    res.status(500).json({ error: 'Failed to create invite code' });
  }
});

// Deactivate an invite code
router.delete('/invites/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.inviteCode.update({
      where: { id },
      data: { isActive: false },
    });

    res.json({ success: true, message: 'Invite code deactivated' });
  } catch (error) {
    console.error('Deactivate invite error:', error);
    res.status(500).json({ error: 'Failed to deactivate invite code' });
  }
});

// Update invite code (change role/group)
router.patch('/invites/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { roleId, groupId, makeGroupAdmin } = req.body;

    // Check if invite exists and is still active/unused
    const existingInvite = await prisma.inviteCode.findUnique({
      where: { id },
    });

    if (!existingInvite) {
      return res.status(404).json({ error: 'Invite code not found' });
    }

    if (existingInvite.usedAt) {
      return res.status(400).json({ error: 'Cannot modify a used invite code' });
    }

    if (!existingInvite.isActive) {
      return res.status(400).json({ error: 'Cannot modify a deactivated invite code' });
    }

    // Build update data
    const updateData = {};
    if (roleId !== undefined) {
      updateData.roleId = roleId || null;
    }
    if (groupId !== undefined) {
      updateData.groupId = groupId || null;
    }
    if (makeGroupAdmin !== undefined) {
      updateData.makeGroupAdmin = makeGroupAdmin;
    }

    const invite = await prisma.inviteCode.update({
      where: { id },
      data: updateData,
      include: {
        assignedRole: true,
        assignedGroup: true,
      },
    });

    res.json(invite);
  } catch (error) {
    console.error('Update invite error:', error);
    res.status(500).json({ error: 'Failed to update invite code' });
  }
});

// Mark invite code as emailed
router.post('/invites/:id/email', async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email address required' });
    }

    const invite = await prisma.inviteCode.update({
      where: { id },
      data: {
        emailedTo: email,
        emailedAt: new Date(),
      },
    });

    res.json({ success: true, invite });
  } catch (error) {
    console.error('Mark as emailed error:', error);
    res.status(500).json({ error: 'Failed to mark invite as emailed' });
  }
});

// Get knowledge base stats
router.get('/knowledge/stats', async (req, res) => {
  try {
    const [bookCount, noteCount, users] = await Promise.all([
      prisma.book.count(),
      prisma.starredNote.count(),
      prisma.user.findMany({
        select: {
          id: true,
          firstName: true,
          _count: {
            select: {
              books: true,
              starredNotes: true,
            },
          },
        },
      }),
    ]);

    res.json({
      totalBooks: bookCount,
      totalNotes: noteCount,
      userStats: users,
    });
  } catch (error) {
    console.error('Get knowledge stats error:', error);
    res.status(500).json({ error: 'Failed to fetch knowledge stats' });
  }
});

// Get all books from all users
router.get('/knowledge/books', async (req, res) => {
  try {
    const { userId } = req.query;

    const where = userId ? { userId } : {};

    const books = await prisma.book.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
          },
        },
        _count: {
          select: { notes: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.json(books);
  } catch (error) {
    console.error('Get all books error:', error);
    res.status(500).json({ error: 'Failed to fetch books' });
  }
});

// Get all notes from all users
router.get('/knowledge/notes', async (req, res) => {
  try {
    const { userId, bookId } = req.query;

    const where = {};
    if (userId) where.userId = userId;
    if (bookId) where.bookId = bookId;

    const notes = await prisma.starredNote.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
          },
        },
        message: {
          include: {
            conversation: {
              select: {
                title: true,
              },
            },
          },
        },
        book: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(notes);
  } catch (error) {
    console.error('Get all notes error:', error);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// Delete user (parent/admin only)
router.post('/delete-user', requireCapability('canManageUsers'), async (req, res) => {
  try {
    const { userId: parentId } = req.user;
    const { targetUserId, deleteType, password } = req.body;

    if (!targetUserId || !deleteType || !password) {
      return res.status(400).json({ error: 'Target user ID, delete type, and password required' });
    }

    // Get parent user to verify password
    const parent = await prisma.user.findUnique({
      where: { id: parentId }
    });

    if (!parent) {
      return res.status(404).json({ error: 'Parent user not found' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, parent.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    // Prevent deleting yourself through this endpoint
    if (targetUserId === parentId) {
      return res.status(400).json({ error: 'Use the profile page to delete your own account' });
    }

    // Get target user with conversations
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      include: {
        conversations: {
          include: {
            messages: true
          }
        }
      }
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'Target user not found' });
    }

    let archiveData = null;

    if (deleteType === 'archive') {
      // Create archive of all conversations
      archiveData = {
        user: {
          email: targetUser.email,
          firstName: targetUser.firstName,
          deletedAt: new Date().toISOString(),
          deletedBy: parent.email
        },
        conversations: targetUser.conversations.map(conv => ({
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

    // Delete user (cascade will delete all related data)
    await prisma.user.delete({
      where: { id: targetUserId }
    });

    console.log(`User deleted by admin: target=${targetUserId} type=${deleteType} actor=${parent.id}`);

    res.json({
      success: true,
      message: 'User deleted successfully',
      archive: archiveData
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ============================================
// GROUP MANAGEMENT ROUTES
// ============================================

// Create a new group
router.post('/groups', async (req, res) => {
  try {
    const { name, description, color } = req.body;
    const userId = req.user.userId;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const group = await prisma.group.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        color: color || '#3b82f6', // Default blue
        createdBy: userId,
      },
    });

    // Automatically add creator as group admin
    await prisma.groupMember.create({
      data: {
        userId,
        groupId: group.id,
        isGroupAdmin: true,
        canViewAll: true,
      },
    });

    // Fetch complete group with member count
    const groupWithCount = await prisma.group.findUnique({
      where: { id: group.id },
      include: {
        _count: { select: { members: true } },
      },
    });

    res.status(201).json(groupWithCount);
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// Update a group
router.patch('/groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, color } = req.body;

    const group = await prisma.group.update({
      where: { id },
      data: {
        name: name?.trim(),
        description: description?.trim(),
        color,
      },
      include: {
        _count: { select: { members: true } },
      },
    });

    res.json(group);
  } catch (error) {
    console.error('Update group error:', error);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

// Delete a group
router.delete('/groups/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.group.delete({
      where: { id },
    });

    res.json({ success: true, message: 'Group deleted' });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// Get group details with members
router.get('/groups/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const group = await prisma.group.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                email: true,
                avatar: true,
                customRole: {
                  select: { name: true, color: true },
                },
              },
            },
          },
        },
        _count: {
          select: {
            members: true,
            sharedConversations: true,
          },
        },
      },
    });

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json(group);
  } catch (error) {
    console.error('Get group error:', error);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
});

// Add user to group
router.post('/groups/:id/members', async (req, res) => {
  try {
    const { id: groupId } = req.params;
    const { userId, isGroupAdmin, canViewAll } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Check if user already in group
    const existing = await prisma.groupMember.findUnique({
      where: {
        userId_groupId: { userId, groupId },
      },
    });

    if (existing) {
      return res.status(400).json({ error: 'User is already in this group' });
    }

    const member = await prisma.groupMember.create({
      data: {
        userId,
        groupId,
        isGroupAdmin: isGroupAdmin || false,
        canViewAll: canViewAll || isGroupAdmin || false,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    res.status(201).json(member);
  } catch (error) {
    console.error('Add group member error:', error);
    res.status(500).json({ error: 'Failed to add user to group' });
  }
});

// Update group member permissions
router.patch('/groups/:groupId/members/:userId', async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const { isGroupAdmin, canViewAll } = req.body;

    const member = await prisma.groupMember.update({
      where: {
        userId_groupId: { userId, groupId },
      },
      data: {
        isGroupAdmin,
        canViewAll: canViewAll ?? isGroupAdmin, // Group admins should always be able to view all
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            email: true,
          },
        },
      },
    });

    res.json(member);
  } catch (error) {
    console.error('Update group member error:', error);
    res.status(500).json({ error: 'Failed to update member' });
  }
});

// Remove user from group
router.delete('/groups/:groupId/members/:userId', async (req, res) => {
  try {
    const { groupId, userId } = req.params;

    await prisma.groupMember.delete({
      where: {
        userId_groupId: { userId, groupId },
      },
    });

    res.json({ success: true, message: 'User removed from group' });
  } catch (error) {
    console.error('Remove group member error:', error);
    res.status(500).json({ error: 'Failed to remove user from group' });
  }
});

// ============================================
// ROLE MANAGEMENT ROUTES
// ============================================

// Create a new role
router.post('/roles', async (req, res) => {
  try {
    const {
      name,
      description,
      color,
      canManageUsers,
      canManageGroups,
      canManageRoles,
      canViewAllConvos,
      canManageSystem,
      canCreateInvites,
      canDeleteConvos,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Role name is required' });
    }

    // Check for duplicate name
    const existing = await prisma.customRole.findUnique({
      where: { name: name.trim() },
    });

    if (existing) {
      return res.status(400).json({ error: 'A role with this name already exists' });
    }

    const role = await prisma.customRole.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        color: color || '#6b7280',
        canManageUsers: canManageUsers || false,
        canManageGroups: canManageGroups || false,
        canManageRoles: canManageRoles || false,
        canViewAllConvos: canViewAllConvos || false,
        canManageSystem: canManageSystem || false,
        canCreateInvites: canCreateInvites || false,
        canDeleteConvos: canDeleteConvos || false,
        isSystem: false,
      },
      include: {
        _count: { select: { users: true } },
      },
    });

    res.status(201).json(role);
  } catch (error) {
    console.error('Create role error:', error);
    res.status(500).json({ error: 'Failed to create role' });
  }
});

// Update a role
router.patch('/roles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Check if role is system role
    const existing = await prisma.customRole.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Role not found' });
    }

    // Don't allow changing name of system roles
    if (existing.isSystem && updates.name && updates.name !== existing.name) {
      return res.status(400).json({ error: 'Cannot rename system roles' });
    }

    const role = await prisma.customRole.update({
      where: { id },
      data: {
        name: updates.name?.trim(),
        description: updates.description?.trim(),
        color: updates.color,
        canManageUsers: updates.canManageUsers,
        canManageGroups: updates.canManageGroups,
        canManageRoles: updates.canManageRoles,
        canViewAllConvos: updates.canViewAllConvos,
        canManageSystem: updates.canManageSystem,
        canCreateInvites: updates.canCreateInvites,
        canDeleteConvos: updates.canDeleteConvos,
      },
      include: {
        _count: { select: { users: true } },
      },
    });

    res.json(role);
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// Delete a role
router.delete('/roles/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if role is system role
    const existing = await prisma.customRole.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Role not found' });
    }

    if (existing.isSystem) {
      return res.status(400).json({ error: 'Cannot delete system roles' });
    }

    if (existing._count.users > 0) {
      return res.status(400).json({
        error: `Cannot delete role with ${existing._count.users} assigned users. Reassign them first.`,
      });
    }

    await prisma.customRole.delete({
      where: { id },
    });

    res.json({ success: true, message: 'Role deleted' });
  } catch (error) {
    console.error('Delete role error:', error);
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

// Update user's role
router.patch('/users/:id/role', requireCapability('canManageUsers'), async (req, res) => {
  try {
    const { id } = req.params;
    const { roleId } = req.body;

    if (!roleId) {
      return res.status(400).json({ error: 'Role ID is required' });
    }

    const user = await prisma.user.update({
      where: { id },
      data: { roleId },
      include: {
        customRole: {
          select: { id: true, name: true, color: true },
        },
      },
    });

    const { passwordHash: _passwordHash, ...safeUser } = user;
    res.json(safeUser);
  } catch (error) {
    console.error('Update user role error:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

// Get user API limits and usage
router.get('/users/:id/api-limits', async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        apiLimitDaily: true,
        apiLimitMonthly: true,
        apiCallsToday: true,
        apiCallsMonth: true,
        apiLimitResetDay: true,
        apiLimitResetMonth: true,
        devices: {
          select: {
            id: true,
            name: true,
            requestCount: true,
            lastUsedAt: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Calculate totals from devices
    const totalDeviceRequests = user.devices.reduce((sum, d) => sum + d.requestCount, 0);

    res.json({
      ...user,
      totalDeviceRequests,
    });
  } catch (error) {
    console.error('Get user API limits error:', error);
    res.status(500).json({ error: 'Failed to get user API limits' });
  }
});

// Update user API limits
router.patch('/users/:id/api-limits', async (req, res) => {
  try {
    const { id } = req.params;
    const { apiLimitDaily, apiLimitMonthly } = req.body;

    // Validate limits (null means unlimited, 0 means blocked)
    const updateData = {};

    if (apiLimitDaily !== undefined) {
      updateData.apiLimitDaily = apiLimitDaily === '' || apiLimitDaily === null ? null : parseInt(apiLimitDaily);
    }

    if (apiLimitMonthly !== undefined) {
      updateData.apiLimitMonthly = apiLimitMonthly === '' || apiLimitMonthly === null ? null : parseInt(apiLimitMonthly);
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        firstName: true,
        apiLimitDaily: true,
        apiLimitMonthly: true,
        apiCallsToday: true,
        apiCallsMonth: true,
      },
    });

    res.json(user);
  } catch (error) {
    console.error('Update user API limits error:', error);
    res.status(500).json({ error: 'Failed to update user API limits' });
  }
});

// Reset user API usage counters
router.post('/users/:id/api-limits/reset', async (req, res) => {
  try {
    const { id } = req.params;
    const { resetDaily, resetMonthly } = req.body;

    const updateData = {};

    if (resetDaily) {
      updateData.apiCallsToday = 0;
      updateData.apiLimitResetDay = new Date();
    }

    if (resetMonthly) {
      updateData.apiCallsMonth = 0;
      updateData.apiLimitResetMonth = new Date();
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        firstName: true,
        apiCallsToday: true,
        apiCallsMonth: true,
        apiLimitResetDay: true,
        apiLimitResetMonth: true,
      },
    });

    res.json(user);
  } catch (error) {
    console.error('Reset user API limits error:', error);
    res.status(500).json({ error: 'Failed to reset user API limits' });
  }
});

export default router;
