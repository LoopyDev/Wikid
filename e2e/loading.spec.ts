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

  test('a page with an icon keeps its title as you come back to it', async ({ alice: page, workspaceId }) => {
    // Its icon used to be written in before the server's copy arrived, which made the connection
    // report the page synced too early, and the title was added again on every visit
    const iconTitle = unique('With icon');
    const otherTitle = unique('Without');
    const withIcon = await createPage(page, workspaceId, { title: iconTitle });
    await page.request.patch(`/api/pages/${withIcon}`, { data: { icon: '🔥' } });
    const other = await createPage(page, workspaceId, { title: otherTitle });
    await openPage(page, other);
    const title = page.getByRole('main').getByRole('textbox').first();
    for (let visit = 0; visit < 3; visit += 1) {
      await sidebarItem(page, iconTitle).click();
      await page.waitForURL(`**/doc/${withIcon}`);
      await page.waitForTimeout(500);
      await expect(title).toHaveValue(iconTitle);
      await sidebarItem(page, otherTitle).click();
      await page.waitForURL(`**/doc/${other}`);
    }
  });

  test("coming back to a page shows its icon and content, never an empty page's hint, and doesn't add its content again", async ({ alice: page, workspaceId }) => {
    const iconTitle = unique('Icon page');
    const otherTitle = unique('Other page');
    const withIcon = await createPage(page, workspaceId, { title: iconTitle });
    await page.request.patch(`/api/pages/${withIcon}`, { data: { icon: '🔥' } });
    const other = await createPage(page, workspaceId, { title: otherTitle });
    await openPage(page, withIcon);
    await editor(page).click();
    await page.keyboard.type('First line');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second line');
    await waitForSaved(page);
    await openPage(page, other);
    // A little delay, as on a real server, so there's a moment before the content arrives
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 80, downloadThroughput: -1, uploadThroughput: -1 });

    for (let visit = 0; visit < 3; visit += 1) {
      // Note what each frame shows while the page opens
      await page.evaluate((id) => {
        const seen = new Set<string>();
        (window as any).__seen = seen;
        const started = performance.now();
        const tick = () => {
          // Once the new page's editor is in (the one before can show for a frame as it leaves)
          if (!location.pathname.endsWith(id) || !document.querySelector('.ProseMirror')) {
            requestAnimationFrame(tick);
            return;
          }
          seen.add(`icon:${document.querySelector('.page-icon-main__icon')?.textContent?.trim()}`);
          const empty = document.querySelector('.ProseMirror .is-editor-empty');
          if (empty && getComputedStyle(empty, '::before').content.includes('/')) seen.add('hint');
          if (performance.now() - started < 1500) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, withIcon);
      await sidebarItem(page, iconTitle).click();
      await expect(editor(page)).toHaveText('First lineSecond line');
      await page.waitForTimeout(1600);
      const seen = await page.evaluate(() => [...(window as any).__seen]);
      expect(seen.filter((s) => s.startsWith('icon:') && s !== 'icon:undefined')).toEqual(['icon:🔥']);
      expect(seen).not.toContain('hint');
      await expect(editor(page)).toHaveText('First lineSecond line');
      await sidebarItem(page, otherTitle).click();
      await page.waitForURL(`**/doc/${other}`);
    }
  });

  test('repairs a title doubled by that bug', async ({ alice: page, workspaceId }) => {
    const pageTitle = unique('Doubled');
    const id = await createPage(page, workspaceId, { title: pageTitle });
    await openPage(page, id);
    const title = page.getByRole('main').getByRole('textbox').first();
    await expect(title).toHaveValue(pageTitle);
    // Double the live title directly, as the bug did
    await page.evaluate((t) => {
      const { state } = (document.querySelector('.ProseMirror') as any).editor;
      const ySync = state.plugins.find((p: any) => p.key.startsWith('y-sync'));
      ySync.getState(state).doc.getText('title').insert(0, t);
    }, pageTitle);
    await expect(title).toHaveValue(pageTitle + pageTitle);
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(title).toHaveValue(pageTitle);
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
