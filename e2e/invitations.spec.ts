import type { Page } from '@playwright/test';
import { test, expect, unique, USERS } from './fixtures';

// Adding someone to a workspace invites them: they see the invitation, and they're a member once
// they accept it. Its owners see who's invited, and can take an invitation back.

const switcher = (page: Page) => page.getByRole('complementary').locator('.user-switch');
const menu = (page: Page) => page.locator('.popover-card');
const invitation = (page: Page, name: string) => menu(page).locator('.user-menu-invitation', { hasText: name });

/** A workspace of Alice's, with Settings open on its Members tab. */
async function membersOf(alice: Page) {
  const name = unique('Invited to');
  const created = await alice.request.post('/api/workspaces', { data: { name } });
  const id = (await created.json()).workspace.id as string;
  await alice.goto('/');
  await switcher(alice).click();
  await menu(alice).getByText(name, { exact: true }).click();
  await switcher(alice).click();
  await menu(alice).getByRole('button', { name: 'Settings' }).click();
  const settings = alice.locator('.settings-popup-card');
  await settings.getByRole('button', { name: 'Members', exact: true }).click();
  return { id, name, settings };
}

test.describe('invitations', () => {
  test('someone invited sees it, and accepting opens the workspace; until then they are only invited', async ({ alice, bob }) => {
    const { id, name, settings } = await membersOf(alice);
    await settings.getByPlaceholder('Email or username').fill(USERS.bob.email);
    await settings.locator('.members-invite select').selectOption('VIEWER');
    await settings.getByRole('button', { name: 'Invite' }).click();
    await expect(settings.getByRole('status')).toContainText(`Invited ${USERS.bob.email}`);
    // Listed as invited, not as a member
    const invited = settings.getByLabel('Invited').locator('.members-row');
    await expect(invited).toHaveCount(1);
    await expect(invited).toContainText(USERS.bob.email);
    await expect(invited).toContainText('Viewer');
    await expect(settings.locator('.members-row', { hasText: USERS.bob.email })).toHaveCount(1);

    // Bob sees it (a count by the workspace name), says yes, and is in it
    await bob.goto('/');
    // (A count by the workspace name: Bob may have others, from tests running alongside)
    await expect(switcher(bob).locator('.user-switch__badge')).toBeVisible();
    await switcher(bob).click();
    await expect(invitation(bob, name)).toContainText('Alice invited you, as a viewer');
    await invitation(bob, name).getByRole('button', { name: 'Accept' }).click();
    await expect(switcher(bob)).toContainText(name);
    await switcher(bob).click();
    await expect(menu(bob).getByText('Workspaces')).toBeVisible();
    await expect(invitation(bob, name)).toHaveCount(0);
    const members = await (await alice.request.get(`/api/workspaces/${id}/members`)).json();
    expect(members.map((m: any) => [m.user.email, m.role])).toContainEqual([USERS.bob.email, 'VIEWER']);
    await alice.request.delete(`/api/workspaces/${id}`);
  });

  test('declined, or taken back by an owner, no one joins', async ({ alice, bob }) => {
    const { id, name, settings } = await membersOf(alice);
    await settings.getByPlaceholder('Email or username').fill(USERS.bob.email);
    await settings.getByRole('button', { name: 'Invite' }).click();
    await expect(settings.getByLabel('Invited').locator('.members-row')).toHaveCount(1);

    await bob.goto('/');
    await switcher(bob).click();
    await invitation(bob, name).getByRole('button', { name: 'Decline' }).click();
    await expect(invitation(bob, name)).toHaveCount(0);
    expect((await bob.request.get(`/api/workspaces/${id}/members`)).status()).toBe(403);

    // Invited again; this time the owner takes it back
    await settings.getByPlaceholder('Email or username').fill(USERS.bob.email);
    await settings.getByRole('button', { name: 'Invite' }).click();
    const invited = settings.getByLabel('Invited').locator('.members-row');
    await expect(invited).toHaveCount(1);
    const cancelled = alice.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes('/invitations/'));
    await invited.getByRole('button', { name: 'Cancel' }).click();
    expect((await cancelled).status()).toBe(200);
    await expect(invited).toHaveCount(0);
    await bob.reload();
    await switcher(bob).click();
    await expect(menu(bob).getByText('Workspaces')).toBeVisible();
    await expect(invitation(bob, name)).toHaveCount(0);
    await alice.request.delete(`/api/workspaces/${id}`);
  });
});
