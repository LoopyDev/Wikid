import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, blockTexts, placeCursor } from './fixtures';

// A page's history: versions as editing sessions, credited to who edited, and restoring one
// with everyone who has the page open seeing it.

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

const versions = async (page: Page, id: string) => (await (await page.request.get(`/api/pages/${id}/versions`)).json()) as any[];

const historyDialog = (page: Page) => page.getByRole('dialog', { name: 'Page history' });

async function openHistory(page: Page) {
  await page.locator('.topbar-menu-btn').click();
  await page.locator('.topbar-menu__dropdown').getByRole('button', { name: 'Page history' }).click();
  await expect(historyDialog(page)).toBeVisible();
}

const versionButtons = (page: Page) => historyDialog(page).getByRole('complementary', { name: 'Versions' }).getByRole('button');
const preview = (page: Page) => historyDialog(page).getByRole('region', { name: 'Version' });

test.describe('page history', () => {
  test('shows who edited each version, and restores one for everyone', async ({ alice, bob, workspaceId }) => {
    const id = await createPage(alice, workspaceId, { title: 'Plans' });
    expect((await alice.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content: [p('Original plan')] } } })).status()).toBe(200);
    // Restoring it as it is ends that version, so the edits below make a version of their own
    const [original] = await versions(alice, id);
    expect((await alice.request.post(`/api/pages/${id}/versions/${original.id}/restore`)).status()).toBe(201);

    await openPage(alice, id);
    await openPage(bob, id);
    await placeCursor(alice, 0, 'end');
    await alice.keyboard.type(', changed by Alice', { delay: 20 });
    await expect.poll(() => blockTexts(bob)).toEqual(['Original plan, changed by Alice']);
    await placeCursor(bob, 0, 'end');
    await bob.keyboard.type(' and Bob', { delay: 20 });
    await expect.poll(async () => (await versions(alice, id))[0]?.editors.map((e: any) => e.name).sort()).toEqual(['Alice', 'Bob']);

    await openHistory(alice);
    await expect(versionButtons(alice)).toHaveCount(2);
    await expect(versionButtons(alice).first()).toContainText('Current');
    await expect(versionButtons(alice).first()).toContainText(/Alice, Bob|Bob, Alice/);
    await expect(preview(alice)).toContainText('Original plan, changed by Alice and Bob');
    // The current version can't be restored over itself
    await expect(historyDialog(alice).getByRole('button', { name: 'Restore this version' })).toBeDisabled();

    await versionButtons(alice).nth(1).click();
    await expect(preview(alice)).toContainText('Original plan');
    await expect(preview(alice)).not.toContainText('changed by Alice');
    await historyDialog(alice).getByRole('button', { name: 'Restore this version' }).click();
    await expect(historyDialog(alice)).toHaveCount(0);

    await expect.poll(() => blockTexts(alice)).toEqual(['Original plan']);
    await expect.poll(() => blockTexts(bob)).toEqual(['Original plan']);

    // The restore is a version of its own, and the one before it is kept
    await openHistory(alice);
    await expect(versionButtons(alice)).toHaveCount(3);
    await expect(versionButtons(alice).first()).toContainText('Restored the version from');
    await expect(versionButtons(alice).first()).toContainText('Alice');
    await versionButtons(alice).nth(1).click();
    await expect(preview(alice)).toContainText('Original plan, changed by Alice and Bob');
  });

  test('shows what a version added, changed and removed', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId, { title: 'Checklist' });
    const put = async (content: unknown[]) =>
      expect((await page.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content } } })).status()).toBe(200);
    await put([p('Keep this'), p('Edit me'), p('Delete me')]);
    const [first] = await versions(page, id);
    const firstContent = (await (await page.request.get(`/api/pages/${id}/versions/${first.id}`)).json()).content;
    const [keep, edit, del] = firstContent.content.map((node: any) => node.attrs.id);
    // Restoring it as it is starts a new version for the edit below
    await page.request.post(`/api/pages/${id}/versions/${first.id}/restore`);
    const withId = (block: string, text: string) => ({ ...p(text), attrs: { id: block } });
    // An id of its own: given none, the new line would take the next free number, the removed line's
    await put([withId(keep, 'Keep this'), withId(edit, 'Edited'), withId('block-9', 'Added')]);

    await openPage(page, id);
    await openHistory(page);
    const changes = historyDialog(page).locator('.page-history__changes');
    await expect(changes).toContainText('1 added');
    await expect(changes).toContainText('1 changed');
    await expect(changes).toContainText('1 removed');
    const block = (blockId: string) => preview(page).locator(`[data-block-id="${blockId}"]`);
    // The removed line is shown where it was, struck through
    await expect(preview(page).locator('.ProseMirror > *')).toHaveText(['Keep this', 'Edited', 'Delete me', 'Added']);
    await expect(block(del)).toHaveCSS('text-decoration-line', 'line-through');
    const marked = (blockId: string) => block(blockId).evaluate((el) => getComputedStyle(el).boxShadow !== 'none');
    expect(await marked(edit)).toBe(true);
    expect(await marked('block-9')).toBe(true);
    expect(await marked(keep)).toBe(false);

    // Off: the version as it is
    await historyDialog(page).getByLabel('Show changes').uncheck();
    await expect(preview(page).locator('.ProseMirror > *')).toHaveText(['Keep this', 'Edited', 'Added']);
    expect(await marked(edit)).toBe(false);

    // The first version has nothing to compare with
    await versionButtons(page).nth(1).click();
    await expect(historyDialog(page)).toContainText('The first version');
  });

  test('a viewer can look through the history but not restore', async ({ alice, bob, workspaceId }) => {
    const id = await createPage(alice, workspaceId);
    expect((await alice.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content: [p('Read only')] } } })).status()).toBe(200);
    const bobId = (await (await bob.request.get('/api/auth/me')).json()).user.id;
    expect((await alice.request.patch(`/api/workspaces/${workspaceId}/members/${bobId}`, { data: { role: 'VIEWER' } })).status()).toBe(200);
    await bob.goto(`/doc/${id}`);
    await expect(bob.locator('.ProseMirror')).toContainText('Read only');

    await openHistory(bob);
    await expect(versionButtons(bob)).toHaveCount(1);
    await expect(preview(bob)).toContainText('Read only');
    await expect(historyDialog(bob).getByRole('button', { name: 'Restore this version' })).toHaveCount(0);
    await bob.keyboard.press('Escape');
    await expect(historyDialog(bob)).toHaveCount(0);
  });
});
