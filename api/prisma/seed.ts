import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import { randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

dotenv.config();

const scryptAsync = promisify(scrypt);
const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

async function main() {
  const systemUserId   = '00000000-0000-0000-0000-000000000010';
  const aliceId        = '00000000-0000-0000-0000-000000000011';
  const bobId          = '00000000-0000-0000-0000-000000000012';
  const workspaceId    = '00000000-0000-0000-0000-000000000100';
  const systemMembershipId = '00000000-0000-0000-0000-000000000210';
  const aliceMembershipId  = '00000000-0000-0000-0000-000000000211';
  const bobMembershipId    = '00000000-0000-0000-0000-000000000212';
  const pageId         = '00000000-0000-0000-0000-000000000300';

  const DEFAULT_PASSWORD = 'wikid';
  // Production installs set their own admin login and skip the demo users
  const adminEmail = process.env.WIKID_ADMIN_EMAIL?.trim() || 'admin@wikid.local';
  const adminPassword = process.env.WIKID_ADMIN_PASSWORD || DEFAULT_PASSWORD;
  const seedDemoUsers = process.env.WIKID_SEED_DEMO_USERS !== 'false';
  const adminHash = await hashPassword(adminPassword);

  await prisma.user.upsert({
    where: { id: systemUserId },
    update: { email: adminEmail, displayName: 'System Admin', passwordHash: adminHash },
    create: { id: systemUserId, email: adminEmail, username: 'admin', displayName: 'System Admin', passwordHash: adminHash },
  });

  await prisma.workspace.upsert({
    where: { id: workspaceId },
    update: {},
    create: { id: workspaceId, name: 'Wikid Workspace' },
  });

  await prisma.userWorkspace.upsert({
    where: { id: systemMembershipId },
    update: { role: 'OWNER' },
    create: { id: systemMembershipId, userId: systemUserId, workspaceId, role: 'OWNER' },
  });

  if (seedDemoUsers) {
    const aliceHash = await hashPassword(DEFAULT_PASSWORD);
    const bobHash   = await hashPassword(DEFAULT_PASSWORD);

    await prisma.user.upsert({
      where: { id: aliceId },
      update: { email: 'alice@wikid.local', username: 'alice', displayName: 'Alice', passwordHash: aliceHash },
      create: { id: aliceId, email: 'alice@wikid.local', username: 'alice', displayName: 'Alice', passwordHash: aliceHash },
    });

    await prisma.user.upsert({
      where: { id: bobId },
      update: { email: 'bob@wikid.local', username: 'bob', displayName: 'Bob', passwordHash: bobHash },
      create: { id: bobId, email: 'bob@wikid.local', username: 'bob', displayName: 'Bob', passwordHash: bobHash },
    });

    await prisma.userWorkspace.upsert({
      where: { id: aliceMembershipId },
      update: { role: 'OWNER' },
      create: { id: aliceMembershipId, userId: aliceId, workspaceId, role: 'OWNER' },
    });

    await prisma.userWorkspace.upsert({
      where: { id: bobMembershipId },
      update: { role: 'OWNER' },
      create: { id: bobMembershipId, userId: bobId, workspaceId, role: 'OWNER' },
    });
  }

  await prisma.page.upsert({
    where: { id: pageId },
    update: {},
    create: {
      id: pageId,
      workspaceId,
      authorId: seedDemoUsers ? aliceId : systemUserId,
      title: 'Welcome to Wikid',
      isPinned: true,
      isFavorite: true,
      content: {
        time: Date.now(),
        blocks: [
          { type: 'header', data: { text: 'Getting started', level: 2 } },
          { type: 'paragraph', data: { text: 'This is your lightweight wiki workspace.' } },
          { type: 'checklist', data: { items: [{ text: 'Try adding a new block', checked: false }] } },
          { type: 'paragraph', data: { text: 'Use the slash menu to insert headings, lists, and embeds.' } },
        ],
        version: '2.31.0',
      },
    },
  });

  console.log(`Seeded admin: ${adminEmail}`);
  if (seedDemoUsers) {
    console.log(`Seeded demo users (password: "${DEFAULT_PASSWORD}"): alice@wikid.local, bob@wikid.local`);
  }
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
