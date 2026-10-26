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
  });
});
