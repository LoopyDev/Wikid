import { expect, type Page } from '@playwright/test';
import { test, createPage, openPage, editor, unique, waitForSaved } from './fixtures';

// How quickly pages and images appear: moving between pages, and images keeping their space.

const sidebarItem = (page: Page, title: string) =>
  page.getByRole('complementary').locator('.sidebar__item', { has: page.getByText(title, { exact: true }) });

/** A PNG of the given size, drawn by the browser. */
async function makePng(page: Page, width: number, height: number) {
  const dataUrl = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#4f46e5';
    ctx.fillRect(0, 0, width, height);
    return canvas.toDataURL('image/png');
  }, { width, height });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

test.describe('loading', () => {
  test('moves between pages over one live connection, loading a page when the pointer rests on it', async ({ alice: page, workspaceId }) => {
    const firstTitle = unique('First');
    const secondTitle = unique('Second');
    const first = await createPage(page, workspaceId, { title: firstTitle });
    const second = await createPage(page, workspaceId, { title: secondTitle });
    await openPage(page, second);
    await editor(page).click();
    await page.keyboard.type('On the second page');
    await waitForSaved(page);

    const sockets: string[] = [];
    page.on('websocket', (ws) => sockets.push(ws.url()));
    const secondPageLoads: string[] = [];
    page.on('request', (req) => {
      if (new URL(req.url()).pathname === `/api/pages/${second}`) secondPageLoads.push(req.url());
    });
    await openPage(page, first);
    expect(sockets).toHaveLength(1);

    // Resting the pointer on a page starts loading it, and the click uses that
    await sidebarItem(page, secondTitle).hover();
    await expect.poll(() => secondPageLoads.length).toBe(1);
    await sidebarItem(page, secondTitle).click();
    await expect(editor(page)).toHaveText('On the second page');
    await page.waitForURL(`**/doc/${second}`);
    expect(secondPageLoads).toHaveLength(1);

    // Back and forth, on the same connection
    await sidebarItem(page, firstTitle).click();
    await page.waitForURL(`**/doc/${first}`);
    await sidebarItem(page, secondTitle).click();
    await expect(editor(page)).toHaveText('On the second page');
    expect(sockets).toHaveLength(1);
  });

  test("keeps an uploaded image's space while it loads, and loads it lazily", async ({ alice: page, workspaceId }) => {
    const pageId = await createPage(page, workspaceId, { title: unique('Images') });
    await openPage(page, pageId);
    const png = await makePng(page, 320, 180);

    await editor(page).click();
    await page.keyboard.type('/image');
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await chooser).setFiles({ name: 'wide.png', mimeType: 'image/png', buffer: png });

    const img = editor(page).locator('img');
    await expect(img).toHaveAttribute('width', '320');
    await expect(img).toHaveAttribute('height', '180');
    await expect(img).toHaveAttribute('loading', 'lazy');
    const attrs = await page.evaluate(() => {
      const doc = (document.querySelector('.ProseMirror') as any).editor.getJSON();
      return doc.content.find((n: any) => n.type === 'image')?.attrs;
    });
    expect(attrs).toMatchObject({ naturalWidth: 320, naturalHeight: 180 });

    // After a reload, before the image has arrived, its space is already there
    await waitForSaved(page);
    await page.route('**/api/uploads/**', () => {}); // never answers
    await page.reload();
    const box = await editor(page).locator('.tiptap-image-resizable').boundingBox();
    expect(Math.round(box!.width)).toBe(320);
    expect(Math.round(box!.height)).toBeGreaterThanOrEqual(180);
  });
});
