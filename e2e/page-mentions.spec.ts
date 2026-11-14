import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, editor, unique } from './fixtures';

// Page mentions: a page's icon and title in a line of text, kept up to date as the page changes.

const mentions = (page: Page) => editor(page).locator('[data-type="page-mention"] .page-mention__title');
const mentionIds = (page: Page) =>
  page.evaluate(() => {
    const ids: string[] = [];
    (document.querySelector('.ProseMirror:not(.page-hold *)') as any).editor.state.doc.descendants((node: any) => {
      if (node.type.name === 'pageMention') ids.push(node.attrs.pageId);
    });
    return ids;
  });
const linkEditor = (page: Page) => page.getByRole('dialog', { name: 'Link' });

test.describe('page mentions', () => {
  test('@ finds a page and puts it in the line; renaming the page renames the mention', async ({ alice: page, workspaceId }) => {
    const title = unique('Onboarding guide');
    const target = await createPage(page, workspaceId, { title });
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('See @', { delay: 30 });
    await page.keyboard.type(title.slice(0, 14), { delay: 30 });
    const choice = page.getByRole('option', { name: title });
    await expect(choice).toBeVisible();
    await page.keyboard.press('Enter');
    await page.keyboard.type('before Monday.', { delay: 20 });
    await expect.poll(() => mentionIds(page)).toEqual([target]);
    await expect(mentions(page)).toHaveText(title);
    // Renamed (by anyone): the mention shows the new title
    await page.request.patch(`/api/pages/${target}`, { data: { title: 'Renamed guide' } });
    await expect(mentions(page)).toHaveText('Renamed guide');
    // Saved: still there after a reload
    await page.reload();
    await expect(mentions(page)).toHaveText('Renamed guide');
    // A click opens the page
    await mentions(page).click();
    await expect(page).toHaveURL(new RegExp(`/doc/${target}`));
  });

  test('[[ finds pages too, and [[ an exact title ]] typed out becomes a mention', async ({ alice: page, workspaceId }) => {
    const title = unique('Office hours');
    const target = await createPage(page, workspaceId, { title });
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('[[', { delay: 30 });
    await page.keyboard.type(title.slice(0, 10), { delay: 30 });
    await expect(page.getByRole('option', { name: title })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect.poll(() => mentionIds(page)).toEqual([target]);
    await page.keyboard.type(' and ', { delay: 20 });
    await page.keyboard.type(`[[${title}]]`, { delay: 20 });
    await expect.poll(() => mentionIds(page)).toEqual([target, target]);
  });

  test("the link editor makes a mention of a page with no words chosen, and a link with words chosen", async ({ alice: page, workspaceId }) => {
    const title = unique('Handbook');
    const target = await createPage(page, workspaceId, { title });
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('/link', { delay: 30 });
    await page.keyboard.press('Enter');
    await linkEditor(page).getByLabel('Link', { exact: true }).fill(title.slice(0, 8));
    await linkEditor(page).getByRole('option', { name: title }).click();
    // Nothing chosen: a mention, unless asked otherwise
    await expect(linkEditor(page).getByLabel(/Show as a mention/)).toBeChecked();
    await linkEditor(page).getByLabel('Link', { exact: true }).press('Enter');
    await expect.poll(() => mentionIds(page)).toEqual([target]);

    await page.keyboard.type(' our handbook', { delay: 20 });
    await expect(async () => {
      for (let i = 0; i < 12; i += 1) await page.keyboard.press('Shift+ArrowLeft');
      await expect(page.locator('.bubble-menu').getByRole('button', { name: 'Bold' })).toBeVisible({ timeout: 500 });
    }).toPass();
    await page.keyboard.press('ControlOrMeta+k');
    await linkEditor(page).getByLabel('Link', { exact: true }).fill(title.slice(0, 8));
    await linkEditor(page).getByRole('option', { name: title }).click();
    await expect(linkEditor(page).getByLabel(/Show as a mention/)).not.toBeChecked();
    await linkEditor(page).getByRole('button', { name: 'Done' }).click();
    // Words chosen: they stay, linked to the page
    await expect.poll(() => mentionIds(page)).toEqual([target]);
    await expect(editor(page).locator(`a[href="/doc/${target}"]:not([data-type="page-mention"])`)).toHaveText('our handbook');
  });

  test("someone else's private page is mentioned without its title", async ({ alice, bob, workspaceId }) => {
    const secret = await createPage(alice, workspaceId, { title: unique('Alice only'), visibility: 'PRIVATE' });
    const shared = await createPage(alice, workspaceId);
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }, { type: 'pageMention', attrs: { pageId: secret } }] }] };
    expect((await alice.request.put(`/api/pages/${shared}/content`, { data: { content } })).status()).toBe(200);
    await openPage(bob, shared);
    await expect(mentions(bob)).toHaveText('Private page');
    await openPage(alice, shared);
    await expect(mentions(alice)).not.toHaveText('Private page');
  });

  test('a copied mention pastes as a mention, not linked words', async ({ alice: page, workspaceId }) => {
    const target = await createPage(page, workspaceId, { title: unique('Pasted') });
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.evaluate((id) => {
      const data = new DataTransfer();
      // What copying a mention puts on the clipboard (pageMention.js renderHTML)
      data.setData('text/html', `<p>See <a data-type="page-mention" data-page-id="${id}" href="/doc/${id}">@Pasted</a> now</p>`);
      data.setData('text/plain', 'See @Pasted now');
      document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, target);
    await expect.poll(() => mentionIds(page)).toEqual([target]);
  });

  test("an @ in a sentence doesn't keep a list open, and Escape gives the keys back", async ({ alice: page, workspaceId }) => {
    await createPage(page, workspaceId, { title: unique('Main hall') });
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    // Nothing matches "5pm in": the list goes, and Enter is a new line
    await page.keyboard.type('Meet @ 5pm in the hall', { delay: 20 });
    await expect(page.getByRole('listbox', { name: 'Pages' })).toHaveCount(0);
    await page.keyboard.press('Enter');
    // Escape on a list that matches: Enter is a new line, not the page
    await page.keyboard.type('Ask @main', { delay: 30 });
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await page.keyboard.type('next line', { delay: 20 });
    await expect.poll(() => mentionIds(page)).toEqual([]);
    await expect(editor(page).locator('p')).toHaveText(['Meet @ 5pm in the hall', 'Ask @main', 'next line']);
  });

  test('⌘K beside a mention edits it: unticked, it becomes words linked to the page; words typed make a link', async ({ alice: page, workspaceId }) => {
    const title = unique('Policies');
    const target = await createPage(page, workspaceId, { title });
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('@', { delay: 30 });
    await page.keyboard.type(title.slice(0, 8), { delay: 30 });
    await page.keyboard.press('Enter');
    await expect.poll(() => mentionIds(page)).toEqual([target]);
    // The cursor just after the mention (as a click there puts it), then ⌘K
    await page.evaluate(() => {
      const ed = (document.querySelector('.ProseMirror:not(.page-hold *)') as any).editor;
      let after = -1;
      ed.state.doc.descendants((node: any, pos: number) => {
        if (after < 0 && node.type.name === 'pageMention') after = pos + node.nodeSize;
      });
      ed.commands.setTextSelection(after);
    });
    await page.keyboard.press('ControlOrMeta+k');
    await expect(linkEditor(page).getByLabel(/Show as a mention/)).toBeChecked();
    await linkEditor(page).getByLabel(/Show as a mention/).uncheck();
    await linkEditor(page).getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => mentionIds(page)).toEqual([]);
    await expect(editor(page).locator(`a[href="/doc/${target}"]`)).toHaveText(title);

    // A page picked, then words typed: a link with those words
    await page.keyboard.press('End');
    await page.keyboard.type(' /link', { delay: 30 });
    await page.keyboard.press('Enter');
    await linkEditor(page).getByLabel('Link', { exact: true }).fill(title.slice(0, 8));
    await linkEditor(page).getByRole('option', { name: title }).click();
    await linkEditor(page).getByLabel('Text').fill('the rules');
    await linkEditor(page).getByRole('button', { name: 'Done' }).click();
    await expect(editor(page).locator(`a[href="/doc/${target}"]`).last()).toHaveText('the rules');
    await expect.poll(() => mentionIds(page)).toEqual([]);
  });
});
