import { test, expect, createPage, openPage, unique, USERS } from './fixtures';
import { newDatabaseFromSidebar } from './database-helpers';

// A form someone may only view, a form from another workspace, and deleting the open workspace.

test('a viewer sees at once that they can\'t fill a form in, and the sidebar shows its workspace', async ({ alice, bob, workspaceId }) => {
  await openPage(alice, await createPage(alice, workspaceId));
  const dbId = await newDatabaseFromSidebar(alice, unique('Sign-ups'));
  const database = await (await alice.request.get(`/api/pages/${dbId}/database`)).json();
  const titleFieldId = database.fields[0].id;
  const form = await (await alice.request.post(`/api/pages/${dbId}/database/forms`, { data: { name: 'Sign up', fields: [{ fieldId: titleFieldId }] } })).json();
  expect((await alice.request.patch(`/api/workspaces/${workspaceId}/members/${await bobId(alice, workspaceId)}`, { data: { role: 'VIEWER' } })).status()).toBe(200);
  const workspaceName = (await (await alice.request.get('/api/workspaces')).json()).find((entry: any) => entry.workspace?.id === workspaceId).workspace.name;

  await bob.goto(`/form/${form.id}`);
  await expect(bob.getByText("You can see this form, but not fill it in: you can only view this workspace.")).toBeVisible();
  await expect(bob.locator('.form-page__body').getByRole('textbox').first()).toBeDisabled();
  await expect(bob.getByRole('button', { name: 'Submit' })).toBeDisabled();
  // The sidebar is on the form's workspace (it kept the one Bob was in)
  await expect(bob.getByRole('complementary').locator('.user-name')).toHaveText(workspaceName);
});

test("deleting the workspace you're in opens another of yours, and a failed delete says so", async ({ alice: page }) => {
  const created = await page.request.post('/api/workspaces', { data: { name: unique('Short-lived') } });
  const { id, name } = (await created.json()).workspace as { id: string; name: string };
  await page.goto('/');
  const switcher = page.getByRole('complementary').locator('.user-switch');
  await switcher.click();
  await page.locator('.popover-card').getByText(name, { exact: true }).click();
  await expect(page.getByRole('complementary').locator('.user-name')).toHaveText(name);
  const openDelete = async () => {
    await switcher.click();
    await page.getByText('Settings', { exact: true }).click();
    await page.locator('.settings-popup-nav').getByRole('button', { name: 'Workspace' }).click();
    await page.getByRole('button', { name: 'Delete workspace' }).click();
  };

  // The server refuses: said by the button (nothing showed)
  await page.route(`**/api/workspaces/${id}*`, (route) =>
    route.request().method() === 'DELETE' ? route.fulfill({ status: 500, json: { message: 'The server is busy' } }) : route.fallback()
  );
  await openDelete();
  await page.getByRole('button', { name: 'Yes, delete workspace' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'The server is busy' })).toBeVisible();
  await page.unroute(`**/api/workspaces/${id}*`);

  // Deleted: another of Alice's workspaces opens ("No workspace" showed, though she had others)
  await page.getByRole('button', { name: 'Yes, delete workspace' }).click();
  await expect(page.locator('.settings-popup-card')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No workspace' })).toHaveCount(0);
  await expect(page.getByRole('complementary').locator('.user-name')).not.toHaveText(name);
  await expect(page.getByRole('complementary').locator('.user-name')).not.toHaveText('');
});

async function bobId(alice: import('@playwright/test').Page, workspaceId: string) {
  const members = await (await alice.request.get(`/api/workspaces/${workspaceId}/members`)).json();
  return members.find((m: any) => m.user?.email === USERS.bob.email).userId as string;
}
