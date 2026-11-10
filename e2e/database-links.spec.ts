import { test, expect, createPage, unique } from './fixtures';
import { main } from './database-helpers';

// URL columns: their links open (in a new tab), and a list view can open each row's link.

test.describe('links in databases', () => {
  test('a URL cell, a gallery card and a list row open the link; only safe ones', async ({ alice: page, workspaceId }) => {
    const db = await createPage(page, workspaceId, { title: unique('Reading'), kind: 'DATABASE' });
    const database = await (await page.request.get(`/api/pages/${db}/database`)).json();
    const name = database.fields.find((f: any) => f.name === 'Name').id;
    const site = await (await page.request.post(`/api/pages/${db}/database/fields`, { data: { name: 'Site', type: 'URL' } })).json();
    for (const [title, url] of [['Docs', 'example.com/docs'], ['Sneaky', 'javascript:alert(1)'], ['Blank', '']]) {
      await page.request.post(`/api/pages/${db}/database/rows`, { data: { data: { [name]: title, ...(url ? { [site.id]: url } : {}) } } });
    }
    await page.goto(`/doc/${db}`);
    const rows = main(page).locator('tbody tr');
    const open = rows.nth(0).locator('a.db-url-open');
    await expect(open).toHaveAttribute('href', 'https://example.com/docs');
    await expect(open).toHaveAttribute('target', '_blank');
    await expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(rows.nth(1).locator('a.db-url-open')).toHaveCount(0);
    await expect(rows.nth(2).locator('a.db-url-open')).toHaveCount(0);

    // A gallery card shows it as a link
    await page.request.post(`/api/pages/${db}/database/views`, { data: { name: 'Cards', type: 'GALLERY', config: { cardFieldIds: [site.id] } } });
    // A list opens each row's link, once set to; a row without one still opens its page
    await page.request.post(`/api/pages/${db}/database/views`, { data: { name: 'Lines', type: 'LIST', config: {} } });
    await page.reload();
    await main(page).getByRole('button', { name: 'Cards' }).click();
    await expect(main(page).locator('.db-gallery__card', { hasText: 'Docs' }).locator('a.db-url-link')).toHaveAttribute('href', 'https://example.com/docs');
    await main(page).getByRole('button', { name: 'Lines' }).click();
    await expect(main(page).locator('a.db-list__title')).toHaveCount(0);
    await main(page).getByLabel('Clicking a row opens').selectOption({ label: 'Site' });
    const docs = main(page).locator('.db-list__row', { hasText: 'Docs' });
    await expect(docs.locator('a.db-list__title')).toHaveAttribute('href', 'https://example.com/docs');
    await expect(docs.getByRole('button', { name: 'Open page' })).toBeVisible();
    await expect(main(page).locator('.db-list__row', { hasText: 'Sneaky' }).locator('a.db-list__title')).toHaveCount(0);
    await expect(main(page).locator('.db-list__row', { hasText: 'Blank' }).locator('button.db-list__title')).toBeVisible();
    // Kept with the view
    await expect.poll(async () => (await (await page.request.get(`/api/pages/${db}/database`)).json()).views.find((v: any) => v.name === 'Lines')?.config?.openFieldId).toBe(site.id);
    await page.reload();
    await main(page).getByRole('button', { name: 'Lines' }).click();
    await expect(docs.locator('a.db-list__title')).toHaveAttribute('href', 'https://example.com/docs');
  });
});
