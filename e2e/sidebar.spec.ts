import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, unique } from './fixtures';

const sidebar = (page: Page) => page.getByRole('complementary');
const main = (page: Page) => page.getByRole('main');
const sidebarItem = (page: Page, title: string) =>
  sidebar(page).locator('.sidebar__item', { has: page.getByText(title, { exact: true }) });
const currentPageId = (page: Page) => page.url().split('/doc/')[1].split(/[?#]/)[0];

/** Types a title into the page currently open. */
async function setTitle(page: Page, title: string) {
  const box = main(page).getByRole('textbox', { name: 'Untitled page' });
  await box.fill(title);
  await box.press('Enter');
  await expect(sidebarItem(page, title)).toBeVisible();
}

async function openItemMenu(page: Page, title: string) {
  const item = sidebarItem(page, title);
  await item.hover();
  await item.locator('.page-menu-btn').click();
}

test.describe('sidebar', () => {
  test('creates a page, renames it and adds a page inside it', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await sidebar(page).getByRole('button', { name: 'Public +' }).getByRole('button', { name: '+' }).click();
    await expect(main(page).getByText('Or select from one of these page types:')).toBeVisible();
    const parentTitle = unique('Parent');
    await setTitle(page, parentTitle);
    const parentId = currentPageId(page);

    // The "+" on a page in the sidebar adds a page inside it.
    const parent = sidebarItem(page, parentTitle);
    await parent.hover();
    await parent.getByRole('button', { name: '+' }).click();
    await expect.poll(() => currentPageId(page)).not.toBe(parentId);
    const childTitle = unique('Child');
    await setTitle(page, childTitle);
    const childId = currentPageId(page);

    // Titles save shortly after typing.
    await expect.poll(async () => (await page.request.get(`/api/pages/${childId}`)).json()).toMatchObject({ title: childTitle, parentId });
    await expect(sidebarItem(page, childTitle)).toHaveAttribute('data-depth', '1');
  });

  test('deletes a page to the bin and restores it', async ({ alice: page, workspaceId }) => {
    // Another page to land on after the delete.
    const otherTitle = unique('Other');
    await createPage(page, workspaceId, { title: otherTitle });
    const title = unique('Binned');
    const id = await createPage(page, workspaceId, { title });
    const childTitle = unique('Binned child');
    const childId = await createPage(page, workspaceId, { title: childTitle, parentId: id });
    await openPage(page, id);
    await expect(sidebarItem(page, otherTitle)).toBeVisible();
    await expect(sidebarItem(page, title)).toBeVisible();

    await openItemMenu(page, title);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = main(page).getByRole('heading', { name: 'Delete page' });
    await expect(dialog).toBeVisible();
    await expect(main(page).getByText(`You are about to delete "${title}"`)).toBeVisible();
    await main(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(sidebarItem(page, title)).toHaveCount(0);
    expect((await page.request.get(`/api/pages/${id}`)).status()).toBe(404);

    await sidebar(page).getByRole('button', { name: /Bin/ }).click();
    await expect(main(page).getByRole('heading', { name: 'Rubbish bin' })).toBeVisible();
    await main(page).getByRole('listitem').filter({ hasText: title }).first().getByRole('button', { name: 'Restore' }).click();
    // The page comes back with its sub-page, without a reload.
    await expect(sidebarItem(page, title)).toBeVisible();
    expect((await page.request.get(`/api/pages/${id}`)).status()).toBe(200);
    expect((await page.request.get(`/api/pages/${childId}`)).status()).toBe(200);
    await expect(main(page).getByRole('listitem').filter({ hasText: childTitle })).toHaveCount(0);
  });

  test("shows a page's menu in full, over the page next to the sidebar", async ({ alice: page, workspaceId }) => {
    const title = unique('Menu page');
    await openPage(page, await createPage(page, workspaceId, { title }));
    await openItemMenu(page, title);
    const del = page.locator('.page-menu').getByRole('button', { name: 'Delete', exact: true });
    await expect(del).toBeVisible();
    // The sidebar scrolls, which would clip a menu inside it: check the button is really on top.
    const box = (await del.boundingBox())!;
    const sidebarRight = (await sidebar(page).boundingBox())!;
    expect(box.x + box.width).toBeGreaterThan(sidebarRight.x + sidebarRight.width);
    const onTop = await del.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.left + r.width - 4, r.top + r.height / 2));
    });
    expect(onTop).toBe(true);
  });

  test("stays in the workspace after deleting its last page", async ({ alice: page, workspaceId }) => {
    const title = unique('Only page');
    const id = await createPage(page, workspaceId, { title });
    await openPage(page, id);
    const memberships = await (await page.request.get('/api/workspaces')).json();
    const workspaceName = memberships.find((m: any) => m.workspace?.id === workspaceId).workspace.name as string;
    await expect(sidebar(page).locator('.user-name')).toHaveText(workspaceName);

    await openItemMenu(page, title);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await main(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(sidebarItem(page, title)).toHaveCount(0);

    // Give any fallback a moment to kick in, then check nothing else was opened.
    await page.waitForTimeout(1500);
    await expect(sidebar(page).locator('.user-name')).toHaveText(workspaceName);
    expect(new URL(page.url()).pathname).toBe('/');
    await expect(page.locator('.ProseMirror')).toHaveCount(0);
  });

  test("lists the linked workspace's pages when opening a link", async ({ alice: page, workspaceId }) => {
    const otherTitle = unique('Other');
    await createPage(page, workspaceId, { title: otherTitle });
    const linked = await createPage(page, workspaceId);
    await openPage(page, linked);
    await expect(sidebarItem(page, otherTitle)).toBeVisible({ timeout: 5000 });
  });

  test('scrolls when there are more pages than fit, keeping the bin in view', async ({ alice: page, workspaceId }) => {
    const titles: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      titles.push(unique(`Long list ${String(i).padStart(2, '0')}`));
      await createPage(page, workspaceId, { title: titles[i] });
    }
    await openPage(page, await createPage(page, workspaceId));
    const bin = sidebar(page).getByRole('button', { name: /Bin/ });
    await expect(bin).toBeInViewport();

    const last = sidebarItem(page, titles[titles.length - 1]);
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await expect(bin).toBeInViewport();
    await last.click();
    await expect(main(page).getByRole('textbox', { name: 'Untitled page' })).toHaveValue(titles[titles.length - 1]);
  });
});
