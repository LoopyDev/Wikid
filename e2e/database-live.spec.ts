import { test, expect, createPage, unique } from './fixtures';
import { main } from './database-helpers';

// What others change in a database reaches you while you're in its table.

test.describe('a database with others', () => {
  test('a cell someone else clears empties for you too, while your cursor is in the table', async ({ alice, bob, workspaceId }) => {
    const id = await createPage(alice, workspaceId, { title: unique('Shared'), kind: 'DATABASE' });
    const db = await (await alice.request.get(`/api/pages/${id}/database`)).json();
    const name = db.fields.find((f: any) => f.name === 'Name').id;
    const notes = (await (await alice.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Notes', type: 'TEXT' } })).json()).id;
    const row = async (data: Record<string, string>) => (await (await alice.request.post(`/api/pages/${id}/database/rows`, { data: { data } })).json()).id;
    await row({ [name]: 'First', [notes]: 'Keep me' });
    const second = await row({ [name]: 'Second', [notes]: 'Clear me' });

    await bob.goto(`/doc/${id}`);
    const values = () => main(bob).locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('input:not([type=checkbox]), textarea')].map((el) => (el as HTMLInputElement).value).filter(Boolean)));
    await expect.poll(values).toEqual([['First', 'Keep me'], ['Second', 'Clear me']]);
    // Bob's cursor in the first row's name
    const nameBox = main(bob).locator('tbody tr').first().locator('.db-cell-input').first();
    await nameBox.focus();

    // Cleared by someone else (here, through the API)
    expect((await alice.request.patch(`/api/database-rows/${second}`, { data: { cells: { [notes]: null } } })).status()).toBe(200);
    await expect.poll(values).toEqual([['First', 'Keep me'], ['Second']]);
    // ...and Bob's cursor is where it was
    await expect(nameBox).toBeFocused();
  });
});
