import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

// Demo users seeded by the Docker stack (password "wikid"), all owners of the demo workspace.
export const USERS = {
  admin: { email: 'admin@wikid.local', name: 'System Admin' },
  alice: { email: 'alice@wikid.local', name: 'Alice' },
  bob: { email: 'bob@wikid.local', name: 'Bob' },
} as const;
export const DEMO_PASSWORD = 'wikid';

/** A title that won't clash with earlier runs against the same stack. */
export const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Logs a browser context in through the API, the way the login form does. */
export async function signIn(context: BrowserContext, email: string) {
  const res = await context.request.post('/api/auth/login', { data: { email, password: DEMO_PASSWORD } });
  expect(res.status(), `login as ${email}`).toBe(201);
  const { user } = await res.json();
  // The web app remembers who is logged in here, next to the session cookie.
  await context.addInitScript((u) => {
    window.localStorage.setItem('wikid:user', JSON.stringify(u));
  }, { id: user.id, name: user.displayName });
}

/** Creates a page through the API and returns its id. */
export async function createPage(page: Page, workspaceId: string, data: Record<string, unknown> = {}) {
  const res = await page.request.post('/api/pages', {
    data: { workspaceId, title: unique('Page'), kind: 'DOC', setupStatus: 'COMPLETE', ...data },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id as string;
}

/** Opens a page and waits until its editor is connected and ready to type in. */
export async function openPage(page: Page, id: string) {
  await page.goto(`/doc/${id}`);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.waitForFunction(() => {
    const el = document.querySelector('.ProseMirror') as any;
    return !!el?.editor && el.getAttribute('contenteditable') === 'true';
  });
  // Give the live-editing connection a moment to sync the stored content.
  await page.waitForTimeout(1500);
}

export const editor = (page: Page) => page.locator('.ProseMirror');

/** The editor content as a compact outline: one entry per block, with its text. */
export async function outline(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const doc = (document.querySelector('.ProseMirror') as any).editor.getJSON();
    const text = (n: any): string => (n.text ?? '') + (n.content || []).map(text).join('');
    const walk = (n: any, depth = 0): string[] => {
      const label = ['paragraph', 'heading', 'codeBlock'].includes(n.type)
        ? `${n.type}${n.attrs?.level ? n.attrs.level : ''}: ${text(n)}`
        : n.type;
      const children = ['paragraph', 'heading', 'codeBlock'].includes(n.type) ? [] : (n.content || []).flatMap((c: any) => walk(c, depth + 1));
      return [`${'  '.repeat(depth)}${label}`, ...children];
    };
    return (doc.content || []).flatMap((n: any) => walk(n)).filter((l: string) => l.trim() !== 'paragraph:');
  });
}

/** The text of each top-level block. */
export async function blockTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const doc = (document.querySelector('.ProseMirror') as any).editor.getJSON();
    const text = (n: any): string => (n.text ?? '') + (n.content || []).map(text).join('');
    return (doc.content || []).map(text);
  });
}

/** Pastes plain text into the editor, like pasting from a text editor. */
export async function pastePlainText(page: Page, text: string) {
  await page.evaluate((t) => {
    const data = new DataTransfer();
    data.setData('text/plain', t);
    document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

/** Waits until the header says the page is saved. */
export async function waitForSaved(page: Page) {
  await expect(page.getByRole('main').getByText('Saved', { exact: true })).toBeVisible();
}

/**
 * Puts the cursor at the start or end of a top-level block and waits until the editor has
 * registered it. Typing in the same instant as the click can beat the editor's own update.
 */
export async function placeCursor(page: Page, index: number, where: 'start' | 'end') {
  await editor(page).locator(':scope > *').nth(index).click();
  await page.keyboard.press(where === 'start' ? 'Home' : 'End');
  await page.waitForFunction(({ index, where }) => {
    const { doc, selection } = (document.querySelector('.ProseMirror') as any).editor.state;
    let pos = 0;
    for (let i = 0; i < index; i += 1) pos += doc.child(i).nodeSize;
    const target = where === 'start' ? pos + 1 : pos + doc.child(index).nodeSize - 1;
    return selection.empty && selection.from === target;
  }, { index, where });
}

type Fixtures = { alice: Page; bob: Page; workspaceId: string };

/**
 * `alice` and `bob` are pages in separate browser sessions, logged in as those users.
 * `workspaceId` is a fresh workspace owned by Alice, with Bob as an editor; it's deleted afterwards.
 */
export const test = base.extend<Fixtures>({
  workspaceId: async ({ alice }, use) => {
    const created = await alice.request.post('/api/workspaces', { data: { name: unique('E2E workspace') } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).workspace.id as string;
    const member = await alice.request.post(`/api/workspaces/${id}/members`, { data: { email: USERS.bob.email, role: 'EDITOR' } });
    expect(member.status()).toBe(201);
    await use(id);
    await alice.request.delete(`/api/workspaces/${id}`);
  },
  alice: async ({ browser }, use) => {
    await usePageAs(browser, USERS.alice.email, use);
  },
  bob: async ({ browser }, use) => {
    await usePageAs(browser, USERS.bob.email, use);
  },
});

/**
 * A logged-in page for the test. Afterwards, fails the test if the app hit a coding error (an
 * undefined name or a call on undefined), even one Vue caught and only logged: those can quietly
 * break a feature while the page still looks fine.
 */
async function usePageAs(browser: Browser, email: string, use: (page: Page) => Promise<void>) {
  const context = await browser.newContext();
  await signIn(context, email);
  const page = await context.newPage();
  const errors: string[] = [];
  const isCodingError = (text: string) => /\b(ReferenceError|TypeError|SyntaxError)\b/.test(text);
  page.on('pageerror', (err) => isCodingError(`${err.name}: ${err.message}`) && errors.push(`${err.name}: ${err.message}`));
  page.on('console', (msg) => msg.type() === 'error' && isCodingError(msg.text()) && errors.push(msg.text()));
  await use(page);
  await context.close();
  expect(errors, `JavaScript errors in ${email}'s browser`).toEqual([]);
}

export { expect };
