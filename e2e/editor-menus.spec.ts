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

  test('the slash menu highlights one item: the pointer moves it, and the arrow keys move on from there', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('/');
    const items = page.locator('.slash-menu .slash-item');
    const lit = async () =>
      items.evaluateAll((els) => els.map((el, i) => (getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)' ? i : -1)).filter((i) => i >= 0));
    await expect.poll(lit).toEqual([0]);
    // The pointer resting on the first item, as when the menu opens under it
    await items.nth(0).hover();
    await page.keyboard.press('ArrowDown');
    await expect.poll(lit).toEqual([1]);
    await items.nth(2).hover();
    await expect.poll(lit).toEqual([2]);
    await page.keyboard.press('ArrowDown');
    await expect.poll(lit).toEqual([3]);
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

  test('the block menu changes a block without scrolling the page to where the text cursor was', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await page.evaluate(() => {
      const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
      const ed = (document.querySelector('.ProseMirror') as any).editor;
      ed.commands.setContent({ type: 'doc', content: Array.from({ length: 80 }, (_, i) => p(`Line ${i}`)) });
      ed.commands.setTextSelection(1); // the cursor at the top
    });
    const scrollTop = () => page.evaluate(() => Math.round((document.querySelector('.wikid-mainframe') as HTMLElement).scrollTop));
    await editor(page).locator(':scope > *').nth(60).scrollIntoViewIfNeeded();
    const before = await scrollTop();
    expect(before).toBeGreaterThan(500);

    await (await handleFor(page, 60)).click();
    await menuItem(page, 'Delete').click();
    await expect.poll(() => outline(page).then((o) => o[60])).toBe('paragraph: Line 61');
    await page.waitForTimeout(300);
    expect(Math.abs((await scrollTop()) - before)).toBeLessThan(80);
    // The cursor where the block was, so typing goes there
    await page.keyboard.type('Here ');
    await expect.poll(() => outline(page).then((o) => o[60])).toBe('paragraph: Here Line 61');

    await page.evaluate(() => (document.querySelector('.ProseMirror') as any).editor.commands.setTextSelection(1));
    await (await handleFor(page, 62)).click();
    await menuItem(page, 'Turn into…').click();
    await menuItem(page, 'Heading 2').click();
    await expect.poll(() => outline(page).then((o) => o[62])).toBe('heading2: Line 63');
    await page.waitForTimeout(300);
    expect(Math.abs((await scrollTop()) - before)).toBeLessThan(80);
  });

  test("blocks that aren't text have no Turn into in their menu", async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await page.evaluate(() => {
      const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
      (document.querySelector('.ProseMirror') as any).editor.commands.setContent({ type: 'doc', content: [
        { type: 'horizontalRule' },
        { type: 'callout', content: [p('Note')] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('Cell')] }] }] },
        p('After'),
      ] });
    });
    const before = await outline(page);
    for (const index of [0, 1, 2]) {
      if (index === 2) await editor(page).locator('td').hover();
      await (index === 2 ? page.locator('.drag-handle--floating:not(.drag-handle--list) .drag-handle__btn--drag') : await handleFor(page, index)).click();
      await expect(menuItem(page, 'Delete')).toBeVisible();
      await expect(menuItem(page, 'Turn into…')).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
    expect(await outline(page)).toEqual(before);
  });

  test('a to-do has one handle for the whole line, and the to-do list one of its own, as a bullet list does', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await page.evaluate(() => {
      const todo = (text: string, checked = false) => ({ type: 'taskItem', attrs: { checked }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
      (document.querySelector('.ProseMirror') as any).editor.commands.setContent({ type: 'doc', content: [
        { type: 'taskList', content: [todo('A'), todo('B', true), todo('C')] },
      ] });
    });
    const itemHandle = page.locator('.drag-handle--floating:not(.drag-handle--list) .drag-handle__btn--drag');
    const listHandle = page.locator('.drag-handle--list .drag-handle__btn--drag');

    // Beside B: the handle is B's line, at its top, and the list's handle shows next to it
    const b = editor(page).locator('li').nth(1);
    await b.hover();
    await expect(itemHandle).toBeVisible();
    const [line, handle] = [await b.boundingBox(), await itemHandle.boundingBox()];
    expect(Math.abs(handle!.y + handle!.height / 2 - (line!.y + line!.height / 2))).toBeLessThan(line!.height / 2);
    await itemHandle.hover();
    await expect(listHandle).toBeVisible();

    // Deleting from B's handle takes the whole to-do, checkbox and all, not just its text
    await b.hover();
    await itemHandle.click();
    await menuItem(page, 'Delete').click();
    await expect.poll(() => outline(page)).toEqual(['taskList', '  taskItem', '    paragraph: A', '  taskItem', '    paragraph: C']);
  });

  test("Turn into on a list item takes just that item out of the list; on the list, it changes the list's kind", async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await page.evaluate(() => {
      const item = (text: string) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
      (document.querySelector('.ProseMirror') as any).editor.commands.setContent({ type: 'doc', content: [
        { type: 'bulletList', content: [item('A'), item('B'), item('C')] },
      ] });
    });
    const items = (kind: string, ...texts: string[]) => [kind, ...texts.flatMap((text) => ['  listItem', `    paragraph: ${text}`])];
    const itemHandle = page.locator('.drag-handle--floating:not(.drag-handle--list) .drag-handle__btn--drag');
    // The list's handle shows beside an item's, once you point at that
    const openListMenu = async () => {
      await editor(page).locator('li').nth(1).hover();
      await itemHandle.hover();
      await page.locator('.drag-handle--list .drag-handle__btn--drag').click();
      await menuItem(page, 'Turn into…').click();
    };

    // The list's own handle: only kinds of list, with its own ticked, which leaves it as it is
    await openListMenu();
    await expect(menuItem(page, 'Heading 1')).toHaveCount(0);
    await expect(menuItem(page, 'Bulleted list').locator('.block-menu__chevron')).toHaveText('✓');
    await menuItem(page, 'Bulleted list').click();
    await expect.poll(() => outline(page)).toEqual(items('bulletList', 'A', 'B', 'C'));
    await openListMenu();
    await menuItem(page, 'Numbered list').click();
    await expect.poll(() => outline(page)).toEqual(items('orderedList', 'A', 'B', 'C'));

    // An item's handle: B becomes a heading between the rest of the list
    await editor(page).locator('li').nth(1).hover();
    await itemHandle.click();
    await menuItem(page, 'Turn into…').click();
    await menuItem(page, 'Heading 1').click();
    await expect.poll(() => outline(page)).toEqual([...items('orderedList', 'A'), 'heading1: B', ...items('orderedList', 'C')]);

    // An item in a list in a list comes all the way out
    await page.evaluate(() => {
      const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
      (document.querySelector('.ProseMirror') as any).editor.commands.setContent({ type: 'doc', content: [
        { type: 'bulletList', content: [{ type: 'listItem', content: [p('A'), { type: 'bulletList', content: [{ type: 'listItem', content: [p('D')] }] }] }] },
      ] });
    });
    await editor(page).locator('li li').hover();
    await itemHandle.click();
    await menuItem(page, 'Turn into…').click();
    await menuItem(page, 'Paragraph').click();
    await expect.poll(() => outline(page)).toEqual([...items('bulletList', 'A'), 'paragraph: D']);
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

  test('dragging a table by its handle moves the whole table, leaving nothing behind in its column', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await page.evaluate(() => {
      const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
      const cell = (text: string) => ({ type: 'tableCell', content: [p(text)] });
      (document.querySelector('.ProseMirror') as any).editor.commands.setContent({ type: 'doc', content: [
        p('Top'),
        { type: 'columns', content: [
          { type: 'column', content: [{ type: 'table', content: [{ type: 'tableRow', content: [cell('A'), cell('B')] }] }] },
          { type: 'column', content: [p('Right')] },
        ] },
      ] });
    });
    const table = ['table', '  tableRow', '    tableCell', '      paragraph: A', '    tableCell', '      paragraph: B'];

    // Pointing at a cell gives the table's handle (it used to be the cell's text)
    await editor(page).locator('td').last().hover();
    const handle = page.locator('.drag-handle--floating:not(.drag-handle--list) .drag-handle__btn--drag');
    await expect(handle).toBeVisible();
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
    // The emptied column goes, and with one column left the columns become plain blocks again
    await expect.poll(() => outline(page)).toEqual([...table, 'paragraph: Top', 'paragraph: Right']);

    // Deleting it from its menu removes the table, not just what's in it
    await editor(page).locator('td').first().hover();
    await handle.click();
    await menuItem(page, 'Delete').click();
    await expect.poll(() => outline(page)).toEqual(['paragraph: Top', 'paragraph: Right']);
  });

  test('dragging an image moves its block, and clicking it opens it in the image viewer', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await typeParagraphs(page, ['One', 'Two']);
    // An image after the paragraphs
    await page.evaluate(() => {
      const ed = (document.querySelector('.ProseMirror') as any).editor;
      ed.chain().focus('end').setImage({ src: '/vite.svg', naturalWidth: 240, naturalHeight: 120 } as any).run();
    });
    const image = editor(page).locator('.tiptap-image-resizable');
    await expect(image).toBeVisible();
    await expect.poll(() => outline(page)).toEqual(['paragraph: One', 'paragraph: Two', 'image']);

    // Drag the image itself (not the block handle) to the top of the page
    await image.evaluate((el) => {
      const data = new DataTransfer();
      const target = document.querySelector('.ProseMirror')!.firstElementChild!.getBoundingClientRect();
      const at = { clientX: target.left + 10, clientY: target.top + 2, bubbles: true, cancelable: true, dataTransfer: data };
      el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data }));
      const dropTarget = document.elementFromPoint(at.clientX, at.clientY)!;
      dropTarget.dispatchEvent(new DragEvent('dragover', at));
      dropTarget.dispatchEvent(new DragEvent('drop', at));
      el.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }));
    });
    await expect.poll(() => outline(page)).toEqual(['image', 'paragraph: One', 'paragraph: Two']);

    // Clicking it opens it in the viewer, over the page
    const viewer = page.locator('.pswp');
    await image.locator('img').click();
    await expect(viewer.locator('.pswp__item:not([aria-hidden="true"]) img.pswp__img')).toHaveAttribute('src', '/vite.svg');
    await expect(viewer.getByRole('link', { name: 'Open in a new tab' })).toHaveAttribute('href', '/vite.svg');
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);

    // Resizing it, ending over the image, doesn't open it
    const handle = await image.getByRole('button', { name: 'Resize image' }).boundingBox();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle!.x - 60, handle!.y + handle!.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(image).toHaveCSS('width', /^1[78]\d/);
    await page.waitForTimeout(300);
    await expect(viewer).toHaveCount(0);
  });

  test("the image viewer moves through the page's images, including ones saved without their size", async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await page.evaluate(() => {
      const ed = (document.querySelector('.ProseMirror') as any).editor;
      ed.chain().focus('end').insertContent([
        { type: 'image', attrs: { src: '/vite.svg?first', naturalWidth: 240, naturalHeight: 120 } },
        { type: 'paragraph' },
        { type: 'image', attrs: { src: '/vite.svg?second', width: '200px' } },
      ]).run();
    });
    const images = editor(page).locator('.tiptap-image-resizable img');
    await expect(images).toHaveCount(2);
    const shown = page.locator('.pswp__item:not([aria-hidden="true"]) img.pswp__img');

    // Opened at the image clicked, then the arrow keys move between them
    await images.nth(1).click();
    await expect(shown).toHaveAttribute('src', '/vite.svg?second');
    await page.keyboard.press('ArrowLeft');
    await expect(shown).toHaveAttribute('src', '/vite.svg?first');
    await expect(page.getByRole('link', { name: 'Open in a new tab' })).toHaveAttribute('href', '/vite.svg?first');
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('.pswp')).toHaveCount(0);

    // Opened at the other, the one without a size is measured, and shown at its own size (32px)
    await page.reload();
    await images.nth(0).click();
    await expect(shown).toHaveAttribute('src', '/vite.svg?first');
    await page.keyboard.press('ArrowRight');
    await expect(shown).toHaveAttribute('src', '/vite.svg?second');
    await expect.poll(() => shown.evaluate((img) => img.getBoundingClientRect().width)).toBeGreaterThan(20);
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('.pswp')).toHaveCount(0);
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
