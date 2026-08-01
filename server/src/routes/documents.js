import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken } from '../middleware/auth.js';
import { fileURLToPath } from 'url';

const router = express.Router();
const execFilePromise = promisify(execFile);

const ALLOWED_OUTPUT_FORMATS = ['markdown', 'json'];

// Configure multer for file uploads.
// Disk filename is UUID + sanitized extension only — originalname is preserved
// on the multer file object (req.file.originalname) for display purposes, but
// is never written to disk or passed to the shell.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(process.cwd(), '../public/uploads/documents'));
  },
  filename: (req, file, cb) => {
    const rawExt = path.extname(file.originalname).toLowerCase();
    const safeExt = /^\.[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : '';
    cb(null, `${uuidv4()}${safeExt}`);
  }
});

// File filter for supported document types
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
    'application/msword', // doc
    'text/html',
    'image/png',
    'image/jpeg',
    'image/tiff',
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  }
});

// All routes require authentication
router.use(authenticateToken);

// Process a document
router.post('/process', upload.single('document'), async (req, res) => {
  let filePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No document uploaded' });
    }

    filePath = req.file.path;
    const outputFormat = req.body.format || 'markdown';

    if (!ALLOWED_OUTPUT_FORMATS.includes(outputFormat)) {
      return res.status(400).json({ error: `Invalid format. Must be one of: ${ALLOWED_OUTPUT_FORMATS.join(', ')}` });
    }

    console.log(`Processing document for user ${req.user.id}: ${req.file.originalname}`);

    // Python interpreter from the Docling virtualenv — override with DOCLING_PYTHON,
    // defaults to <repo>/.venv/docling created by the installer
    const srcDir = path.dirname(fileURLToPath(import.meta.url));
    const venvPython = process.env.DOCLING_PYTHON || path.join(srcDir, '../../../.venv/docling/bin/python3');
    const scriptPath = path.join(srcDir, '../../process_document.py');

    // execFile avoids shell interpretation — args are passed as argv, not a shell string
    const { stdout, stderr } = await execFilePromise(venvPython, [scriptPath, filePath, outputFormat], {
      timeout: 300000, // 5 minutes
      maxBuffer: 100 * 1024 * 1024, // 100MB buffer for large outputs
    });

    // Parse JSON response
    const result = JSON.parse(stdout.trim().split('\n').pop());

    if (!result.success) {
      console.error('Document processing failed:', result.error);
      return res.status(500).json({ error: result.error });
    }

    // If content was written to file, read it
    let content = result.content;
    if (result.content_truncated && result.content_file) {
      content = await fs.readFile(result.content_file, 'utf-8');
      // Clean up the temp output file
      await fs.unlink(result.content_file).catch(() => {});

      // Parse if JSON format
      if (outputFormat === 'json') {
        content = JSON.parse(content);
      }
    }

    console.log(`Document processed successfully: ${req.file.originalname}`);

    res.json({
      success: true,
      content,
      metadata: {
        ...result.metadata,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
      },
      processedAt: result.processed_at,
    });

  } catch (error) {
    console.error('Document processing error:', error);

    if (error.killed) {
      return res.status(504).json({ error: 'Document processing timed out' });
    }

    res.status(500).json({ error: 'Failed to process document' });

  } finally {
    // Clean up uploaded file after processing
    if (filePath) {
      await fs.unlink(filePath).catch(() => {});
    }
  }
});

// Get supported formats
router.get('/formats', (req, res) => {
  res.json({
    supported: [
      { extension: '.pdf', description: 'PDF documents' },
      { extension: '.docx', description: 'Microsoft Word documents' },
      { extension: '.pptx', description: 'Microsoft PowerPoint presentations' },
      { extension: '.xlsx', description: 'Microsoft Excel spreadsheets' },
      { extension: '.html', description: 'HTML documents' },
      { extension: '.png', description: 'PNG images (OCR)' },
      { extension: '.jpg', description: 'JPEG images (OCR)' },
      { extension: '.tiff', description: 'TIFF images (OCR)' },
    ],
    maxSize: '50MB',
    outputFormats: ['markdown', 'json'],
  });
});

export default router;
