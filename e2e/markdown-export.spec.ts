import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, unique } from './fixtures';

// Uploads need a login, so a Markdown export brings them along in a zip rather than linking to them.

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** The files in a zip whose files are stored, not compressed (as Wikid's exports are). */
const readZip = (bytes: Buffer) => {
  const files = new Map<string, Buffer>();
  let ptr = 0;
  while (ptr + 30 <= bytes.length && bytes.readUInt32LE(ptr) === 0x04034b50) {
    const size = bytes.readUInt32LE(ptr + 18);
    const nameLength = bytes.readUInt16LE(ptr + 26);
    const dataStart = ptr + 30 + nameLength + bytes.readUInt16LE(ptr + 28);
    files.set(bytes.subarray(ptr + 30, ptr + 30 + nameLength).toString('utf8'), bytes.subarray(dataStart, dataStart + size));
    ptr = dataStart + size;
  }
  return files;
};

const exportDialog = (page: Page) =>
  page.locator('.modal-card').filter({ has: page.getByRole('heading', { name: 'Export' }) });

const uploadPng = async (page: Page, pageId: string) => {
  const res = await page.request.post('/api/uploads', {
    multipart: { pageId, image: { name: 'dot.png', mimeType: 'image/png', buffer: png } },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).file as { url: string; key: string };
};

const setContent = async (page: Page, id: string, content: unknown[]) => {
  expect((await page.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content } } })).status()).toBe(200);
};

const exportMarkdown = async (page: Page) => {
  await page.locator('.topbar-menu-btn').click();
  await page.locator('.topbar-menu__dropdown').getByRole('button', { name: 'Export' }).click();
  await exportDialog(page).getByRole('button', { name: 'Markdown', exact: true }).click();
  const download = page.waitForEvent('download');
  await exportDialog(page).getByRole('button', { name: 'Download Markdown' }).click();
  return download;
};

test.describe('Markdown export', () => {
  test('puts the images uploaded to a page in a zip with it', async ({ alice: page, workspaceId }) => {
    const title = unique('Trip');
    const id = await createPage(page, workspaceId, { title });
    const { url, key } = await uploadPng(page, id);
    const fileName = key.split('/')[1];
    await setContent(page, id, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
      { type: 'image', attrs: { src: url, alt: 'Dot' } },
      { type: 'image', attrs: { src: 'https://example.com/cat.png', alt: 'Cat' } },
    ]);
    await openPage(page, id);

    const download = await exportMarkdown(page);
    expect(download.suggestedFilename()).toBe(`${title}.zip`);
    const files = readZip(await readFile(await download.path()));
    expect([...files.keys()]).toEqual([`${title}.md`, `images/${fileName}`]);
    expect(files.get(`images/${fileName}`)!.equals(png)).toBe(true);
    // Images from other sites stay links
    expect(files.get(`${title}.md`)!.toString('utf8')).toBe(
      `Before\n\n![Dot](images/${fileName})\n\n![Cat](https://example.com/cat.png)`,
    );
  });

  test('is a plain Markdown file when the page has no uploads', async ({ alice: page, workspaceId }) => {
    const title = unique('Plain');
    const id = await createPage(page, workspaceId, { title });
    await setContent(page, id, [{ type: 'paragraph', content: [{ type: 'text', text: 'Just text' }] }]);
    await openPage(page, id);

    const download = await exportMarkdown(page);
    expect(download.suggestedFilename()).toBe(`${title}.md`);
    expect((await readFile(await download.path())).toString('utf8')).toBe('Just text');
  });
});
