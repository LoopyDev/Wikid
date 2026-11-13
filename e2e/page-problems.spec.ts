import { test, expect, createPage, openPage, editor, unique, USERS } from './fixtures';
import type { Page } from '@playwright/test';

// A link to a page that can't be opened: the reason in its place, at its address, and nothing
// left behind once you move on.

const problem = (page: Page) => page.locator('.page-problem');
const goTo = async (page: Page, id: string) => {
  await page.goto(`/doc/${id}`);
  await expect(page.locator('aside.sidebar')).toBeVisible();
};

test.describe("pages that can't be opened", () => {
  test('a page in the Bin: says so where the page would be, keeps its address, and Restore opens it', async ({ alice: page, workspaceId }) => {
    const other = await createPage(page, workspaceId, { title: 'Still here' });
    const binned = await createPage(page, workspaceId, { title: 'Binned page' });
    expect((await page.request.delete(`/api/pages/${binned}`)).status()).toBe(200);
    await openPage(page, other);
    await goTo(page, binned);
    await expect(problem(page).getByRole('heading')).toHaveText('This page is in the Bin');
    // Not under another page's title, and the address is still this page's
    await expect(editor(page)).toHaveCount(0);
    await expect(page.locator('.alert')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(`/doc/${binned}`);

    await problem(page).getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByRole('main').getByRole('textbox', { name: 'Untitled page' })).toHaveValue('Binned page');
    await expect(problem(page)).toHaveCount(0);
    await expect(page.locator('aside.sidebar').getByText('Binned page', { exact: true })).toBeVisible();
  });

  test("a page that doesn't exist, and one that's private to someone else; another page then opens as usual", async ({ alice, bob, workspaceId }) => {
    const shared = await createPage(alice, workspaceId, { title: 'Shared page' });
    const secret = await createPage(alice, workspaceId, { title: 'Alice only', visibility: 'PRIVATE' });

    // In the workspace (the sidebar shows its pages), then the links
    await openPage(bob, shared);
    await goTo(bob, '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b');
    await expect(problem(bob).getByRole('heading')).toHaveText("This page doesn't exist");
    expect(new URL(bob.url()).pathname).toBe('/doc/6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b');

    await goTo(bob, secret);
    await expect(problem(bob).getByRole('heading')).toHaveText("You can't open this page");
    await expect(bob.getByText('Alice only')).toHaveCount(0);

    // Moving on: the page opens, with nothing left over from before (an error used to stay on every page)
    await bob.locator('aside.sidebar').getByText('Shared page', { exact: true }).click();
    await expect(bob.getByRole('main').getByRole('textbox', { name: 'Untitled page' })).toHaveValue('Shared page');
    await expect(editor(bob)).toBeVisible();
    await expect(problem(bob)).toHaveCount(0);
    await expect(bob.locator('.alert')).toHaveCount(0);
    expect(new URL(bob.url()).pathname).toBe(`/doc/${shared}`);
  });

  test('an open page someone makes private, or moves to another workspace, says so in its place', async ({ alice, bob, workspaceId }) => {
    // Made private by its author
    const secret = await createPage(alice, workspaceId, { title: 'Soon private' });
    await openPage(bob, secret);
    await expect(editor(bob)).toBeVisible();
    expect((await alice.request.patch(`/api/pages/${secret}/visibility`, { data: { visibility: 'PRIVATE' } })).status()).toBe(200);
    await expect(problem(bob).getByRole('heading')).toHaveText(`You can't open "Soon private" any more`);
    await expect(editor(bob)).toHaveCount(0);

    // Moved to another workspace Bob is in: he can follow it there
    const created = await alice.request.post('/api/workspaces', { data: { name: unique('Elsewhere') } });
    const other = (await created.json()).workspace as { id: string; name: string };
    try {
      expect((await alice.request.post(`/api/workspaces/${other.id}/members`, { data: { email: USERS.bob.email, role: 'EDITOR' } })).status()).toBe(201);
      const moving = await createPage(alice, workspaceId, { title: 'On the move' });
      await openPage(bob, moving);
      await expect(editor(bob)).toBeVisible();
      expect((await alice.request.patch(`/api/pages/${moving}/workspace`, { data: { targetWorkspaceId: other.id } })).status()).toBe(200);
      await expect(problem(bob).getByRole('heading')).toHaveText(`"On the move" was moved to ${other.name}`);
      await problem(bob).getByRole('button', { name: 'Open it there' }).click();
      await expect(bob.getByRole('main').getByRole('textbox', { name: 'Untitled page' })).toHaveValue('On the move');
      await expect(problem(bob)).toHaveCount(0);
      await expect(bob.locator('aside.sidebar .user-name')).toHaveText(other.name);
    } finally {
      await alice.request.delete(`/api/workspaces/${other.id}`);
    }
  });
});

