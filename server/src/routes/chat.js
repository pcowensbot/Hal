import express from 'express';
import prisma from '../config/database.js';
import ollamaService from '../services/ollama.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Build an LLM message from a DB message (+ any attachments) using the OpenAI
// vision content-parts format when images are present. Ollama's /v1 endpoint
// accepts this shape and forwards images to multimodal models (Qwen 3.5, Gemma).
function buildLLMMessage({ role, content, attachments }) {
  const imageUrls = Array.isArray(attachments)
    ? attachments.filter(a => a?.type === 'image' && a?.originalUrl).map(a => a.originalUrl)
    : [];
  if (imageUrls.length === 0) return { role, content };
  const parts = [];
  if (content) parts.push({ type: 'text', text: content });
  for (const url of imageUrls) parts.push({ type: 'image_url', image_url: { url } });
  return { role, content: parts };
}

// Validate images array: expects data URIs (data:image/*;base64,...) up to MAX_IMAGES.
// Returns {images, error}. error is a user-facing string when rejected.
const MAX_IMAGES = 4;
function normalizeImages(input) {
  if (input == null) return { images: [] };
  if (!Array.isArray(input)) return { error: 'images must be an array' };
  if (input.length > MAX_IMAGES) return { error: `Max ${MAX_IMAGES} images per message` };
  const out = [];
  for (const entry of input) {
    if (typeof entry !== 'string') return { error: 'images entries must be strings' };
    if (!entry.startsWith('data:image/')) return { error: 'images must be data: URIs' };
    out.push(entry);
  }
  return { images: out };
}

// Get all conversations for current user + shared with their groups (excluding soft-deleted)
router.get('/conversations', async (req, res) => {
  try {
    // Get user's group memberships
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        groupMemberships: {
          select: { groupId: true },
        },
      },
    });

    const userGroupIds = user?.groupMemberships.map(gm => gm.groupId) || [];

    // Get own conversations + conversations shared with user's groups
    const conversations = await prisma.conversation.findMany({
      where: {
        deletedAt: null,
        OR: [
          { userId: req.user.id }, // Own conversations
          {
            shares: {
              some: {
                groupId: { in: userGroupIds },
              },
            },
          }, // Shared with user's groups
        ],
      },
      orderBy: [
        { starred: 'desc' },
        { updatedAt: 'desc' },
      ],
      include: {
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
        user: {
          select: {
            id: true,
            firstName: true,
          },
        },
        shares: {
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
      },
    });

    // Mark which are shared vs owned
    const result = conversations.map(conv => ({
      ...conv,
      isOwned: conv.userId === req.user.id,
      isShared: conv.userId !== req.user.id,
    }));

    res.json(result);
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Helper to check if user has access to conversation
async function hasConversationAccess(userId, conversationId) {
  // Get user with their group memberships and permissions
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      customRole: true,
      groupMemberships: {
        select: { groupId: true, canViewAll: true, isGroupAdmin: true },
      },
    },
  });

  // Get the conversation with sharing info
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      shares: {
        select: { groupId: true },
      },
    },
  });

  if (!conversation) return { hasAccess: false, isOwner: false };

  // Owner always has access (check before admin override so admins see their own convos as owned)
  if (conversation.userId === userId) return { hasAccess: true, isOwner: true };

  // System admins can see everything
  if (user?.isSystemAdmin) return { hasAccess: true, isOwner: false };

  // Users with canViewAllConvos permission can see everything
  if (user?.customRole?.canViewAllConvos) return { hasAccess: true, isOwner: false };

  // Check if conversation is shared with any of user's groups
  const userGroupIds = user?.groupMemberships.map(gm => gm.groupId) || [];
  const sharedGroupIds = conversation.shares.map(s => s.groupId);
  const hasGroupAccess = sharedGroupIds.some(gid => userGroupIds.includes(gid));

  // Check if user is group admin with view all permissions for any shared group
  const groupAdminAccess = user?.groupMemberships.some(gm =>
    sharedGroupIds.includes(gm.groupId) && (gm.canViewAll || gm.isGroupAdmin)
  );

  return { hasAccess: hasGroupAccess || groupAdminAccess, isOwner: false };
}

// Get single conversation with all messages
router.get('/conversations/:id', async (req, res) => {
  try {
    const { hasAccess, isOwner } = await hasConversationAccess(req.user.id, req.params.id);

    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

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
            avatar: true,
          },
        },
        shares: {
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
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json({
      ...conversation,
      isOwned: isOwner,
      isShared: !isOwner,
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// Create new conversation
router.post('/conversations', async (req, res) => {
  try {
    const { title } = req.body;

    const conversation = await prisma.conversation.create({
      data: {
        userId: req.user.id,
        title: title || 'New Chat',
      },
    });

    res.status(201).json(conversation);
  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// Update conversation (title, folderId)
router.patch('/conversations/:id', async (req, res) => {
  try {
    const { title, folderId } = req.body;
    const { id } = req.params;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (conversation.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const data = {};
    if (title !== undefined) data.title = title;
    if (folderId !== undefined) data.folderId = folderId; // null = remove from folder

    const updated = await prisma.conversation.update({
      where: { id },
      data,
    });

    res.json(updated);
  } catch (error) {
    console.error('Update conversation error:', error);
    res.status(500).json({ error: 'Failed to update conversation' });
  }
});

// Toggle starred status
router.patch('/conversations/:id/star', async (req, res) => {
  try {
    const { starred } = req.body;
    const { id } = req.params;

    // Check ownership
    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (conversation.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: { starred: starred === true },
    });

    res.json({ success: true, starred: updated.starred });
  } catch (error) {
    console.error('Toggle star error:', error);
    res.status(500).json({ error: 'Failed to toggle star' });
  }
});

// Delete conversation (soft delete)
router.delete('/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check ownership
    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (conversation.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Soft delete: mark as deleted
    await prisma.conversation.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedBy: req.user.id,
      },
    });

    res.json({ success: true, message: 'Conversation marked for deletion' });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// Send message and get AI response
router.post('/conversations/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const { images, error: imgErr } = normalizeImages(req.body.images);
    if (imgErr) return res.status(400).json({ error: imgErr });

    const hasContent = typeof content === 'string' && content.trim().length > 0;
    if (!hasContent && images.length === 0) {
      return res.status(400).json({ error: 'Message content or image required' });
    }

    // Check conversation exists and user has access
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            role: true,
            content: true,
            attachments: true,
          },
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (conversation.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if system is in maintenance mode
    const settings = await prisma.settings.findFirst();
    if (settings && settings.maintenanceEnabled) {
      const now = new Date();
      const currentHour = now.getHours();
      const startHour = settings.maintenanceStartHour;
      const endHour = settings.maintenanceEndHour;

      // Check if current time is in maintenance window
      let inMaintenanceWindow = false;
      if (startHour < endHour) {
        // Same day window (e.g., 2 AM to 6 AM)
        inMaintenanceWindow = currentHour >= startHour && currentHour < endHour;
      } else {
        // Overnight window (e.g., 10 PM to 4 AM)
        inMaintenanceWindow = currentHour >= startHour || currentHour < endHour;
      }

      // If both GPUs are in maintenance, block all chat
      if (inMaintenanceWindow && settings.maintenanceGPUs === 'both') {
        const eta = new Date(now);
        if (currentHour >= endHour) {
          eta.setDate(eta.getDate() + 1);
        }
        eta.setHours(endHour, 0, 0, 0);

        return res.status(503).json({
          error: 'System in maintenance',
          inMaintenance: true,
          message: settings.maintenanceMessage || 'System is down for AI training maintenance.',
          nextAvailable: eta.toISOString(),
        });
      }
    }

    const userContent = hasContent ? content.trim() : '';
    const userAttachments = images.map((url, i) => ({
      type: 'image',
      originalUrl: url,
      filename: `upload-${i + 1}`,
      size: url.length,
    }));

    // Save user message
    const userMessage = await prisma.message.create({
      data: {
        conversationId: id,
        role: 'user',
        content: userContent,
        modelUsed: 'user',
        attachments: userAttachments.length > 0 ? userAttachments : undefined,
      },
    });

    // Prepare message history for AI (preserves image context across turns)
    const messageHistory = [
      ...conversation.messages.map(buildLLMMessage),
      buildLLMMessage({ role: 'user', content: userContent, attachments: userAttachments }),
    ];

    // Get AI response (with tool calling support)
    const aiResponse = await ollamaService.generateResponse(messageHistory);

    // If web search was used, prepend a subtle indicator
    let responseContent = aiResponse.content;
    if (aiResponse.toolsUsed && aiResponse.toolsUsed.length > 0) {
      const searches = aiResponse.toolsUsed
        .filter(t => t.tool === 'web_search')
        .map(t => t.args.query);
      if (searches.length > 0) {
        const searchNote = searches.map(q => `*Searched: "${q}"*`).join('\n');
        responseContent = `${searchNote}\n\n---\n\n${responseContent}`;
      }
    }

    // Save assistant message
    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: id,
        role: 'assistant',
        content: responseContent,
        modelUsed: aiResponse.model,
      },
    });

    // Update conversation timestamp
    await prisma.conversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    // Auto-generate title if this is the first message
    if (conversation.messages.length === 0 && conversation.title === 'New Chat') {
      const src = userContent || `Image chat (${userAttachments.length})`;
      const autoTitle = src.substring(0, 50) + (src.length > 50 ? '...' : '');
      await prisma.conversation.update({
        where: { id },
        data: { title: autoTitle },
      });
    }

    res.json({
      userMessage,
      assistantMessage,
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Send message and stream the AI response via SSE.
// Event types: start (user + assistant placeholder), chunk (delta), done (final assistant message), error.
router.post('/conversations/:id/messages/stream', async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  const { images, error: imgErr } = normalizeImages(req.body.images);
  if (imgErr) return res.status(400).json({ error: imgErr });

  const hasContent = typeof content === 'string' && content.trim().length > 0;
  if (!hasContent && images.length === 0) {
    return res.status(400).json({ error: 'Message content or image required' });
  }

  let conversation;
  try {
    conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { role: true, content: true, attachments: true },
        },
      },
    });

    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    if (conversation.userId !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    const settings = await prisma.settings.findFirst();
    if (settings?.maintenanceEnabled) {
      const now = new Date();
      const currentHour = now.getHours();
      const { maintenanceStartHour: startHour, maintenanceEndHour: endHour } = settings;
      const inWindow = startHour < endHour
        ? currentHour >= startHour && currentHour < endHour
        : currentHour >= startHour || currentHour < endHour;

      if (inWindow && settings.maintenanceGPUs === 'both') {
        const eta = new Date(now);
        if (currentHour >= endHour) eta.setDate(eta.getDate() + 1);
        eta.setHours(endHour, 0, 0, 0);
        return res.status(503).json({
          error: 'System in maintenance',
          inMaintenance: true,
          message: settings.maintenanceMessage || 'System is down for AI training maintenance.',
          nextAvailable: eta.toISOString(),
        });
      }
    }
  } catch (error) {
    console.error('Stream pre-check error:', error);
    return res.status(500).json({ error: 'Failed to prepare stream' });
  }

  const userContent = hasContent ? content.trim() : '';
  const userAttachments = images.map((url, i) => ({
    type: 'image',
    originalUrl: url,
    filename: `upload-${i + 1}`,
    size: url.length,
  }));

  // Save user message and a placeholder assistant message up front so the
  // client can display a live-updating bubble with stable IDs.
  let userMessage, assistantMessage;
  try {
    userMessage = await prisma.message.create({
      data: {
        conversationId: id,
        role: 'user',
        content: userContent,
        modelUsed: 'user',
        attachments: userAttachments.length > 0 ? userAttachments : undefined,
      },
    });
    assistantMessage = await prisma.message.create({
      data: { conversationId: id, role: 'assistant', content: '', modelUsed: 'pending' },
    });
  } catch (error) {
    console.error('Stream message-create error:', error);
    return res.status(500).json({ error: 'Failed to start stream' });
  }

  // Open SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Disable Nagle — ensures each SSE write hits the wire immediately.
  // Without this, the 'start' event can sit buffered until tool rounds finish.
  res.socket?.setNoDelay(true);

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Prime the stream with an SSE comment so any intermediate proxy flushes headers+bytes
  res.write(': ready\n\n');
  send('start', { userMessage, assistantMessage });

  const messageHistory = [
    ...conversation.messages.map(buildLLMMessage),
    buildLLMMessage({ role: 'user', content: userContent, attachments: userAttachments }),
  ];

  let clientClosed = false;
  req.on('close', () => { clientClosed = true; });

  try {
    const aiResponse = await ollamaService.generateResponseStream(
      messageHistory,
      null,
      {},
      (delta) => {
        if (clientClosed) return;
        send('chunk', { delta });
      },
    );

    let responseContent = aiResponse.content;
    if (aiResponse.toolsUsed?.length > 0) {
      const searches = aiResponse.toolsUsed
        .filter(t => t.tool === 'web_search')
        .map(t => t.args.query);
      if (searches.length > 0) {
        const searchNote = searches.map(q => `*Searched: "${q}"*`).join('\n');
        responseContent = `${searchNote}\n\n---\n\n${responseContent}`;
      }
    }

    const finalAssistant = await prisma.message.update({
      where: { id: assistantMessage.id },
      data: { content: responseContent, modelUsed: aiResponse.model || 'unknown' },
    });

    await prisma.conversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    if (conversation.messages.length === 0 && conversation.title === 'New Chat') {
      const src = userContent || `Image chat (${userAttachments.length})`;
      const autoTitle = src.substring(0, 50) + (src.length > 50 ? '...' : '');
      await prisma.conversation.update({ where: { id }, data: { title: autoTitle } });
    }

    send('done', { assistantMessage: finalAssistant });
    res.end();
  } catch (error) {
    console.error('Stream generation error:', error);
    // Remove the empty placeholder so the UI doesn't keep a stale bubble
    await prisma.message.delete({ where: { id: assistantMessage.id } }).catch(() => {});
    if (!res.writableEnded) {
      send('error', { error: error.message || 'Failed to generate response' });
      res.end();
    }
  }
});

// ============================================
// CHAT FOLDER ROUTES
// ============================================

// Get all folders for current user (with children)
router.get('/folders', async (req, res) => {
  try {
    const folders = await prisma.chatFolder.findMany({
      where: { userId: req.user.id, parentId: null },
      include: {
        children: {
          orderBy: { position: 'asc' },
          include: {
            _count: { select: { conversations: { where: { deletedAt: null } } } },
          },
        },
        _count: { select: { conversations: { where: { deletedAt: null } } } },
      },
      orderBy: { position: 'asc' },
    });

    res.json(folders);
  } catch (error) {
    console.error('Get folders error:', error);
    res.status(500).json({ error: 'Failed to fetch folders' });
  }
});

// Create folder
router.post('/folders', async (req, res) => {
  try {
    const { name, parentId } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    // If parentId set, verify it exists, belongs to user, and isn't already a subfolder
    if (parentId) {
      const parent = await prisma.chatFolder.findUnique({ where: { id: parentId } });
      if (!parent || parent.userId !== req.user.id) {
        return res.status(400).json({ error: 'Parent folder not found' });
      }
      if (parent.parentId) {
        return res.status(400).json({ error: 'Maximum folder depth is 2 levels' });
      }
    }

    // Get next position
    const maxPos = await prisma.chatFolder.aggregate({
      where: { userId: req.user.id, parentId: parentId || null },
      _max: { position: true },
    });

    const folder = await prisma.chatFolder.create({
      data: {
        name: name.trim(),
        userId: req.user.id,
        parentId: parentId || null,
        position: (maxPos._max.position ?? -1) + 1,
      },
      include: {
        children: true,
        _count: { select: { conversations: { where: { deletedAt: null } } } },
      },
    });

    res.status(201).json(folder);
  } catch (error) {
    console.error('Create folder error:', error);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// Update folder (name, collapsed state)
router.patch('/folders/:id', async (req, res) => {
  try {
    const { name, isCollapsed } = req.body;
    const { id } = req.params;

    const folder = await prisma.chatFolder.findUnique({ where: { id } });
    if (!folder || folder.userId !== req.user.id) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const data = {};
    if (name !== undefined) data.name = name.trim();
    if (isCollapsed !== undefined) data.isCollapsed = isCollapsed;

    const updated = await prisma.chatFolder.update({
      where: { id },
      data,
    });

    res.json(updated);
  } catch (error) {
    console.error('Update folder error:', error);
    res.status(500).json({ error: 'Failed to update folder' });
  }
});

// Reorder folders
router.post('/folders/reorder', async (req, res) => {
  try {
    const { folderIds, parentId } = req.body;

    if (!Array.isArray(folderIds)) {
      return res.status(400).json({ error: 'folderIds array is required' });
    }

    // Update positions in a transaction
    await prisma.$transaction(
      folderIds.map((id, index) =>
        prisma.chatFolder.updateMany({
          where: { id, userId: req.user.id, parentId: parentId || null },
          data: { position: index },
        })
      )
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Reorder folders error:', error);
    res.status(500).json({ error: 'Failed to reorder folders' });
  }
});

// Delete folder (conversations get unfiled, not deleted)
router.delete('/folders/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const folder = await prisma.chatFolder.findUnique({
      where: { id },
      include: { children: true },
    });

    if (!folder || folder.userId !== req.user.id) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    // Unfile all conversations in this folder and its children
    const childIds = folder.children.map(c => c.id);
    await prisma.conversation.updateMany({
      where: { folderId: { in: [id, ...childIds] } },
      data: { folderId: null },
    });

    // Delete folder (cascades to children)
    await prisma.chatFolder.delete({ where: { id } });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete folder error:', error);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// ============================================
// CONVERSATION SHARING ROUTES
// ============================================

// Get user's groups (for sharing UI)
router.get('/my-groups', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        groupMemberships: {
          include: {
            group: {
              select: {
                id: true,
                name: true,
                color: true,
                description: true,
              },
            },
          },
        },
      },
    });

    const groups = user?.groupMemberships.map(gm => ({
      ...gm.group,
      isGroupAdmin: gm.isGroupAdmin,
    })) || [];

    res.json(groups);
  } catch (error) {
    console.error('Get my groups error:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// Share conversation with a group
router.post('/conversations/:id/share', async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    const { groupId } = req.body;
    const userId = req.user.id;

    if (!groupId) {
      return res.status(400).json({ error: 'Group ID is required' });
    }

    // Check ownership - only owner can share
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (conversation.userId !== userId) {
      return res.status(403).json({ error: 'Only the owner can share a conversation' });
    }

    // Check user is member of the group
    const membership = await prisma.groupMember.findUnique({
      where: {
        userId_groupId: { userId, groupId },
      },
    });

    if (!membership) {
      return res.status(403).json({ error: 'You can only share with groups you belong to' });
    }

    // Check if already shared
    const existing = await prisma.conversationShare.findUnique({
      where: {
        conversationId_groupId: { conversationId, groupId },
      },
    });

    if (existing) {
      return res.status(400).json({ error: 'Already shared with this group' });
    }

    // Create the share
    const share = await prisma.conversationShare.create({
      data: {
        conversationId,
        groupId,
        sharedBy: userId,
      },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
      },
    });

    res.status(201).json(share);
  } catch (error) {
    console.error('Share conversation error:', error);
    res.status(500).json({ error: 'Failed to share conversation' });
  }
});

// Unshare conversation from a group
router.delete('/conversations/:id/share/:groupId', async (req, res) => {
  try {
    const { id: conversationId, groupId } = req.params;
    const userId = req.user.id;

    // Check ownership
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (conversation.userId !== userId) {
      return res.status(403).json({ error: 'Only the owner can unshare a conversation' });
    }

    await prisma.conversationShare.delete({
      where: {
        conversationId_groupId: { conversationId, groupId },
      },
    });

    res.json({ success: true, message: 'Conversation unshared' });
  } catch (error) {
    console.error('Unshare conversation error:', error);
    res.status(500).json({ error: 'Failed to unshare conversation' });
  }
});

// Get shared conversations for a specific group (for group admins)
router.get('/groups/:groupId/conversations', async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    // Check user has access to this group
    const membership = await prisma.groupMember.findUnique({
      where: {
        userId_groupId: { userId, groupId },
      },
    });

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    const conversations = await prisma.conversation.findMany({
      where: {
        deletedAt: null,
        shares: {
          some: { groupId },
        },
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            avatar: true,
          },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
        shares: {
          where: { groupId },
          include: {
            sharedByUser: {
              select: {
                firstName: true,
              },
            },
          },
        },
      },
    });

    res.json(conversations);
  } catch (error) {
    console.error('Get group conversations error:', error);
    res.status(500).json({ error: 'Failed to fetch group conversations' });
  }
});

export default router;
