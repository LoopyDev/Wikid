import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, editor } from './fixtures';

/** How many editors are still in memory after a garbage collection (Chromium's DevTools protocol). */
async function editorsAlive(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  for (let i = 0; i < 3; i += 1) await cdp.send('HeapProfiler.collectGarbage');
  const proto = await cdp.send('Runtime.evaluate', {
    expression: "Object.getPrototypeOf(document.querySelector('.ProseMirror:not(.page-hold *)').editor)",
  });
  if (!proto.result.objectId) throw new Error('No editor on the page to count from');
  const found = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId });
  const count = await cdp.send('Runtime.callFunctionOn', {
    objectId: found.objects.objectId!,
    functionDeclaration: 'function () { return this.length; }',
    returnByValue: true,
  });
  await cdp.detach();
  return count.result.value as number;
}

test.describe('memory', () => {
  test('pages you leave let go of their editors', async ({ alice, workspaceId }) => {
    const titles = ['Memory one', 'Memory two', 'Memory three'];
    const ids: string[] = [];
    for (const title of titles) ids.push(await createPage(alice, workspaceId, { title }));
    await openPage(alice, ids[0]);
    const sidebar = alice.locator('aside.sidebar');
    for (let round = 0; round < 4; round += 1) {
      for (const index of [1, 2, 0]) {
        await sidebar.getByText(titles[index], { exact: true }).click();
        await expect(alice).toHaveURL(new RegExp(ids[index]));
        await expect(editor(alice)).toBeVisible();
        await alice.waitForTimeout(400);
      }
    }
    // Twelve pages opened in turn: only the one open now (and the still copy shown while moving
    // between pages, at most) may be left
    await expect.poll(() => editorsAlive(alice), { timeout: 15_000 }).toBeLessThanOrEqual(2);
  });
});
