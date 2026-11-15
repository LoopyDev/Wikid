import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage } from './fixtures';

// A diagram's editor (diagrams.net, in a frame) closed with changes not saved asks "Save?" first.
// diagrams.net is stood in for by a page that speaks its messages: it says it's ready, takes the
// diagram, and answers an export; the test has it report a change, as the real one does.

const SVG = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>').toString('base64')}`;
const STAND_IN = `<!doctype html><script>
  const send = (msg) => parent.postMessage(JSON.stringify(msg), '*');
  window.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    window.told = [...(window.told || []), msg];
    if (msg.action === 'load') { window.loaded = msg.xml; send({ event: 'load' }); }
    const answer = () => send({ event: 'export', data: ${JSON.stringify(SVG)}, xml: msg.xml });
    // (Held back when the test says, as a slow one would be)
    if (msg.action === 'export') { if (window.holdExport) window.release = answer; else answer(); }
  });
  send({ event: 'init' });
</script>`;

const XML = (shapes: number) => `<mxGraphModel><root>${'<mxCell/>'.repeat(shapes)}</root></mxGraphModel>`;

/** A page with an empty diagram, its editor open (the stand-in loaded). */
async function openDiagram(page: Page, workspaceId: string) {
  await page.route('https://embed.diagrams.net/**', (route) => route.fulfill({ contentType: 'text/html', body: STAND_IN }));
  const id = await createPage(page, workspaceId);
  expect((await page.request.put(`/api/pages/${id}/content`, { data: { content: { type: 'doc', content: [{ type: 'drawio', attrs: { xml: '', svg: '' } }] } } })).status()).toBe(200);
  await openPage(page, id);
  const frame = page.frameLocator('.drawio-modal__iframe');
  // Opened, and the diagram given to the editor
  const reopen = async () => {
    await page.locator('.drawio-preview').click();
    await expect.poll(() => frame.locator('body').evaluate(() => (window as any).loaded ?? null)).not.toBeNull();
  };
  await reopen();
  // As the editor does when the diagram changes
  const change = (xml: string) => frame.locator('body').evaluate((_, x) => parent.postMessage(JSON.stringify({ event: 'autosave', xml: x }), '*'), xml);
  const exit = () => frame.locator('body').evaluate(() => parent.postMessage(JSON.stringify({ event: 'exit' }), '*'));
  // The editor's own Save (it stays open)
  const save = (xml: string) => frame.locator('body').evaluate((_, x) => parent.postMessage(JSON.stringify({ event: 'save', xml: x }), '*'), xml);
  const saved = () => page.evaluate(() => (document.querySelector('.ProseMirror:not(.page-hold *)') as any).editor.getJSON().content[0].attrs.xml);
  return { change, exit, save, saved, reopen };
}

const prompt = (page: Page) => page.getByRole('alertdialog', { name: 'Save changes?' });
const modal = (page: Page) => page.locator('.drawio-modal');

test.describe('diagrams', () => {
  test('closing with changes not saved asks first: Save keeps them, Keep editing goes back', async ({ alice: page, workspaceId }) => {
    const { change, saved } = await openDiagram(page, workspaceId);
    await change(XML(2));
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(prompt(page)).toBeVisible();
    await prompt(page).getByRole('button', { name: 'Keep editing' }).click();
    await expect(prompt(page)).toHaveCount(0);
    await expect(modal(page)).toBeVisible();

    // Escape (the page having the keyboard) asks too; Escape in the question goes back to editing
    await page.getByRole('button', { name: 'Close' }).focus();
    await page.keyboard.press('Escape');
    await expect(prompt(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(prompt(page)).toHaveCount(0);
    await expect(modal(page)).toBeVisible();

    // A click outside it asks too; Save keeps the changes, with a picture of them, and closes
    await modal(page).click({ position: { x: 5, y: 5 } });
    await prompt(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(modal(page)).toHaveCount(0);
    expect(await saved()).toBe(XML(2));
    await expect(page.locator('.drawio-preview__img')).toHaveAttribute('src', SVG);
  });

  test("Don't save closes and leaves the diagram as it was; with nothing changed, or after Save, it just closes", async ({ alice: page, workspaceId }) => {
    const { change, exit, save, saved, reopen } = await openDiagram(page, workspaceId);
    // Nothing changed: closes at once
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(modal(page)).toHaveCount(0);

    await reopen();
    await change(XML(3));
    await page.getByRole('button', { name: 'Close' }).click();
    await prompt(page).getByRole('button', { name: "Don't save" }).click();
    await expect(modal(page)).toHaveCount(0);
    expect(await saved()).toBe('');

    // The editor's own Exit closes at once: it has asked about changes itself by then
    await reopen();
    await change(XML(5));
    await exit();
    await expect(prompt(page)).toHaveCount(0);
    await expect(modal(page)).toHaveCount(0);
    expect(await saved()).toBe('');

    // Changed and saved in the editor: closes at once
    await reopen();
    await change(XML(4));
    await save(XML(4));
    await expect.poll(saved).toBe(XML(4));
    // ...and the editor told it's saved, once the picture's back (its own Exit then doesn't warn
    // that changes will be lost)
    const toldSaved = () =>
      page.frameLocator('.drawio-modal__iframe').locator('body').evaluate(() => (window as any).told.filter((m: any) => m.action === 'status' && m.modified === false).length);
    await expect.poll(toldSaved).toBe(1);
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(prompt(page)).toHaveCount(0);
    await expect(modal(page)).toHaveCount(0);

    // Changed again while a save's picture is still being made: that change isn't saved, so the
    // editor isn't told it is, and closing asks
    await reopen();
    const frame = page.frameLocator('.drawio-modal__iframe').locator('body');
    await frame.evaluate(() => ((window as any).holdExport = true));
    await change(XML(6));
    await save(XML(6));
    await expect.poll(() => frame.evaluate(() => typeof (window as any).release)).toBe('function');
    await change(XML(7));
    await frame.evaluate(() => (window as any).release());
    await expect.poll(saved).toBe(XML(6));
    await page.waitForTimeout(300);
    expect(await toldSaved()).toBe(0);
    await page.getByRole('button', { name: 'Close' }).click();
    await prompt(page).getByRole('button', { name: "Don't save" }).click();
    await expect(modal(page)).toHaveCount(0);
    expect(await saved()).toBe(XML(6));
  });
});
