import { expect } from '@playwright/test';
import { test, createPage, editor, blockTexts, outline, waitForSaved } from './fixtures';

// The first letter typed on a new page makes it a regular page, and the editor it was typed in
// hands over to the live one; quick typing used to lose a letter in that handover. It's a race,
// so it's typed at a few speeds.
test.describe('typing straight away on a new page', () => {
  for (const delay of [25, 40, 60]) {
    test(`keeps every letter, in order, at ${delay}ms a key`, async ({ alice, workspaceId }) => {
      const id = await createPage(alice, workspaceId, { setupStatus: 'PENDING' });
      await alice.goto(`/doc/${id}`);
      await alice.waitForFunction(() => {
        const el = document.querySelector('.ProseMirror') as any;
        return !!el?.editor && el.getAttribute('contenteditable') === 'true';
      });
      await editor(alice).click();
      const text = 'The quick brown fox jumps over the lazy dog';
      await alice.keyboard.type(text, { delay });
      await expect.poll(async () => (await blockTexts(alice)).join('|')).toBe(text);
      await alice.keyboard.type('!');
      await expect.poll(async () => (await blockTexts(alice)).join('|')).toBe(`${text}!`);
    });
  }
});

// A page started as a list or a heading ("- ", "# ", "1. " typed first) stays one through the handover:
// a bullet came back as "- First" or "-First", and the next letters after a heading went onto a
// line of their own
test.describe('a new page started with Markdown, typed straight away', () => {
  const cases: Array<[string, string[]]> = [
    ['- First item', ['bulletList', '  listItem', '    paragraph: First item']],
    ['# A heading', ['heading1: A heading']],
    ['1. Numbered', ['orderedList', '  listItem', '    paragraph: Numbered']],
    // A task list: now and then it came out empty, or twice
    ['[] A task', ['taskList', '  taskItem', '    paragraph: A task']],
    ['[ ] A task', ['taskList', '  taskItem', '    paragraph: A task']],
    // (The cursor carried across: put at the end of what was typed, it went back up a line)
    ['Hello\nWorld', ['paragraph: Hello', 'paragraph: World']],
  ];
  for (const [typed, expected] of cases) {
    for (const delay of [25, 40]) {
      test(`"${typed.replace(/\n/g, '⏎')}" at ${delay}ms a key`, async ({ alice, workspaceId }) => {
        const id = await createPage(alice, workspaceId, { setupStatus: 'PENDING' });
        await alice.goto(`/doc/${id}`);
        await alice.waitForFunction(() => {
          const el = document.querySelector('.ProseMirror') as any;
          return !!el?.editor && el.getAttribute('contenteditable') === 'true';
        });
        await editor(alice).click();
        await alice.keyboard.type(typed, { delay });
        await expect.poll(() => outline(alice)).toEqual(expected);
      });
    }
  }
});

// "/" typed first on a new page opens the slash menu, though the editor it was typed in hands over to
// the live one while it's open (that rebuilds the menu's plugin view, which used to lose the menu)
test('the slash menu opens on a new page, and stays open as the live editor takes over', async ({ alice, workspaceId }) => {
  const id = await createPage(alice, workspaceId, { setupStatus: 'PENDING' });
  await alice.goto(`/doc/${id}`);
  await alice.waitForFunction(() => {
    const el = document.querySelector('.ProseMirror') as any;
    return !!el?.editor && el.getAttribute('contenteditable') === 'true';
  });
  await editor(alice).click();
  await alice.keyboard.type('/', { delay: 40 });
  const menu = alice.locator('.slash-menu');
  await expect(menu).toBeVisible();
  // Long enough for the handover to have happened
  await alice.waitForTimeout(1500);
  await expect(menu).toBeVisible();
  await alice.keyboard.type('heading', { delay: 40 });
  await expect(menu.locator('.slash-item--active')).toContainText('Heading 1');
  await alice.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await alice.keyboard.type('Title', { delay: 30 });
  await expect.poll(() => outline(alice)).toEqual(['heading1: Title']);
});

// A new page made from the sidebar goes straight to its editor: it showed, then "Loading page..."
// in its place for a moment (the page loaded again), then the editor again
test('a new page from the sidebar shows its editor straight away, with no "Loading page" in between', async ({ alice, workspaceId }) => {
  void workspaceId;
  await alice.goto('/');
  await expect(alice.getByRole('complementary').getByRole('button', { name: 'Public +' })).toBeVisible();
  // Everything the page body shows from here on, as it changes
  await alice.evaluate(() => {
    (window as any).seen = [];
    const note = () => {
      const loading = [...document.querySelectorAll('.page-body-slot .muted')].some((el) => el.textContent?.includes('Loading page'));
      const editor = !!document.querySelector('.page-body-slot .ProseMirror');
      const last = (window as any).seen.at(-1);
      const now = loading ? 'loading' : editor ? 'editor' : 'other';
      if (now !== last) (window as any).seen.push(now);
    };
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const before = alice.url();
  await alice.getByRole('complementary').getByRole('button', { name: 'Public +' }).getByRole('button', { name: '+' }).click();
  await expect.poll(() => alice.url()).not.toBe(before);
  await expect(alice.locator('.page-body-slot .ProseMirror')).toBeVisible();
  // Past when the page's news (that it was made) comes back, and what that set off
  await alice.waitForTimeout(1500);
  const seen: string[] = await alice.evaluate(() => (window as any).seen);
  // From the click on: never "Loading page", and the new page's editor at the end
  expect(seen).not.toContain('loading');
  expect(seen.at(-1)).toBe('editor');
});

// A to-do list chosen from the slash menu first thing on a new page: now and then the page came out
// empty, or with the list twice
for (const delay of [25, 40]) {
  test(`a to-do list from the slash menu on a new page, typed into at ${delay}ms a key`, async ({ alice, workspaceId }) => {
    const id = await createPage(alice, workspaceId, { setupStatus: 'PENDING' });
    await alice.goto(`/doc/${id}`);
    await alice.waitForFunction(() => {
      const el = document.querySelector('.ProseMirror') as any;
      return !!el?.editor && el.getAttribute('contenteditable') === 'true';
    });
    await editor(alice).click();
    await alice.keyboard.type('/todo', { delay });
    await expect(alice.locator('.slash-menu .slash-item--active')).toContainText('To-do list');
    await alice.keyboard.press('Enter');
    await alice.keyboard.type('Buy milk', { delay });
    await alice.keyboard.press('Enter');
    await alice.keyboard.type('Post letter', { delay });
    const expected = ['taskList', '  taskItem', '    paragraph: Buy milk', '  taskItem', '    paragraph: Post letter'];
    await expect.poll(() => outline(alice)).toEqual(expected);
    // ...and it's what's saved (seen by someone opening it afresh)
    await waitForSaved(alice);
    await alice.reload();
    await expect(editor(alice)).toBeVisible();
    await expect.poll(() => outline(alice).catch(() => [])).toEqual(expected);
  });
}
