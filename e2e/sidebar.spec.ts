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

  test("shows a page's icon from the icon set, in the sidebar and on the page", async ({ alice: page, workspaceId }) => {
    const title = unique('Pinned icon');
    const id = await createPage(page, workspaceId, { title });
    await page.request.patch(`/api/pages/${id}`, { data: { icon: 'icon:pin' } });
    await openPage(page, id);
    for (const icon of [sidebarItem(page, title), main(page).locator('.page-icon-main')]) {
      await expect(icon.locator('svg').first()).toBeVisible();
      await expect(icon).not.toContainText('[object');
    }
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

  test("restores a page whose parent is still in the bin: to the top level, or with its parent", async ({ alice: page, workspaceId }) => {
    const parentTitle = unique('Binned parent');
    const parentId = await createPage(page, workspaceId, { title: parentTitle });
    const firstTitle = unique('First child');
    await createPage(page, workspaceId, { title: firstTitle, parentId });
    const secondTitle = unique('Second child');
    await createPage(page, workspaceId, { title: secondTitle, parentId });
    await openPage(page, await createPage(page, workspaceId, { title: unique('Elsewhere') }));
    expect((await page.request.delete(`/api/pages/${parentId}`)).status()).toBe(200);
    await expect(sidebarItem(page, parentTitle)).toHaveCount(0);

    await sidebar(page).getByRole('button', { name: /Bin/ }).click();
    const bin = main(page);
    const restoreButton = (title: string) => bin.getByRole('listitem').filter({ hasText: title }).getByRole('button', { name: 'Restore' });

    // To the top level: the page shows in the sidebar straight away, and its parent stays in the bin.
    await restoreButton(firstTitle).click();
    const choice = bin.getByRole('group', { name: 'Where to restore the page' });
    await expect(choice).toContainText(`"${parentTitle}" is still in the Bin`);
    await choice.getByRole('button', { name: 'Restore to the top level' }).click();
    await expect(bin.getByRole('status')).toContainText(`Restored "${firstTitle}" to the top level`);
    await expect(sidebarItem(page, firstTitle)).toHaveAttribute('data-depth', '0');
    await expect(sidebarItem(page, parentTitle)).toHaveCount(0);

    // With its parent: both come back, the page in its old place.
    await restoreButton(secondTitle).click();
    await choice.getByRole('button', { name: `Restore with "${parentTitle}"` }).click();
    await expect(sidebarItem(page, parentTitle)).toBeVisible();
    await expect(sidebarItem(page, secondTitle)).toHaveAttribute('data-depth', '1');
    await expect(bin.getByRole('listitem').filter({ hasText: parentTitle })).toHaveCount(0);
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

  test("keeps a page highlighted while its menu is open, once the pointer leaves it", async ({ alice: page, workspaceId }) => {
    const title = unique('Menu page');
    await createPage(page, workspaceId, { title });
    await openPage(page, await createPage(page, workspaceId));
    const item = sidebarItem(page, title);
    const background = () => item.evaluate((el) => getComputedStyle(el).backgroundColor);
    await item.hover();
    await page.waitForTimeout(300); // its background fades in
    const hovered = await background();
    await openItemMenu(page, title);

    // Onto the menu, then right away from the sidebar
    await page.locator('.page-menu').getByRole('button', { name: 'Rename' }).hover();
    await expect.poll(background).toBe(hovered);
    await page.mouse.move(900, 500);
    await expect.poll(background).toBe(hovered);

    // Closing the menu lets it go
    await page.keyboard.press('Escape');
    await page.mouse.click(900, 500);
    await expect(page.locator('.page-menu')).toHaveCount(0);
    await expect.poll(background).not.toBe(hovered);
  });

  test("lights up the hovered page's whole branch, and keeps it lit moving between its pages", async ({ alice: page, workspaceId }) => {
    // First: Empty (expanded, with no pages inside), then Child, which has a Grandchild. Then Other.
    const name = (label: string) => unique(label);
    const t = { first: name('First'), empty: name('Empty'), child: name('Child'), grandchild: name('Grandchild'), other: name('Other'), otherChild: name('Other child') };
    const first = await createPage(page, workspaceId, { title: t.first });
    const empty = await createPage(page, workspaceId, { title: t.empty, parentId: first });
    const child = await createPage(page, workspaceId, { title: t.child, parentId: first });
    await createPage(page, workspaceId, { title: t.grandchild, parentId: child });
    const other = await createPage(page, workspaceId, { title: t.other });
    await createPage(page, workspaceId, { title: t.otherChild, parentId: other });
    await openPage(page, await createPage(page, workspaceId));
    for (const title of [t.first, t.empty, t.child, t.other]) {
      await sidebarItem(page, title).hover();
      await sidebarItem(page, title).locator('.page-chevron').click();
    }
    await expect(sidebar(page).getByText('No pages inside')).toBeVisible();
    await expect(sidebarItem(page, t.otherChild)).toBeVisible();

    const lit = async () => {
      const rows = await sidebar(page).locator('.sidebar__item.tree-hovered').allTextContents();
      return Object.entries(t).filter(([, title]) => rows.some((row) => row.includes(title))).map(([key]) => key);
    };
    await sidebarItem(page, t.empty).hover();
    await expect.poll(lit).toEqual(['first', 'child', 'grandchild']);
    // Onto a page at the same level: still the same branch, after the old one's linger is over
    await sidebarItem(page, t.child).hover();
    await page.waitForTimeout(500);
    await expect.poll(lit).toEqual(['first', 'empty', 'grandchild']);
    // Another branch
    await sidebarItem(page, t.otherChild).hover();
    await expect.poll(lit).toEqual(['other']);
    // And gone a moment after leaving the sidebar
    await page.mouse.move(900, 500);
    await expect.poll(lit).toEqual([]);
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
