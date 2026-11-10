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

  test('pastes Markdown with an image in a heading or a table cell, keeping the image', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId);
    await openPage(page, id);
    await editor(page).click();
    await pastePlainText(page, '# Plans ![map](https://example.com/map.png)\n\n| A | B |\n| --- | --- |\n| Before ![dot](https://example.com/dot.png) | Text |\n\nAfter');
    await expect(editor(page)).toContainText('After');
    await expect(editor(page).locator('h1')).toHaveText('Plans');
    await expect(editor(page).locator('img[src="https://example.com/map.png"]')).toHaveCount(1);
    // In a table cell, as a link to it (a cell's row can't hold an image block in Markdown)
    await expect(editor(page).locator('td a[href="https://example.com/dot.png"]')).toHaveText('dot');
  });

  test('turns a single pasted to-do line into a to-do, but leaves a single bullet line as text', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId);
    await openPage(page, id);
    await editor(page).click();
    await pastePlainText(page, '- [ ] Okay');
    await expect.poll(() => outline(page)).toEqual(['taskList', '  taskItem', '    paragraph: Okay']);

    const other = await createPage(page, workspaceId);
    await openPage(page, other);
    await editor(page).click();
    await pastePlainText(page, '- just a dash');
    await expect.poll(() => outline(page)).toEqual(['paragraph: - just a dash']);
  });

  test('turns pasted markdown to-dos and tables into to-dos and tables', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId);
    await openPage(page, id);
    await editor(page).click();
    await pastePlainText(page, '- [ ] Book train\n- [x] Pack **bag**\n\n| Day | Plan |\n| --- | --- |\n| Mon | Travel |');

    await expect.poll(() => outline(page)).toEqual([
      'taskList',
      '  taskItem',
      '    paragraph: Book train',
      '  taskItem',
      '    paragraph: Pack bag',
      'table',
      '  tableRow',
      '    tableHeader',
      '      paragraph: Day',
      '    tableHeader',
      '      paragraph: Plan',
      '  tableRow',
      '    tableCell',
      '      paragraph: Mon',
      '    tableCell',
      '      paragraph: Travel',
    ]);
    await expect(editor(page).locator('li[data-checked="true"] p')).toHaveText('Pack bag');
    await expect(editor(page).locator('strong', { hasText: 'bag' })).toBeVisible();
  });

  test('removing the empty bullet between two others keeps them one list, so the second can be indented', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('- One\nTwo\nThree', { delay: 20 });
    // Empty the middle bullet, then backspace twice: out of the list, then the empty line goes
    await editor(page).getByText('Two', { exact: true }).click();
    await page.keyboard.press('End');
    // Once the editor has the cursor at the end of "Two" (typing straight after a click can beat it)
    await page.waitForFunction(() => {
      const { selection } = (document.querySelector('.ProseMirror') as any).editor.state;
      return selection.empty && selection.$from.parent.textContent === 'Two' && selection.$from.parentOffset === 3;
    });
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('Backspace');
    await expect.poll(() => outline(page)).toEqual(['bulletList', '  listItem', '    paragraph: One', '  listItem', '    paragraph: Three']);
    await editor(page).getByText('Three', { exact: true }).click();
    await page.keyboard.press('Home');
    await page.waitForFunction(() => {
      const { selection } = (document.querySelector('.ProseMirror') as any).editor.state;
      return selection.$from.parent.textContent === 'Three' && selection.$from.parentOffset === 0;
    });
    await page.keyboard.press('Tab');
    await expect.poll(() => outline(page)).toEqual(['bulletList', '  listItem', '    paragraph: One', '    bulletList', '      listItem', '        paragraph: Three']);
  });

  test('leaves two lists elsewhere on the page apart', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId);
    const list = (text: string) => ({ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }] });
    const content = { type: 'doc', content: [list('First list'), list('Second list'), { type: 'paragraph', content: [{ type: 'text', text: 'Below' }] }] };
    expect((await page.request.put(`/api/pages/${id}/content`, { data: { content } })).status()).toBe(200);
    await openPage(page, id);
    await editor(page).getByText('Below').click();
    await page.keyboard.press('End');
    await page.waitForFunction(() => {
      const { selection } = (document.querySelector('.ProseMirror') as any).editor.state;
      return selection.$from.parent.textContent === 'Below' && selection.$from.parentOffset === 5;
    });
    await page.keyboard.type(' and more', { delay: 20 });
    await expect.poll(() => outline(page)).toEqual([
      'bulletList', '  listItem', '    paragraph: First list',
      'bulletList', '  listItem', '    paragraph: Second list',
      'paragraph: Below and more',
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

