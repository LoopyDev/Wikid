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
  const adminHash = await hashPassword(DEFAULT_PASSWORD);
  const aliceHash = await hashPassword(DEFAULT_PASSWORD);
  const bobHash   = await hashPassword(DEFAULT_PASSWORD);

  await prisma.user.upsert({
    where: { id: systemUserId },
    update: { email: 'admin@wikid.local', displayName: 'System Admin', passwordHash: adminHash },
    create: { id: systemUserId, email: 'admin@wikid.local', displayName: 'System Admin', passwordHash: adminHash },
  });

  await prisma.user.upsert({
    where: { id: aliceId },
    update: { email: 'alice@wikid.local', displayName: 'Alice', passwordHash: aliceHash },
    create: { id: aliceId, email: 'alice@wikid.local', displayName: 'Alice', passwordHash: aliceHash },
  });

  await prisma.user.upsert({
    where: { id: bobId },
    update: { email: 'bob@wikid.local', displayName: 'Bob', passwordHash: bobHash },
    create: { id: bobId, email: 'bob@wikid.local', displayName: 'Bob', passwordHash: bobHash },
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

  await prisma.page.upsert({
    where: { id: pageId },
    update: {},
    create: {
      id: pageId,
      workspaceId,
      authorId: aliceId,
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

  console.log(`Seeded users (default password: "${DEFAULT_PASSWORD}"):`);
  console.log('  admin@wikid.local  — System Admin');
  console.log('  alice@wikid.local  — Alice');
  console.log('  bob@wikid.local    — Bob');
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
