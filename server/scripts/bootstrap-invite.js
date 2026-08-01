// Mints a one-time bootstrap invite code when the instance has no users yet.
// Signup requires an invite code, but on a fresh install nobody exists to
// create one — the first account to consume an invite auto-promotes to
// SUPER_ADMIN. Safe to run on every boot: it's a no-op once a user exists.
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

try {
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    console.log('bootstrap-invite: users already exist, nothing to do');
  } else {
    let invite = await prisma.inviteCode.findFirst({
      where: { isActive: true, usedAt: null },
    });
    if (!invite) {
      invite = await prisma.inviteCode.create({
        data: { code: `BOOTSTRAP-${crypto.randomBytes(4).toString('hex').toUpperCase()}` },
      });
    }
    console.log('');
    console.log('==============================================================');
    console.log('  FIRST-RUN SETUP: use this invite code on the signup page');
    console.log('');
    console.log(`      ${invite.code}`);
    console.log('');
    console.log('  The first account created becomes the administrator.');
    console.log('==============================================================');
    console.log('');
  }
} finally {
  await prisma.$disconnect();
}
