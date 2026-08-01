import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const execFilePromise = promisify(execFile);

// All routes require authentication
router.use(authenticateToken);

// Generate image from prompt
router.post('/generate', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt required' });
    }

    console.log(`Generating image for user ${req.user.id}: "${prompt}"`);

    // execFile avoids shell interpretation — prompt is argv, never parsed by a shell.
    const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../generate_image.py');

    const { stdout, stderr } = await execFilePromise('python3', [scriptPath, prompt], {
      env: { ...process.env, CUDA_VISIBLE_DEVICES: '0' },
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    // Parse JSON response from Python script
    const result = JSON.parse(stdout.trim().split('\n').pop());

    if (!result.success) {
      console.error('Image generation failed:', result.error);
      return res.status(500).json({ error: result.error });
    }

    console.log(`Image generated successfully: ${result.image_path}`);

    res.json({
      success: true,
      image_url: result.image_path,
      prompt: prompt.trim(),
    });

  } catch (error) {
    console.error('Image generation error:', error);

    // Handle timeout
    if (error.killed) {
      return res.status(504).json({ error: 'Image generation timed out' });
    }

    res.status(500).json({ error: 'Failed to generate image' });
  }
});

export default router;
