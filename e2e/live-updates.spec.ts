import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, unique, editor } from './fixtures';

// Changes one person makes to the page tree show up for others without a reload.

const sidebarItem = (page: Page, title: string) =>
  page.getByRole('complementary').locator('.sidebar__item', { has: page.getByText(title, { exact: true }) });
const main = (page: Page) => page.getByRole('main');
const deletedNotice = (page: Page) => main(page).locator('.page-deleted-notice');
const isEditable = (page: Page) => page.evaluate(() => (document.querySelector('.ProseMirror') as any).editor.isEditable);

test.describe('live updates', () => {
  test('shows pages someone else creates, renames and deletes', async ({ alice, bob, workspaceId }) => {
    const start = await createPage(alice, workspaceId);
    await openPage(alice, start);
    await openPage(bob, start);

    const title = unique('Made by Alice');
    const created = await alice.request.post('/api/pages', { data: { workspaceId, title, kind: 'DOC', setupStatus: 'COMPLETE' } });
    const id = (await created.json()).id;
    await expect(sidebarItem(bob, title)).toBeVisible();

    const renamed = unique('Renamed by Alice');
    await alice.request.patch(`/api/pages/${id}`, { data: { title: renamed } });
    await expect(sidebarItem(bob, renamed)).toBeVisible();
    await expect(sidebarItem(bob, title)).toHaveCount(0);

    await alice.request.delete(`/api/pages/${id}`);
    await expect(sidebarItem(bob, renamed)).toHaveCount(0);
  });

  test("replaces the type picker when someone else picks the page's type", async ({ alice, bob, workspaceId }) => {
    const id = await createPage(alice, workspaceId, { setupStatus: 'PENDING', title: unique('New page') });
    await alice.goto(`/doc/${id}`);
    await bob.goto(`/doc/${id}`);
    for (const page of [alice, bob]) {
      await expect(main(page).getByText('Or select from one of these page types:')).toBeVisible();
    }

    await main(alice).getByRole('button', { name: /^Database Structured tables/ }).click();
    await expect(main(alice).getByRole('button', { name: 'Add row' })).toBeVisible();

    // Bob's screen follows without a reload: the picker is gone and the database is there.
    await expect(main(bob).getByText('Or select from one of these page types:')).toHaveCount(0);
    await expect(main(bob).getByRole('button', { name: 'Add row' })).toBeVisible();
  });

  test('tells you when someone else moves the page you have open to the Bin', async ({ alice, bob, workspaceId }) => {
    const title = unique('Shared page');
    const id = await createPage(alice, workspaceId, { title });
    await openPage(alice, id);
    expect(await isEditable(alice)).toBe(true);

    expect((await bob.request.delete(`/api/pages/${id}`)).status()).toBe(200);
    await expect(deletedNotice(alice)).toContainText('Bob moved this page to the Bin.');
    // While it's in the Bin, the page can't be edited here.
    await expect.poll(() => isEditable(alice)).toBe(false);
    await expect(main(alice).getByRole('textbox', { name: 'Untitled page' })).toHaveAttribute('readonly', '');
    await expect(sidebarItem(alice, title)).toHaveCount(0);

    await deletedNotice(alice).getByRole('button', { name: 'Restore' }).click();
    await expect(deletedNotice(alice)).toHaveCount(0);
    await expect(sidebarItem(alice, title)).toBeVisible();
    await expect.poll(() => isEditable(alice)).toBe(true);
    expect((await alice.request.get(`/api/pages/${id}`)).status()).toBe(200);
  });

  test('names the deleted parent page, and Close opens another page', async ({ alice, bob, workspaceId }) => {
    const otherTitle = unique('Other');
    const otherId = await createPage(alice, workspaceId, { title: otherTitle });
    const parentTitle = unique('Parent');
    const parentId = await createPage(alice, workspaceId, { title: parentTitle });
    const childId = await createPage(alice, workspaceId, { title: unique('Child'), parentId });
    await openPage(alice, childId);
    await expect(sidebarItem(alice, parentTitle)).toBeVisible();

    await bob.request.delete(`/api/pages/${parentId}`);
    await expect(deletedNotice(alice)).toContainText(`Bob moved "${parentTitle}" to the Bin, with this page inside it.`);

    await deletedNotice(alice).getByRole('button', { name: 'Close' }).click();
    await expect(deletedNotice(alice)).toHaveCount(0);
    await expect.poll(() => alice.url()).toContain(`/doc/${otherId}`);
    await expect(editor(alice)).toBeVisible();
  });

  test('clears the notice when someone else restores the page', async ({ alice, bob, workspaceId }) => {
    const id = await createPage(alice, workspaceId, { title: unique('Back again') });
    await openPage(alice, id);
    await bob.request.delete(`/api/pages/${id}`);
    await expect(deletedNotice(alice)).toBeVisible();
    await bob.request.patch(`/api/pages/${id}/restore`);
    await expect(deletedNotice(alice)).toHaveCount(0);
    await expect.poll(() => isEditable(alice)).toBe(true);
  });
});
