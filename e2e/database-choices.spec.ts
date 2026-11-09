import type { Locator } from '@playwright/test';
import { test, expect, createPage } from './fixtures';
import { main } from './database-helpers';

// A select's choices: renaming one renames it in every cell; removing one keeps what cells had,
// greyed until replaced, rather than emptying them.

test.describe('select choices', () => {
  test('renaming a choice renames it in the cells; removing one keeps the cells what they were', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId, { kind: 'DATABASE' });
    const field = async (data: Record<string, unknown>) => (await page.request.post(`/api/pages/${id}/database/fields`, { data })).json();
    const status = await field({ name: 'Status', type: 'SELECT', options: { choices: [{ value: 'Open' }, { value: 'Done' }] } });
    const tags = await field({ name: 'Tags', type: 'MULTI_SELECT', options: { choices: [{ value: 'Red' }, { value: 'Blue' }] } });
    const db = await (await page.request.get(`/api/pages/${id}/database`)).json();
    const name = db.fields.find((f: any) => f.name === 'Name').id;
    for (const [title, s, t] of [['One', 'Open', ['Red', 'Blue']], ['Two', 'Done', ['Blue']]] as const) {
      await page.request.post(`/api/pages/${id}/database/rows`, { data: { data: { [name]: title, [status.id]: s, [tags.id]: t } } });
    }
    await page.goto(`/doc/${id}`);
    const row = (n: number) => main(page).locator('tbody tr').nth(n);
    const statusOf = (n: number) => row(n).locator('select.db-cell-input');
    await expect(statusOf(0)).toHaveValue('Open');

    const editChoices = async (column: string, edit: (inputs: Locator) => Promise<void>) => {
      await main(page).locator('.db-header-button', { hasText: column }).click();
      await page.getByRole('button', { name: /^Opt\s*Options/ }).click();
      await edit(page.locator('.db-option-row'));
      await main(page).locator('.db-header-button', { hasText: column }).click(); // closes the menu, saving
    };
    await editChoices('Status', async (options) => {
      await options.nth(0).locator('.db-option-input').fill('In progress');
      await options.nth(1).locator('.db-option-remove').click();
    });
    await editChoices('Tags', async (options) => {
      await options.nth(1).locator('.db-option-remove').click();
    });

    // Renamed in place; removed choices kept, greyed
    await expect(statusOf(0)).toHaveValue('In progress');
    await expect(row(1).locator('.db-cell-kept__text')).toHaveText(['Done', 'Blue']);
    await expect(row(0).locator('.db-multi-pill', { hasText: 'Red' })).toBeVisible();
    await expect(row(0).locator('.db-cell-kept__text')).toHaveText(['Blue']);
    // And saved so
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(statusOf(0)).toHaveValue('In progress');
    await expect(row(1).locator('.db-cell-kept__text')).toHaveText(['Done', 'Blue']);
  });
});
