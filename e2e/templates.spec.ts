import { expect, type Page } from '@playwright/test';
import { test, createPage, openPage, editor, blockTexts, unique } from './fixtures';

// Until the page's own editor is up (moving between pages, a still copy of the last one shows)
const liveEditor = (page: Page) => page.waitForFunction(() => !!(document.querySelector('.ProseMirror:not(.page-hold *)') as any)?.editor);

// Page templates in the app: starting a new page from one, saving a page as one, and a template's
// own page. What a template may hold, and the API, are tested in api/test/templates*.
test.describe('page templates', () => {
  test('a new page can start from a template, in place', async ({ alice, workspaceId }) => {
    const id = await createPage(alice, workspaceId, { setupStatus: 'PENDING', title: 'Untitled page' });
    await alice.goto(`/doc/${id}`);
    const choice = alice.locator('.setup-template', { hasText: 'Meeting notes' });
    await expect(choice).toBeVisible();
    await choice.click();
    await expect(alice.locator('.setup-callout')).toHaveCount(0);
    await liveEditor(alice);
    await expect.poll(async () => (await blockTexts(alice)).join('|')).toContain('Actions');
    // Where it was made: in the sidebar, by its new title
    await expect(alice.locator('.sidebar__item', { hasText: 'Meeting notes' })).toBeVisible();
  });

  test('saves a page as a template, opens it with its banner, and makes a page from it', async ({ alice, workspaceId }) => {
    const title = unique('Site visit');
    const id = await createPage(alice, workspaceId, { title });
    await openPage(alice, id);
    await editor(alice).click();
    await alice.keyboard.type('Checklist for the visit');
    await expect.poll(async () => (await blockTexts(alice)).join('|')).toBe('Checklist for the visit');

    await alice.getByRole('button', { name: 'Page actions' }).click();
    await alice.getByRole('button', { name: 'Save as template…' }).click();
    const dialog = alice.getByRole('dialog', { name: 'Save as template' });
    await expect(dialog.getByLabel(/This workspace's/)).toBeChecked();
    await dialog.getByRole('button', { name: 'Save as template' }).click();
    await expect(dialog).toContainText("Saved to this workspace's templates.");
    await dialog.getByRole('button', { name: 'Open template' }).click();

    const banner = alice.locator('.template-banner');
    await expect(banner).toContainText("This workspace's template");
    await liveEditor(alice);
    await expect.poll(async () => (await blockTexts(alice)).join('|')).toBe('Checklist for the visit');
    // Not a page in the sidebar's tree: the one there is the page it was saved from
    await expect(alice.locator('.sidebar__item', { hasText: title })).toHaveCount(1);

    await banner.getByRole('button', { name: 'Use this template' }).click();
    await expect(alice.locator('.template-banner')).toHaveCount(0);
    await liveEditor(alice);
    await expect.poll(async () => (await blockTexts(alice)).join('|')).toBe('Checklist for the visit');
  });

  test('the Templates window lists the built-in ones and copies one to your own', async ({ alice, workspaceId }) => {
    const id = await createPage(alice, workspaceId);
    await openPage(alice, id);
    await alice.getByRole('button', { name: '📋 Templates' }).click();
    const dialog = alice.getByRole('dialog', { name: 'Templates' });
    const builtIn = dialog.locator('.templates-section', { hasText: 'Built-in' }).locator('.templates-item', { hasText: 'Decision record' });
    await expect(builtIn).toBeVisible();
    await builtIn.getByRole('button', { name: 'Copy to mine' }).click();
    await expect(dialog).toContainText('Copied "Decision record" to your templates.');
    await expect(dialog.locator('.templates-section', { hasText: 'Yours' }).locator('.templates-item', { hasText: 'Decision record' }).first()).toBeVisible();
  });

  test("the workspace's owner hides a built-in template for everyone there, and shows it again", async ({ alice, bob, workspaceId }) => {
    const id = await createPage(alice, workspaceId);
    const builtIn = (dialog: ReturnType<Page['getByRole']>) =>
      dialog.locator('.templates-section', { hasText: 'Built-in' }).locator('.templates-list:not(.templates-list--hidden) .templates-item', { hasText: 'Project brief' });

    await openPage(alice, id);
    await alice.getByRole('button', { name: '📋 Templates' }).click();
    const aliceDialog = alice.getByRole('dialog', { name: 'Templates' });
    await builtIn(aliceDialog).getByRole('button', { name: 'Hide' }).click();
    await expect(aliceDialog).toContainText('Hid "Project brief" in this workspace, for everyone.');
    await expect(builtIn(aliceDialog)).toHaveCount(0);

    // Bob, an editor: not offered it, can't show it again, can still copy it to his own
    await openPage(bob, id);
    await bob.getByRole('button', { name: '📋 Templates' }).click();
    const bobDialog = bob.getByRole('dialog', { name: 'Templates' });
    await expect(builtIn(bobDialog)).toHaveCount(0);
    await expect(bobDialog.getByRole('button', { name: 'Hide' })).toHaveCount(0);
    await bobDialog.getByRole('button', { name: /Hidden in this workspace \(1\)/ }).click();
    const hidden = bobDialog.locator('.templates-list--hidden .templates-item', { hasText: 'Project brief' });
    await expect(hidden).toContainText("Hidden here by the workspace's owner");
    await expect(hidden.getByRole('button', { name: 'Show again' })).toHaveCount(0);
    await expect(hidden.getByRole('button', { name: 'Copy to mine' })).toBeVisible();

    await aliceDialog.getByRole('button', { name: /Hidden in this workspace \(1\)/ }).click();
    await aliceDialog.locator('.templates-list--hidden .templates-item', { hasText: 'Project brief' }).getByRole('button', { name: 'Show again' }).click();
    await expect(builtIn(aliceDialog)).toHaveCount(1);
  });
});
