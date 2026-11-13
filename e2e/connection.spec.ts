import { test, expect, createPage, openPage, editor, DEMO_PASSWORD } from './fixtures';
import type { Page } from '@playwright/test';

// Losing the connection and the session, and coming back from them on the page you were on.

const title = (page: Page) => page.getByRole('main').getByRole('textbox', { name: 'Untitled page' });
const notConnected = (page: Page) => page.getByRole('heading', { name: 'Not connected' });

test.describe('connection and session', () => {
  test('"Not connected" clears when the network is back, and Retry stays on the page you were on', async ({ alice: page, workspaceId }) => {
    await createPage(page, workspaceId, { title: 'First page' });
    const id = await createPage(page, workspaceId, { title: 'Where I was' });
    await openPage(page, id);
    await expect(title(page)).toHaveValue('Where I was');

    // The network goes and comes back: it clears by itself
    await page.context().setOffline(true);
    await expect(notConnected(page)).toBeVisible();
    await page.context().setOffline(false);
    await expect(notConnected(page)).toHaveCount(0);
    await expect(title(page)).toHaveValue('Where I was');
    expect(new URL(page.url()).pathname).toBe(`/doc/${id}`);

    // The server can't be reached though the network is there: Retry once it can, on the same page
    await page.route('**/api/**', (route) => route.abort());
    await page.context().setOffline(true);
    await expect(notConnected(page)).toBeVisible();
    await page.context().setOffline(false);
    await page.waitForTimeout(500);
    await expect(notConnected(page)).toBeVisible();
    await page.unroute('**/api/**');
    // (the check every few seconds may get there first)
    const retry = page.getByRole('button', { name: 'Retry' });
    if (await retry.isVisible()) await retry.click({ timeout: 2000 }).catch(() => {});
    await expect(notConnected(page)).toHaveCount(0);
    await expect(title(page)).toHaveValue('Where I was');
    await expect(editor(page)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/doc/${id}`);
  });

  test('a session that runs out says so at sign-in, and signing in goes back to the page', async ({ alice: page, workspaceId }) => {
    const first = await createPage(page, workspaceId, { title: 'First page' });
    const id = await createPage(page, workspaceId, { title: 'Where I was' });
    // The page the app would open after signing in by itself is "First page" (picked in the sidebar)...
    await openPage(page, first);
    await page.locator('aside.sidebar').getByText('First page', { exact: true }).click();
    // ...but the session runs out on "Where I was"
    await openPage(page, id);
    await expect(title(page)).toHaveValue('Where I was');
    await page.context().clearCookies();
    // The next request finds out
    await page.getByRole('button', { name: '📋 Templates' }).click();
    await expect(page.getByText('Your session expired. Sign in again to carry on where you were.')).toBeVisible();

    await page.getByRole('textbox', { name: 'Email or username' }).fill('alice');
    await page.getByRole('textbox', { name: 'Password' }).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(title(page)).toHaveValue('Where I was');
    expect(new URL(page.url()).pathname).toBe(`/doc/${id}`);
    await expect(page.getByText('Your session expired')).toHaveCount(0);
  });
});
