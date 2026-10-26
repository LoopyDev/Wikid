import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, editor, USERS, signIn } from './fixtures';

// AI features show only when the server has AI set up, the admin hasn't switched it off, and the
// user hasn't hidden it. The test stack has AI set up when ANTHROPIC_API_KEY is set (CI sets a
// placeholder); otherwise only the "not set up" test runs.

const aiButton = (page: Page) => page.locator('.topbar-ai-btn');
const aiConfigured = async (page: Page) => {
  const context = await page.context().browser()!.newContext();
  await signIn(context, USERS.admin.email);
  const settings = await (await context.request.get('/api/admin/settings')).json();
  await context.close();
  return settings.ai.configured as boolean;
};

/** Selects the first paragraph's text so the text toolbar shows. */
async function selectText(page: Page) {
  await editor(page).click();
  await page.keyboard.type('Some words', { delay: 20 });
  await page.keyboard.press('Shift+Home');
  await expect(page.locator('.bubble-menu').filter({ has: page.getByRole('button', { name: 'Bold' }) })).toBeVisible();
}

test.describe('AI settings', () => {
  test('hides AI everywhere when the server has no AI set up', async ({ alice: page, workspaceId }) => {
    test.skip(await aiConfigured(page), 'AI is set up on this test stack');
    await openPage(page, await createPage(page, workspaceId));
    await expect(aiButton(page)).toHaveCount(0);
    await selectText(page);
    await expect(page.getByRole('button', { name: /Improve/ })).toHaveCount(0);
  });

  test('the admin switch and each person\'s own setting hide AI', async ({ alice: page, workspaceId, browser }) => {
    test.skip(!(await aiConfigured(page)), 'needs ANTHROPIC_API_KEY on the test stack');
    const id = await createPage(page, workspaceId);
    await openPage(page, id);
    await expect(aiButton(page)).toBeVisible();
    await selectText(page);
    await expect(page.getByRole('button', { name: /Improve/ })).toBeVisible();

    // Alice hides AI for herself in Settings.
    await page.keyboard.press('Escape');
    await page.locator('.user-switch').click();
    await page.locator('.popover-card').getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Show AI features').uncheck();
    await page.keyboard.press('Escape');
    await expect(aiButton(page)).toHaveCount(0);
    await page.reload();
    await expect(editor(page)).toBeVisible();
    await expect(aiButton(page)).toHaveCount(0);
    await page.locator('.user-switch').click();
    await page.locator('.popover-card').getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Show AI features').check();
    await page.keyboard.press('Escape');
    await expect(aiButton(page)).toBeVisible();

    // The admin switches AI off for everyone, in Admin → Settings.
    const adminContext = await browser.newContext();
    await signIn(adminContext, USERS.admin.email);
    const admin = await adminContext.newPage();
    await admin.goto('/');
    await admin.getByRole('complementary').getByRole('button', { name: /Settings/ }).click();
    const everyone = admin.getByLabel('Turn on AI features for everyone');
    await expect(everyone).toBeChecked();
    await everyone.uncheck();
    await expect.poll(async () => (await (await admin.request.get('/api/config')).json()).ai.available).toBe(false);
    await page.reload();
    await expect(editor(page)).toBeVisible();
    await expect(aiButton(page)).toHaveCount(0);

    await everyone.check();
    await expect.poll(async () => (await (await admin.request.get('/api/config')).json()).ai.available).toBe(true);
    await adminContext.close();
  });
});
