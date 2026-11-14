import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, unique, editor, signIn, USERS, DEMO_PASSWORD } from './fixtures';

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
  test('duplicates a page with what it has now, its icon and its subpages, next to it', async ({ alice: page, workspaceId }) => {
    const title = unique('Original');
    const id = await createPage(page, workspaceId, { title });
    await page.request.patch(`/api/pages/${id}`, { data: { icon: '📘' } });
    await createPage(page, workspaceId, { title: 'Child page', parentId: id });
    await openPage(page, id);
    await editor(page).click();
    await page.keyboard.type('Typed a moment ago', { delay: 20 });

    await openItemMenu(page, title);
    await page.locator('.page-menu').getByRole('button', { name: 'Duplicate' }).click();
    await expect(main(page).getByRole('textbox', { name: 'Untitled page' })).toHaveValue(`${title} copy`);
    await expect(editor(page)).toContainText('Typed a moment ago');
    const copy = sidebarItem(page, `${title} copy`);
    await expect(copy).toBeVisible();
    await expect(copy.locator('.page-icon').first()).toContainText('📘');
    const copyId = currentPageId(page);
    const pages = await (await page.request.get(`/api/pages?workspaceId=${workspaceId}`)).json();
    expect(pages.filter((p: any) => p.parentId === copyId).map((p: any) => p.title)).toEqual(['Child page']);
  });

  test('drags a page into the Private or Public section when that section is empty', async ({ alice: page, workspaceId }) => {
    const title = unique('Movable');
    const id = await createPage(page, workspaceId, { title });
    await openPage(page, id);
    const section = (name: string) => sidebar(page).locator(`.sidebar__section[data-section="${name}"]`);
    const visibility = async () => (await (await page.request.get(`/api/pages/${id}`)).json()).visibility;
    // The browser's drag events, sent ourselves: Playwright's dragTo doesn't fire them for the sidebar
    const dragTo = async (name: string) => {
      await sidebarItem(page, title).evaluate((row, name) => {
        const data = new DataTransfer();
        const heading = document.querySelector(`.sidebar__section[data-section="${name}"] .sidebar__section-title`)!;
        const box = heading.getBoundingClientRect();
        const at = { clientX: box.left + 20, clientY: box.top + box.height / 2, bubbles: true, cancelable: true, dataTransfer: data };
        row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data }));
        heading.dispatchEvent(new DragEvent('dragover', at));
        heading.dispatchEvent(new DragEvent('drop', at));
        row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }));
      }, name);
    };

    // A new workspace has no private pages: the section says so, and takes the drop
    await expect(section('private').locator('.sidebar__section-empty')).toHaveText('No private pages');
    await dragTo('private');
    await expect.poll(visibility).toBe('PRIVATE');
    await expect(section('private').locator('.sidebar__item', { hasText: title })).toBeVisible();
    await expect(section('public').locator('.sidebar__section-empty')).toHaveText('No public pages');

    // And back, now that Public is the empty one
    await dragTo('public');
    await expect.poll(visibility).toBe('PUBLIC');
    await expect(section('public').locator('.sidebar__item', { hasText: title })).toBeVisible();
  });

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
    await page.emulateMedia({ colorScheme: 'dark' });
    const title = unique('Pinned icon');
    const id = await createPage(page, workspaceId, { title });
    await page.request.patch(`/api/pages/${id}`, { data: { icon: 'icon:pin' } });
    await openPage(page, id);
    const textColour = await main(page).getByRole('textbox').first().evaluate((el) => getComputedStyle(el).color);
    for (const icon of [sidebarItem(page, title), main(page).locator('.page-icon-main')]) {
      await expect(icon.locator('svg').first()).toBeVisible();
      await expect(icon).not.toContainText('[object');
    }
    // With no colour chosen it's drawn in the text colour, not the browser's black for buttons
    await expect(main(page).locator('.page-icon-main svg')).toHaveCSS('color', textColour);
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

test.describe('nested pages in the sidebar', () => {
  // A chain eight levels deep (Level 1 > Level 2 > ... > Level 8), Level 2 with a sister after it
  async function deepTree(page: Page, workspaceId: string) {
    const titles = Array.from({ length: 8 }, (_, i) => unique(`Level ${i + 1}`));
    const sister = unique('Sister');
    const ids: string[] = [];
    for (const title of titles) ids.push(await createPage(page, workspaceId, { title, ...(ids.length ? { parentId: ids[ids.length - 1] } : {}) }));
    // Made last, so it comes after Level 2
    await createPage(page, workspaceId, { title: sister, parentId: ids[0] });
    await openPage(page, await createPage(page, workspaceId));
    for (const title of titles.slice(0, -1)) {
      await sidebarItem(page, title).hover();
      await sidebarItem(page, title).locator('.page-chevron').click();
    }
    await expect(sidebarItem(page, titles[7])).toBeVisible();
    return { titles, sister };
  }
  const titleBox = async (page: Page, title: string) => (await sidebarItem(page, title).locator('.sidebar__title').boundingBox())!;
  // How far each level is from the one above it, from the first level to the deepest
  const levelStep = async (page: Page, titles: string[]) => ((await titleBox(page, titles[7])).x - (await titleBox(page, titles[0])).x) / 7;
  async function dragSidebarEdgeTo(page: Page, x: number) {
    const handle = (await page.locator('[role="separator"][aria-orientation="vertical"]').first().boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, handle.y + handle.height / 2, { steps: 5 });
    await page.mouse.up();
  }

  test("levels share out the sidebar's width: closer together when it's narrow, further apart when it's wide", async ({ alice: page, workspaceId }) => {
    const { titles } = await deepTree(page, workspaceId);
    await dragSidebarEdgeTo(page, 220);
    // Each level a fixed step in from the last ran the deepest titles out of room
    expect((await titleBox(page, titles[7])).width).toBeGreaterThan(80);
    // The lines still read as joins (├─), not lines touching the icons
    const arms = await sidebar(page).locator('.tree-line--tee, .tree-line--elbow').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect(Math.min(...arms)).toBeGreaterThanOrEqual(5);
    const narrow = await levelStep(page, titles);
    await dragSidebarEdgeTo(page, 520);
    const wide = await levelStep(page, titles);
    expect(wide).toBeGreaterThan(narrow + 4);
    const side = (await sidebar(page).boundingBox())!;
    const deepest = await titleBox(page, titles[7]);
    expect(deepest.x + deepest.width).toBeLessThanOrEqual(side.x + side.width);
  });

  test('tree lines join each page to the one it is in', async ({ alice: page, workspaceId }) => {
    const { titles, sister } = await deepTree(page, workspaceId);
    // (Each row's joins; an open page's stem down to its pages isn't one)
    const lines = (title: string) => sidebarItem(page, title).locator('.tree-line[data-line]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.line));
    expect(await lines(titles[0])).toEqual([]);
    // Level 2 has its sister after it, so its line carries on down to her
    expect(await lines(titles[1])).toEqual(['tee']);
    expect(await lines(sister)).toEqual(['elbow']);
    // Level 3, in Level 2: Level 1's line passes it on the way to the sister
    expect(await lines(titles[2])).toEqual(['through', 'elbow']);
    expect(await lines(titles[3])).toEqual(['through', 'none', 'elbow']);

    // An open page with nothing inside: "No pages inside" joins its line, in line with it (it was a
    // pixel off, as that row had no border)
    await sidebarItem(page, sister).hover();
    await sidebarItem(page, sister).locator('.page-chevron').click();
    const empty = sidebar(page).locator('.page-empty');
    await expect(empty).toBeVisible();
    const stem = (await sidebarItem(page, sister).locator('.tree-line--stem').boundingBox())!;
    const join = (await empty.locator('.tree-line--elbow').boundingBox())!;
    expect(Math.abs(stem.x - join.x)).toBeLessThan(0.5);
    // ...and its words start clear of the join's arm
    const words = await empty.evaluate((el) => el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft));
    expect(words).toBeGreaterThan(join.x + join.width);
  });

  test("the lines can be turned off in Settings, and stay off for the account", async ({ browser }) => {
    // An account of its own: the setting is the account's, and the other tests' accounts are shared
    const adminContext = await browser.newContext();
    await signIn(adminContext, USERS.admin.email);
    const admin = adminContext.request;
    const email = `lines-${Date.now().toString(36)}@example.com`;
    const created = await admin.post('/api/admin/users?adminId=x', { data: { displayName: 'Lines', email, password: DEMO_PASSWORD, mustChangePassword: false } });
    expect(created.status()).toBe(201);
    const userId = (await created.json()).id;
    const context = await browser.newContext();
    try {
      await signIn(context, email);
      const page = await context.newPage();
      const made = await page.request.post('/api/workspaces', { data: { name: unique('Lines') } });
      expect(made.status(), await made.text()).toBe(201);
      const workspaceId = (await made.json()).workspace.id;
      const { titles } = await deepTree(page, workspaceId);
      const linesOf = (title: string) => sidebarItem(page, title).locator('.tree-line[data-line]');
      await expect(linesOf(titles[2])).toHaveCount(2);
      const setLines = async (on: boolean) => {
        await page.locator('.user-switch').click();
        await page.locator('.popover-card').getByRole('button', { name: 'Settings' }).click();
        await page.getByLabel('Show lines between nested pages').setChecked(on);
        await page.keyboard.press('Escape');
      };
      await setLines(false);
      await expect(sidebar(page).locator('.tree-line')).toHaveCount(0);
      // Kept for the account: still off after a reload (which closes the pages up again)
      await page.reload();
      await sidebarItem(page, titles[0]).hover();
      await sidebarItem(page, titles[0]).locator('.page-chevron').click();
      await expect(sidebarItem(page, titles[1])).toBeVisible();
      await expect(sidebar(page).locator('.tree-line')).toHaveCount(0);
      await setLines(true);
      await expect(linesOf(titles[1])).toHaveCount(1);
      await page.request.delete(`/api/workspaces/${workspaceId}`);
    } finally {
      await context.close();
      await admin.delete(`/api/admin/users/${userId}?adminId=x`);
      await adminContext.close();
    }
  });

  test('on a phone, the levels close up to fit the drawer', async ({ alice: page, workspaceId }) => {
    const { titles } = await deepTree(page, workspaceId);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.narrow-menu-btn, .topbar-sidebar-toggle').first().click();
    await expect(sidebarItem(page, titles[7])).toBeVisible();
    expect((await titleBox(page, titles[7])).width).toBeGreaterThan(80);
  });
});

test.describe('renaming from the sidebar', () => {
  test('reaches people with the page open, and leaves the page you are on alone', async ({ alice, bob, workspaceId }) => {
    const here = unique('Here');
    const there = unique('There');
    const hereId = await createPage(alice, workspaceId, { title: here });
    const thereId = await createPage(alice, workspaceId, { title: there });
    await openPage(alice, hereId);
    await openPage(bob, thereId);
    const titleBox = (page: Page) => main(page).getByRole('textbox', { name: 'Untitled page' });
    await expect(titleBox(bob)).toHaveValue(there);

    const renamed = `${there} renamed`;
    alice.once('dialog', (dialog) => dialog.accept(renamed));
    await openItemMenu(alice, there);
    await alice.locator('.page-menu').getByRole('button', { name: 'Rename' }).click();
    await expect(sidebarItem(alice, renamed)).toBeVisible();
    // Alice's own page keeps its title
    await expect(titleBox(alice)).toHaveValue(here);
    await alice.waitForTimeout(1500);
    expect((await (await alice.request.get(`/api/pages/${hereId}`)).json()).title).toBe(here);

    // Bob sees the new title, and his next edit to it builds on it
    await expect(titleBox(bob)).toHaveValue(renamed);
    await titleBox(bob).click();
    await bob.keyboard.press('End');
    await bob.keyboard.type('!', { delay: 30 });
    await expect.poll(async () => (await (await bob.request.get(`/api/pages/${thereId}`)).json()).title).toBe(`${renamed}!`);
  });
});

test.describe('the Bin', () => {
  test('"Delete all" asks first, and only the workspace owner gets it', async ({ alice, bob, workspaceId }) => {
    const title = unique('Binned');
    const id = await createPage(alice, workspaceId, { title });
    await alice.request.delete(`/api/pages/${id}`);
    const openBin = async (page: Page) => {
      await openPage(page, await createPage(alice, workspaceId));
      await sidebar(page).getByRole('button', { name: /Bin/ }).click();
      await expect(page.getByRole('heading', { name: 'Rubbish bin' })).toBeVisible();
    };

    // An editor can restore, but not delete for good
    await openBin(bob);
    await expect(bob.getByText(title)).toBeVisible();
    await expect(bob.getByRole('button', { name: 'Delete all' })).toHaveCount(0);

    await openBin(alice);
    await alice.getByRole('button', { name: 'Delete all' }).click();
    await expect(alice.getByText(/Delete 1 page for good\? This can't be undone\./)).toBeVisible();
    await alice.getByRole('button', { name: 'Cancel' }).click();
    expect((await alice.request.get(`/api/pages?workspaceId=${workspaceId}&includeDeleted=true`).then((r) => r.json())).some((p: any) => p.id === id)).toBe(true);
    await alice.getByRole('button', { name: 'Delete all' }).click();
    await alice.getByRole('button', { name: 'Delete for good' }).click();
    await expect.poll(async () => (await alice.request.get(`/api/pages?workspaceId=${workspaceId}&includeDeleted=true`).then((r) => r.json())).some((p: any) => p.id === id)).toBe(false);
  });
});
