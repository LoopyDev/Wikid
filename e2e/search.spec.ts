import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, unique } from './fixtures';

// Search: the sidebar button or Cmd/Ctrl+K, results as you type, keys to choose, Enter to open.

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Search' });
const word = (stem: string) => `${stem}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test.describe('search', () => {
  test('finds a page from the keyboard and opens it', async ({ alice: page, workspaceId }) => {
    const target = word('marmot');
    const id = await createPage(page, workspaceId, { title: `Guide to ${target}` });
    await createPage(page, workspaceId, { title: `Notes on ${target} habits` });
    await openPage(page, await createPage(page, workspaceId, { title: unique('Start') }));

    await page.keyboard.press('ControlOrMeta+k');
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole('searchbox').fill(target.slice(0, -2));
    const results = dialog(page).getByRole('option');
    await expect(results).toHaveCount(2);
    await expect(results.first().locator('mark')).toContainText(target);

    // Arrow keys move through the results; Enter opens the selected one.
    const titles = await results.locator('.search-result__title').allInnerTexts();
    await page.keyboard.press('ArrowDown');
    await expect(results.nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveCount(0);
    const opened = titles[0] === `Guide to ${target}` ? id : null;
    if (opened) await expect(page).toHaveURL(new RegExp(`/doc/${opened}`));
    await expect(page.getByRole('main').getByRole('textbox', { name: 'Untitled page' })).toHaveValue(titles[0]);
  });

  test('finds text inside pages and database rows, from the sidebar button', async ({ alice: page, workspaceId }) => {
    const inText = word('ibex');
    const docId = await createPage(page, workspaceId, { title: unique('Field notes') });
    await page.request.put(`/api/pages/${docId}/content`, {
      data: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Saw an ${inText} today` }] }] } },
    });
    const dbId = await createPage(page, workspaceId, { title: 'Sightings', kind: 'DATABASE' });
    const db = await (await page.request.get(`/api/pages/${dbId}/database`)).json();
    const name = db.fields.find((f: any) => f.name === 'Name').id;
    await page.request.post(`/api/pages/${dbId}/database/rows`, { data: { data: { [name]: `${inText} at dawn` } } });

    await openPage(page, await createPage(page, workspaceId, { title: unique('Start') }));
    await page.getByRole('complementary').getByRole('button', { name: /Search/ }).click();
    await dialog(page).getByRole('searchbox').fill(inText);
    const results = dialog(page).getByRole('option');
    await expect(results).toHaveCount(2);
    await expect(dialog(page).getByText('Sightings ·')).toBeVisible();

    // Opening the row's result opens the row's own page.
    const rowPageId = (await (await page.request.get(`/api/pages/${dbId}/database`)).json()).rows[0].pageId;
    await results.filter({ hasText: 'Sightings ·' }).click();
    await expect(page).toHaveURL(new RegExp(`/doc/${rowPageId}`));

    // Escape closes the search.
    await page.keyboard.press('ControlOrMeta+k');
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('opens a page in another workspace', async ({ alice: page, workspaceId }) => {
    const other = await page.request.post('/api/workspaces', { data: { name: unique('Elsewhere') } });
    const otherId = (await other.json()).workspace.id as string;
    const target = word('tapir');
    const id = await createPage(page, otherId, { title: `Far away ${target}` });
    await openPage(page, await createPage(page, workspaceId));

    await page.keyboard.press('ControlOrMeta+k');
    await dialog(page).getByRole('searchbox').fill(target);
    await expect(dialog(page).getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/doc/${id}`));
    await expect(page.getByRole('complementary').locator('.user-name')).toContainText('Elsewhere');
    await page.request.delete(`/api/workspaces/${otherId}`);
  });
});
