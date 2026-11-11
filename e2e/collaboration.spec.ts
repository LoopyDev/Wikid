import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, editor, blockTexts, placeCursor } from './fixtures';

// Alice and Bob edit the same page in separate browser sessions.

/** Opens a page for both, with two lines Alice typed. */
async function sharedPage(alice: Page, bob: Page, workspaceId: string) {
  const id = await createPage(alice, workspaceId);
  await openPage(alice, id);
  await openPage(bob, id);
  await editor(alice).click();
  await alice.keyboard.type('Line one:', { delay: 30 });
  await alice.keyboard.press('Enter');
  await alice.keyboard.type('Line two:', { delay: 30 });
  await expect.poll(() => blockTexts(bob)).toEqual(['Line one:', 'Line two:']);
}

/** Who made each top-level block's element and text in this person's live document: "me" or "other". */
const owners = (page: Page) =>
  page.evaluate(() => {
    const ed = (document.querySelector('.ProseMirror:not(.page-hold *)') as any).editor;
    const sync = ed.state.plugins.find((plugin: any) => plugin.key.startsWith('y-sync'));
    const fragment = sync.getState(ed.state).type;
    const me = fragment.doc.clientID;
    return fragment.toArray().map((element: any) => {
      const text = element.toArray()[0];
      const items: string[] = [];
      for (let item = text?._start; item; item = item.right) if (!item.deleted) items.push(item.id.client === me ? 'me' : 'other');
      // The block's text, from its text items (not its markup)
      const plain = element
        .toArray()
        .map((child: any) => (typeof child.toDelta === 'function' ? child.toDelta().map((op: any) => (typeof op.insert === 'string' ? op.insert : '')).join('') : ''))
        .join('');
      return `${plain}: ${element._item.id.client === me ? 'me' : 'other'}/${[...new Set(items)].join('+') || '-'}`;
    });
  });

test.describe('editing together', () => {
  test("shows each other's typing live", async ({ alice, bob, workspaceId }) => {
    await sharedPage(alice, bob, workspaceId);
    await placeCursor(bob, 1, 'end');
    await bob.keyboard.type(' from Bob', { delay: 30 });
    await expect.poll(() => blockTexts(alice)).toEqual(['Line one:', 'Line two: from Bob']);
  });

  test('both typing fast in the same line keeps each person\'s text in order', async ({ alice, bob, workspaceId }) => {
    await sharedPage(alice, bob, workspaceId);
    await placeCursor(alice, 0, 'end');
    await placeCursor(bob, 0, 'start');

    const aliceText = ' 0123456789abcdefghij';
    const bobText = 'ABCDEFGHIJKLMNOPQRST ';
    await Promise.all([alice.keyboard.type(aliceText, { delay: 20 }), bob.keyboard.type(bobText, { delay: 20 })]);

    const expected = [`${bobText}Line one:${aliceText}`, 'Line two:'];
    await expect.poll(() => blockTexts(alice)).toEqual(expected);
    await expect.poll(() => blockTexts(bob)).toEqual(expected);
  });

  test('both typing at the end of the same line keeps both texts whole', async ({ alice, bob, workspaceId }) => {
    await sharedPage(alice, bob, workspaceId);
    await placeCursor(alice, 0, 'end');
    await placeCursor(bob, 0, 'end');

    await Promise.all([alice.keyboard.type(' 0123456789', { delay: 20 }), bob.keyboard.type(' ABCDEFGHIJ', { delay: 20 })]);

    // Nothing's lost and each run of letters stays whole. Which space ends up where isn't checked:
    // when both type a space at the very same spot in the same instant, one cursor can land
    // between the two (about 1 run in 100), so the spaces swap places
    await expect.poll(async () => {
      const [first] = await blockTexts(alice);
      return first.startsWith('Line one:') && first.includes('0123456789') && first.includes('ABCDEFGHIJ') && first.length === 'Line one:'.length + 22;
    }).toBe(true);
    await expect.poll(() => blockTexts(bob)).toEqual(await blockTexts(alice));
  });

  test('pressing Enter while the other person types elsewhere', async ({ alice, bob, workspaceId }) => {
    await sharedPage(alice, bob, workspaceId);
    await placeCursor(alice, 1, 'end');
    await placeCursor(bob, 0, 'end');

    await Promise.all([
      (async () => {
        for (const word of ['alpha', 'beta', 'gamma']) {
          await alice.keyboard.press('Enter');
          await alice.keyboard.type(word, { delay: 20 });
        }
      })(),
      bob.keyboard.type(' 0123456789', { delay: 20 }),
    ]);

    const expected = ['Line one: 0123456789', 'Line two:', 'alpha', 'beta', 'gamma'];
    await expect.poll(() => blockTexts(alice)).toEqual(expected);
    await expect.poll(() => blockTexts(bob)).toEqual(expected);
  });

  test("someone pressing Enter at the start of your line leaves it yours, so your Ctrl+Z still undoes it", async ({ alice, bob, workspaceId }) => {
    const id = await createPage(alice, workspaceId);
    await openPage(alice, id);
    await openPage(bob, id);
    await editor(alice).click();
    await alice.keyboard.type('Hello world', { delay: 30 });
    // A pause, so the next line is an undo step of its own (typing within ~0.5s is one)
    await alice.waitForTimeout(1200);
    await alice.keyboard.press('Enter');
    await alice.keyboard.type('Second para', { delay: 30 });
    await expect.poll(() => blockTexts(bob)).toEqual(['Hello world', 'Second para']);

    await placeCursor(bob, 1, 'start');
    await bob.keyboard.press('Enter');
    await expect.poll(() => blockTexts(alice)).toEqual(['Hello world', '', 'Second para']);
    // Her line is still hers in the live document (it was deleted and made again, as Bob's)
    expect(await owners(alice)).toEqual(['Hello world: me/me', ': other/-', 'Second para: me/me']);

    await alice.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => blockTexts(alice)).not.toContain('Second para');
    expect(await blockTexts(alice)).toContain('Hello world');
  });

  test("someone undoing the line they added above yours leaves what you typed since in your line", async ({ alice, bob, workspaceId }) => {
    const id = await createPage(alice, workspaceId);
    await openPage(alice, id);
    await openPage(bob, id);
    await editor(alice).click();
    await alice.keyboard.type('Hello world', { delay: 30 });
    await alice.keyboard.press('Enter');
    await alice.keyboard.type('Second para', { delay: 30 });
    await expect.poll(() => blockTexts(bob)).toEqual(['Hello world', 'Second para']);

    await placeCursor(bob, 1, 'start');
    await bob.keyboard.press('Enter');
    await expect.poll(() => blockTexts(alice)).toEqual(['Hello world', '', 'Second para']);
    await placeCursor(alice, 2, 'end');
    await alice.keyboard.type(' plus', { delay: 30 });
    await expect.poll(() => blockTexts(bob)).toEqual(['Hello world', '', 'Second para plus']);
    await bob.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => blockTexts(alice)).toEqual(['Hello world', 'Second para plus']);
    await expect.poll(() => blockTexts(bob)).toEqual(['Hello world', 'Second para plus']);
  });

  test('a block someone moved keeps what the other person types in it, and the others keep theirs', async ({ alice, bob, workspaceId }) => {
    const id = await createPage(alice, workspaceId);
    const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    expect((await alice.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content: [p('Alpha'), p('Beta'), p('Gamma')] } } })).status()).toBe(200);
    await openPage(alice, id);
    await openPage(bob, id);
    await expect.poll(() => blockTexts(bob)).toEqual(['Alpha', 'Beta', 'Gamma']);
    // Alice moves Alpha to the end (as the block handle's drag does: one change taking it out and
    // putting it back further down)
    await alice.evaluate(() => {
      const ed = (document.querySelector('.ProseMirror:not(.page-hold *)') as any).editor;
      const { state } = ed;
      const alpha = state.doc.child(0);
      const tr = state.tr.delete(0, alpha.nodeSize);
      tr.insert(tr.doc.content.size, alpha);
      ed.view.dispatch(tr);
    });
    await expect.poll(() => blockTexts(bob)).toEqual(['Beta', 'Gamma', 'Alpha']);
    await placeCursor(bob, 2, 'end');
    await bob.keyboard.type(' moved', { delay: 30 });
    await placeCursor(alice, 0, 'end');
    await alice.keyboard.type(' too', { delay: 30 });
    await expect.poll(() => blockTexts(alice)).toEqual(['Beta too', 'Gamma', 'Alpha moved']);
    await expect.poll(() => blockTexts(bob)).toEqual(['Beta too', 'Gamma', 'Alpha moved']);
  });

  // Known to fail: splitting a line copies the text after the split into a new line and deletes it
  // from the old one, so two people splitting one line at the same moment both copy the same text,
  // and it's doubled or lost. Needs a split to be a move in the live document (y-tiptap); a line split
  // and joined again while someone types at its end goes the same way.
  test.fail('two people pressing Enter and typing in the same line at once keep one copy of everything', async ({ alice, bob, workspaceId }) => {
    const id = await createPage(alice, workspaceId);
    await openPage(alice, id);
    await editor(alice).click();
    await alice.keyboard.type('START  END', { delay: 20 });
    await openPage(bob, id);
    await expect.poll(() => blockTexts(bob)).toEqual(['START  END']);
    const at = (page: Page, pos: number) =>
      page.evaluate((p) => {
        const ed = (document.querySelector('.ProseMirror:not(.page-hold *)') as any).editor;
        ed.chain().focus().setTextSelection(p).run();
      }, pos);
    await at(alice, 7);
    await at(bob, 8);
    await Promise.all([
      (async () => { for (let i = 0; i < 3; i += 1) { await alice.keyboard.press('Enter'); await alice.keyboard.type(`a${i}`, { delay: 20 }); } })(),
      (async () => { for (let i = 0; i < 3; i += 1) { await bob.keyboard.press('Enter'); await bob.keyboard.type(`b${i}`, { delay: 20 }); } })(),
    ]);
    await expect.poll(async () => JSON.stringify(await blockTexts(bob)) === JSON.stringify(await blockTexts(alice))).toBe(true);
    const text = (await blockTexts(alice)).join('|');
    // Each piece once: START, END, and every typed line
    for (const piece of ['START', 'END', 'a0', 'a1', 'a2', 'b0', 'b1', 'b2']) {
      expect(text.split(piece).length - 1, `${piece} in ${text}`).toBe(1);
    }
  });
});
