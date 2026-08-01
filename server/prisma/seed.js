import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding default roles...');

  // Create default system roles
  const defaultRoles = [
    {
      name: 'Admin',
      description: 'Full administrative access to manage users, groups, and system settings',
      color: '#dc2626', // Red
      canManageUsers: true,
      canManageGroups: true,
      canManageRoles: true,
      canViewAllConvos: true,
      canManageSystem: true,
      canCreateInvites: true,
      canDeleteConvos: true,
      isSystem: true,
    },
    {
      name: 'Manager',
      description: 'Can manage users and groups, view all conversations in their groups',
      color: '#ea580c', // Orange
      canManageUsers: true,
      canManageGroups: true,
      canManageRoles: false,
      canViewAllConvos: false, // Only sees group convos, not system-wide
      canManageSystem: false,
      canCreateInvites: true,
      canDeleteConvos: false,
      isSystem: true,
    },
    {
      name: 'Member',
      description: 'Standard user with access to own conversations and shared group content',
      color: '#2563eb', // Blue
      canManageUsers: false,
      canManageGroups: false,
      canManageRoles: false,
      canViewAllConvos: false,
      canManageSystem: false,
      canCreateInvites: false,
      canDeleteConvos: false,
      isSystem: true,
    },
    {
      name: 'Guest',
      description: 'Limited access, can only view shared conversations',
      color: '#6b7280', // Gray
      canManageUsers: false,
      canManageGroups: false,
      canManageRoles: false,
      canViewAllConvos: false,
      canManageSystem: false,
      canCreateInvites: false,
      canDeleteConvos: false,
      isSystem: true,
    },
  ];

  for (const role of defaultRoles) {
    const existing = await prisma.customRole.findUnique({
      where: { name: role.name },
    });

    if (!existing) {
      await prisma.customRole.create({ data: role });
      console.log(`  Created role: ${role.name}`);
    } else {
      console.log(`  Role already exists: ${role.name}`);
    }
  }

  // Migrate existing users from legacy roles to new system
  console.log('\nMigrating existing users...');

  // Get the new roles
  const adminRole = await prisma.customRole.findUnique({ where: { name: 'Admin' } });
  const memberRole = await prisma.customRole.findUnique({ where: { name: 'Member' } });

  // Migrate SUPER_ADMIN users
  const superAdmins = await prisma.user.findMany({
    where: { role: 'SUPER_ADMIN', roleId: null },
  });
  for (const user of superAdmins) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isSystemAdmin: true,
        roleId: adminRole.id,
      },
    });
    console.log(`  Migrated SUPER_ADMIN: ${user.firstName} (${user.email})`);
  }

  // Migrate PARENT users
  const parents = await prisma.user.findMany({
    where: { role: 'PARENT', roleId: null },
  });
  for (const user of parents) {
    await prisma.user.update({
      where: { id: user.id },
      data: { roleId: adminRole.id },
    });
    console.log(`  Migrated PARENT: ${user.firstName} (${user.email})`);
  }

  // Migrate CHILD users
  const children = await prisma.user.findMany({
    where: { role: 'CHILD', roleId: null },
  });
  for (const user of children) {
    await prisma.user.update({
      where: { id: user.id },
      data: { roleId: memberRole.id },
    });
    console.log(`  Migrated CHILD: ${user.firstName} (${user.email})`);
  }

  // Migrate any MEMBER users (new default)
  const members = await prisma.user.findMany({
    where: { role: 'MEMBER', roleId: null },
  });
  for (const user of members) {
    await prisma.user.update({
      where: { id: user.id },
      data: { roleId: memberRole.id },
    });
    console.log(`  Migrated MEMBER: ${user.firstName} (${user.email})`);
  }

  console.log('\nSeed completed!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
