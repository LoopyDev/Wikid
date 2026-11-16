import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, editor, blockTexts, outline, placeCursor, focusEditorAt, pastePlainText, waitForSaved } from './fixtures';

// Everyday editing that used to go wrong.

// What's been typed so far is one change to undo (Yjs runs typing within half a second together)
const endUndoStep = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const { state } = (document.querySelector('.ProseMirror') as any).editor.view;
    state.plugins.find((p: any) => p.key.startsWith('y-undo$')).getState(state).undoManager.stopCapturing();
  });

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

  // Redo after undoing back to an empty page put an empty line above what came back: the empty line
  // the editor shows on a blank page had gone into the live document. Redone at once, or after a pause
  const undoAllThenRedo = async (alice: Page, lines: string[], pause: number) => {
    await editor(alice).click();
    for (const [i, line] of lines.entries()) {
      if (i) await alice.keyboard.press('Enter');
      await alice.keyboard.type(line, { delay: 30 });
      await alice.waitForTimeout(700); // separate undo steps
    }
    await expect.poll(() => blockTexts(alice)).toEqual(lines);
    for (let i = 0; i < lines.length; i += 1) {
      await alice.keyboard.press('ControlOrMeta+z');
      await alice.waitForTimeout(150);
    }
    await expect.poll(() => blockTexts(alice)).toEqual(['']);
    await alice.waitForTimeout(pause);
    for (let i = 0; i < lines.length; i += 1) {
      await alice.keyboard.press('ControlOrMeta+Shift+z');
      await alice.waitForTimeout(150);
    }
  };
  for (const [lines, pause] of [[['One', 'Two', 'Three'], 800], [['One', 'Two', 'Three'], 0], [['Only'], 800]] as const) {
    test(`undoing back to an empty page and redoing brings every line back, and nothing else (${lines.length} lines, ${pause}ms)`, async ({ alice, workspaceId }) => {
      await openPage(alice, await createPage(alice, workspaceId));
      await undoAllThenRedo(alice, [...lines], pause);
      await expect.poll(() => blockTexts(alice)).toEqual(lines);
      // ...and it stays that way, saved
      await waitForSaved(alice);
      await alice.reload();
      await expect.poll(() => blockTexts(alice).catch(() => [])).toEqual(lines);
    });
  }

  test('an empty line typed before undoing everything comes back with the redo', async ({ alice, workspaceId }) => {
    await openPage(alice, await createPage(alice, workspaceId));
    await editor(alice).click();
    await alice.keyboard.type('Top', { delay: 30 });
    await alice.waitForTimeout(700);
    // An empty line, kept as one step with what's typed under it
    await alice.keyboard.press('Enter');
    await alice.keyboard.press('Enter');
    await alice.keyboard.type('Below', { delay: 30 });
    await alice.waitForTimeout(700);
    await expect.poll(() => blockTexts(alice)).toEqual(['Top', '', 'Below']);
    for (let i = 0; i < 2; i += 1) {
      await alice.keyboard.press('ControlOrMeta+z');
      await alice.waitForTimeout(150);
    }
    await expect.poll(() => blockTexts(alice)).toEqual(['']);
    await alice.waitForTimeout(800);
    for (let i = 0; i < 2; i += 1) {
      await alice.keyboard.press('ControlOrMeta+Shift+z');
      await alice.waitForTimeout(150);
    }
    await expect.poll(() => blockTexts(alice)).toEqual(['Top', '', 'Below']);
    // ...saved so, the empty line too
    await waitForSaved(alice);
    await alice.reload();
    await expect.poll(() => blockTexts(alice).catch(() => [])).toEqual(['Top', '', 'Below']);
  });

  test('after undoing everything, what is typed next is what the page has, saved', async ({ alice, workspaceId }) => {
    await openPage(alice, await createPage(alice, workspaceId));
    await editor(alice).click();
    await alice.keyboard.type('Old', { delay: 30 });
    await alice.waitForTimeout(700);
    await alice.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => blockTexts(alice)).toEqual(['']);
    await alice.keyboard.type('New', { delay: 30 });
    await alice.keyboard.press('Enter');
    await alice.keyboard.type('Second', { delay: 30 });
    await expect.poll(() => blockTexts(alice)).toEqual(['New', 'Second']);
    await waitForSaved(alice);
    await alice.reload();
    await expect.poll(() => blockTexts(alice).catch(() => [])).toEqual(['New', 'Second']);
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

  test('Backspace on an empty first line removes it and keeps typing going, at the start of the next', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId);
    const p = (text?: string) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' });
    expect((await page.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content: [p(), p('second'), p('third')] } } })).status()).toBe(200);
    await openPage(page, id);
    await placeCursor(page, 0, 'start');
    await page.keyboard.press('Backspace');
    await expect.poll(() => blockTexts(page)).toEqual(['second', 'third']);
    await page.waitForTimeout(300);
    // Still typing in the page (the cursor was taken out of it, so the next key went nowhere)
    expect(await page.evaluate(() => !!document.activeElement?.closest('.ProseMirror'))).toBe(true);
    await page.keyboard.type('X', { delay: 20 });
    await expect.poll(() => blockTexts(page)).toEqual(['Xsecond', 'third']);
  });

  test('Backspace on an empty first line before an image leaves the image alone', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId);
    const content = [{ type: 'paragraph' }, { type: 'horizontalRule' }, { type: 'paragraph', content: [{ type: 'text', text: 'after' }] }];
    expect((await page.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content } } })).status()).toBe(200);
    await openPage(page, id);
    await placeCursor(page, 0, 'start');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('X', { delay: 20 });
    await expect.poll(() => outline(page)).toEqual(['horizontalRule', 'paragraph: Xafter']);
  });

  test('Backspace and Enter around a callout: join the line after it, turn it back into text, leave it', async ({ alice: page, workspaceId }) => {
    const p = (text?: string) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' });
    const callout = (...content: unknown[]) => ({ type: 'callout', attrs: { icon: '💡' }, content });
    // The cursor at the start or end of the callout's first line (Home and End scroll the page on a Mac)
    const inCallout = async (where: 'start' | 'end') => {
      const target = await page.evaluate((at) => {
        const editorEl = document.querySelector('.ProseMirror:not(.page-hold *)') as any;
        const doc = editorEl.editor.state.doc;
        let target = -1;
        doc.descendants((node: any, pos: number) => {
          if (target >= 0) return false;
          if (node.type.name === 'callout') {
            const line = node.firstChild;
            target = at === 'start' ? pos + 2 : pos + 1 + line.nodeSize - 1;
            return false;
          }
          return true;
        });
        return target;
      }, where);
      await focusEditorAt(page, target);
    };
    const open = async (content: unknown[]) => {
      const id = await createPage(page, workspaceId);
      expect((await page.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content } } })).status()).toBe(200);
      await openPage(page, id);
    };

    // At the start of the line after it: that line joins its last line (it used to select the whole
    // callout, which the next key deleted)
    await open([callout(p('inside'), p('line two')), p('next')]);
    await placeCursor(page, 1, 'start');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('!', { delay: 20 });
    await expect.poll(() => outline(page)).toEqual(['callout', '  paragraph: inside', '  paragraph: line two!next']);

    // At the start of a callout: it becomes plain lines again
    await open([p('before'), callout(p('Remember'), p('this'))]);
    await inCallout('start');
    await page.keyboard.press('Backspace');
    await expect.poll(() => outline(page)).toEqual(['paragraph: before', 'paragraph: Remember', 'paragraph: this']);

    // Enter on an empty last line leaves it
    await open([callout(p('Tip')), p('after')]);
    await inCallout('end');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Outside', { delay: 20 });
    await expect.poll(() => outline(page)).toEqual(['callout', '  paragraph: Tip', 'paragraph: Outside', 'paragraph: after']);
  });

  test('Enter in the title goes to the page at once, so the next keys land there', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId, { title: 'Untitled page' });
    const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    expect((await page.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content: [p('Existing')] } } })).status()).toBe(200);
    await openPage(page, id);
    await expect(editor(page)).toContainText('Existing');
    const title = page.getByRole('main').getByRole('textbox', { name: 'Untitled page' });
    await title.fill('Title');
    await title.press('End');
    // Straight after Enter, with no pause (it used to put the first key in the title)
    await page.keyboard.press('Enter');
    await page.keyboard.type('hello');
    await expect(title).toHaveValue('Title');
    await expect.poll(() => blockTexts(page)).toEqual(['hello', 'Existing']);
    // Enter from the title again and again doesn't pile up empty lines at the top
    for (let i = 0; i < 2; i += 1) {
      await title.click();
      await page.keyboard.press('Enter');
    }
    await expect.poll(() => blockTexts(page)).toEqual(['', 'hello', 'Existing']);
  });

  test("Enter in the title before the page's content has come: the new line still goes first, with what's typed", async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId, { title: 'Untitled page' });
    const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    expect((await page.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content: [p('Existing'), p('Second')] } } })).status()).toBe(200);
    // The live connection's messages from the server held back: the page's content comes late
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    await page.routeWebSocket(/\/collab/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => server.send(message));
      server.onMessage((message) => {
        released.then(() => ws.send(message));
      });
    });
    await page.goto(`/doc/${id}`);
    const title = page.getByRole('main').getByRole('textbox', { name: 'Untitled page' });
    await expect(title).toBeVisible();
    // The editor's there, waiting for the page's content
    await expect(page.locator('.tiptap-wrapper--waiting .ProseMirror')).toBeVisible();
    const titleBefore = await title.inputValue();
    await title.click();
    await title.press('End');
    await page.keyboard.press('Enter');
    // Typing, a mistake put right, another line, and "# " (no heading made of it meanwhile)
    await page.keyboard.type('helo');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('lo');
    await page.keyboard.press('Enter');
    await page.keyboard.type('# world');
    // Shown meanwhile, faintly, at the top
    await expect(page.locator('.pending-top-line')).toHaveText(/hello\s*# world/);
    await page.waitForTimeout(300);
    release();
    await expect.poll(() => blockTexts(page)).toEqual(['hello', '# world', 'Existing', 'Second']);
    await expect(page.locator('.pending-top-line')).toHaveCount(0);
    await expect(title).toHaveValue(titleBefore);
    // The cursor at the end of it: typing goes on there
    await page.keyboard.type('!');
    await expect.poll(() => blockTexts(page)).toEqual(['hello', '# world!', 'Existing', 'Second']);
    // ...and saved so: as another tab opens it (one that's not held back)
    const other = await page.context().newPage();
    await other.goto(`/doc/${id}`);
    await expect.poll(() => blockTexts(other).catch(() => null)).toEqual(['hello', '# world!', 'Existing', 'Second']);
    await other.close();
  });

  test('Backspace and Enter around a toggle heading, and one from the / menu takes the empty line it was on', async ({ alice: page, workspaceId }) => {
    const p = (text?: string) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' });
    const toggle = (collapsed: boolean, title: string, ...content: unknown[]) => ({ type: 'toggleHeading', attrs: { collapsed }, content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: title }] }, ...content] });
    // The cursor at the start of the toggle's heading, or the end of its last line
    const inToggle = async (where: 'start' | 'end') => {
      const target = await page.evaluate((at) => {
        const editorEl = document.querySelector('.ProseMirror:not(.page-hold *)') as any;
        let target = -1;
        editorEl.editor.state.doc.descendants((node: any, pos: number) => {
          if (target >= 0) return false;
          if (node.type.name === 'toggleHeading') {
            target = at === 'start' ? pos + 2 : pos + node.nodeSize - 2;
            return false;
          }
          return true;
        });
        return target;
      }, where);
      await focusEditorAt(page, target);
    };
    const open = async (content: unknown[]) => {
      const id = await createPage(page, workspaceId);
      expect((await page.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content } } })).status()).toBe(200);
      await openPage(page, id);
    };
    const topLevel = () => page.evaluate(() => ((document.querySelector('.ProseMirror') as any).editor.getJSON().content || []).map((n: any) => n.type));

    // At the start of the line after it: that line joins its last line (it used to select the whole toggle)
    await open([toggle(false, 'Plan', p('step')), p('next')]);
    await placeCursor(page, 1, 'start');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('!', { delay: 20 });
    await expect.poll(() => outline(page)).toEqual(['toggleHeading', '  heading2: Plan', '  paragraph: step!next']);

    // Folded, its heading is the last line showing
    await open([toggle(true, 'Plan', p('step')), p('next')]);
    await placeCursor(page, 1, 'start');
    await page.keyboard.press('Backspace');
    await expect.poll(() => outline(page)).toEqual(['toggleHeading', '  heading2: Plannext', '  paragraph: step']);

    // At the start of its heading: it becomes plain blocks again; folded, it opens first
    await open([p('before'), toggle(true, 'Plan', p('step'))]);
    await inToggle('start');
    await page.keyboard.press('Backspace');
    await expect.poll(() => page.evaluate(() => (document.querySelector('.ProseMirror') as any).editor.getJSON().content[1].attrs.collapsed)).toBe(false);
    await page.keyboard.press('Backspace');
    await expect.poll(() => outline(page)).toEqual(['paragraph: before', 'heading2: Plan', 'paragraph: step']);

    // After one ending in a list: the cursor goes to the list's last line, and nothing breaks
    await open([toggle(false, 'Plan', { type: 'bulletList', content: [{ type: 'listItem', content: [p('item')] }] }), p('next')]);
    await placeCursor(page, 1, 'start');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('!', { delay: 20 });
    await expect.poll(() => outline(page)).toEqual(['toggleHeading', '  heading2: Plan', '  bulletList', '    listItem', '      paragraph: item!', 'paragraph: next']);

    // Enter on an empty last line leaves it
    await open([toggle(false, 'Plan', p('step')), p('after')]);
    await inToggle('end');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Outside', { delay: 20 });
    await expect.poll(() => outline(page)).toEqual(['toggleHeading', '  heading2: Plan', '  paragraph: step', 'paragraph: Outside', 'paragraph: after']);

    // From the / menu on an empty line: in that line's place, with no empty line left above it
    await open([p('Intro'), p(), p('After')]);
    await placeCursor(page, 1, 'start');
    await page.keyboard.type('/toggle', { delay: 40 });
    await expect(page.locator('.slash-menu')).toBeVisible();
    await page.keyboard.press('Enter');
    await page.keyboard.type('Plan', { delay: 20 });
    await expect.poll(() => topLevel()).toEqual(['paragraph', 'toggleHeading', 'paragraph']);
    await expect.poll(() => outline(page)).toEqual(['paragraph: Intro', 'toggleHeading', '  heading1: Plan', 'paragraph: After']);
  });

  test("typing shortcuts: not in inline code being typed, nor inside words; *** needs a space to become a divider", async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    await page.keyboard.type('`a -> b != c (c)` f(c) g(r) 3x4, 3 x 4, (c) 2026 -> done', { delay: 15 });
    const textAndCode = () =>
      page.evaluate(() => {
        const json = (document.querySelector('.ProseMirror') as any).editor.getJSON();
        const texts = json.content[0].content || [];
        return { text: texts.map((t: any) => t.text).join(''), code: texts.filter((t: any) => t.marks?.some((m: any) => m.type === 'code')).map((t: any) => t.text) };
      });
    await expect.poll(textAndCode).toEqual({ text: 'a -> b != c (c) f(c) g(r) 3x4, 3 × 4, © 2026 → done', code: ['a -> b != c (c)'] });

    await page.keyboard.press('Enter');
    await page.keyboard.type('***bold italic*** then', { delay: 15 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('*** ', { delay: 15 });
    await page.keyboard.type('below', { delay: 15 });
    await expect.poll(() => outline(page)).toEqual(['paragraph: a -> b != c (c) f(c) g(r) 3x4, 3 × 4, © 2026 → done', 'paragraph: ***bold italic*** then', 'horizontalRule', 'paragraph: below']);
  });

  test("a double-click to the right of a line puts the cursor at its end, and typing doesn't join the next line", async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId);
    const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    expect((await page.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content: [p('First'), p('Second')] } } })).status()).toBe(200);
    await openPage(page, id);
    const first = editor(page).locator('p').first();
    const box = (await first.boundingBox())!;
    await page.mouse.dblclick(box.x + box.width - 20, box.y + box.height / 2);
    await page.keyboard.type('X', { delay: 20 });
    await expect.poll(() => outline(page)).toEqual(['paragraph: FirstX', 'paragraph: Second']);
  });

  test('copied as plain text, list items and table rows (cells apart by tabs) are a line each, with no blank lines between', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    const text = await page.evaluate(() => {
      const ed = (document.querySelector('.ProseMirror') as any).editor;
      const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
      const item = (text: string) => ({ type: 'listItem', content: [p(text)] });
      const cell = (text: string) => ({ type: 'tableCell', content: [p(text)] });
      ed.commands.setContent({ type: 'doc', content: [
        p('Intro'),
        { type: 'bulletList', content: [item('One'), item('Two')] },
        { type: 'table', content: [{ type: 'tableRow', content: [cell('A'), cell('B')] }] },
        p('End'),
      ] });
      ed.commands.selectAll();
      return ed.view.someProp('clipboardTextSerializer', (f: any) => f(ed.state.selection.content(), ed.view));
    });
    expect(text).toBe('Intro\n\nOne\nTwo\n\nA\tB\n\nEnd');
  });

  test("a callout and a toggle heading cut and pasted into another page keep what's in them", async ({ alice: page, workspaceId }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const from = await createPage(page, workspaceId);
    const content = [
      p('Before'),
      { type: 'callout', attrs: { icon: '⚠️', tone: '#fde68a' }, content: [p('Inside the callout')] },
      { type: 'toggleHeading', attrs: { collapsed: false }, content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] }, p('Inside the toggle')] },
      p('After'),
    ];
    expect((await page.request.put(`/api/pages/${from}/content`, { data: { content: { type: 'doc', content } } })).status()).toBe(200);
    await openPage(page, from);
    await placeCursor(page, 0, 'end');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+x');
    await expect.poll(() => blockTexts(page)).toEqual(['']);
    // (On the clipboard before going on)
    await expect
      .poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).includes('Inside the toggle')))
      .toBe(true);

    await openPage(page, await createPage(page, workspaceId));
    await placeCursor(page, 0, 'start');
    await page.keyboard.press('ControlOrMeta+v');
    await expect.poll(() => outline(page)).toEqual([
      'paragraph: Before',
      'callout',
      '  paragraph: Inside the callout',
      'toggleHeading',
      '  heading2: Plan',
      '  paragraph: Inside the toggle',
      'paragraph: After',
    ]);
    // The callout's icon and colour came too
    const callout = await page.evaluate(() => (document.querySelector('.ProseMirror:not(.page-hold *)') as any).editor.getJSON().content[1].attrs);
    expect(callout).toMatchObject({ icon: '⚠️', tone: '#fde68a' });
  });

  test('a block copied and pasted above itself leaves the original its id (links to it still find it)', async ({ alice: page, workspaceId }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const id = await createPage(page, workspaceId);
    const content = [
      { type: 'paragraph', attrs: { id: 'block-keepmine01' }, content: [{ type: 'text', text: 'Linked to' }] },
      { type: 'callout', attrs: { icon: '💡' }, content: [{ type: 'paragraph', attrs: { id: 'block-keepmine02' }, content: [{ type: 'text', text: 'Also linked to' }] }] },
    ];
    expect((await page.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content } } })).status()).toBe(200);
    await openPage(page, id);
    await placeCursor(page, 0, 'end');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+c');
    await expect
      .poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).includes('Also linked to')))
      .toBe(true);
    await placeCursor(page, 0, 'start');
    await page.keyboard.press('ControlOrMeta+v');
    const ids = () =>
      page.evaluate(() => {
        const found: Array<[string, string]> = [];
        (document.querySelector('.ProseMirror:not(.page-hold *)') as any).editor.state.doc.descendants((node: any) => {
          if (node.type.name === 'paragraph' && node.textContent) found.push([node.textContent, node.attrs.id]);
        });
        return found;
      });
    await expect.poll(async () => (await ids()).length).toBe(4);
    const [copyFirst, copyInside, original, originalInside] = await ids();
    expect(original).toEqual(['Linked to', 'block-keepmine01']);
    expect(originalInside).toEqual(['Also linked to', 'block-keepmine02']);
    expect([copyFirst[1], copyInside[1]]).not.toContain('block-keepmine01');
    expect([copyFirst[1], copyInside[1]]).not.toContain('block-keepmine02');
  });

  test('after a redo, typing goes on from the end of what came back', async ({ alice: page, workspaceId }) => {
    // A line there already: undoing back to an empty page is its own bug (the test.fail above)
    const id = await createPage(page, workspaceId);
    expect((await page.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'zero' }] }] } } })).status()).toBe(200);
    await openPage(page, id);
    await placeCursor(page, 0, 'end');
    for (const word of ['one', 'two', 'three']) {
      await page.keyboard.press('Enter');
      await page.keyboard.type(word, { delay: 30 });
    }
    await expect.poll(() => blockTexts(page)).toEqual(['zero', 'one', 'two', 'three']);
    await endUndoStep(page); // the typing is one change to undo
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => blockTexts(page)).toEqual(['zero']);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(() => blockTexts(page)).toEqual(['zero', 'one', 'two', 'three']);
    await page.keyboard.type('X', { delay: 30 });
    await expect.poll(() => blockTexts(page)).toEqual(['zero', 'one', 'two', 'threeX']);

    // Typing in the middle of the page, undone and redone: on from the end of it
    await endUndoStep(page);
    await placeCursor(page, 2, 'end');
    await page.keyboard.type(' more', { delay: 30 });
    await endUndoStep(page);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => blockTexts(page)).toEqual(['zero', 'one', 'two', 'threeX']);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(() => blockTexts(page)).toEqual(['zero', 'one', 'two more', 'threeX']);
    await page.keyboard.type('!', { delay: 30 });
    await expect.poll(() => blockTexts(page)).toEqual(['zero', 'one', 'two more!', 'threeX']);
  });

  test('Ctrl+Z in the title undoes the typing in one go, as in any text box', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId, { title: 'Untitled page' }));
    const title = page.getByRole('main').getByRole('textbox', { name: 'Untitled page' });
    await title.click();
    await page.keyboard.type('Plan for the week', { delay: 30 });
    await expect(title).toHaveValue('Plan for the week');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(title).toHaveValue('');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(title).toHaveValue('Plan for the week');
  });

  test('--- makes a divider, typed or pasted as Markdown', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    await editor(page).click();
    // Typed (the shortcut made the first two dashes an em dash, so it gave "—-")
    await page.keyboard.type('Above', { delay: 20 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('---', { delay: 30 });
    await page.keyboard.type('Below', { delay: 20 });
    await expect.poll(() => outline(page)).toEqual(['paragraph: Above', 'horizontalRule', 'paragraph: Below']);

    // Pasted Markdown with a --- in it (the divider was dropped)
    await page.keyboard.press('Enter');
    await pastePlainText(page, '## Pasted\n\nIntro\n\n---\n\nAfter');
    await expect.poll(() => outline(page)).toEqual(['paragraph: Above', 'horizontalRule', 'paragraph: Below', 'heading2: Pasted', 'paragraph: Intro', 'horizontalRule', 'paragraph: After']);
  });
});

