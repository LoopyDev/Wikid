import { test, expect, createPage, openPage, editor, blockTexts, outline, placeCursor } from './fixtures';

// Everyday editing that used to go wrong.

test.describe('editing basics', () => {
  test('after selecting everything and deleting it, the page takes typing again, for everyone and after a reload', async ({ alice, bob, workspaceId }) => {
    const id = await createPage(alice, workspaceId);
    await openPage(alice, id);
    await openPage(bob, id);
    await editor(alice).click();
    await alice.keyboard.type('Line one', { delay: 20 });
    await alice.keyboard.press('Enter');
    await alice.keyboard.type('Line two', { delay: 20 });
    await expect.poll(() => blockTexts(bob)).toEqual(['Line one', 'Line two']);

    await alice.keyboard.press('ControlOrMeta+a');
    await alice.keyboard.press('Backspace');
    await alice.keyboard.type('Fresh start', { delay: 30 });
    await expect.poll(() => blockTexts(alice)).toEqual(['Fresh start']);
    await expect.poll(() => blockTexts(bob)).toEqual(['Fresh start']);

    await placeCursor(bob, 0, 'end');
    await bob.keyboard.type(' and more', { delay: 30 });
    await expect.poll(() => blockTexts(alice)).toEqual(['Fresh start and more']);

    await openPage(alice, id);
    await placeCursor(alice, 0, 'end');
    await alice.keyboard.type('!', { delay: 30 });
    await expect.poll(() => blockTexts(alice)).toEqual(['Fresh start and more!']);
  });

  test('a page emptied before this fix takes typing once opened', async ({ alice, workspaceId }) => {
    const id = await createPage(alice, workspaceId);
    await openPage(alice, id);
    await editor(alice).click();
    await alice.keyboard.type('Something', { delay: 20 });
    await alice.keyboard.press('ControlOrMeta+a');
    await alice.keyboard.press('Backspace');
    await alice.waitForTimeout(3000); // saved like that
    await openPage(alice, id);
    await editor(alice).click();
    await alice.keyboard.type('Typed after reopening', { delay: 30 });
    await expect.poll(() => outline(alice)).toEqual(['paragraph: Typed after reopening']);
  });

  for (const [command, type] of [['divider', 'horizontalRule'], ['contents', 'tableOfContents'], ['diagram', 'drawio']]) {
    test(`a ${type} put in from the / menu is followed by a line to type on, not replaced by the next key`, async ({ alice, workspaceId }) => {
      const id = await createPage(alice, workspaceId);
      await openPage(alice, id);
      await editor(alice).click();
      await alice.keyboard.type('Before', { delay: 20 });
      await alice.keyboard.press('Enter');
      await alice.keyboard.type(`/${command}`, { delay: 40 });
      await expect(alice.locator('.slash-menu')).toBeVisible();
      await alice.keyboard.press('Enter');
      await alice.keyboard.type('After', { delay: 30 });
      await expect.poll(() => outline(alice)).toEqual(['paragraph: Before', type, 'paragraph: After']);
    });
  }

  test('a divider put in just above a line with text gets a new line to type on, in front of nothing', async ({ alice, workspaceId }) => {
    const id = await createPage(alice, workspaceId);
    const p = (text?: string) => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
    const res = await alice.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content: [p('Intro'), p(), p('Existing text')] } } });
    expect(res.status()).toBe(200);
    await openPage(alice, id);
    await placeCursor(alice, 1, 'start');
    await alice.keyboard.type('/divider', { delay: 40 });
    await expect(alice.locator('.slash-menu')).toBeVisible();
    await alice.keyboard.press('Enter');
    await alice.keyboard.type('New', { delay: 30 });
    await expect.poll(() => outline(alice)).toEqual(['paragraph: Intro', 'horizontalRule', 'paragraph: New', 'paragraph: Existing text']);
  });

  test('typing into an empty table cell stays in the cell', async ({ alice, workspaceId }) => {
    const cell = (type: string, text = '') => ({ type, content: [{ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }] });
    const row = (type: string, first = '') => ({ type: 'tableRow', content: [cell(type, first), cell(type), cell(type)] });
    const id = await createPage(alice, workspaceId);
    const res = await alice.request.put(`/api/pages/${id}/content`, {
      data: { content: { type: 'doc', content: [{ type: 'table', content: [row('tableHeader', 'Name'), row('tableCell'), row('tableCell')] }, { type: 'paragraph' }] } },
    });
    expect(res.status()).toBe(200);
    await openPage(alice, id);
    await editor(alice).locator('td').nth(1).click();
    await alice.keyboard.type('mid', { delay: 40 });
    await expect.poll(() => alice.evaluate(() => [...document.querySelectorAll('.ProseMirror td')].map((td) => td.textContent))).toEqual(['', 'mid', '', '', '', '']);
    expect(await outline(alice)).not.toContain('paragraph: id');
  });

  test('typing into a cell of a table put in from the / menu stays in the cell', async ({ alice, workspaceId }) => {
    const id = await createPage(alice, workspaceId);
    await openPage(alice, id);
    await editor(alice).click();
    await alice.keyboard.type('/table', { delay: 40 });
    await alice.locator('.slash-menu .slash-item', { has: alice.locator('.slash-item__title', { hasText: /^Table$/ }) }).click();
    await expect(editor(alice).locator('td').first()).toBeVisible();
    await editor(alice).locator('td').nth(1).click();
    await alice.keyboard.type('mid', { delay: 40 });
    await expect.poll(() => alice.evaluate(() => [...document.querySelectorAll('.ProseMirror td')].map((td) => td.textContent).filter(Boolean))).toEqual(['mid']);
    expect((await outline(alice)).filter((line) => line.startsWith('paragraph: '))).toEqual([]);
  });

  // Known: redo after undoing back to an empty page adds a blank line first and leaves out the last
  // change (y-tiptap's undo; scan item 2.16). Expected to fail until that's fixed.
  test.fail('undoing back to an empty page and redoing brings every line back, and nothing else', async ({ alice, workspaceId }) => {
    const id = await createPage(alice, workspaceId);
    await openPage(alice, id);
    await editor(alice).click();
    for (const [i, line] of ['One', 'Two', 'Three'].entries()) {
      if (i) await alice.keyboard.press('Enter');
      await alice.keyboard.type(line, { delay: 30 });
      await alice.waitForTimeout(700); // separate undo steps
    }
    await expect.poll(() => blockTexts(alice)).toEqual(['One', 'Two', 'Three']);
    for (let i = 0; i < 3; i += 1) {
      await alice.keyboard.press('ControlOrMeta+z');
      await alice.waitForTimeout(150);
    }
    for (let i = 0; i < 3; i += 1) {
      await alice.keyboard.press('ControlOrMeta+Shift+z');
      await alice.waitForTimeout(150);
    }
    await expect.poll(() => blockTexts(alice)).toEqual(['One', 'Two', 'Three']);
  });

  // Pauses the live-editing server for everyone: run with the other tests that change shared state
  // (one at a time there, see playwright.config.ts)
  test("asks before leaving with changes the server hasn't got yet", { tag: '@shared-state' }, async ({ alice, workspaceId }) => {
    // Pauses the stack's live-editing server (as CI starts it, or COMPOSE_PROJECT_NAME's); skipped
    // where the tests can't reach Docker
    const { execSync } = await import('node:child_process');
    const compose = (cmd: string) => execSync(`docker compose -f docker-compose.yml ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    let collabRunning = false;
    try {
      collabRunning = compose('ps -q collab').trim().length > 0;
    } catch {
      collabRunning = false;
    }
    test.skip(!collabRunning, "Needs the stack's live-editing server, through docker compose");
    const id = await createPage(alice, workspaceId);
    await openPage(alice, id);
    await editor(alice).click();
    await alice.keyboard.type('Saved', { delay: 20 });
    await alice.waitForTimeout(1500);
    const asksToStay = () => alice.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
    expect(await asksToStay()).toBe(false);
    compose('pause collab');
    try {
      await alice.keyboard.type(' not yet', { delay: 20 });
      await alice.waitForTimeout(500);
      expect(await asksToStay()).toBe(true);
    } finally {
      compose('unpause collab');
    }
    await expect.poll(asksToStay, { timeout: 15_000 }).toBe(false);
  });
});

