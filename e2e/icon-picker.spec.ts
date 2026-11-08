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
});
