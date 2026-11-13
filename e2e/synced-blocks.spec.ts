import type { Page } from '@playwright/test';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { test, expect, createPage, openPage, editor, placeCursor, waitForSaved, unique } from './fixtures';

// A synced block: a block pasted onto another page by its link, kept in step with the original.

test.describe('synced blocks', () => {
  test('a pasted block link becomes a synced copy that follows the original', async ({ alice: page, workspaceId }) => {
    const sourceId = await createPage(page, workspaceId, { title: unique('Source') });
    const targetId = await createPage(page, workspaceId, { title: unique('Target') });

    // The original: one paragraph on the source page.
    await openPage(page, sourceId);
    await editor(page).click();
    await page.keyboard.type('Shared words', { delay: 20 });
    await waitForSaved(page);
    const blockId = await page.evaluate(() => {
      const doc = (document.querySelector('.ProseMirror') as any).editor.getJSON();
      return doc.content.find((n: any) => n.type === 'paragraph' && n.content?.length)?.attrs?.id as string;
    });
    expect(blockId).toBeTruthy();

    // Paste its link on the target page, and say yes to "Paste as a synced block reference?".
    await openPage(page, targetId);
    await editor(page).click();
    page.once('dialog', (dialog) => dialog.accept());
    const link = `${new URL(page.url()).origin}/ws/${workspaceId}/doc/${sourceId}#${blockId}`;
    await page.evaluate((text) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, link);
    const copy = editor(page).locator('[data-synced-from]');
    await expect(copy).toHaveText('Shared words');
    await waitForSaved(page);

    // Change the original; the copy follows.
    await openPage(page, sourceId);
    await placeCursor(page, 0, 'end');
    await page.keyboard.type(' and more', { delay: 20 });
    await waitForSaved(page);
    await openPage(page, targetId);
    await expect(copy).toHaveText('Shared words and more');
    // Still shared for the copy: opening a page doesn't drop its references while its content loads
    await page.waitForTimeout(1000);
    expect(Object.keys(await syncedBlocksIn(page, workspaceId))).toEqual([`${sourceId}:${blockId}`]);
  });
});

/** Connects to the workspace's synced-blocks document as someone with the workspace open. */
async function connectSyncedBlocksDoc(page: Page, workspaceId: string) {
  const { token } = await (await page.request.post('/api/collab/token', { data: { workspaceId } })).json();
  const base = new URL(process.env.WIKID_BASE_URL || 'http://localhost:8089');
  const url = `${base.protocol === 'https:' ? 'wss:' : 'ws:'}//${base.host}/collab`;
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({ url, name: `ws:${workspaceId}:synced-blocks`, token, document: doc });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('synced-blocks document never synced')), 10_000);
    provider.on('synced', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  return { doc, provider };
}

/** The blocks in the workspace's synced-blocks document, as someone opening it receives them. */
async function syncedBlocksIn(page: Page, workspaceId: string) {
  const { doc, provider } = await connectSyncedBlocksDoc(page, workspaceId);
  const blocks = doc.getMap('syncedBlocks').toJSON();
  provider.destroy();
  return blocks;
}

test.describe('the synced-blocks document', () => {
  test("holds only blocks something is synced from, so nobody gets another person's private page through it", async ({ alice, bob, workspaceId }) => {
    const secret = await createPage(alice, workspaceId, { title: unique('Private'), visibility: 'PRIVATE' });
    await openPage(alice, secret);
    await editor(alice).click();
    await alice.keyboard.type('Only for Alice', { delay: 20 });
    await waitForSaved(alice);
    await alice.waitForTimeout(1000);
    expect(JSON.stringify(await syncedBlocksIn(bob, workspaceId))).not.toContain('Only for Alice');
  });

  test('blocks nothing refers to are taken out, so a page that copies them all (an old tab) leaks nothing', async ({ alice, workspaceId }) => {
    test.setTimeout(60_000);
    const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    // Kept open, as a workspace usually is (with nobody in it, it's tidied when next opened)
    const { doc, provider } = await connectSyncedBlocksDoc(alice, workspaceId);
    const blocks = doc.getMap('syncedBlocks');
    doc.transact(() => {
      blocks.set('page-a:block-old', paragraph('Copied when the page was opened'));
      // A block and the page referring to it arrive together, as when a block link is pasted
      blocks.set('page-a:block-shared', paragraph('Synced from'));
      const refs = new Y.Map();
      refs.set('page-b', 1);
      doc.getMap('syncedRefs').set('page-a:block-shared', refs);
    });
    // Not straight away: a copy cut and pasted is unreferenced for a moment (10 seconds' grace)
    await alice.waitForTimeout(3_000);
    expect([...blocks.keys()].sort()).toEqual(['page-a:block-old', 'page-a:block-shared']);
    await expect.poll(() => [...blocks.keys()], { timeout: 20_000 }).toEqual(['page-a:block-shared']);
    provider.destroy();
  });
});
