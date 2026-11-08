import { expect } from '@playwright/test';
import { test, createPage, editor, blockTexts, outline } from './fixtures';

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
