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

  // The page's save status, and every one it shows from now on
  const watchStatus = async (page: Page) => {
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as any).__statuses = seen;
      setInterval(() => {
        const text = document.querySelector('main .status-text')?.textContent?.trim();
        if (text && seen[seen.length - 1] !== text) seen.push(text);
      }, 50);
    });
    return () => page.evaluate(() => (window as any).__statuses as string[]);
  };
  const statusText = (page: Page) => page.locator('main .status-text');

  test('the network gone: the page says "Offline" at once, and "Saved" once it\'s back', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId, { title: 'Offline test' }));
    await editor(page).click();
    await page.keyboard.type('Before');
    await expect(statusText(page)).toHaveText('Saved');
    const seen = await watchStatus(page);
    await page.context().setOffline(true);
    await expect(statusText(page)).toHaveText('Offline', { timeout: 1500 });
    expect(await seen()).not.toContain('Saving...');
    await page.context().setOffline(false);
    await expect(statusText(page)).toHaveText('Saved', { timeout: 15000 });
  });

  test('the server not answering, though the connection is open: "Offline" after a few seconds, not "Saving…" on and on', async ({ alice: page, workspaceId }) => {
    // The live connection's messages dropped both ways from a point on, and the API unreachable
    let dead = false;
    await page.routeWebSocket(/\/collab/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => {
        if (!dead) server.send(message);
      });
      server.onMessage((message) => {
        if (!dead) ws.send(message);
      });
    });
    await openPage(page, await createPage(page, workspaceId, { title: 'Quiet server' }));
    await editor(page).click();
    await page.keyboard.type('Before');
    await expect(statusText(page)).toHaveText('Saved');
    dead = true;
    await page.route('**/api/**', (route) => route.abort());
    await page.keyboard.type(' more');
    await expect(statusText(page)).toHaveText('Saving...');
    await expect(statusText(page)).toHaveText('Offline', { timeout: 6000 });
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
