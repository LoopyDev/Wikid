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

test.describe('image uploads in progress', () => {
  // Holds uploads until release() (or fails them), so what shows meanwhile can be checked
  async function holdUploads(page: Page, { fail = false } = {}) {
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    await page.route(/\/uploads(\?|$)/, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await released;
      if (fail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Storage unavailable"}' });
      return route.continue();
    });
    return () => release();
  }
  const pending = (page: Page) => editor(page).locator('.image-upload-pending');

  test('a pasted image shows its progress where it will go, while you carry on typing', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('Before', { delay: 20 });
    await page.keyboard.press('Enter');
    const release = await holdUploads(page);
    await pasteImageFile(page);
    await expect(pending(page)).toBeVisible();
    await expect(pending(page)).toHaveAttribute('role', 'status');
    await expect(pending(page)).toContainText(/Uploading image… \d+%/);
    // Not part of the page: nothing saved for it yet
    expect(await images(page)).toEqual([]);

    // Typing goes on meanwhile, after it
    await page.keyboard.type('After', { delay: 20 });
    release();
    await expect(pending(page)).toHaveCount(0);
    await expect.poll(() => outline(page)).toEqual(['paragraph: Before', 'image', 'paragraph: After']);
    await expectImagesLoad(page, 1);
  });

  test('a failed upload leaves no placeholder or image behind', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    const release = await holdUploads(page, { fail: true });
    const alerted = page.waitForEvent('dialog').then(async (dialog) => {
      const message = dialog.message();
      await dialog.accept();
      return message;
    });
    await pasteImageFile(page);
    await expect(pending(page)).toBeVisible();
    release();
    expect(await alerted).toBe('Image upload failed.');
    await expect(pending(page)).toHaveCount(0);
    expect(await images(page)).toEqual([]);
  });

  test('leaving the page while an image uploads asks first', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    const release = await holdUploads(page);
    await pasteImageFile(page);
    await expect(pending(page)).toBeVisible();
    const asked = page.waitForEvent('dialog');
    page.reload().catch(() => {});
    const dialog = await asked;
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
    // Staying keeps the upload, which then finishes
    await expect(pending(page)).toBeVisible();
    release();
    await expect.poll(() => images(page)).toHaveLength(1);
  });
});

// An image's address is saved without the site's name, so pages still show their images when
// served from another address: a backup restored on another machine, or a move to a new domain.
test.describe('image addresses', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

  test('an uploaded image is saved without the site name', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await pasteImageFile(page);
    await expect.poll(async () => (await images(page))[0]?.src).toMatch(/^\/api\/uploads\/[^/]+\/[^/]+\.png$/);
  });

  test('an image saved with another site name loads from this one', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId);
    const upload = await page.request.post('/api/uploads', {
      multipart: { pageId: id, image: { name: 'dot.png', mimeType: 'image/png', buffer: png } },
    });
    expect(upload.status()).toBe(201);
    const { key } = (await upload.json()).file;
    // As saved before, on a site at another address
    const src = `https://wiki.old-address.example/api/uploads/${key}`;
    const content = { type: 'doc', content: [{ type: 'image', attrs: { src } }] };
    expect((await page.request.put(`/api/pages/${id}/content`, { data: { content } })).status()).toBe(200);
    await openPage(page, id);
    const img = editor(page).locator('.tiptap-image-resizable img');
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(1);
    expect(await img.evaluate((el: HTMLImageElement) => new URL(el.currentSrc).host)).toBe(new URL(page.url()).host);
    // The saved address is left as it was
    expect((await images(page))[0].src).toBe(src);
  });
});

test.describe('image placeholders', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

  test('says which image goes here, and uploading one puts it in its place', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('/placeholder', { delay: 20 });
    await page.locator('.slash-menu .slash-item', { hasText: 'Image placeholder' }).click();
    await page.waitForFunction(() => (document.querySelector('.ProseMirror') as any).editor.isFocused);
    await page.keyboard.type('A photo of the site', { delay: 20 });
    // Enter carries on below, not in a second placeholder
    await page.keyboard.press('Enter');
    await page.keyboard.type('After', { delay: 20 });
    const box = editor(page).locator('.image-placeholder');
    await expect(box).toContainText('A photo of the site');
    await expect.poll(async () => (await page.evaluate(() => (document.querySelector('.ProseMirror') as any).editor.getJSON())).content.map((n: any) => n.type)).toEqual(['imagePlaceholder', 'paragraph']);

    const chooser = page.waitForEvent('filechooser');
    await box.getByRole('button', { name: 'Upload' }).click();
    await (await chooser).setFiles({ name: 'site.png', mimeType: 'image/png', buffer: png });
    // The image takes its place
    await expect.poll(async () => (await images(page)).length).toBe(1);
    await expect(box).toHaveCount(0);
    await expect.poll(async () => (await page.evaluate(() => (document.querySelector('.ProseMirror') as any).editor.getJSON())).content.map((n: any) => n.type)).toEqual(['image', 'paragraph']);
  });
});

