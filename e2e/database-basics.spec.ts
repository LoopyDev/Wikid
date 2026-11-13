import { test, expect, createPage, openPage, unique } from './fixtures';
import { addNamedRow, main, newDatabaseFromSidebar, rowNames } from './database-helpers';

// Database basics the testers found broken: number cells, Add row, a wide view inside a page.

test.describe('database basics', () => {
  test('a number cell keeps ".5" and "-.25" as they are typed (the leading "-" and "." were lost)', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    const id = await newDatabaseFromSidebar(page, unique('Numbers'));
    await addNamedRow(page, id, 'First');
    await addNamedRow(page, id, 'Second');
    expect((await page.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Count', type: 'NUMBER' } })).status()).toBe(201);
    await page.reload();
    const cells = main(page).locator('tbody tr input[inputmode="decimal"]');
    await expect(cells).toHaveCount(2);
    for (const [i, text] of ['.5', '-.25'].entries()) {
      await cells.nth(i).focus();
      // Slowly: a half-typed "-" or "." used to be sent back empty before the next key
      for (const ch of text) {
        await page.keyboard.type(ch);
        await page.waitForTimeout(250);
      }
      await page.keyboard.press('Enter');
    }
    await expect.poll(() => cells.nth(0).inputValue().then(Number)).toBe(0.5);
    await expect.poll(() => cells.nth(1).inputValue().then(Number)).toBe(-0.25);
    await page.reload();
    await expect.poll(() => main(page).locator('tbody tr input[inputmode="decimal"]').nth(1).inputValue().then(Number)).toBe(-0.25);
  });

  test('"Add row" puts the cursor in the new row, so typing names it (it added more rows)', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    const id = await newDatabaseFromSidebar(page, unique('Rows'));
    await addNamedRow(page, id, 'First');
    await main(page).getByRole('button', { name: 'Add row' }).click();
    await expect(rowNames(page)).toHaveCount(2);
    await expect(rowNames(page).nth(1)).toBeFocused();
    await page.keyboard.type('Second row', { delay: 30 });
    await page.keyboard.press('Enter');
    await expect(rowNames(page)).toHaveCount(2);
    await expect(rowNames(page).nth(1)).toHaveValue('Second row');
  });

  test("a wide database view in a page scrolls in its own box, not the page", async ({ alice: page, workspaceId }) => {
    const db = await createPage(page, workspaceId, { title: unique('Wide'), kind: 'DATABASE' });
    for (let i = 0; i < 14; i += 1) {
      await page.request.post(`/api/pages/${db}/database/fields`, { data: { name: `Column number ${i + 1}`, type: 'TEXT' } });
    }
    const id = await createPage(page, workspaceId, { title: 'Host' });
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Above' }] }, { type: 'databaseView', attrs: { pageId: db } }, { type: 'paragraph' }] };
    expect((await page.request.put(`/api/pages/${id}/content`, { data: { content } })).status()).toBe(200);
    await page.setViewportSize({ width: 1200, height: 800 });
    await openPage(page, id);
    await expect(page.locator('.database-table--embedded table')).toBeVisible();
    const sideways = () =>
      page.evaluate(() => {
        const frame = document.querySelector('.wikid-mainframe') as HTMLElement;
        const box = document.querySelector('.database-table--embedded .database-table__wrap') as HTMLElement;
        return { page: frame.scrollWidth - frame.clientWidth, table: box.scrollWidth - box.clientWidth };
      });
    await expect.poll(() => sideways().then((s) => s.page)).toBe(0);
    expect((await sideways()).table).toBeGreaterThan(0);
  });
});
