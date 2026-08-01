import express from 'express';
import prisma from '../config/database.js';
import { chatImporter } from '../services/chatImporter.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * Import a chat from external platforms (Claude.ai, ChatGPT)
 * POST /api/import/chat
 * Body: { shareUrl: string }
 */
router.post('/chat', async (req, res) => {
  try {
    const { shareUrl } = req.body;

    // Validate URL
    if (!shareUrl || !shareUrl.trim()) {
      return res.status(400).json({ error: 'Share URL is required' });
    }

    // Detect platform
    const platform = chatImporter.detectPlatform(shareUrl);
    if (!platform) {
      return res.status(400).json({
        error: 'Unsupported platform',
        message: 'Only Claude.ai and ChatGPT share links are supported'
      });
    }

    console.log(`[Import] User ${req.user.id} importing from ${platform}: ${shareUrl}`);

    // Scrape the conversation
    let importedData;
    try {
      importedData = await chatImporter.importChat(shareUrl);
    } catch (scrapeError) {
      console.error('[Import] Scraping failed:', scrapeError);
      return res.status(500).json({
        error: 'Failed to import conversation',
        message: scrapeError.message
      });
    }

    // Validate imported data
    if (!importedData.messages || importedData.messages.length === 0) {
      return res.status(400).json({
        error: 'No messages found',
        message: 'The shared conversation appears to be empty or could not be parsed'
      });
    }

    // Create conversation in database
    const conversation = await prisma.conversation.create({
      data: {
        userId: req.user.id,
        title: importedData.title || `Imported from ${platform}`,
        source: platform,
        messages: {
          create: importedData.messages.map((msg, index) => ({
            role: msg.role,
            content: msg.content,
            modelUsed: msg.role === 'assistant' ? platform : 'user',
            attachments: msg.attachments || undefined, // Include image attachments if present
            createdAt: new Date(Date.now() + index * 1000), // Preserve order with timestamps
          }))
        }
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    console.log(`[Import] Successfully imported conversation ${conversation.id} with ${importedData.messages.length} messages`);

    res.status(201).json({
      success: true,
      conversation: {
        id: conversation.id,
        title: conversation.title,
        messageCount: importedData.messages.length,
        platform: importedData.platform,
        importedAt: importedData.importedAt
      }
    });

  } catch (error) {
    console.error('[Import] Error:', error);
    res.status(500).json({
      error: 'Failed to import conversation',
      message: error.message
    });
  }
});

/**
 * Import a chat from the HAL browser extension
 * POST /api/import/extension
 * Body: { platform, title, messages: [{ role, content }], url, extractedAt }
 */
router.post('/extension', async (req, res) => {
  try {
    const { platform, title, messages, url } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: 'No messages provided',
        message: 'The extension did not extract any messages from the page'
      });
    }

    const validPlatforms = ['claude', 'chatgpt'];
    const detectedPlatform = validPlatforms.includes(platform) ? platform : 'unknown';

    console.log(`[Import] Extension import from ${req.user.id}: ${messages.length} messages from ${detectedPlatform} (${url || 'no url'})`);

    // Create conversation in database
    const conversation = await prisma.conversation.create({
      data: {
        userId: req.user.id,
        title: title || `Imported from ${detectedPlatform}`,
        source: detectedPlatform,
        messages: {
          create: messages.map((msg, index) => ({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content,
            modelUsed: msg.role === 'assistant' ? detectedPlatform : 'user',
            createdAt: new Date(Date.now() + index * 1000),
          }))
        }
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    console.log(`[Import] Extension import saved: conversation ${conversation.id} with ${messages.length} messages`);

    res.status(201).json({
      success: true,
      conversation: {
        id: conversation.id,
        title: conversation.title,
        messageCount: messages.length,
        platform: detectedPlatform,
        importedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('[Import] Extension import error:', error);
    res.status(500).json({
      error: 'Failed to import conversation',
      message: error.message
    });
  }
});

/**
 * Get import status/info
 * GET /api/import/status
 */
router.get('/status', async (req, res) => {
  try {
    res.json({
      supported: ['claude.ai', 'chatgpt.com'],
      status: 'operational'
    });
  } catch (error) {
    console.error('[Import] Status error:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

export default router;
