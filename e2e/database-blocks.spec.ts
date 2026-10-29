import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, unique, waitForSaved, editor } from './fixtures';
import { main } from './database-helpers';

// Database view blocks: a database shown on a page, with its title, controls and views.

test.describe('database view blocks', () => {
  test("a database view block's view picker follows the theme", async ({ alice: page, workspaceId }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const db = await createPage(page, workspaceId, { title: unique('Viewed'), kind: 'DATABASE' });
    expect((await page.request.post(`/api/pages/${db}/database/views`, { data: { name: 'Open tasks', config: {} } })).status()).toBe(201);
    await openPage(page, await createPage(page, workspaceId));
    await page.evaluate((pageId) => {
      (document.querySelector('.ProseMirror') as any).editor.chain().focus('end').insertContent({ type: 'databaseView', attrs: { pageId } }).run();
    }, db);
    const picker = page.locator('.ce-database-view__view-select');
    await expect(picker).toBeVisible();
    await expect(picker.locator('option', { hasText: 'Open tasks' })).toHaveCount(1);
    // In the page's colours, not the browser's white select, and its list drawn dark too
    const textColour = await page.locator('.ProseMirror').evaluate((el) => getComputedStyle(el).color);
    await expect(picker).toHaveCSS('color', textColour);
    await expect(picker).not.toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(picker).toHaveCSS('color-scheme', 'dark');
  });

  test("a database view block's title opens the database, and can be hidden from the block's menu", async ({ alice: page, workspaceId }) => {
    const dbTitle = unique('Stock');
    const db = await createPage(page, workspaceId, { title: dbTitle, kind: 'DATABASE' });
    const doc = await createPage(page, workspaceId, { title: unique('Report') });
    await openPage(page, doc);
    await page.evaluate((pageId) => {
      (document.querySelector('.ProseMirror') as any).editor.chain().focus('end').insertContent({ type: 'databaseView', attrs: { pageId } }).run();
    }, db);
    const block = page.locator('.ce-database-view');
    const title = block.getByRole('button', { name: dbTitle });
    await expect(title).toBeVisible();

    // The title opens the database's own page
    await title.click();
    await page.waitForURL(`**/doc/${db}`);
    await expect(page.getByRole('main').getByRole('textbox').first()).toHaveValue(dbTitle);
    await openPage(page, doc);
    await expect(title).toBeVisible();

    // Hidden from the block's menu; the table and its buttons stay
    const toggleTitle = async () => {
      await block.hover();
      await page.locator('.drag-handle--floating:not(.drag-handle--list) .drag-handle__btn--drag').click();
      await page.locator('.block-menu').getByRole('button', { name: 'Show title' }).click();
    };
    await toggleTitle();
    await expect(block.locator('.ce-database-view__title')).toHaveCount(0);
    await expect(block.locator('.database-table')).toBeVisible();
    await waitForSaved(page);
    await page.reload();
    await expect(block.locator('.database-table')).toBeVisible();
    await expect(block.locator('.ce-database-view__title')).toHaveCount(0);
    await toggleTitle();
    await expect(title).toBeVisible();
  });

  test('the printed page keeps a database view block\'s title hidden, or shows it as a link', async ({ alice: page, workspaceId }) => {
    const dbTitle = unique('Stock');
    const db = await createPage(page, workspaceId, { title: dbTitle, kind: 'DATABASE' });
    const me = (await (await page.request.get('/api/auth/me')).json()).user;
    for (const showTitle of [false, true]) {
      const doc = await createPage(page, workspaceId, { title: unique('Report') });
      const content = { type: 'doc', content: [{ type: 'databaseView', attrs: { pageId: db, showTitle } }] };
      expect((await page.request.put(`/api/pages/${doc}/content`, { data: { content } })).status()).toBe(200);
      await page.goto(`/print/${doc}?userId=${me.id}&userName=${encodeURIComponent(me.displayName)}`);
      await expect(page.locator('.ce-database-view .database-table')).toBeVisible();
      await expect(page.locator('.ce-database-view').getByRole('button', { name: dbTitle })).toHaveCount(showTitle ? 1 : 0);
    }
  });

  test("a view chosen on a database view block is only for you, until you save it for everyone", async ({ alice, bob, workspaceId }) => {
    // A database with an "Only Apple" view, embedded on a page
    const db = await createPage(alice, workspaceId, { title: unique('Fruit'), kind: 'DATABASE' });
    const nameField = (await (await alice.request.get(`/api/pages/${db}/database`)).json()).fields.find((f: any) => f.name === 'Name').id;
    for (const fruit of ['Apple', 'Banana']) await alice.request.post(`/api/pages/${db}/database/rows`, { data: { data: { [nameField]: fruit } } });
    await alice.request.post(`/api/pages/${db}/database/fields`, { data: { name: 'Notes', type: 'TEXT' } });
    const view = await (await alice.request.post(`/api/pages/${db}/database/views`, {
      data: { name: 'Only Apple', config: { filters: { match: 'AND', rules: [{ fieldId: nameField, operator: 'contains', value: 'Apple' }] } } },
    })).json();
    const doc = await createPage(alice, workspaceId, { title: unique('Report') });
    await openPage(alice, doc);
    await alice.evaluate((pageId) => {
      (document.querySelector('.ProseMirror') as any).editor.chain().focus('end').insertContent({ type: 'databaseView', attrs: { pageId } }).run();
    }, db);
    await waitForSaved(alice);
    await openPage(bob, doc);

    const fruits = (page: Page) => page.locator('.ce-database-view tbody tr');
    const picker = (page: Page) => page.locator('.ce-database-view__view-select');
    const blockViewId = () => alice.evaluate(() => {
      const json = (document.querySelector('.ProseMirror') as any).editor.getJSON();
      return json.content.find((n: any) => n.type === 'databaseView')?.attrs?.viewId || null;
    });
    await expect(fruits(alice)).toHaveCount(2);
    await expect(fruits(bob)).toHaveCount(2);

    // Alice's choice changes only what she sees
    await picker(alice).selectOption({ label: 'Only Apple' });
    await expect(fruits(alice)).toHaveCount(1);
    await expect(alice.getByText('Only you see this')).toBeVisible();
    expect(await blockViewId()).toBeNull();
    await bob.waitForTimeout(500);
    await expect(fruits(bob)).toHaveCount(2);
    await expect(picker(bob)).toHaveValue('');

    // Remembered in her browser, and Reset goes back to the block's view
    await alice.reload();
    await expect(fruits(alice)).toHaveCount(1);
    await alice.getByRole('button', { name: 'Reset' }).click();
    await expect(fruits(alice)).toHaveCount(2);
    await expect(alice.getByText('Only you see this')).toHaveCount(0);

    // Hiding a column (on the block's own view) is hers alone too, until saved for everyone
    const notesHeader = (page: Page) => page.locator('.ce-database-view thead th', { hasText: 'Notes' });
    await expect(notesHeader(bob)).toHaveCount(1);
    await alice.locator('.ce-database-view').getByRole('button', { name: 'Columns' }).click();
    await alice.locator('.db-columns-menu__item', { hasText: 'Notes' }).click();
    await alice.keyboard.press('Escape');
    await alice.mouse.click(5, 5);
    await expect(notesHeader(alice)).toHaveCount(0);
    await expect(alice.getByText('Only you see this')).toBeVisible();
    await bob.waitForTimeout(500);
    await expect(notesHeader(bob)).toHaveCount(1);
    await alice.getByRole('button', { name: 'Save for everyone' }).click();
    await expect(alice.getByText('Only you see this')).toHaveCount(0);
    await expect(notesHeader(bob)).toHaveCount(0);

    // A view saved for everyone: Bob sees it too
    await picker(alice).selectOption({ label: 'Only Apple' });
    await alice.getByRole('button', { name: 'Save for everyone' }).click();
    await expect(alice.getByText('Only you see this')).toHaveCount(0);
    expect(await blockViewId()).toBe(view.id);
    await expect(picker(bob)).toHaveValue(view.id);
    await expect(fruits(bob)).toHaveCount(1);
  });

  test("a database view block's controls can be turned off, showing everyone the block's own view", async ({ alice: page, workspaceId }) => {
    const db = await createPage(page, workspaceId, { title: unique('Fruit'), kind: 'DATABASE' });
    const nameField = (await (await page.request.get(`/api/pages/${db}/database`)).json()).fields.find((f: any) => f.name === 'Name').id;
    for (const fruit of ['Apple', 'Banana']) await page.request.post(`/api/pages/${db}/database/rows`, { data: { data: { [nameField]: fruit } } });
    await page.request.post(`/api/pages/${db}/database/views`, {
      data: { name: 'Only Apple', config: { filters: { match: 'AND', rules: [{ fieldId: nameField, operator: 'contains', value: 'Apple' }] } } },
    });
    const doc = await createPage(page, workspaceId, { title: unique('Report') });
    await openPage(page, doc);
    await page.evaluate((pageId) => {
      (document.querySelector('.ProseMirror') as any).editor.chain().focus('end').insertContent({ type: 'databaseView', attrs: { pageId } }).run();
    }, db);
    const block = page.locator('.ce-database-view');
    const fruits = block.locator('tbody .db-cell-input');
    await expect(fruits).toHaveCount(2);
    // A choice of her own first
    await block.locator('.ce-database-view__view-select').selectOption({ label: 'Only Apple' });
    await expect(fruits).toHaveCount(1);

    await block.hover();
    await page.locator('.drag-handle--floating:not(.drag-handle--list) .drag-handle__btn--drag').click();
    await page.locator('.block-menu').getByRole('button', { name: 'Show controls' }).click();
    // The picker, Columns and search go, and the block's own view shows, not her choice
    await expect(block.locator('.ce-database-view__header-controls')).toBeHidden();
    await expect(block.getByRole('button', { name: 'Columns' })).toBeHidden();
    await expect(fruits).toHaveCount(2);
    await waitForSaved(page);
    await page.reload();
    await expect(fruits).toHaveCount(2);
    await expect(block.locator('.ce-database-view__header-controls')).toBeHidden();
  });
});
