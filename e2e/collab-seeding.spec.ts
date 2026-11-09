import { test, expect, createPage, openPage, blockTexts, placeCursor } from './fixtures';

// A page's saved content reaches its live document from the server, not from the first browser to
// open it: so it isn't that person's to undo, and two opening at once don't each put it in.

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

test.describe('opening a page with saved content', () => {
  test("undo straight after opening doesn't take the page's content away", async ({ alice, workspaceId }) => {
    const id = await createPage(alice, workspaceId);
    const res = await alice.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content: [p('Important existing text'), p('Second paragraph')] } } });
    expect(res.status()).toBe(200);
    await openPage(alice, id);
    await placeCursor(alice, 1, 'end');
    await alice.keyboard.press('ControlOrMeta+z');
    await alice.waitForTimeout(500);
    expect(await blockTexts(alice)).toEqual(['Important existing text', 'Second paragraph']);
  });

  test('two people opening it at the same moment see it once', async ({ alice, bob, workspaceId }) => {
    const id = await createPage(alice, workspaceId);
    const res = await alice.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content: [p('Alpha'), p('Bravo')] } } });
    expect(res.status()).toBe(200);
    await Promise.all([openPage(alice, id), openPage(bob, id)]);
    await alice.waitForTimeout(1500);
    expect(await blockTexts(alice)).toEqual(['Alpha', 'Bravo']);
    expect(await blockTexts(bob)).toEqual(['Alpha', 'Bravo']);
  });
});
