import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../config/database.js';
import { authenticateToken, requireParent } from '../middleware/auth.js';

const execAsync = promisify(exec);
const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LLM_PROVIDER = process.env.LLM_PROVIDER || 'ollama';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

// Gate routes that hit Ollama-native /api/* endpoints. Under vLLM these
// routes would 404 — respond with a clear 400 instead.
function requireOllamaProvider(req, res, next) {
  if (LLM_PROVIDER !== 'ollama') {
    return res.status(400).json({
      error: 'Model management is only available when LLM_PROVIDER=ollama',
      provider: LLM_PROVIDER,
    });
  }
  next();
}

// All routes require parent authentication
router.use(authenticateToken);
router.use(requireParent);

// ========== Model Management ==========

// List all installed models
router.get('/models', requireOllamaProvider, async (req, res) => {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }
    const data = await response.json();
    res.json(data.models || []);
  } catch (error) {
    console.error('List models error:', error);
    res.status(500).json({ error: 'Failed to list models' });
  }
});

// Pull/download a new model
router.post('/models/pull', requireOllamaProvider, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Model name is required' });
    }

    // Start the pull process
    const response = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: false }),
    });

    if (!response.ok) {
      throw new Error(`Failed to pull model: ${response.statusText}`);
    }

    const data = await response.json();
    res.json({ success: true, message: `Model ${name} downloaded successfully`, data });
  } catch (error) {
    console.error('Pull model error:', error);
    res.status(500).json({ error: error.message || 'Failed to pull model' });
  }
});

// Delete a model
router.delete('/models/:name', requireOllamaProvider, async (req, res) => {
  try {
    const { name } = req.params;

    const response = await fetch(`${OLLAMA_BASE_URL}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete model: ${response.statusText}`);
    }

    res.json({ success: true, message: `Model ${name} deleted successfully` });
  } catch (error) {
    console.error('Delete model error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete model' });
  }
});

// Get model info
router.get('/models/:name/info', requireOllamaProvider, async (req, res) => {
  try {
    const { name } = req.params;

    const response = await fetch(`${OLLAMA_BASE_URL}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get model info: ${response.statusText}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Get model info error:', error);
    res.status(500).json({ error: error.message || 'Failed to get model info' });
  }
});

// Get currently running/loaded models
router.get('/models/running', requireOllamaProvider, async (req, res) => {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/ps`);
    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }
    const data = await response.json();
    res.json(data.models || []);
  } catch (error) {
    console.error('Running models error:', error);
    res.status(500).json({ error: 'Failed to get running models' });
  }
});

// Load a model into memory
router.post('/models/load', requireOllamaProvider, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Model name is required' });
    }

    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name, prompt: '', keep_alive: '10m' }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Failed to load model: ${response.statusText}`);
    }

    res.json({ success: true, message: `Model ${name} loaded into memory` });
  } catch (error) {
    console.error('Load model error:', error);
    res.status(500).json({ error: error.message || 'Failed to load model' });
  }
});

// Unload a model from memory
router.post('/models/unload', requireOllamaProvider, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Model name is required' });
    }

    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name, prompt: '', keep_alive: 0 }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Failed to unload model: ${response.statusText}`);
    }

    res.json({ success: true, message: `Model ${name} unloaded from memory` });
  } catch (error) {
    console.error('Unload model error:', error);
    res.status(500).json({ error: error.message || 'Failed to unload model' });
  }
});

// ========== System Hardware Detection ==========

router.get('/hardware', async (req, res) => {
  try {
    const hardware = {
      gpus: [],
      ram: { total: 0, available: 0 },
      cpu: { model: '', cores: 0 },
    };

    // Detect NVIDIA GPUs
    try {
      const { stdout: nvidiaOutput } = await execAsync('nvidia-smi --query-gpu=name,memory.total,memory.free,temperature.gpu,power.draw,fan.speed --format=csv,noheader,nounits');
      const gpuLines = nvidiaOutput.trim().split('\n');
      hardware.gpus = gpuLines.map((line, index) => {
        const [name, totalMem, freeMem, temp, power, fan] = line.split(',').map(s => s.trim());
        return {
          id: index,
          name,
          vendor: 'NVIDIA',
          vramTotal: parseInt(totalMem),
          vramFree: parseInt(freeMem),
          temperature: parseInt(temp) || null,
          powerDraw: parseFloat(power) || null,
          fanSpeed: parseInt(fan) || null,
        };
      });
    } catch (error) {
      // No NVIDIA GPUs or nvidia-smi not available
      console.log('No NVIDIA GPUs detected');
    }

    // Detect AMD GPUs (rocm-smi)
    try {
      const { stdout: amdOutput } = await execAsync('rocm-smi --showmeminfo vram --csv');
      // Parse AMD GPU info if available
      console.log('AMD GPU detection available but not fully implemented');
    } catch (error) {
      // No AMD GPUs
      console.log('No AMD GPUs detected');
    }

    // Get RAM info
    try {
      const { stdout: memInfo } = await execAsync('cat /proc/meminfo');
      const totalMatch = memInfo.match(/MemTotal:\s+(\d+)/);
      const availableMatch = memInfo.match(/MemAvailable:\s+(\d+)/);

      if (totalMatch && availableMatch) {
        hardware.ram.total = Math.round(parseInt(totalMatch[1]) / 1024); // Convert to MB
        hardware.ram.available = Math.round(parseInt(availableMatch[1]) / 1024);
      }
    } catch (error) {
      console.error('Failed to get RAM info:', error);
    }

    // Get CPU info
    try {
      const { stdout: cpuInfo } = await execAsync('lscpu');
      const modelMatch = cpuInfo.match(/Model name:\s+(.+)/);
      const coresMatch = cpuInfo.match(/CPU\(s\):\s+(\d+)/);

      if (modelMatch) hardware.cpu.model = modelMatch[1].trim();
      if (coresMatch) hardware.cpu.cores = parseInt(coresMatch[1]);
    } catch (error) {
      console.error('Failed to get CPU info:', error);
    }

    res.json(hardware);
  } catch (error) {
    console.error('Hardware detection error:', error);
    res.status(500).json({ error: 'Failed to detect hardware' });
  }
});

// ========== Disk Space Monitoring ==========

async function getDirectorySize(dirPath) {
  try {
    await fs.access(dirPath);
    const { stdout } = await execAsync(`du -sb "${dirPath}"`);
    const size = parseInt(stdout.split('\t')[0]);
    return size;
  } catch (error) {
    return 0;
  }
}

router.get('/disk-usage', async (req, res) => {
  try {
    const projectRoot = path.join(__dirname, '../../..');

    // Get sizes for different components
    const [
      modelsSize,
      gallerySize,
      totalDisk,
    ] = await Promise.all([
      // Ollama models location (common paths)
      getDirectorySize(process.env.OLLAMA_MODELS || '/usr/share/ollama/.ollama/models')
        .catch(() => getDirectorySize(path.join(process.env.HOME || '/root', '.ollama/models')))
        .catch(() => 0),

      // Generated images
      getDirectorySize(path.join(projectRoot, 'public/images')),

      // Total disk space
      execAsync('df -B1 . | tail -1').then(({ stdout }) => {
        const parts = stdout.trim().split(/\s+/);
        return {
          total: parseInt(parts[1]),
          used: parseInt(parts[2]),
          available: parseInt(parts[3]),
        };
      }),
    ]);

    // Get database size
    const dbSize = await prisma.$queryRaw`
      SELECT pg_database_size(current_database()) as size
    `.then(result => Number(result[0]?.size || 0));

    // Calculate trash size (pending deletions in DB don't take much space, but count messages)
    const pendingDeletions = await prisma.conversation.count({
      where: { deletedAt: { not: null }, permanentDelete: false },
    });

    const diskUsage = {
      total: totalDisk.total,
      used: totalDisk.used,
      available: totalDisk.available,
      breakdown: {
        models: {
          bytes: modelsSize,
          label: 'AI Models',
        },
        database: {
          bytes: dbSize,
          label: 'Chats & Knowledge Base',
        },
        gallery: {
          bytes: gallerySize,
          label: 'Generated Images',
        },
        trash: {
          bytes: 0, // Soft deletes don't use extra space
          count: pendingDeletions,
          label: 'Pending Deletions',
        },
      },
    };

    res.json(diskUsage);
  } catch (error) {
    console.error('Disk usage error:', error);
    res.status(500).json({ error: 'Failed to get disk usage' });
  }
});

// ========== Settings Management ==========

// Get current default model
router.get('/settings/default-model', async (req, res) => {
  try {
    const settings = await prisma.settings.findFirst();
    res.json({ defaultModel: settings?.defaultModel || 'llama3.1:8b' });
  } catch (error) {
    console.error('Get default model error:', error);
    res.status(500).json({ error: 'Failed to get default model' });
  }
});

// Set default model
router.post('/settings/default-model', async (req, res) => {
  try {
    const { model } = req.body;

    if (!model) {
      return res.status(400).json({ error: 'Model name is required' });
    }

    const settings = await prisma.settings.upsert({
      where: { id: 1 },
      update: { defaultModel: model },
      create: { id: 1, defaultModel: model },
    });

    res.json({ success: true, defaultModel: settings.defaultModel });
  } catch (error) {
    console.error('Set default model error:', error);
    res.status(500).json({ error: 'Failed to set default model' });
  }
});

// ========== Maintenance Mode ==========

// Get maintenance settings
router.get('/settings/maintenance', async (req, res) => {
  try {
    const settings = await prisma.settings.findFirst();

    res.json({
      enabled: settings?.maintenanceEnabled || false,
      startHour: settings?.maintenanceStartHour || 2,
      endHour: settings?.maintenanceEndHour || 6,
      gpus: settings?.maintenanceGPUs || 'both',
      message: settings?.maintenanceMessage || null,
    });
  } catch (error) {
    console.error('Get maintenance settings error:', error);
    res.status(500).json({ error: 'Failed to get maintenance settings' });
  }
});

// Update maintenance settings
router.post('/settings/maintenance', async (req, res) => {
  try {
    const { enabled, startHour, endHour, gpus, message } = req.body;

    // Validate hours
    if (startHour !== undefined && (startHour < 0 || startHour > 23)) {
      return res.status(400).json({ error: 'Start hour must be between 0 and 23' });
    }
    if (endHour !== undefined && (endHour < 0 || endHour > 23)) {
      return res.status(400).json({ error: 'End hour must be between 0 and 23' });
    }

    // Validate GPU selection
    if (gpus && !['gpu0', 'gpu1', 'both'].includes(gpus)) {
      return res.status(400).json({ error: 'GPUs must be "gpu0", "gpu1", or "both"' });
    }

    const updateData = {};
    if (enabled !== undefined) updateData.maintenanceEnabled = enabled;
    if (startHour !== undefined) updateData.maintenanceStartHour = startHour;
    if (endHour !== undefined) updateData.maintenanceEndHour = endHour;
    if (gpus !== undefined) updateData.maintenanceGPUs = gpus;
    if (message !== undefined) updateData.maintenanceMessage = message;

    const settings = await prisma.settings.upsert({
      where: { id: 1 },
      update: updateData,
      create: {
        id: 1,
        ...updateData,
      },
    });

    res.json({
      success: true,
      enabled: settings.maintenanceEnabled,
      startHour: settings.maintenanceStartHour,
      endHour: settings.maintenanceEndHour,
      gpus: settings.maintenanceGPUs,
      message: settings.maintenanceMessage,
    });
  } catch (error) {
    console.error('Update maintenance settings error:', error);
    res.status(500).json({ error: 'Failed to update maintenance settings' });
  }
});

// Check if currently in maintenance mode
router.get('/maintenance/status', async (req, res) => {
  try {
    const settings = await prisma.settings.findFirst();

    if (!settings || !settings.maintenanceEnabled) {
      return res.json({
        inMaintenance: false,
        gpusAvailable: 'both',
      });
    }

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

    // Calculate next availability time
    let nextAvailableHour = endHour;
    const eta = new Date(now);
    if (currentHour >= endHour) {
      // Next maintenance is tomorrow
      eta.setDate(eta.getDate() + 1);
    }
    eta.setHours(nextAvailableHour, 0, 0, 0);

    // Determine GPU availability
    const gpusInMaintenance = settings.maintenanceGPUs;
    const systemBlocked = inMaintenanceWindow && gpusInMaintenance === 'both';

    res.json({
      inMaintenance: systemBlocked,
      maintenanceWindow: inMaintenanceWindow,
      gpusInMaintenance: inMaintenanceWindow ? gpusInMaintenance : 'none',
      gpusAvailable: inMaintenanceWindow ? (gpusInMaintenance === 'both' ? 'none' : (gpusInMaintenance === 'gpu0' ? 'gpu1' : 'gpu0')) : 'both',
      nextAvailable: systemBlocked ? eta.toISOString() : null,
      message: systemBlocked ? (settings.maintenanceMessage || 'System is down for AI training maintenance.') : null,
      startHour: settings.maintenanceStartHour,
      endHour: settings.maintenanceEndHour,
    });
  } catch (error) {
    console.error('Check maintenance status error:', error);
    res.status(500).json({ error: 'Failed to check maintenance status' });
  }
});

// ========== GPU Service Assignment ==========

// Get all settings (including GPU assignments)
router.get('/settings', async (req, res) => {
  try {
    const settings = await prisma.settings.findFirst();

    if (!settings) {
      return res.json({
        defaultModel: 'llama3.1:8b',
        imageGenEnabled: false,
        knowledgeBaseEnabled: true,
        chatGPU: null,
        imageGenGPU: null,
        knowledgeBaseGPU: null,
      });
    }

    res.json({
      defaultModel: settings.defaultModel,
      imageGenEnabled: settings.imageGenEnabled,
      knowledgeBaseEnabled: settings.knowledgeBaseEnabled,
      chatGPU: settings.chatGPU,
      imageGenGPU: settings.imageGenGPU,
      knowledgeBaseGPU: settings.knowledgeBaseGPU,
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// Update GPU service assignments
router.post('/settings/gpu', async (req, res) => {
  try {
    const {
      chatGPU,
      imageGenEnabled,
      imageGenGPU,
      knowledgeBaseEnabled,
      knowledgeBaseGPU,
    } = req.body;

    const updateData = {};

    // Update GPU assignments
    if (chatGPU !== undefined) updateData.chatGPU = chatGPU;
    if (imageGenGPU !== undefined) updateData.imageGenGPU = imageGenGPU;
    if (knowledgeBaseGPU !== undefined) updateData.knowledgeBaseGPU = knowledgeBaseGPU;

    // Update enable/disable flags
    if (imageGenEnabled !== undefined) updateData.imageGenEnabled = imageGenEnabled;
    if (knowledgeBaseEnabled !== undefined) updateData.knowledgeBaseEnabled = knowledgeBaseEnabled;

    const settings = await prisma.settings.upsert({
      where: { id: 1 },
      update: updateData,
      create: {
        id: 1,
        ...updateData,
      },
    });

    res.json({
      success: true,
      chatGPU: settings.chatGPU,
      imageGenEnabled: settings.imageGenEnabled,
      imageGenGPU: settings.imageGenGPU,
      knowledgeBaseEnabled: settings.knowledgeBaseEnabled,
      knowledgeBaseGPU: settings.knowledgeBaseGPU,
    });
  } catch (error) {
    console.error('Update GPU settings error:', error);
    res.status(500).json({ error: 'Failed to update GPU settings' });
  }
});

export default router;
