import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, editor, unique } from './fixtures';

// Links typed the Markdown way: [words](address) becomes the words, linked, as the ")" is typed.
// After "[words](" a hint says so, and after "[words](/" pages are suggested.

/** The page's links, as [text, href] pairs. */
const links = (page: Page) =>
  editor(page).locator('a').evaluateAll((els) => els.map((el) => [el.textContent, el.getAttribute('href')]));
const hint = (page: Page) => page.getByText('Type an address, or / to link a page');

test.describe('Markdown links', () => {
  test('[words](address) becomes the words, linked, once the ")" is typed', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('Read [our handbook](', { delay: 20 });
    await expect(hint(page)).toBeVisible();
    await page.keyboard.type('example.com/handbook) first.', { delay: 20 });
    await expect.poll(() => links(page)).toEqual([['our handbook', 'https://example.com/handbook']]);
    await expect(editor(page).locator('p')).toHaveText('Read our handbook first.');
    await expect(hint(page)).toHaveCount(0);
  });

  test('Backspace straight after gives back what was typed', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('[docs](example.com)', { delay: 20 });
    await expect.poll(() => links(page)).toEqual([['docs', 'https://example.com']]);
    await page.keyboard.press('Backspace');
    await expect.poll(() => links(page)).toEqual([]);
    await expect(editor(page).locator('p')).toHaveText('[docs](example.com)');
  });

  test('an address that would run code is left as typed', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('[click](javascript:void) here', { delay: 20 });
    await expect.poll(() => links(page)).toEqual([]);
    await expect(editor(page).locator('p')).toHaveText('[click](javascript:void) here');
  });

  test('[words](/ suggests pages: one chosen links the words to it, leaving nothing else', async ({ alice: page, workspaceId }) => {
    const title = unique('Onboarding guide');
    const target = await createPage(page, workspaceId, { title });
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('See [the guide](/', { delay: 20 });
    await page.keyboard.type(title.slice(0, 10), { delay: 30 });
    const choice = page.getByRole('option', { name: title });
    await expect(choice).toBeVisible();
    await page.keyboard.press('Enter');
    await page.keyboard.type(' today.', { delay: 20 });
    await expect.poll(() => links(page)).toEqual([['the guide', `/doc/${target}`]]);
    await expect(editor(page).locator('p')).toHaveText('See the guide today.');
  });

  test('Escape hides the suggestions; typing on and ")" links to what was typed', async ({ alice: page, workspaceId }) => {
    await createPage(page, workspaceId, { title: unique('Notes') });
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('[my notes](/note', { delay: 30 });
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('option')).toHaveCount(0);
    await page.keyboard.type('s)', { delay: 30 });
    await expect.poll(() => links(page)).toEqual([['my notes', '/notes']]);
  });

  test('not in code', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('`[x](example.com)` and on', { delay: 20 });
    await expect.poll(() => links(page)).toEqual([]);
    await expect(editor(page).locator('code')).toHaveText('[x](example.com)');
  });

  test('the words keep their bold, and a page mention in them, when linked', async ({ alice: page, workspaceId }) => {
    const mentioned = await createPage(page, workspaceId, { title: unique('Roadmap') });
    const target = await createPage(page, workspaceId, { title: unique('Planning') });
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('[', { delay: 20 });
    await page.keyboard.press('ControlOrMeta+b');
    await page.keyboard.type('important', { delay: 20 });
    await page.keyboard.press('ControlOrMeta+b');
    await page.keyboard.type(' doc](example.com) and [see ', { delay: 20 });
    await expect(editor(page).locator('strong a, a strong')).toHaveText('important');
    // A mention in the words, then a page chosen for them: the mention stays
    await page.evaluate((id) => (document.querySelector('.ProseMirror:not(.page-hold *)') as any).editor.commands.insertContent([{ type: 'pageMention', attrs: { pageId: id } }, { type: 'text', text: ' notes' }]), mentioned);
    await page.keyboard.type('](/Plann', { delay: 30 });
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    const ids = await page.evaluate(() => {
      const found: string[] = [];
      (document.querySelector('.ProseMirror:not(.page-hold *)') as any).editor.state.doc.descendants((node: any) => {
        if (node.type.name === 'pageMention') found.push(node.attrs.pageId);
      });
      return found;
    });
    expect(ids).toEqual([mentioned]);
    // The words around it linked to the page
    await expect(editor(page).locator(`a[href="/doc/${target}"]:not([data-type="page-mention"])`).first()).toBeVisible();
    await expect(editor(page).locator('p')).toContainText('see');
    await expect(editor(page).locator('p')).toContainText('notes');
  });

  test("a page search can have spaces in it while it matches", async ({ alice: page, workspaceId }) => {
    const prefix = unique('Onboarding');
    const wanted = await createPage(page, workspaceId, { title: `${prefix} guide` });
    await createPage(page, workspaceId, { title: `${prefix} checklist` });
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type(`[the guide](/${prefix} g`, { delay: 20 });
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect.poll(() => links(page)).toEqual([['the guide', `/doc/${wanted}`]]);
  });

  test('an address with brackets in it, or "--", is linked as typed; an image stays an image', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('[Mercury](https://en.wikipedia.org/wiki/Mercury_(planet)) and [spec](example.com/rfc--draft) and [odd](a.com "a ](title") and ![logo](example.com/logo.png) end', { delay: 10 });
    await expect.poll(() => links(page)).toEqual([
      ['Mercury', 'https://en.wikipedia.org/wiki/Mercury_(planet)'],
      ['spec', 'https://example.com/rfc--draft'],
      // ("](" in its title too: the words end at the first one, the title left out)
      ['odd', 'https://a.com'],
    ]);
    // (The image is the image rule's: not made a link to it)
    await expect(editor(page).locator('img')).toHaveCount(1);
  });
});
