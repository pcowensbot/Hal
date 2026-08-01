// Fix foreign key issues before migration
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Checking for orphaned foreign keys...');

  // Check usedById
  const orphanedUsed = await prisma.$queryRaw`
    SELECT ic.id, ic."usedById"
    FROM invite_codes ic
    LEFT JOIN users u ON ic."usedById" = u.id
    WHERE ic."usedById" IS NOT NULL AND u.id IS NULL
  `;

  console.log(`Found ${orphanedUsed.length} invite codes with orphaned usedById`);
  for (const code of orphanedUsed) {
    console.log(`  Nullifying usedById for code ${code.id} (user ${code.usedById} no longer exists)`);
    await prisma.$executeRaw`UPDATE invite_codes SET "usedById" = NULL WHERE id = ${code.id}`;
  }

  // Check createdById
  const orphanedCreated = await prisma.$queryRaw`
    SELECT ic.id, ic."createdById"
    FROM invite_codes ic
    LEFT JOIN users u ON ic."createdById" = u.id
    WHERE ic."createdById" IS NOT NULL AND u.id IS NULL
  `;

  console.log(`Found ${orphanedCreated.length} invite codes with orphaned createdById`);
  for (const code of orphanedCreated) {
    console.log(`  Nullifying createdById for code ${code.id} (user ${code.createdById} no longer exists)`);
    await prisma.$executeRaw`UPDATE invite_codes SET "createdById" = NULL WHERE id = ${code.id}`;
  }

  // Check for duplicates in usedById (must be unique)
  const duplicates = await prisma.$queryRaw`
    SELECT "usedById", COUNT(*) as cnt
    FROM invite_codes
    WHERE "usedById" IS NOT NULL
    GROUP BY "usedById"
    HAVING COUNT(*) > 1
  `;

  console.log(`Found ${duplicates.length} duplicate usedById values`);
  for (const dup of duplicates) {
    console.log(`  User ${dup.usedById} has ${dup.cnt} codes - keeping most recent`);
    // Keep only the most recent one
    await prisma.$executeRaw`
      UPDATE invite_codes
      SET "usedById" = NULL
      WHERE "usedById" = ${dup.usedById}
      AND id NOT IN (
        SELECT id FROM invite_codes
        WHERE "usedById" = ${dup.usedById}
        ORDER BY "usedAt" DESC NULLS LAST
        LIMIT 1
      )
    `;
  }

  console.log('\nForeignkey issues fixed!');
}

main()
  .catch((e) => {
    console.error('Fix failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
