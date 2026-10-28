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

  test('moving between pages never shows an empty page: the last one stays until the next is in', async ({ alice: page, workspaceId }) => {
    const pages: { id: string; title: string; text: string }[] = [];
    for (const label of ['First', 'Second']) {
      const title = unique(label);
      const id = await createPage(page, workspaceId, { title });
      await openPage(page, id);
      await editor(page).click();
      await page.keyboard.type(`${label} page text`);
      await waitForSaved(page);
      pages.push({ id, title, text: `${label} page text` });
    }
    // A delay, as on a real server, for requests and the live connection both (Chrome's own
    // throttling leaves the live connection alone, which is where a page's content comes from)
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 80, downloadThroughput: -1, uploadThroughput: -1 });
    await page.routeWebSocket(/\/collab/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => setTimeout(() => server.send(message), 100));
      server.onMessage((message) => setTimeout(() => ws.send(message), 100));
    });
    await page.reload();
    await expect(editor(page)).toHaveText(pages[1].text);

    for (const to of [pages[0], pages[1], pages[0]]) {
      // Note any frame where the page body shows neither the last page nor this one's content
      await page.evaluate((text) => {
        const blank: string[] = [];
        (window as any).__blank = blank;
        const started = performance.now();
        const tick = () => {
          if (!document.querySelector('.page-hold')) {
            const live = document.querySelector('.ProseMirror:not(.page-hold *)')?.textContent || '';
            const body = document.querySelector('.page-body-slot > .page-body');
            // Fading the new content in from nothing as the copy went left a blank moment too
            const faint = body && Number(getComputedStyle(body).opacity) < 0.9;
            if (!live.trim()) blank.push(`${Math.round(performance.now() - started)}ms: ${live ? 'other text' : 'empty'}`);
            else if (faint) blank.push(`${Math.round(performance.now() - started)}ms: faint`);
            else if (live !== text && performance.now() - started > 5) blank.push(`${Math.round(performance.now() - started)}ms: "${live}"`);
          }
          if (performance.now() - started < 1200) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, to.text);
      await sidebarItem(page, to.title).click();
      await expect(editor(page)).toHaveText(to.text);
      await page.waitForTimeout(1300);
      // The page being left counts until the click lands; after that, only this one's text
      const blank: string[] = await page.evaluate(() => (window as any).__blank);
      expect(blank.filter((frame) => !frame.includes('"First page text"') && !frame.includes('"Second page text"'))).toEqual([]);
    }
  });

  test('a slow page fades the last one, then shows placeholder lines, then its content', async ({ alice: page, workspaceId }) => {
    // A full-width window: the page is centred there, and the placeholder lines once had no room
    await page.setViewportSize({ width: 1920, height: 1000 });
    const slowTitle = unique('Slow');
    const slow = await createPage(page, workspaceId, { title: slowTitle });
    await openPage(page, slow);
    await editor(page).click();
    await page.keyboard.type('Worth the wait');
    await waitForSaved(page);
    await openPage(page, await createPage(page, workspaceId));
    await page.route(/\/api\/pages\/[0-9a-f-]{36}(\?|$)/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.continue();
    });

    await page.evaluate(() => {
      const stages: string[] = [];
      (window as any).__stages = stages;
      const tick = () => {
        const stage = (document.querySelector('.page-hold') as HTMLElement | null)?.dataset.stage || 'none';
        if (stages[stages.length - 1] !== stage) stages.push(stage);
        if (stages.length < 6) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await sidebarItem(page, slowTitle).click();
    // The new page's title is there straight away
    const title = page.getByRole('main').getByRole('textbox').first();
    await expect(title).toHaveValue(slowTitle);
    // The placeholder lines show, under the title
    const line = page.locator('.page-hold[data-stage="skeleton"] .page-hold__line').first();
    await expect(line).toBeVisible();
    const lineBox = (await line.boundingBox())!;
    expect(lineBox.width).toBeGreaterThan(200);
    expect(Math.abs(lineBox.x - (await title.boundingBox())!.x)).toBeLessThan(24);
    await expect(editor(page)).toHaveText('Worth the wait');
    await expect(page.locator('.page-hold')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__stages)).toEqual(['none', 'hold', 'fade', 'skeleton', 'none']);
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
          if (!location.pathname.endsWith(id) || !document.querySelector('.ProseMirror:not(.page-hold *)')) {
            requestAnimationFrame(tick);
            return;
          }
          seen.add(`icon:${document.querySelector('.page-icon-main__icon')?.textContent?.trim()}`);
          const empty = document.querySelector('.ProseMirror:not(.page-hold *) .is-editor-empty');
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

  test('an image comes from the browser cache when its page is opened again', async ({ alice: page, workspaceId }) => {
    const pageId = await createPage(page, workspaceId, { title: unique('Cached image') });
    await openPage(page, pageId);
    const png = await makePng(page, 200, 100);
    await editor(page).click();
    await page.keyboard.type('/image');
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await chooser).setFiles({ name: 'cached.png', mimeType: 'image/png', buffer: png });
    const img = editor(page).locator('img');
    const shown = () => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth === 200 && el.currentSrc.includes('/api/uploads/'));
    await expect.poll(shown).toBe(true);
    await waitForSaved(page);

    // Watch where the image comes from as the page opens again. Chrome reports one from its
    // memory cache as served from the cache, and one from its disk cache with fromDiskCache.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    const uploads = new Map<string, { cached: boolean }>();
    cdp.on('Network.requestWillBeSent', (e: any) => {
      if (e.request.url.includes('/api/uploads/')) uploads.set(e.requestId, { cached: false });
    });
    cdp.on('Network.requestServedFromCache', (e: any) => {
      const upload = uploads.get(e.requestId);
      if (upload) upload.cached = true;
    });
    cdp.on('Network.responseReceived', (e: any) => {
      const upload = uploads.get(e.requestId);
      if (upload && e.response.fromDiskCache) upload.cached = true;
    });
    await page.goto('/');
    await page.goto(`/doc/${pageId}`);
    await expect.poll(shown).toBe(true);
    const loads = [...uploads.values()];
    expect(loads.length).toBeGreaterThan(0);
    // None of them went to the server
    expect(loads.filter((load) => !load.cached)).toEqual([]);
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
