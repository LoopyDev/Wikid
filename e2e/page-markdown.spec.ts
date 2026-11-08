import { test, expect, createPage, openPage, editor, blockTexts, placeCursor } from './fixtures';

// Content written through the API (as the MCP server does) reaches a page that's open in the
// editor, live: once a page has been opened, its live document is what it holds, and a change
// written only to the stored copy used to be lost.

// Without the empty line the editor keeps after a list, to carry on typing in
const texts = async (page: Parameters<typeof blockTexts>[0]) => (await blockTexts(page)).filter(Boolean);

test.describe('content from outside the editor', () => {
  test('reaches a page open in the editor, alongside what was typed there', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId);
    await openPage(page, id);
    await editor(page).click();
    await page.keyboard.type('Typed in the editor', { delay: 20 });
    await expect.poll(() => blockTexts(page)).toEqual(['Typed in the editor']);

    // Added as Markdown, after what was typed
    const added = await page.request.post(`/api/pages/${id}/markdown/blocks`, { data: { markdown: '## Added from outside\n\n- one\n- two' } });
    expect(added.status()).toBe(201);
    await expect.poll(() => texts(page)).toEqual(['Typed in the editor', 'Added from outside', 'onetwo']);

    // Typing carries on as normal after it
    await placeCursor(page, 0, 'end');
    await page.keyboard.type(', and more', { delay: 20 });
    await expect.poll(() => texts(page)).toEqual(['Typed in the editor, and more', 'Added from outside', 'onetwo']);

    // And it was saved: the API reads back the lot
    await expect.poll(async () => (await (await page.request.get(`/api/pages/${id}/markdown`)).json()).markdown).toBe(
      'Typed in the editor, and more\n\n## Added from outside\n\n- one\n- two',
    );
  });

  test('page content saved through the API replaces what an open page shows', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId);
    await openPage(page, id);
    await editor(page).click();
    await page.keyboard.type('Before', { delay: 20 });
    await expect.poll(() => blockTexts(page)).toEqual(['Before']);

    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Saved through the API' }] }] };
    expect((await page.request.put(`/api/pages/${id}/content`, { data: { content } })).status()).toBe(200);
    await expect.poll(() => blockTexts(page)).toEqual(['Saved through the API']);
    // Still there after a reload, not put back by the live document
    await openPage(page, id);
    await expect.poll(() => blockTexts(page)).toEqual(['Saved through the API']);
  });
});
