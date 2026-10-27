import fs from 'node:fs';
import path from 'node:path';
import { test, expect, createPage, openPage, editor, outline, pastePlainText, unique, waitForSaved } from './fixtures';

test.describe('editor', () => {
  test('saves what you type, including markdown shortcuts', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId);
    await openPage(page, id);
    await editor(page).click();
    await page.keyboard.type('# Plans', { delay: 20 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('Some text', { delay: 20 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('- one', { delay: 20 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('two', { delay: 20 });

    const expected = ['heading1: Plans', 'paragraph: Some text', 'bulletList', '  listItem', '    paragraph: one', '  listItem', '    paragraph: two'];
    await expect.poll(() => outline(page)).toEqual(expected);

    await waitForSaved(page);
    await openPage(page, id);
    await expect.poll(() => outline(page)).toEqual(expected);
  });

  test('turns pasted markdown into blocks', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId);
    await openPage(page, id);
    await editor(page).click();
    await pastePlainText(page, '## Shopping\n\n- milk\n- `$&` bread\n\n```js\nconst a = 1;\n```');

    await expect.poll(() => outline(page)).toEqual([
      'heading2: Shopping',
      'bulletList',
      '  listItem',
      '    paragraph: milk',
      '  listItem',
      '    paragraph: $& bread',
      'codeBlock: const a = 1;',
    ]);
  });

  test('indents a paragraph with Tab and outdents with Shift+Tab', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId);
    await openPage(page, id);
    await editor(page).click();
    await page.keyboard.type('Indented', { delay: 20 });
    const indent = () => page.evaluate(() => (document.querySelector('.ProseMirror') as any).editor.getJSON().content[0].attrs?.indent ?? 0);

    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect.poll(indent).toBe(2);
    await page.keyboard.press('Shift+Tab');
    await expect.poll(indent).toBe(1);
  });
});

test('shows an uploaded 3D scan', async ({ alice: page, workspaceId }) => {
  // A small scan made by e2e/assets/make-test-scan.py: a coloured sphere
  const pageId = await createPage(page, workspaceId, { title: unique('Scan') });
  const upload = await page.request.post('/api/uploads', {
    multipart: {
      pageId,
      image: { name: 'test-scan.spz', mimeType: 'application/octet-stream', buffer: fs.readFileSync(path.join(__dirname, 'assets/test-scan.spz')) },
    },
  });
  expect(upload.status()).toBe(201);
  const content = { type: 'doc', content: [{ type: 'gaussianSplat', attrs: { src: (await upload.json()).file.url } }] };
  expect((await page.request.put(`/api/pages/${pageId}/content`, { data: { content } })).status()).toBe(200);
  await page.goto(`/doc/${pageId}`);

  // The viewer should draw the sphere: count clearly coloured pixels in a screenshot of it.
  const viewer = page.locator('.gs-node canvas');
  await expect(viewer).toBeVisible();
  const colouredPixels = async () => {
    const shot = (await viewer.screenshot()).toString('base64');
    return page.evaluate(async (png) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, img.width, img.height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 60) count += 1;
      }
      return count;
    }, shot);
  };
  await expect.poll(colouredPixels, { timeout: 15_000 }).toBeGreaterThan(5000);
});

