import { test, expect, unique, signIn, USERS } from './fixtures';

// The system admin's Workspaces panel: every workspace (not only the admin's), an owner set and a
// member removed to repair one, each change shown to its members, and deleting one.

test('the admin repairs and deletes a workspace from the panel; its members see what changed', async ({ browser, alice, bob }) => {
  const created = await alice.request.post('/api/workspaces', { data: { name: unique('Locked out') } });
  const { id, name } = (await created.json()).workspace as { id: string; name: string };
  expect((await alice.request.post(`/api/workspaces/${id}/members`, { data: { email: USERS.bob.email, role: 'EDITOR' } })).status()).toBe(201);

  const context = await browser.newContext();
  await signIn(context, USERS.admin.email);
  const admin = await context.newPage();
  await admin.goto('/');
  await admin.getByRole('complementary').getByText('Workspaces', { exact: true }).click();
  const card = admin.locator('.workspace-admin__card', { has: admin.getByText(name, { exact: true }) });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Manage members' }).click();

  // An owner, by email (no way to add an editor or a viewer here)
  await expect(card.getByRole('combobox')).toHaveCount(0);
  await card.getByRole('textbox', { name: "New owner's email address or username" }).fill(USERS.bob.email);
  await card.getByRole('button', { name: 'Make owner' }).click();
  await expect(card.locator('.workspace-admin__member', { hasText: USERS.bob.email }).locator('.workspace-admin__member-role')).toHaveText('OWNER');
  // Removing Alice asks first
  const aliceRow = card.locator('.workspace-admin__member', { hasText: USERS.alice.email });
  await aliceRow.getByRole('button', { name: 'Remove' }).click();
  await aliceRow.getByRole('button', { name: 'Remove?' }).click();
  await expect(aliceRow).toHaveCount(0);
  await expect(card.locator('.workspace-admin__history li')).toHaveText([/^Removed Alice/, /^Made Bob an owner/]);

  // Bob, in the workspace, sees what the admin changed
  await bob.goto('/');
  const switcher = bob.getByRole('complementary').locator('.user-switch');
  await switcher.click();
  await bob.locator('.popover-card').getByText(name, { exact: true }).click();
  await switcher.click();
  await bob.getByText('Settings', { exact: true }).click();
  await bob.locator('.settings-popup-nav').getByRole('button', { name: 'Members' }).click();
  await expect(bob.locator('.members-admin-actions li')).toHaveText([/The system admin removed Alice/, /The system admin made Bob an owner/]);

  // Deleting it asks first, then it's gone
  await card.getByRole('button', { name: 'Delete workspace…' }).click();
  await card.getByRole('alertdialog').getByRole('button', { name: 'Delete for good' }).click();
  await expect(admin.locator('.workspace-admin__card', { has: admin.getByText(name, { exact: true }) })).toHaveCount(0);
  await context.close();
});
