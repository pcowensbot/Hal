// Pre-migration script to copy old field values before schema change
// Run this BEFORE prisma db push

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Pre-migration: Copying invite code data to new fields...');

  // Get all invite codes with their current values using raw query
  const inviteCodes = await prisma.$queryRaw`
    SELECT id, "createdBy", "usedBy"
    FROM invite_codes
    WHERE "createdBy" IS NOT NULL OR "usedBy" IS NOT NULL
  `;

  console.log(`Found ${inviteCodes.length} invite codes to migrate`);

  // First, add the new columns if they don't exist
  try {
    await prisma.$executeRaw`
      ALTER TABLE invite_codes
      ADD COLUMN IF NOT EXISTS "createdById" TEXT,
      ADD COLUMN IF NOT EXISTS "usedById" TEXT,
      ADD COLUMN IF NOT EXISTS "legacyCreatedBy" TEXT,
      ADD COLUMN IF NOT EXISTS "roleId" TEXT,
      ADD COLUMN IF NOT EXISTS "groupId" TEXT,
      ADD COLUMN IF NOT EXISTS "makeGroupAdmin" BOOLEAN DEFAULT false
    `;
    console.log('Added new columns');
  } catch (e) {
    console.log('Columns may already exist:', e.message);
  }

  // Copy data from old fields to new fields
  for (const code of inviteCodes) {
    try {
      await prisma.$executeRaw`
        UPDATE invite_codes
        SET
          "createdById" = ${code.createdBy},
          "legacyCreatedBy" = ${code.createdBy},
          "usedById" = ${code.usedBy}
        WHERE id = ${code.id}
      `;
      console.log(`  Migrated invite code: ${code.id}`);
    } catch (e) {
      console.error(`  Failed to migrate ${code.id}:`, e.message);
    }
  }

  // Check for duplicate usedBy values which would violate unique constraint
  const duplicates = await prisma.$queryRaw`
    SELECT "usedBy", COUNT(*) as count
    FROM invite_codes
    WHERE "usedBy" IS NOT NULL
    GROUP BY "usedBy"
    HAVING COUNT(*) > 1
  `;

  if (duplicates.length > 0) {
    console.log('\nWARNING: Duplicate usedBy values found!');
    console.log('These need to be resolved before migration:');
    for (const dup of duplicates) {
      console.log(`  User ${dup.usedBy} used ${dup.count} codes`);
    }
    console.log('\nKeeping only the most recent used code for each user...');

    // For each duplicate, keep only the most recent and nullify others
    for (const dup of duplicates) {
      await prisma.$executeRaw`
        UPDATE invite_codes
        SET "usedById" = NULL
        WHERE "usedBy" = ${dup.usedBy}
        AND id NOT IN (
          SELECT id FROM invite_codes
          WHERE "usedBy" = ${dup.usedBy}
          ORDER BY "usedAt" DESC NULLS LAST
          LIMIT 1
        )
      `;
    }
  }

  console.log('\nPre-migration complete!');
  console.log('Now run: npx prisma db push --accept-data-loss');
}

main()
  .catch((e) => {
    console.error('Pre-migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
