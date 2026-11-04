import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, editor, outline, waitForSaved } from './fixtures';

// Images pasted or dropped onto a page are uploaded, so they're still there for everyone later;
// never left at an address that only worked in the tab they were pasted in.

/** Makes a 30x20 PNG in the page: as a File, or (with asBlobUrl) at a blob: address, as Safari pastes. */
const makePng = `async (asBlobUrl) => {
  const canvas = document.createElement('canvas');
  canvas.width = 30;
  canvas.height = 20;
  canvas.getContext('2d').fillRect(0, 0, 30, 20);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return asBlobUrl ? URL.createObjectURL(blob) : new File([blob], 'shot.png', { type: 'image/png' });
}`;

/** Pastes a PNG file, as from a screenshot. */
async function pasteImageFile(page: Page) {
  await page.evaluate(async (makePng) => {
    const data = new DataTransfer();
    data.items.add(await eval(makePng)(false));
    document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, makePng);
}

const images = (page: Page) =>
  page.evaluate(() => {
    const json = (document.querySelector('.ProseMirror') as any).editor.getJSON();
    const found: any[] = [];
    const walk = (node: any) => {
      if (node.type === 'image') found.push(node.attrs);
      (node.content || []).forEach(walk);
    };
    walk(json);
    return found.map((attrs) => ({ src: attrs.src, width: attrs.naturalWidth, height: attrs.naturalHeight }));
  });

// The page's image elements have loaded, from the server (not a tab's own blob: address)
async function expectImagesLoad(page: Page, count: number) {
  const img = editor(page).locator('.tiptap-image-resizable img');
  await expect(img).toHaveCount(count);
  for (let i = 0; i < count; i += 1) {
    await expect.poll(() => img.nth(i).evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(30);
  }
}

test.describe('pasted and dropped images', () => {
  test('a pasted image file is uploaded, and still loads after a reload', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await pasteImageFile(page);
    await expect.poll(() => images(page)).toEqual([{ src: expect.stringMatching(/\/uploads\/[^/]+\/[^/]+\.png$/), width: 30, height: 20 }]);
    await waitForSaved(page);
    await page.reload();
    await expectImagesLoad(page, 1);
  });

  test("an image pasted at a blob: address, as Safari does, is uploaded from it", async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.evaluate(async (makePng) => {
      const url = await eval(makePng)(true);
      const data = new DataTransfer();
      data.setData('text/html', `<img src="${url}">`);
      document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, makePng);
    await expect.poll(() => images(page)).toEqual([{ src: expect.stringMatching(/\/uploads\//), width: 30, height: 20 }]);
    await waitForSaved(page);
    await page.reload();
    await expectImagesLoad(page, 1);
  });

  test('text pasted with a blob: image (as from Word) pastes the text, without a broken image', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.evaluate(async (makePng) => {
      const url = await eval(makePng)(true);
      const data = new DataTransfer();
      data.setData('text/html', `<p>Quarterly figures</p><img src="${url}">`);
      data.setData('text/plain', 'Quarterly figures');
      data.items.add(await eval(makePng)(false));
      document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, makePng);
    await expect.poll(() => outline(page)).toContain('paragraph: Quarterly figures');
    await page.waitForTimeout(500);
    expect(await images(page)).toEqual([]);
  });

  test('an image file dropped onto the page is uploaded where it was dropped', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('Above', { delay: 20 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('Below', { delay: 20 });
    await page.evaluate(async (makePng) => {
      const data = new DataTransfer();
      data.items.add(await eval(makePng)(false));
      const below = document.querySelector('.ProseMirror')!.children[1].getBoundingClientRect();
      const at = { clientX: below.left + 2, clientY: below.top + 2, bubbles: true, cancelable: true, dataTransfer: data };
      const target = document.elementFromPoint(at.clientX, at.clientY)!;
      target.dispatchEvent(new DragEvent('dragover', at));
      target.dispatchEvent(new DragEvent('drop', at));
    }, makePng);
    await expect.poll(() => outline(page)).toEqual(['paragraph: Above', 'image', 'paragraph: Below']);
    expect(await images(page)).toEqual([{ src: expect.stringMatching(/\/uploads\//), width: 30, height: 20 }]);
    await waitForSaved(page);
    await page.reload();
    await expectImagesLoad(page, 1);
  });
});
