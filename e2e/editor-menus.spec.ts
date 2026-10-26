import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, editor, outline, placeCursor, waitForSaved } from './fixtures';

// The editor's menus: the slash menu, the block menu behind the drag handle, and dragging blocks.

const blockMenu = (page: Page) => page.locator('.block-menu');
const menuItem = (page: Page, title: string) =>
  blockMenu(page).locator('.block-menu__item', { has: page.locator('.block-menu__title', { hasText: new RegExp(`^${title}$`) }) });

/** Types paragraphs, one per line. */
async function typeParagraphs(page: Page, lines: string[]) {
  await editor(page).click();
  for (const [i, line] of lines.entries()) {
    if (i) await page.keyboard.press('Enter');
    await page.keyboard.type(line, { delay: 20 });
  }
}

/** Hovers a top-level block so its drag handle shows, and returns the handle's drag button. */
async function handleFor(page: Page, index: number) {
  await editor(page).locator(':scope > *').nth(index).hover();
  const button = page.locator('.drag-handle--floating:not(.drag-handle--list) .drag-handle__btn--drag');
  await expect(button).toBeVisible();
  return button;
}

test.describe('editor menus', () => {
  test('the slash menu turns a line into a heading or a to-do list', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('/heading', { delay: 30 });
    const menu = page.locator('.slash-menu');
    await expect(menu.locator('.slash-item__title', { hasText: /^Heading 1$/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await page.keyboard.type('Title', { delay: 20 });
    await page.keyboard.press('Enter');

    await page.keyboard.type('/todo', { delay: 30 });
    await menu.locator('.slash-item', { hasText: 'To-do list' }).click();
    // Clicking the menu item takes focus for a moment; wait until the editor has it back.
    await page.waitForFunction(() => (document.querySelector('.ProseMirror') as any).editor.isFocused);
    await page.keyboard.type('Buy milk', { delay: 20 });
    await expect.poll(() => outline(page)).toEqual(['heading1: Title', 'taskList', '  taskItem', '    paragraph: Buy milk']);
    await waitForSaved(page);
  });

  test('the block menu turns a block into a heading and deletes it', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await typeParagraphs(page, ['First', 'Second']);

    await (await handleFor(page, 1)).click();
    await expect(blockMenu(page)).toBeVisible();
    await menuItem(page, 'Turn into…').click();
    await menuItem(page, 'Heading 2').click();
    await expect.poll(() => outline(page)).toEqual(['paragraph: First', 'heading2: Second']);

    await page.keyboard.press('Escape');
    await (await handleFor(page, 0)).click();
    await menuItem(page, 'Delete').click();
    await expect.poll(() => outline(page)).toEqual(['heading2: Second']);
  });

  test('dragging a block by its handle moves it', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await typeParagraphs(page, ['One', 'Two', 'Three']);
    await placeCursor(page, 2, 'end');

    // Playwright's dragTo doesn't drive ProseMirror's drag and drop, so send the browser's drag
    // events ourselves: dragstart on the handle, then dragover and drop at the top of the first block.
    const handle = await handleFor(page, 2);
    await handle.evaluate((button) => {
      const data = new DataTransfer();
      const target = document.querySelector('.ProseMirror')!.firstElementChild!.getBoundingClientRect();
      const at = { clientX: target.left + 10, clientY: target.top + 2, bubbles: true, cancelable: true, dataTransfer: data };
      button.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data }));
      const dropTarget = document.elementFromPoint(at.clientX, at.clientY)!;
      dropTarget.dispatchEvent(new DragEvent('dragover', at));
      dropTarget.dispatchEvent(new DragEvent('drop', at));
      button.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }));
    });
    await expect.poll(() => outline(page)).toEqual(['paragraph: Three', 'paragraph: One', 'paragraph: Two']);
  });

  test("the block menu colours a block's text, and the panel follows the block", async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await typeParagraphs(page, ['Coloured']);
    await (await handleFor(page, 0)).click();
    await menuItem(page, 'Colour').click();
    await blockMenu(page).getByRole('button', { name: 'Text color Orange' }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const doc = (document.querySelector('.ProseMirror') as any).editor.getJSON();
          return doc.content[0].content[0].marks?.find((m: any) => m.type === 'textStyle')?.attrs?.color;
        })
      )
      .toBe('var(--text-color-orange)');
    await blockMenu(page).getByRole('button', { name: '‹ Back' }).click();
    await expect(menuItem(page, 'Turn into…')).toBeVisible();
  });

  test('the toolbar over selected text makes it bold and colours it', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await typeParagraphs(page, ['Make me bold']);
    await page.keyboard.press('Shift+Home');
    const toolbar = page.locator('.bubble-menu').filter({ has: page.getByRole('button', { name: 'Color' }) });
    await expect(toolbar).toBeVisible();

    const bold = toolbar.getByRole('button', { name: 'Bold' });
    await expect(bold).toHaveAttribute('aria-pressed', 'false');
    await bold.click();
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    await toolbar.getByRole('button', { name: 'Color' }).click();
    await page.getByRole('menu').filter({ hasText: 'Text color' }).getByRole('button', { name: 'Orange' }).click();
    const marks = () =>
      page.evaluate(() => {
        const doc = (document.querySelector('.ProseMirror') as any).editor.getJSON();
        return (doc.content[0].content[0].marks || []).map((m: any) => m.type + (m.attrs?.color ? `:${m.attrs.color}` : '')).sort();
      });
    await expect.poll(marks).toEqual(['bold', 'textStyle:var(--text-color-orange)']);
    await waitForSaved(page);
  });
});
