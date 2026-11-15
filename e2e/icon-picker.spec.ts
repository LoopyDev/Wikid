import { expect } from '@playwright/test';
import { test, createPage, openPage, unique } from './fixtures';

// Choosing a page's icon from Bootstrap Icons: searching by tag, and browsing by category.

test.describe('icon picker', () => {
  test("shows Wikid's own Recent row, not the emoji picker's unlabelled one of most-used emoji", async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId, { title: unique('Emoji') }));
    await page.locator('.page-icon-main').click();
    // Wikid's picker only: the emoji library inside it uses the same class name
    const picker = page.locator('css:light=.emoji-menu');
    // Playwright's locators reach inside the library's shadow root
    const emojiList = picker.locator('emoji-picker .emoji-menu[role="menu"]').first();
    await expect(picker.locator('emoji-picker [role="menuitem"]').first()).toBeVisible();
    // There, but hidden
    await expect(picker.locator('emoji-picker .favorites')).toHaveCount(1);
    await expect(picker.locator('emoji-picker .favorites')).toBeHidden();
    await expect(emojiList).toBeVisible();

    // Still hidden when the emoji tab is opened again (the picker is drawn afresh)
    await picker.getByRole('button', { name: 'Icons', exact: true }).click();
    await picker.getByRole('button', { name: 'Emoji', exact: true }).click();
    await expect(picker.locator('emoji-picker [role="menuitem"]').first()).toBeVisible();
    await expect(picker.locator('emoji-picker .favorites')).toBeHidden();

    // A chosen emoji goes in the Recent row
    await picker.locator('emoji-picker [role="menuitem"]').first().click();
    await expect(page.locator('.page-icon-main')).not.toHaveText('');
    if (!(await picker.isVisible())) await page.locator('.page-icon-main').click();
    await expect(picker.locator('.emoji-menu__section-title', { hasText: 'Recent' })).toBeVisible();
  });

  test('finds icons by tag, and browses them by category', async ({ alice: page, workspaceId }) => {
    const metaRequests: string[] = [];
    page.on('request', (req) => {
      if (/iconMeta/.test(req.url())) metaRequests.push(req.url());
    });
    const id = await createPage(page, workspaceId, { title: unique('Icons') });
    await openPage(page, id);
    // The categories and tags load only when they're needed
    expect(metaRequests).toEqual([]);

    await page.locator('.page-icon-main').click();
    const picker = page.locator('.emoji-menu');
    await picker.getByRole('button', { name: 'Icons', exact: true }).click();
    // "home" is a tag of "house", not part of its name
    await picker.getByLabel('Search icons').fill('home');
    await expect(picker.locator('button[title="house"]')).toBeVisible();
    expect(metaRequests.length).toBeGreaterThan(0);

    // Opened out: a category, then a search within it
    await picker.getByRole('button', { name: 'Browse', exact: true }).click();
    const browser = page.getByRole('dialog', { name: 'Browse icons' });
    await expect(browser).toBeVisible();
    await browser.getByLabel('Search icons').fill('');
    await browser.getByRole('button', { name: 'Real world', exact: true }).click();
    await expect(browser.getByRole('button', { name: 'Real world', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(browser.locator('button[title="house"]')).toBeVisible();
    await expect(browser.locator('button[title="arrow-left"]')).toHaveCount(0);
    await browser.getByLabel('Search icons').fill('coffee');
    await expect(browser.locator('button[title="cup-hot"]')).toBeVisible();
    await expect(browser.locator('button[title="house"]')).toHaveCount(0);

    // Escape closes it, leaving the picker open
    await page.keyboard.press('Escape');
    await expect(browser).toHaveCount(0);
    await expect(picker).toBeVisible();

    // Choosing from it sets the page's icon
    await picker.getByRole('button', { name: 'Browse', exact: true }).click();
    await browser.getByRole('button', { name: 'Real world', exact: true }).click();
    await browser.getByLabel('Search icons').fill('coffee');
    await browser.locator('button[title="cup-hot"]').click();
    await expect(browser).toHaveCount(0);
    await expect.poll(async () => (await (await page.request.get(`/api/pages/${id}`)).json()).icon).toBe('icon:cup-hot');
    await expect(page.locator('.page-icon-main svg')).toBeVisible();
  });

  test('icons chosen lately are in a Recent row on the Icons tab, in their colours, newest first', async ({ alice: page, workspaceId }) => {
    const icon = async (id: string) => (await (await page.request.get(`/api/pages/${id}`)).json()).icon;
    const picker = page.locator('css:light=.emoji-menu');
    const recent = picker.locator('.emoji-menu__grid--recent-icons button');
    const first = await createPage(page, workspaceId, { title: unique('First') });
    await openPage(page, first);
    await page.locator('.page-icon-main').click();
    await picker.getByRole('button', { name: 'Icons', exact: true }).click();
    // None yet
    await expect(recent).toHaveCount(0);

    // A red house, then a cup (red too)
    await picker.getByLabel('Select icon color').click();
    await picker.getByRole('listbox', { name: 'Icon color' }).getByRole('button', { name: 'Red', exact: true }).click();
    await picker.getByLabel('Search icons').fill('house');
    await picker.locator('button[title="house"]').click();
    await expect.poll(() => icon(first)).toBe('icon:house|#ef4444');
    if (!(await picker.isVisible())) await page.locator('.page-icon-main').click();
    // (It opens on the icon's tab, in its colour)
    await picker.getByLabel('Search icons').fill('coffee');
    await picker.locator('button[title="cup-hot"]').click();
    await expect.poll(() => icon(first)).toBe('icon:cup-hot|#ef4444');

    // On another page (and after a reload), newest first
    const second = await createPage(page, workspaceId, { title: unique('Second') });
    await openPage(page, second);
    await page.locator('.page-icon-main').click();
    await picker.getByRole('button', { name: 'Icons', exact: true }).click();
    await expect(picker.locator('.emoji-menu__section-title', { hasText: 'Recent' })).toBeVisible();
    await expect(recent).toHaveCount(2);
    await expect(recent.nth(0)).toHaveAttribute('title', 'cup-hot');
    await expect(recent.nth(1)).toHaveAttribute('title', 'house');
    // ...hidden while searching
    await picker.getByLabel('Search icons').fill('star');
    await expect(recent).toHaveCount(0);
    await picker.getByLabel('Search icons').fill('');
    // Chosen from there: as it was, red
    await recent.nth(1).click();
    await expect.poll(() => icon(second)).toBe('icon:house|#ef4444');

    // Opened again, it's on the icon's tab and colour; recoloured, the Recent row has it in its new one
    if (await picker.isVisible()) await page.keyboard.press('Escape');
    await page.locator('.page-icon-main').click();
    await expect(picker.getByLabel('Search icons')).toBeVisible();
    await expect(picker.getByLabel('Select icon color')).toHaveCSS('background-color', 'rgb(239, 68, 68)');
    await picker.getByLabel('Select icon color').click();
    await picker.getByRole('listbox', { name: 'Icon color' }).getByRole('button', { name: 'Green', exact: true }).click();
    await expect.poll(() => icon(second)).toBe('icon:house|#22c55e');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('wikid:recent-icons') || '[]'))).toEqual([
      'icon:house|#22c55e',
      'icon:house|#ef4444',
      'icon:cup-hot|#ef4444',
    ]);
  });
});
