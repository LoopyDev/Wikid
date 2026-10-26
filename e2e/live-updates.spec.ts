import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, unique } from './fixtures';

// Changes one person makes to the page tree show up for others without a reload.

const sidebarItem = (page: Page, title: string) =>
  page.getByRole('complementary').locator('.sidebar__item', { has: page.getByText(title, { exact: true }) });
const main = (page: Page) => page.getByRole('main');

test.describe('live updates', () => {
  test('shows pages someone else creates, renames and deletes', async ({ alice, bob, workspaceId }) => {
    const start = await createPage(alice, workspaceId);
    await openPage(alice, start);
    await openPage(bob, start);

    const title = unique('Made by Alice');
    const created = await alice.request.post('/api/pages', { data: { workspaceId, title, kind: 'DOC', setupStatus: 'COMPLETE' } });
    const id = (await created.json()).id;
    await expect(sidebarItem(bob, title)).toBeVisible();

    const renamed = unique('Renamed by Alice');
    await alice.request.patch(`/api/pages/${id}`, { data: { title: renamed } });
    await expect(sidebarItem(bob, renamed)).toBeVisible();
    await expect(sidebarItem(bob, title)).toHaveCount(0);

    await alice.request.delete(`/api/pages/${id}`);
    await expect(sidebarItem(bob, renamed)).toHaveCount(0);
  });

  test("replaces the type picker when someone else picks the page's type", async ({ alice, bob, workspaceId }) => {
    const id = await createPage(alice, workspaceId, { setupStatus: 'PENDING', title: unique('New page') });
    await alice.goto(`/doc/${id}`);
    await bob.goto(`/doc/${id}`);
    for (const page of [alice, bob]) {
      await expect(main(page).getByText('Or select from one of these page types:')).toBeVisible();
    }

    await main(alice).getByRole('button', { name: /^Database Structured tables/ }).click();
    await expect(main(alice).getByRole('button', { name: 'Add row' })).toBeVisible();

    // Bob's screen follows without a reload: the picker is gone and the database is there.
    await expect(main(bob).getByText('Or select from one of these page types:')).toHaveCount(0);
    await expect(main(bob).getByRole('button', { name: 'Add row' })).toBeVisible();
  });
});
