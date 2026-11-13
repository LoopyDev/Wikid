import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, editor, placeCursor } from './fixtures';

/** A page of `count` paragraphs, open with the cursor in the middle one. */
async function openPageOf(page: Page, workspaceId: string, count: number) {
  const id = await createPage(page, workspaceId);
  const content = {
    type: 'doc',
    content: Array.from({ length: count }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Paragraph ${i} with a few words in it, as pages have.` }] })),
  };
  expect((await page.request.put(`/api/pages/${id}/content`, { data: { content } })).status()).toBe(200);
  await openPage(page, id);
  await expect(editor(page).locator('p')).toHaveCount(count, { timeout: 30_000 });
  await placeCursor(page, Math.floor(count / 2), 'end');
  await page.waitForTimeout(500);
}

/** The middle time, in ms, the page takes to handle one typed letter (until it can paint again). */
async function timePerKey(page: Page) {
  return page.evaluate(async () => {
    const times: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      const start = performance.now();
      document.execCommand('insertText', false, 'x');
      await new Promise((resolve) => setTimeout(resolve, 0));
      times.push(performance.now() - start);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return times.sort((a, b) => a - b)[10];
  });
}

test.describe('large pages', () => {
  test('typing on a 1,000-block page is about as quick as on a short one', async ({ alice, workspaceId }) => {
    test.setTimeout(120_000);
    // The better of two runs each, so a pause on a busy machine doesn't decide it
    await openPageOf(alice, workspaceId, 50);
    const short = Math.min(await timePerKey(alice), await timePerKey(alice));
    await openPageOf(alice, workspaceId, 1000);
    const long = Math.min(await timePerKey(alice), await timePerKey(alice));
    console.log(`time per key: ${short.toFixed(1)} ms on 50 blocks, ${long.toFixed(1)} ms on 1,000`);
    // Each keystroke used to redo work for the whole page: 1,000 blocks took several times as long
    expect(long).toBeLessThan(short * 2.5 + 8);
  });
});
