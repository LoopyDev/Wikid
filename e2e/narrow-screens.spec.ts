import { test, expect, createPage, openPage, editor, blockTexts, signIn, USERS } from './fixtures';
import type { Page } from '@playwright/test';

// A tablet upright and a phone: the sidebar is a drawer over the page, and nothing runs off the side.

const sidebar = (page: Page) => page.locator('aside.sidebar');
const menuButton = (page: Page) => page.getByRole('main').getByRole('button', { name: 'Show sidebar' });
// The sidebar is on the screen
const sidebarShowing = (page: Page) =>
  sidebar(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.right > 1 && getComputedStyle(el).opacity !== '0';
  });
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test.describe('narrow screens', () => {
  test('a tablet: the sidebar is a drawer, opened from the top bar, closed by picking a page, a tap beside it or Escape', async ({ alice: page, workspaceId }) => {
    const first = await createPage(page, workspaceId, { title: 'First page' });
    await createPage(page, workspaceId, { title: 'Second page' });
    await page.setViewportSize({ width: 820, height: 1180 });
    await openPage(page, first);
    // The page has the width, with nothing over it
    await expect.poll(() => sidebarShowing(page)).toBe(false);
    expect(await fitsWidth(page)).toBe(true);
    const box = (await editor(page).boundingBox())!;
    expect(box.x).toBeLessThan(80);

    // Open it, and pick a page: that page opens, and the drawer closes
    await menuButton(page).click();
    await expect.poll(() => sidebarShowing(page)).toBe(true);
    await sidebar(page).getByText('Second page', { exact: true }).click();
    await expect(page.getByRole('main').getByRole('textbox', { name: 'Untitled page' })).toHaveValue('Second page');
    await expect.poll(() => sidebarShowing(page)).toBe(false);

    // Picking the page already open closes it too
    await menuButton(page).click();
    await expect.poll(() => sidebarShowing(page)).toBe(true);
    await sidebar(page).getByText('Second page', { exact: true }).click();
    await expect.poll(() => sidebarShowing(page)).toBe(false);

    // A tap beside it closes it; so does Escape; and hovering the menu button doesn't open it
    await menuButton(page).click();
    await expect.poll(() => sidebarShowing(page)).toBe(true);
    await page.locator('.sidebar-drawer-backdrop').click({ position: { x: 700, y: 600 } });
    await expect.poll(() => sidebarShowing(page)).toBe(false);
    await menuButton(page).click();
    await expect.poll(() => sidebarShowing(page)).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => sidebarShowing(page)).toBe(false);
    await menuButton(page).hover();
    await page.waitForTimeout(400);
    expect(await sidebarShowing(page)).toBe(false);

    // Its own close button
    await menuButton(page).click();
    await sidebar(page).getByRole('button', { name: 'Close sidebar' }).click();
    await expect.poll(() => sidebarShowing(page)).toBe(false);

    // Wide again: the sidebar is back beside the page, as it was (the drawer didn't change that)
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect.poll(() => sidebarShowing(page)).toBe(true);
    await expect(page.locator('.sidebar-drawer-backdrop')).toHaveCount(0);
  });

  test('a phone: the page fits and takes typing, the top bar names the page, and settings fit', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId, { title: 'Notes with a long title for a phone screen' });
    const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    expect((await page.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content: [p('A line of text long enough to wrap on a phone, and then some more.')] } } })).status()).toBe(200);
    await page.setViewportSize({ width: 390, height: 844 });
    await openPage(page, id);
    await expect(editor(page)).toContainText('A line of text');
    expect(await fitsWidth(page)).toBe(true);
    await expect.poll(() => sidebarShowing(page)).toBe(false);
    // The text uses the width (it had about a hundred pixels of gutter each side)
    const line = (await editor(page).locator('p').first().boundingBox())!;
    expect(line.width).toBeGreaterThan(320);
    // The top bar names the page you're on
    await expect(page.getByRole('main').locator('.crumbs > :last-child')).toHaveText('Notes with a long title for a phone screen');
    await expect(page.getByRole('main').locator('.crumbs > :last-child')).toBeVisible();

    await editor(page).locator('p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Typed.', { delay: 20 });
    await expect.poll(() => blockTexts(page)).toEqual(['A line of text long enough to wrap on a phone, and then some more. Typed.']);

    // Settings: its sections along the top, the section itself the width of the screen
    await menuButton(page).click();
    await sidebar(page).locator('.user-switch').click();
    await page.getByText('Settings', { exact: true }).click();
    await expect(page.locator('.settings-popup-card')).toBeVisible();
    await expect.poll(() => sidebarShowing(page)).toBe(false);
    const content = (await page.locator('.settings-popup-content').boundingBox())!;
    expect(content.width).toBeGreaterThan(330);
    expect(await fitsWidth(page)).toBe(true);
  });

  test("an admin view, which has no top bar, has its own button for the drawer", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 820, height: 1180 } });
    await signIn(context, USERS.admin.email);
    const page = await context.newPage();
    await page.goto('/');
    const open = page.locator('.narrow-menu-btn, .topbar-sidebar-toggle').first();
    await open.click();
    await expect.poll(() => sidebarShowing(page)).toBe(true);
    await sidebar(page).getByText('Users', { exact: true }).click();
    // The admin view, the drawer gone, and a way back to it
    await expect.poll(() => sidebarShowing(page)).toBe(false);
    await page.locator('.narrow-menu-btn').click();
    await expect.poll(() => sidebarShowing(page)).toBe(true);
    await context.close();
  });

  test("the sidebar doesn't scroll sideways, on a laptop or in a phone's drawer", async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId, { title: 'A page' });
    await createPage(page, workspaceId, { title: 'A subpage with a long enough title to need cutting short', parentId: id });
    const sideways = () => sidebar(page).evaluate((el) => el.scrollWidth - el.clientWidth);
    await page.setViewportSize({ width: 1400, height: 900 });
    await openPage(page, id);
    await expect.poll(() => sidebarShowing(page)).toBe(true);
    expect(await sideways()).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await menuButton(page).click();
    await expect.poll(() => sidebarShowing(page)).toBe(true);
    expect(await sideways()).toBe(0);
  });
});

