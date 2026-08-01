// Orphan file cleanup — deletes uploaded files that no DB row references.
// Targets:
//   - public/uploads/imported-images/: should match Message.attachments[].filename
//   - public/uploads/documents/:        always ephemeral (documents.js deletes
//                                        on finally — any leftovers are from crashed
//                                        requests)
//
// Only deletes files older than MIN_AGE_HOURS. That window gives in-flight
// uploads grace: a file uploaded seconds ago but not yet attached to a DB
// row is safe.
//
// Intended invocations:
//   - Manual:   cd server && npm run cleanup:orphans
//   - Cron/systemd timer: daily — see runbook .claude/runbooks/orphan-cleanup.md

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../config/database.js';
import logger from '../lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIN_AGE_HOURS = parseInt(process.env.ORPHAN_MIN_AGE_HOURS) || 24;
const IMPORTED_IMAGES_DIR = path.resolve(__dirname, '../../../public/uploads/imported-images');
const DOCUMENTS_DIR = path.resolve(__dirname, '../../../public/uploads/documents');
const GENERATED_IMAGES_DIR = path.resolve(__dirname, '../../../public/generated-images');

async function getReferencedAttachmentFilenames() {
  const messages = await prisma.message.findMany({
    where: { attachments: { not: null } },
    select: { attachments: true },
  });
  const referenced = new Set();
  for (const m of messages) {
    const atts = m.attachments;
    if (!Array.isArray(atts)) continue;
    for (const a of atts) {
      if (a && typeof a === 'object' && typeof a.filename === 'string') {
        referenced.add(a.filename);
      }
    }
  }
  return referenced;
}

async function cleanDir(dir, referenced, minAgeMs, label) {
  try {
    await fs.access(dir);
  } catch {
    logger.debug({ dir, label }, 'Directory does not exist — skipping');
    return { dir, checked: 0, deleted: 0, freedBytes: 0 };
  }

  const entries = await fs.readdir(dir);
  const now = Date.now();
  let deleted = 0;
  let freedBytes = 0;

  for (const name of entries) {
    if (name.startsWith('.')) continue;
    if (referenced.has(name)) continue;

    const filepath = path.join(dir, name);
    const stat = await fs.stat(filepath).catch(() => null);
    if (!stat || !stat.isFile()) continue;
    if (now - stat.mtimeMs < minAgeMs) continue;

    try {
      await fs.unlink(filepath);
      deleted++;
      freedBytes += stat.size;
    } catch (err) {
      logger.warn({ err, filepath }, 'Failed to delete orphan file');
    }
  }

  return { dir, label, checked: entries.length, deleted, freedBytes };
}

async function main() {
  const minAgeMs = MIN_AGE_HOURS * 3600 * 1000;
  logger.info({ minAgeHours: MIN_AGE_HOURS }, 'Starting orphan cleanup');

  const referencedAttachments = await getReferencedAttachmentFilenames();
  logger.info({ count: referencedAttachments.size }, 'Referenced attachments indexed');

  const results = await Promise.all([
    cleanDir(IMPORTED_IMAGES_DIR, referencedAttachments, minAgeMs, 'imported-images'),
    // Documents are always ephemeral — documents.js unlinks on finally. Anything
    // leftover is from a crashed request, so no DB references to check.
    cleanDir(DOCUMENTS_DIR, new Set(), minAgeMs, 'documents'),
    // Generated images aren't currently tracked in DB. Leave them alone for now
    // (treat as user-generated content to be pruned by hand).
  ]);

  const totalFreed = results.reduce((s, r) => s + r.freedBytes, 0);
  const totalDeleted = results.reduce((s, r) => s + r.deleted, 0);
  logger.info({ results, totalDeleted, totalFreedBytes: totalFreed }, 'Orphan cleanup complete');

  // Skipped for safety — record it so anyone reading the log knows
  // generated-images is explicitly not pruned here.
  try {
    await fs.access(GENERATED_IMAGES_DIR);
    logger.info({ dir: GENERATED_IMAGES_DIR }, 'Generated images skipped (no DB ref tracking yet)');
  } catch { /* dir doesn't exist — fine */ }

  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({ err }, 'Orphan cleanup failed');
  process.exit(1);
});
