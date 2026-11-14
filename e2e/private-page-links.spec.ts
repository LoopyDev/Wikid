import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, editor, unique } from './fixtures';

// A mention of, or a link to, a private page on a page others can read: only its author can open
// it (everyone else sees "Private page"), so the author is told, and it shows a lock.

const note = (page: Page) => page.getByText('Only you can open this page; others will see “Private page”');
const linkEditor = (page: Page) => page.getByRole('dialog', { name: 'Link' });

test.describe('links to private pages', () => {
  test('on a page others can read: a note while choosing one, and a lock on it once put in', async ({ alice: page, workspaceId }) => {
    const title = unique('My notes');
    const secret = await createPage(page, workspaceId, { title, visibility: 'PRIVATE' });
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();

    // The @ list says so while the private page is the one highlighted
    await page.keyboard.type('See @', { delay: 30 });
    await page.keyboard.type(title.slice(0, 8), { delay: 30 });
    await expect(page.getByRole('option', { name: title })).toBeVisible();
    await expect(note(page)).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(editor(page).locator('[data-type="page-mention"] .page-mention__lock')).toBeVisible();
    // (A mention is in the text's own colour, not a link's: the editor's link colour won over it)
    const colours = await editor(page).locator('p').first().evaluate((p) => [getComputedStyle(p).color, getComputedStyle(p.querySelector('[data-type="page-mention"]')!).color]);
    expect(colours[1]).toBe(colours[0]);
    await expect(note(page)).toHaveCount(0);

    // So does the link editor, once it's picked; the linked words get the lock too
    await page.keyboard.type('and ', { delay: 20 });
    await page.keyboard.type('/link', { delay: 30 });
    await page.keyboard.press('Enter');
    await linkEditor(page).getByLabel('Text').fill('these notes');
    await linkEditor(page).getByLabel('Link', { exact: true }).fill(title.slice(0, 8));
    await linkEditor(page).getByRole('option', { name: title }).click();
    await expect(linkEditor(page).getByText('Only you can open this page; others will see “Private page”')).toBeVisible();
    await linkEditor(page).getByRole('button', { name: 'Done' }).click();
    await expect(editor(page).locator(`a[href="/doc/${secret}"] .page-link--private, a.page-link--private[href="/doc/${secret}"]`).first()).toHaveText('these notes');
  });

  test('on a private page (no one else reads it): no note, no lock', async ({ alice: page, workspaceId }) => {
    const title = unique('Other notes');
    await createPage(page, workspaceId, { title, visibility: 'PRIVATE' });
    await openPage(page, await createPage(page, workspaceId, { visibility: 'PRIVATE' }));
    await editor(page).click();
    await page.keyboard.type('@', { delay: 30 });
    await page.keyboard.type(title.slice(0, 8), { delay: 30 });
    await expect(page.getByRole('option', { name: title })).toBeVisible();
    await expect(note(page)).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(editor(page).locator('[data-type="page-mention"]')).toBeVisible();
    await expect(editor(page).locator('.page-mention__lock')).toHaveCount(0);
  });

  test('a page made private later gets the lock where it is mentioned, without anyone editing', async ({ alice: page, workspaceId }) => {
    const target = await createPage(page, workspaceId, { title: unique('Shared for now') });
    const id = await createPage(page, workspaceId);
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }, { type: 'text', text: 'this', marks: [{ type: 'link', attrs: { href: `/doc/${target}` } }] }] }] };
    expect((await page.request.put(`/api/pages/${id}/content`, { data: { content } })).status()).toBe(200);
    await openPage(page, id);
    await expect(editor(page).locator('.page-link--private')).toHaveCount(0);
    expect((await page.request.patch(`/api/pages/${target}/visibility`, { data: { visibility: 'PRIVATE' } })).status()).toBe(200);
    await expect(editor(page).locator('.page-link--private')).toHaveText('this');
  });
});
