import { test, expect, createPage } from './fixtures';
import { main } from './database-helpers';

// Compliance databases: a record changes only with a reason, kept in its audit trail.

test.describe('compliance databases', () => {
  test('changes to records wait for a reason, then are saved as amendments; deleting archives with one', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId, { kind: 'DATABASE' });
    expect((await page.request.patch(`/api/pages/${id}/database`, { data: { complianceMode: true } })).status()).toBe(200);
    const count = await (await page.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Count', type: 'NUMBER' } })).json();
    const db = await (await page.request.get(`/api/pages/${id}/database`)).json();
    const name = db.fields.find((f: any) => f.name === 'Name').id;
    const row = await (await page.request.post(`/api/pages/${id}/database/rows`, { data: { data: { [name]: 'Gloves', [count.id]: 1 } } })).json();
    const record = async () => (await (await page.request.get(`/api/compliance/records/${row.data.__complianceRecordId}`)).json());

    await page.goto(`/doc/${id}`);
    const number = main(page).locator('tbody tr').first().locator('input[inputmode="decimal"]');
    await number.fill('2');
    await number.press('Enter');
    const bar = main(page).locator('.database-table__amend');
    await expect(bar).toContainText('1 record changed');
    const save = bar.getByRole('button', { name: 'Save changes' });
    await expect(save).toBeDisabled();
    await page.waitForTimeout(800);
    expect((await record()).latestRevision.data[count.id]).toBe(1); // nothing saved yet

    await bar.getByRole('textbox').fill('Recount');
    await save.click();
    await expect(bar).toBeHidden();
    await expect.poll(async () => (await record()).latestRevision).toMatchObject({ kind: 'AMEND', reason: 'Recount' });
    expect((await record()).latestRevision.data[count.id]).toBe(2);

    // Delete asks why, and archives the record
    const first = main(page).locator('tbody tr').first();
    await first.hover();
    await first.getByRole('button', { name: 'Row actions' }).click();
    page.once('dialog', (dialog) => dialog.accept('Entered twice'));
    await page.locator('.db-row-menu').getByRole('button', { name: /Delete row/ }).click();
    await expect(main(page).locator('tbody tr', { hasText: 'Gloves' })).toHaveCount(0);
    await expect.poll(async () => (await record()).status).toBe('ARCHIVED');
  });

  test("an amendment changes only the cells it changed: one made meanwhile by someone else to another cell stays", async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId, { kind: 'DATABASE' });
    expect((await page.request.patch(`/api/pages/${id}/database`, { data: { complianceMode: true } })).status()).toBe(200);
    const count = await (await page.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Count', type: 'NUMBER' } })).json();
    const notes = await (await page.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Notes', type: 'TEXT' } })).json();
    const db = await (await page.request.get(`/api/pages/${id}/database`)).json();
    const name = db.fields.find((f: any) => f.name === 'Name').id;
    const row = await (await page.request.post(`/api/pages/${id}/database/rows`, { data: { data: { [name]: 'Gloves', [count.id]: 1 } } })).json();
    await page.goto(`/doc/${id}`);
    await expect(main(page).locator('tbody tr').first().locator('input[inputmode="decimal"]')).toHaveValue('1');

    // Someone else amends its Notes, while this table shows it as it was
    expect((await page.request.patch(`/api/database-rows/${row.id}`, { data: { cells: { [notes.id]: 'Checked' }, reason: 'Checked them' } })).status()).toBe(200);

    // Here, Count is amended
    const number = main(page).locator('tbody tr').first().locator('input[inputmode="decimal"]');
    await number.fill('2');
    await number.press('Enter');
    const bar = main(page).locator('.database-table__amend');
    await bar.getByRole('textbox').fill('Recount');
    await bar.getByRole('button', { name: 'Save changes' }).click();
    await expect(bar).toBeHidden();

    // Both stay (it put back the Notes it had, empty, and the audit trail said this amendment did that)
    const saved = async () => (await (await page.request.get(`/api/pages/${id}/database`)).json()).rows.find((r: any) => r.id === row.id).data;
    await expect.poll(async () => (await saved())[count.id]).toBe(2);
    expect((await saved())[notes.id]).toBe('Checked');
    const record = await (await page.request.get(`/api/compliance/records/${row.data.__complianceRecordId}`)).json();
    expect(record.latestRevision).toMatchObject({ kind: 'AMEND', reason: 'Recount' });
    expect(record.latestRevision.data).toMatchObject({ [count.id]: 2, [notes.id]: 'Checked' });
  });

  test('a record added in the table: an amendment to it later changes only its own cells too', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId, { kind: 'DATABASE' });
    expect((await page.request.patch(`/api/pages/${id}/database`, { data: { complianceMode: true } })).status()).toBe(200);
    const count = await (await page.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Count', type: 'NUMBER' } })).json();
    const notes = await (await page.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Notes', type: 'TEXT' } })).json();
    await page.goto(`/doc/${id}`);
    await main(page).getByRole('button', { name: 'Add row' }).click();
    await expect(main(page).locator('tbody tr')).toHaveCount(1);
    const rowsNow = async () => (await (await page.request.get(`/api/pages/${id}/database`)).json()).rows;
    await expect.poll(async () => (await rowsNow()).length).toBe(1);
    const rowId = (await rowsNow())[0].id;

    // Someone else amends its Notes
    expect((await page.request.patch(`/api/database-rows/${rowId}`, { data: { cells: { [notes.id]: 'Checked' }, reason: 'Checked them' } })).status()).toBe(200);
    // Here, its Count
    const number = main(page).locator('tbody tr').first().locator('input[inputmode="decimal"]');
    await number.fill('3');
    await number.press('Enter');
    const bar = main(page).locator('.database-table__amend');
    await bar.getByRole('textbox').fill('Counted');
    await bar.getByRole('button', { name: 'Save changes' }).click();
    await expect(bar).toBeHidden();
    await expect.poll(async () => (await rowsNow())[0].data[count.id]).toBe(3);
    expect((await rowsNow())[0].data[notes.id]).toBe('Checked');
  });
});
