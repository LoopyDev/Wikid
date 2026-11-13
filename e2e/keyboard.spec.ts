import { test, expect, createPage, openPage, editor, outline, blockTexts, placeCursor } from './fixtures';
import type { Page } from '@playwright/test';

// Getting around the page with the keyboard alone.

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const openWith = async (page: Page, workspaceId: string, content: unknown[]) => {
  const id = await createPage(page, workspaceId, { title: 'Keys' });
  expect((await page.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content } } })).status()).toBe(200);
  await openPage(page, id);
  return id;
};
// The focused menu item's text (not the menu's own, which holds every item's while a panel slides in)
const focusedText = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.matches('button') ? el.textContent?.trim() || '' : '';
  });
const pressUntilFocused = async (page: Page, key: string, text: string) => {
  for (let i = 0; i < 20; i += 1) {
    if ((await focusedText(page)).includes(text)) return;
    // (while a panel slides in, no item has focus yet: wait for it rather than press)
    if (!(await focusedText(page))) await page.waitForTimeout(100);
    else await page.keyboard.press(key);
  }
  throw new Error(`never reached "${text}"`);
};

test.describe('keyboard', () => {
  test('Ctrl/Cmd+/ opens the block menu; arrows, Right and Enter work it; Escape puts you back in the page', async ({ alice: page, workspaceId }) => {
    await openWith(page, workspaceId, [p('One'), p('Two')]);
    const menu = page.locator('.block-menu');
    await placeCursor(page, 1, 'end');
    await page.keyboard.press('ControlOrMeta+/');
    await expect(menu).toBeVisible();
    await expect.poll(() => menu.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    await pressUntilFocused(page, 'ArrowDown', 'Turn into');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => focusedText(page)).toContain('Paragraph');
    await pressUntilFocused(page, 'ArrowDown', 'Heading 2');
    await page.keyboard.press('Enter');
    await expect.poll(() => outline(page)).toEqual(['paragraph: One', 'heading2: Two']);

    // Escape: closed, and back to typing in the page
    await placeCursor(page, 0, 'end');
    await page.keyboard.press('ControlOrMeta+/');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await page.keyboard.type('!', { delay: 20 });
    // (an empty line may follow the heading now last)
    await expect.poll(() => blockTexts(page).then((t) => t.slice(0, 2))).toEqual(['One!', 'Two']);
  });

  test("Escape leaves the page, so Tab moves on instead of indenting", async ({ alice: page, workspaceId }) => {
    await openWith(page, workspaceId, [p('Text')]);
    await placeCursor(page, 0, 'end');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.ProseMirror'))).toBe(false);
    const indent = await page.evaluate(() => (document.querySelector('.ProseMirror') as any).editor.getJSON().content[0].attrs.indent);
    expect(indent ?? 0).toBe(0);
  });

  test('ArrowUp on the first line goes to the title, and ArrowDown from the title comes back', async ({ alice: page, workspaceId }) => {
    await openWith(page, workspaceId, [p('First'), p('Second')]);
    const title = page.getByRole('main').getByRole('textbox', { name: 'Untitled page' });
    await placeCursor(page, 0, 'start');
    await page.keyboard.press('ArrowUp');
    await expect(title).toBeFocused();
    await page.keyboard.type('!', { delay: 20 });
    await expect(title).toHaveValue('Keys!');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.ProseMirror'))).toBe(true);
    await page.keyboard.type('>', { delay: 20 });
    await expect.poll(() => blockTexts(page)).toEqual(['>First', 'Second']);
  });

  test("a code block's language picker shows while the cursor is in it, the pointer elsewhere", async ({ alice: page, workspaceId }) => {
    await openWith(page, workspaceId, [p('Before'), { type: 'codeBlock', content: [{ type: 'text', text: 'let x = 1;' }] }, p('After')]);
    await page.mouse.move(5, 5);
    const trigger = page.locator('.code-lang-trigger');
    await expect(trigger).toHaveCount(0);
    await placeCursor(page, 0, 'end');
    await page.keyboard.press('ArrowDown');
    await page.mouse.move(5, 5);
    await expect(trigger).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(trigger).toHaveCount(0);
  });
});
