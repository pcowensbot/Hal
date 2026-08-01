import express from 'express';
import prisma from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import ollamaService from '../services/ollama.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get user's books
router.get('/books', async (req, res) => {
  try {
    const userId = req.user.userId;

    const books = await prisma.book.findMany({
      where: { userId },
      include: {
        _count: {
          select: { notes: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.json(books);
  } catch (error) {
    console.error('Get books error:', error);
    res.status(500).json({ error: 'Failed to fetch books' });
  }
});

// Create a book
router.post('/books', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Book name is required' });
    }

    const book = await prisma.book.create({
      data: {
        userId,
        name,
        description,
      },
    });

    res.status(201).json(book);
  } catch (error) {
    console.error('Create book error:', error);
    res.status(500).json({ error: 'Failed to create book' });
  }
});

// Update a book
router.put('/books/:id', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, description } = req.body;

    // Verify ownership
    const book = await prisma.book.findUnique({ where: { id } });
    if (!book || book.userId !== userId) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const updatedBook = await prisma.book.update({
      where: { id },
      data: { name, description },
    });

    res.json(updatedBook);
  } catch (error) {
    console.error('Update book error:', error);
    res.status(500).json({ error: 'Failed to update book' });
  }
});

// Delete a book
router.delete('/books/:id', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    // Verify ownership
    const book = await prisma.book.findUnique({ where: { id } });
    if (!book || book.userId !== userId) {
      return res.status(404).json({ error: 'Book not found' });
    }

    await prisma.book.delete({ where: { id } });

    res.json({ success: true, message: 'Book deleted' });
  } catch (error) {
    console.error('Delete book error:', error);
    res.status(500).json({ error: 'Failed to delete book' });
  }
});

// Get user's starred notes
router.get('/notes', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { bookId } = req.query;

    const where = { userId };
    if (bookId) {
      where.bookId = bookId;
    }

    const notes = await prisma.starredNote.findMany({
      where,
      include: {
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
    console.error('Get notes error:', error);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// Star a message (create note)
router.post('/notes', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { messageId, title, note, bookId } = req.body;

    if (!messageId) {
      return res.status(400).json({ error: 'Message ID is required' });
    }

    // Verify message exists
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Verify user owns the conversation
    if (message.conversation.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if already starred
    const existing = await prisma.starredNote.findFirst({
      where: { userId, messageId },
    });

    if (existing) {
      return res.status(409).json({ error: 'Message already starred' });
    }

    const starredNote = await prisma.starredNote.create({
      data: {
        userId,
        messageId,
        title,
        note,
        bookId,
      },
      include: {
        message: true,
        book: true,
      },
    });

    res.status(201).json(starredNote);
  } catch (error) {
    console.error('Star message error:', error);
    res.status(500).json({ error: 'Failed to star message' });
  }
});

// POST /api/knowledge/notes/from-text — Create note from raw text (no message required)
router.post('/notes/from-text', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { title, content, bookId } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const data = {
      userId,
      title: title || null,
      note: content,
    };

    if (bookId) {
      const book = await prisma.book.findFirst({ where: { id: bookId, userId } });
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }
      data.bookId = bookId;
    }

    const note = await prisma.starredNote.create({ data });
    res.status(201).json(note);
  } catch (error) {
    console.error('Create note from text error:', error);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// Update a starred note
router.put('/notes/:id', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { title, note, bookId } = req.body;

    // Verify ownership
    const starredNote = await prisma.starredNote.findUnique({ where: { id } });
    if (!starredNote || starredNote.userId !== userId) {
      return res.status(404).json({ error: 'Note not found' });
    }

    const updated = await prisma.starredNote.update({
      where: { id },
      data: { title, note, bookId },
      include: {
        message: true,
        book: true,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Update note error:', error);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// Delete a starred note (unstar)
router.delete('/notes/:id', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    // Verify ownership
    const starredNote = await prisma.starredNote.findUnique({ where: { id } });
    if (!starredNote || starredNote.userId !== userId) {
      return res.status(404).json({ error: 'Note not found' });
    }

    await prisma.starredNote.delete({ where: { id } });

    res.json({ success: true, message: 'Note deleted' });
  } catch (error) {
    console.error('Delete note error:', error);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// Check if a message is starred
router.get('/notes/check/:messageId', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { messageId } = req.params;

    const starredNote = await prisma.starredNote.findFirst({
      where: { userId, messageId },
    });

    res.json({ starred: !!starredNote, note: starredNote });
  } catch (error) {
    console.error('Check starred error:', error);
    res.status(500).json({ error: 'Failed to check if starred' });
  }
});

// ========== Training Markers ==========


// ========== Search / RAG ==========

// Search knowledge base
router.get('/search', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { q, bookId } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const where = { userId };
    if (bookId) {
      where.bookId = bookId;
    }

    // Simple text search for now (can be upgraded to semantic search later)
    const notes = await prisma.starredNote.findMany({
      where: {
        ...where,
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { note: { contains: q, mode: 'insensitive' } },
          {
            message: {
              content: { contains: q, mode: 'insensitive' },
            },
          },
        ],
      },
      include: {
        message: {
          include: {
            conversation: {
              select: { title: true },
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
      take: 20,
    });

    res.json(notes);
  } catch (error) {
    console.error('Search knowledge base error:', error);
    res.status(500).json({ error: 'Failed to search knowledge base' });
  }
});

// ========== Export / Import ==========

// Export a book
router.get('/books/:id/export', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    // Verify ownership
    const book = await prisma.book.findUnique({
      where: { id },
      include: {
        notes: {
          include: {
            message: {
              select: {
                content: true,
                role: true,
                createdAt: true,
              },
            },
          },
        },
        user: {
          select: {
            firstName: true,
          },
        },
      },
    });

    if (!book || book.userId !== userId) {
      return res.status(404).json({ error: 'Book not found' });
    }

    // Format for export
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      exportedBy: book.user.firstName,
      book: {
        name: book.name,
        description: book.description,
        createdAt: book.createdAt,
        noteCount: book.notes.length,
      },
      notes: book.notes.map(note => ({
        title: note.title,
        note: note.note,
        message: {
          role: note.message.role,
          content: note.message.content,
          createdAt: note.message.createdAt,
        },
        createdAt: note.createdAt,
      })),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="hal-book-${book.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json"`);
    res.json(exportData);
  } catch (error) {
    console.error('Export book error:', error);
    res.status(500).json({ error: 'Failed to export book' });
  }
});

// Import a book
router.post('/books/import', async (req, res) => {
  try {
    const userId = req.user.userId;
    const importData = req.body;

    // Validate import data
    if (!importData.version || !importData.book || !importData.notes) {
      return res.status(400).json({ error: 'Invalid import file format' });
    }

    // Create the book
    const book = await prisma.book.create({
      data: {
        userId,
        name: `${importData.book.name} (Imported)`,
        description: importData.book.description || `Imported from ${importData.exportedBy} on ${new Date(importData.exportedAt).toLocaleDateString()}`,
      },
    });

    // For each note, we need to create a conversation and message first
    // Since we're importing standalone knowledge, create a special "Imported Knowledge" conversation
    let importConversation = await prisma.conversation.findFirst({
      where: {
        userId,
        title: '📚 Imported Knowledge',
      },
    });

    if (!importConversation) {
      importConversation = await prisma.conversation.create({
        data: {
          userId,
          title: '📚 Imported Knowledge',
        },
      });
    }

    // Import notes
    for (const noteData of importData.notes) {
      // Create message in imported conversation
      const message = await prisma.message.create({
        data: {
          conversationId: importConversation.id,
          role: noteData.message.role,
          content: noteData.message.content,
        },
      });

      // Create starred note
      await prisma.starredNote.create({
        data: {
          userId,
          messageId: message.id,
          bookId: book.id,
          title: noteData.title,
          note: noteData.note,
        },
      });
    }

    res.status(201).json({
      success: true,
      book,
      imported: importData.notes.length,
    });
  } catch (error) {
    console.error('Import book error:', error);
    res.status(500).json({ error: 'Failed to import book' });
  }
});

// ========== AI Auto-Organize ==========

// Auto-organize notes into book suggestions
router.post('/auto-organize', async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get all user's notes
    const notes = await prisma.starredNote.findMany({
      where: { userId },
      include: {
        message: {
          select: {
            content: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (notes.length === 0) {
      return res.json({ books: [], uncategorized: [], message: 'No notes to organize' });
    }

    if (notes.length < 3) {
      return res.json({
        books: [],
        uncategorized: notes.map((_, idx) => idx),
        message: 'Need at least 3 notes to suggest groupings',
      });
    }

    // Analyze notes with local LLM
    const suggestions = await ollamaService.analyzeNotesForBooks(notes);

    // Map note indices back to actual note IDs
    const booksWithIds = suggestions.books.map(book => ({
      ...book,
      notes: book.noteIndices.map(idx => notes[idx - 1]), // Convert 1-indexed to 0-indexed
    }));

    const uncategorizedNotes = suggestions.uncategorized?.map(idx => notes[idx - 1]) || [];

    res.json({
      books: booksWithIds,
      uncategorized: uncategorizedNotes,
      totalNotes: notes.length,
    });
  } catch (error) {
    console.error('Auto-organize error:', error);
    res.status(500).json({ error: 'Failed to auto-organize notes. ' + error.message });
  }
});

// Create books from auto-organize suggestions
router.post('/auto-organize/confirm', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { selectedBooks } = req.body; // Array of {title, description, noteIds: []}

    if (!selectedBooks || !Array.isArray(selectedBooks)) {
      return res.status(400).json({ error: 'Invalid request format' });
    }

    const createdBooks = [];

    for (const bookData of selectedBooks) {
      // Create the book
      const book = await prisma.book.create({
        data: {
          userId,
          name: bookData.title,
          description: bookData.description,
        },
      });

      // Assign notes to this book
      if (bookData.noteIds && bookData.noteIds.length > 0) {
        await prisma.starredNote.updateMany({
          where: {
            id: { in: bookData.noteIds },
            userId, // Security: ensure user owns these notes
          },
          data: {
            bookId: book.id,
          },
        });
      }

      createdBooks.push(book);
    }

    res.status(201).json({
      success: true,
      created: createdBooks.length,
      books: createdBooks,
    });
  } catch (error) {
    console.error('Confirm auto-organize error:', error);
    res.status(500).json({ error: 'Failed to create books from suggestions' });
  }
});

export default router;
