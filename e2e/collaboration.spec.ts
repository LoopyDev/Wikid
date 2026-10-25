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

    await expect.poll(async () => {
      const [first] = await blockTexts(alice);
      return first.includes(' 0123456789') && first.includes(' ABCDEFGHIJ') && first.length === 'Line one:'.length + 22;
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
});
