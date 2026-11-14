import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, editor, unique, blockTexts } from './fixtures';

// Links in a page: the link editor (its text and where it goes, apart), and links to pages.

const linkEditor = (page: Page) => page.getByRole('dialog', { name: 'Link' });
const textField = (page: Page) => linkEditor(page).getByLabel('Text');
const linkField = (page: Page) => linkEditor(page).getByLabel('Link', { exact: true });
/** The page's links, as [text, href] pairs. */
const links = (page: Page) =>
  editor(page).locator('a').evaluateAll((els) => els.map((el) => [el.textContent, el.getAttribute('href')]));

/** Types the words, then selects them (once the text toolbar shows, they're selected). */
async function typeAndSelect(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.type(text, { delay: 20 });
  // (A selection straight after typing is held back by the editor's typing guard: retried)
  await expect(async () => {
    await page.keyboard.press('Shift+Home');
    await expect(page.locator('.bubble-menu').getByRole('button', { name: 'Bold' })).toBeVisible({ timeout: 500 });
  }).toPass();
}

test.describe('links', () => {
  test('the toolbar links the words chosen: the words stay, the address is its own', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await typeAndSelect(page, 'our handbook');
    await page.locator('.bubble-menu').getByRole('button', { name: 'Link' }).click();
    // It used to be the browser's one-box prompt
    await expect(textField(page)).toHaveValue('our handbook');
    await linkField(page).fill('example.com/handbook');
    await linkField(page).press('Enter');
    await expect(linkEditor(page)).toHaveCount(0);
    await expect.poll(() => links(page)).toEqual([['our handbook', 'https://example.com/handbook']]);
  });

  test("Ctrl+K with nothing chosen is still search; the slash menu adds a link with its own words", async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('Read ', { delay: 20 });
    // ⌘K is the app's search (it opened both, the search over the link editor)
    await page.keyboard.press('ControlOrMeta+k');
    await expect(linkEditor(page)).toHaveCount(0);
    await expect(page.locator('.search-backdrop')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.search-backdrop')).toHaveCount(0);
    await editor(page).click();
    await page.keyboard.press('End');
    await page.keyboard.type('/link', { delay: 30 });
    await page.keyboard.press('Enter');
    await textField(page).fill('the docs');
    await linkField(page).fill('https://example.com/docs');
    await linkField(page).press('Enter');
    // Straight on (the first key used to go nowhere, and the next word joined the link). A key in
    // the very same moment as Enter is still lost: 20ms later it isn't, sooner than anyone types.
    await page.waitForTimeout(50);
    await page.keyboard.type(' first.');
    await expect.poll(() => links(page)).toEqual([['the docs', 'https://example.com/docs']]);
    await expect(editor(page).locator('p')).toHaveText('Read the docs first.');
  });

  test('a link is changed or taken off from the editor, the cursor in it', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('/link', { delay: 30 });
    await page.keyboard.press('Enter');
    await textField(page).fill('old words');
    await linkField(page).fill('https://example.com/a');
    await linkField(page).press('Enter');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ControlOrMeta+k');
    await expect(textField(page)).toHaveValue('old words');
    await expect(linkField(page)).toHaveValue('https://example.com/a');
    await textField(page).fill('new words');
    await linkField(page).press('Enter');
    await expect.poll(() => links(page)).toEqual([['new words', 'https://example.com/a']]);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ControlOrMeta+k');
    await linkEditor(page).getByRole('button', { name: 'Remove link' }).click();
    await expect.poll(() => links(page)).toEqual([]);
    await expect(editor(page).locator('p')).toHaveText('new words');
  });

  test('the Link box finds pages; a page link opens the page here, not in a new tab', async ({ alice: page, workspaceId }) => {
    const title = unique('Onboarding guide');
    const target = await createPage(page, workspaceId, { title });
    await openPage(page, await createPage(page, workspaceId));
    await typeAndSelect(page, 'see the guide');
    await page.keyboard.press('ControlOrMeta+k');
    await linkField(page).fill(title.slice(0, 12));
    const suggestion = linkEditor(page).getByRole('option', { name: title });
    await expect(suggestion).toBeVisible();
    await suggestion.click();
    await expect(linkEditor(page)).toHaveCount(0);
    await expect.poll(() => links(page)).toEqual([['see the guide', `/doc/${target}`]]);

    let newTab = false;
    page.context().once('page', () => {
      newTab = true;
    });
    await editor(page).locator('a').click();
    await expect(page).toHaveURL(new RegExp(`/doc/${target}`));
    await expect(page.getByRole('main').getByRole('textbox', { name: 'Untitled page' }).or(page.locator('textarea.page-title'))).toHaveValue(title);
    expect(newTab).toBe(false);
  });

  test('the slash menu\'s Link opens the link editor', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('/link', { delay: 30 });
    await page.keyboard.press('Enter');
    await textField(page).fill('Wikid');
    await linkField(page).fill('example.com');
    await linkField(page).press('Enter');
    await expect.poll(() => links(page)).toEqual([['Wikid', 'https://example.com']]);
    await expect(editor(page).locator('p')).toHaveText('Wikid');
  });

  test('Escape closes the link editor and changes nothing', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await typeAndSelect(page, 'left alone');
    await page.keyboard.press('ControlOrMeta+k');
    await linkField(page).fill('example.com');
    await page.keyboard.press('Escape');
    await expect(linkEditor(page)).toHaveCount(0);
    await expect.poll(() => links(page)).toEqual([]);
    await expect(editor(page).locator('p')).toHaveText('left alone');
  });

  test("a link can't run code: a javascript: address is refused", async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await typeAndSelect(page, 'click me');
    await page.keyboard.press('ControlOrMeta+k');
    await linkField(page).fill('javascript:alert(document.cookie)');
    await linkField(page).press('Enter');
    await expect(linkEditor(page).getByRole('alert')).toContainText('web addresses');
    await page.keyboard.press('Escape');
    await expect.poll(() => links(page)).toEqual([]);
  });

  test('words chosen just after a link, or "/link" typed there, make a new link (not the one before)', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('/link', { delay: 30 });
    await page.keyboard.press('Enter');
    await textField(page).fill('docs');
    await linkField(page).fill('https://example.com/docs');
    await linkField(page).press('Enter');
    // "/link" right after it
    await page.waitForTimeout(50);
    await page.keyboard.type('/link', { delay: 30 });
    await page.keyboard.press('Enter');
    await expect(textField(page)).toHaveValue('');
    await expect(linkField(page)).toHaveValue('');
    await textField(page).fill(' guide');
    await linkField(page).fill('https://example.com/guide');
    await linkField(page).press('Enter');
    await expect.poll(() => links(page)).toEqual([['docs', 'https://example.com/docs'], [' guide', 'https://example.com/guide']]);
  });

  test('new words for a link keep their bold', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+b');
    await page.keyboard.type('bold words', { delay: 20 });
    await expect(async () => {
      await page.keyboard.press('Shift+Home');
      await expect(page.locator('.bubble-menu').getByRole('button', { name: 'Bold' })).toBeVisible({ timeout: 500 });
    }).toPass();
    await page.keyboard.press('ControlOrMeta+k');
    await textField(page).fill('still bold');
    await linkField(page).fill('example.com');
    await linkField(page).press('Enter');
    await expect(editor(page).locator('strong a, a strong')).toHaveText('still bold');
  });

  test("the link goes on the words chosen, though someone else typed before them meanwhile", async ({ alice, bob, workspaceId }) => {
    const id = await createPage(alice, workspaceId);
    await openPage(alice, id);
    await editor(alice).click();
    await alice.keyboard.type('Start. Link these words.', { delay: 15 });
    await openPage(bob, id);
    await expect(editor(bob)).toContainText('Link these words.');
    // "words" chosen
    await alice.waitForTimeout(300);
    await alice.evaluate(() => {
      const ed = (document.querySelector('.ProseMirror:not(.page-hold *)') as any).editor;
      let at = -1;
      ed.state.doc.descendants((node: any, pos: number) => {
        if (at < 0 && node.isText && node.text.includes('words')) at = pos + node.text.indexOf('words');
      });
      ed.commands.setTextSelection({ from: at, to: at + 'words'.length });
    });
    await alice.keyboard.press('ControlOrMeta+k');
    await expect(textField(alice)).toHaveValue('words');
    // Bob adds to the start of the line while Alice's link editor is open
    await editor(bob).locator('p').first().click();
    await bob.keyboard.press('Home');
    await bob.keyboard.type('Earlier. ', { delay: 15 });
    await expect.poll(() => blockTexts(alice)).toEqual(['Earlier. Start. Link these words.']);
    await linkField(alice).fill('https://example.com/words');
    await linkField(alice).press('Enter');
    await expect.poll(() => links(alice)).toEqual([['words', 'https://example.com/words']]);
    // (From the document: the page also shows Bob's cursor, with his name)
    await expect.poll(() => blockTexts(alice)).toEqual(['Earlier. Start. Link these words.']);
  });
});
