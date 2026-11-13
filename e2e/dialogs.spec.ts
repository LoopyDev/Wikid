import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, unique, USERS } from './fixtures';

// The app's dialogs: settings, workspaces, export, compliance setup.

const sidebar = (page: Page) => page.getByRole('complementary');
const main = (page: Page) => page.getByRole('main');
const sidebarItem = (page: Page, title: string) =>
  sidebar(page).locator('.sidebar__item', { has: page.getByText(title, { exact: true }) });
const dialog = (page: Page, heading: string) =>
  page.locator('.modal-card, .settings-popup-card').filter({ has: page.getByRole('heading', { name: heading }) });

async function openUserMenu(page: Page) {
  await page.locator('.user-switch').click();
  await expect(page.locator('.popover-card')).toBeVisible();
}

async function workspaceName(page: Page, workspaceId: string) {
  const memberships = await (await page.request.get('/api/workspaces')).json();
  return memberships.find((m: any) => m.workspace?.id === workspaceId).workspace.name as string;
}

test.describe('dialogs', () => {
  test('settings: colour mode, renaming the workspace, and its members', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await openUserMenu(page);
    await page.locator('.popover-card').getByRole('button', { name: 'Settings' }).click();
    const settings = page.locator('.settings-popup-card');
    await expect(settings.getByRole('heading', { name: 'General' })).toBeVisible();

    const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const before = await theme();
    await settings.getByRole('button', { name: /Switch to (light|dark) mode/ }).click();
    await expect.poll(theme).not.toBe(before);
    await settings.getByRole('button', { name: /Switch to (light|dark) mode/ }).click();
    await expect.poll(theme).toBe(before);

    await settings.getByRole('button', { name: 'Workspace', exact: true }).click();
    const renamed = unique('Renamed workspace');
    await settings.getByPlaceholder('Workspace name').fill(renamed);
    await settings.getByRole('button', { name: 'Rename' }).click();
    await expect.poll(() => workspaceName(page, workspaceId)).toBe(renamed);

    await settings.getByRole('button', { name: 'Members', exact: true }).click();
    await expect(settings.locator('.members-row')).toHaveCount(2);
    await expect(settings.getByText(USERS.bob.email)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);
  });

  test('creates a workspace from the user menu', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await openUserMenu(page);
    // The AGPL "Source code" link points at the repository (or a fork's, if the build says so).
    await expect(page.locator('.popover-card').getByRole('link', { name: 'Source code' })).toHaveAttribute('href', /^https:\/\/github\.com\//);
    await page.locator('.popover-card').getByRole('button', { name: 'Create workspace' }).click();
    const name = unique('New workspace');
    await dialog(page, 'New workspace').getByPlaceholder('Workspace name').fill(name);
    await dialog(page, 'New workspace').getByRole('button', { name: 'Create' }).click();
    await expect(dialog(page, 'New workspace')).toHaveCount(0);
    await expect(sidebar(page).locator('.user-name')).toHaveText(name);

    const memberships = await (await page.request.get('/api/workspaces')).json();
    const created = memberships.find((m: any) => m.workspace?.name === name);
    expect(created?.role).toBe('OWNER');
    await page.request.delete(`/api/workspaces/${created.workspace.id}`);
  });

  test('moves a page and its sub-page to another workspace', async ({ alice: page, workspaceId }) => {
    const target = await page.request.post('/api/workspaces', { data: { name: unique('Target workspace') } });
    const targetId = (await target.json()).workspace.id as string;
    const targetName = (await target.json()).workspace.name as string;
    const title = unique('Moving page');
    const id = await createPage(page, workspaceId, { title });
    const childId = await createPage(page, workspaceId, { title: unique('Moving child'), parentId: id });
    await openPage(page, await createPage(page, workspaceId));

    const item = sidebarItem(page, title);
    await item.hover();
    await item.locator('.page-menu-btn').click();
    await page.locator('.page-menu').getByRole('button', { name: 'Move to workspace…' }).click();
    const move = dialog(page, 'Move to workspace');
    await move.getByRole('button', { name: new RegExp(targetName) }).click();
    await move.getByRole('button', { name: 'Move 2 pages' }).click();
    await expect(move).toHaveCount(0);
    await expect(sidebarItem(page, title)).toHaveCount(0);
    for (const pageId of [id, childId]) {
      expect((await (await page.request.get(`/api/pages/${pageId}`)).json()).workspaceId).toBe(targetId);
    }
    await page.request.delete(`/api/workspaces/${targetId}`);
  });

  test('export offers the open page and its sub-pages as HTML', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId, { title: unique('Export me') });
    await createPage(page, workspaceId, { title: unique('Export child'), parentId: id });
    await openPage(page, id);
    await page.locator('.topbar-menu-btn').click();
    await page.locator('.topbar-menu__dropdown').getByRole('button', { name: 'Export' }).click();
    const exportDialog = dialog(page, 'Export');
    await expect(exportDialog.getByRole('button', { name: 'Export 2 pages' })).toBeVisible();

    const download = page.waitForEvent('download');
    await exportDialog.getByRole('button', { name: 'Export 2 pages' }).click();
    expect((await download).suggestedFilename()).toMatch(/\.(html|zip)$/);
    await expect(exportDialog).toHaveCount(0);

    // PDF and Markdown are for the open page only.
    await page.locator('.topbar-menu-btn').click();
    await page.locator('.topbar-menu__dropdown').getByRole('button', { name: 'Export' }).click();
    await exportDialog.getByRole('button', { name: 'Markdown', exact: true }).click();
    await expect(exportDialog.getByRole('button', { name: 'Download Markdown' })).toBeVisible();
    await exportDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(exportDialog).toHaveCount(0);
  });

  test('the printed page, which PDF export uses, shows embedded databases', async ({ alice: page, workspaceId }) => {
    const dbId = await createPage(page, workspaceId, { title: unique('Stock'), kind: 'DATABASE' });
    const db = await (await page.request.get(`/api/pages/${dbId}/database`)).json();
    const name = db.fields.find((f: any) => f.name === 'Name').id;
    const rowName = unique('Spanner');
    await page.request.post(`/api/pages/${dbId}/database/rows`, { data: { data: { [name]: rowName } } });
    const content = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Our stock:' }] },
        { type: 'databaseView', attrs: { pageId: dbId } },
      ],
    };
    const pageId = await createPage(page, workspaceId, { title: unique('Report') });
    expect((await page.request.put(`/api/pages/${pageId}/content`, { data: { content } })).status()).toBe(200);
    const me = (await (await page.request.get('/api/auth/me')).json()).user;

    // The same address the PDF export opens (see api/src/pdf/pdf.service.ts)
    await page.goto(`/print/${pageId}?userId=${me.id}&userName=${encodeURIComponent(me.displayName)}`);
    await expect(page.getByText('Our stock:')).toBeVisible();
    await expect.poll(() => page.locator('.database-table input').evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value))).toContain(rowName);
    await expect(page.getByText(/Database not found/)).toHaveCount(0);
    // A PDF shows content, not editing controls
    await expect(page.getByRole('button', { name: 'Add row' })).toBeHidden();
  });

  test('sets up a compliance database from the page type picker', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId, { setupStatus: 'PENDING', title: unique('Compliance') });
    await page.goto(`/doc/${id}`);
    await main(page).getByRole('button', { name: /Compliance database/ }).click();
    const setup = dialog(page, 'Create compliance database');
    await expect(setup.getByPlaceholder('Field name').first()).toHaveValue('Item Name');
    await setup.getByRole('button', { name: 'Cancel' }).click();
    await expect(setup).toHaveCount(0);
    await expect(main(page).getByText('Or select from one of these page types:')).toBeVisible();

    await main(page).getByRole('button', { name: /Compliance database/ }).click();
    await setup.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(setup).toHaveCount(0);
    await expect.poll(async () => (await (await page.request.get(`/api/pages/${id}`)).json()).kind).toBe('DATABASE');
  });

  test("Tab stays inside a dialog, not reaching the page behind; Escape closes it and focus goes back", async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId, { title: 'Behind the dialog' });
    expect((await page.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Text' }] }] } } })).status()).toBe(200);
    await openPage(page, id);
    await main(page).getByRole('button', { name: 'Page actions' }).click();
    await page.getByText('Export', { exact: true }).click();
    const exporting = dialog(page, 'Export');
    await expect(exporting).toBeVisible();
    await expect(exporting).toHaveAttribute('role', 'dialog');
    const focusInside = () => exporting.evaluate((el) => el.contains(document.activeElement));
    await expect.poll(focusInside).toBe(true);
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press(i % 4 === 3 ? 'Shift+Tab' : 'Tab');
      expect(await focusInside()).toBe(true);
    }
    // The page's text wasn't indented by those Tabs (it was, each one)
    const indent = await page.evaluate(() => (document.querySelector('.ProseMirror') as any).editor.getJSON().content[0].attrs.indent);
    expect(indent ?? 0).toBe(0);
    await page.keyboard.press('Escape');
    await expect(exporting).toHaveCount(0);
    await expect(main(page).getByRole('button', { name: 'Page actions' })).toBeFocused();
  });

  test('Escape closes every dialog, and the user menu', async ({ alice: page, workspaceId }) => {
    const title = unique('Dialog page');
    await openPage(page, await createPage(page, workspaceId, { title }));
    const closesOnEscape = async (heading: string) => {
      const open = dialog(page, heading);
      await expect(open).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(open).toHaveCount(0);
    };

    await sidebar(page).getByRole('button', { name: '🗑️ Bin' }).click();
    await closesOnEscape('Rubbish bin');
    await sidebar(page).getByRole('button', { name: '📋 Templates' }).click();
    await closesOnEscape('Templates');
    await main(page).getByRole('button', { name: 'Page actions' }).click();
    await page.getByText('Save as template…', { exact: true }).click();
    await closesOnEscape('Save as template');

    const item = sidebarItem(page, title);
    for (const [action, heading] of [['Move to workspace…', 'Move to workspace'], ['Delete', 'Delete page']]) {
      await item.hover();
      await item.locator('.page-menu-btn').click();
      await page.locator('.page-menu').getByRole('button', { name: action }).click();
      // Not with focus on a button there, where Enter would act (Delete deleted the page)
      await expect(dialog(page, heading)).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe('BUTTON');
      await closesOnEscape(heading);
    }
    await expect(sidebarItem(page, title)).toBeVisible();

    await sidebar(page).locator('.user-switch').click();
    const menu = page.locator('.popover-card.context-menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('button', { name: 'Create workspace' }).click();
    await closesOnEscape('New workspace');
    await sidebar(page).locator('.user-switch').click();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(sidebar(page).locator('.user-switch')).toBeFocused();

    // In the Bin, Escape backs out of "delete for good" first, then closes it
    expect((await page.request.delete(`/api/pages/${await createPage(page, workspaceId, { title: 'Binned' })}`)).status()).toBe(200);
    await sidebar(page).getByRole('button', { name: '🗑️ Bin' }).click();
    const bin = dialog(page, 'Rubbish bin');
    await bin.getByRole('button', { name: 'Delete all' }).click();
    await expect(bin.getByRole('alertdialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(bin.getByRole('alertdialog')).toHaveCount(0);
    await expect(bin).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(bin).toHaveCount(0);
  });
});

