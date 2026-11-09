import { test, expect, createPage, openPage, editor, blockTexts, placeCursor } from './fixtures';

// Block ids: links, synced copies and the Markdown API point at them. Existing ones are kept; new
// ones are random, the same in every browser, and never an id a deleted block had.

const para = (text: string, id: string) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });
const blockIds = (page: import('@playwright/test').Page) =>
  editor(page).locator(':scope > [data-block-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-block-id')));

test.describe('block ids', () => {
  test('new blocks get random ids, the same for everyone; old ids are kept and never handed out again', async ({ alice, bob, workspaceId }) => {
    const id = await createPage(alice, workspaceId);
    const content = { type: 'doc', content: [para('One', 'block-1'), para('Two', 'block-2')] };
    expect((await alice.request.put(`/api/pages/${id}/content`, { data: { content } })).status()).toBe(200);
    await openPage(alice, id);
    await openPage(bob, id);
    await expect.poll(() => blockTexts(bob)).toEqual(['One', 'Two']);

    await placeCursor(alice, 1, 'end');
    await alice.keyboard.press('Enter');
    await alice.keyboard.type('Three', { delay: 20 });
    await expect.poll(() => blockTexts(bob)).toEqual(['One', 'Two', 'Three']);
    const [one, two, three] = await blockIds(alice);
    expect([one, two]).toEqual(['block-1', 'block-2']);
    expect(three).toMatch(/^block-[2-9][a-z0-9]{9}$/);
    await expect.poll(() => blockIds(bob)).toEqual([one, two, three]);

    // Delete the newest block, then add another: it doesn't take the deleted one's id
    await placeCursor(alice, 2, 'end');
    for (let i = 0; i < 'Three'.length + 1; i += 1) await alice.keyboard.press('Backspace');
    await expect.poll(() => blockTexts(bob)).toEqual(['One', 'Two']);
    await alice.keyboard.press('Enter');
    await alice.keyboard.type('Four', { delay: 20 });
    await expect.poll(() => blockTexts(bob)).toEqual(['One', 'Two', 'Four']);
    const after = await blockIds(alice);
    expect(after.slice(0, 2)).toEqual(['block-1', 'block-2']);
    expect(after[2]).not.toBe(three);
    expect(after[2]).not.toBe('block-3');
    await expect.poll(() => blockIds(bob)).toEqual(after);
  });

  test('a link to a block opens the page at that block', async ({ alice, workspaceId }) => {
    const id = await createPage(alice, workspaceId);
    const content = { type: 'doc', content: [para('Top', 'block-k3x9q2m7ab'), para('Linked to', 'block-zz12')] };
    expect((await alice.request.put(`/api/pages/${id}/content`, { data: { content } })).status()).toBe(200);
    // On a slow connection too, where the page's content (from the live connection) comes in well
    // after the page itself
    await alice.routeWebSocket(/\/collab/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => setTimeout(() => server.send(message), 1000));
      server.onMessage((message) => setTimeout(() => ws.send(message), 1000));
    });
    await alice.goto(`/doc/${id}#block-zz12`);
    await expect(editor(alice).locator('[data-block-id="block-zz12"]')).toHaveClass(/block-link-focus/);
  });
});
