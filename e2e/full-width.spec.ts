import { expect } from '@playwright/test';
import { test, createPage, openPage } from './fixtures';

// Full width is the page's own setting, the same for everyone. It used to be kept in each browser.
const fullWidth = async (page: import('@playwright/test').Page) => {
  const body = page.locator('.page-body:not(.page-hold *)');
  await expect(body).toBeVisible();
  return body.evaluate((el) => el.classList.contains('page-body--full'));
};

test.describe('full width', () => {
  test('is the page\'s own: set by one person, seen by another', async ({ alice, bob, workspaceId }) => {
    const id = await createPage(alice, workspaceId);
    await openPage(alice, id);
    expect(await fullWidth(alice)).toBe(false);
    await alice.getByRole('button', { name: 'Page actions' }).click();
    await alice.getByRole('button', { name: 'Full Width Page' }).click();
    await expect.poll(() => fullWidth(alice)).toBe(true);
    await expect.poll(async () => (await (await alice.request.get(`/api/pages/${id}`)).json()).fullWidth).toBe(true);

    await openPage(bob, id);
    expect(await fullWidth(bob)).toBe(true);
  });

  test('set in this browser before it was the page\'s setting: moved onto the page', async ({ alice, bob, workspaceId }) => {
    const id = await createPage(alice, workspaceId);
    await alice.context().addInitScript((pageId) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(`wikid:page-full-width:${pageId}`, 'true');
        sessionStorage.setItem('seeded', '1');
      }
    }, id);
    await openPage(alice, id);
    await expect.poll(() => fullWidth(alice)).toBe(true);
    await expect.poll(async () => (await (await alice.request.get(`/api/pages/${id}`)).json()).fullWidth).toBe(true);
    expect(await alice.evaluate((pageId) => localStorage.getItem(`wikid:page-full-width:${pageId}`), id)).toBeNull();
    await openPage(bob, id);
    expect(await fullWidth(bob)).toBe(true);
  });
});
