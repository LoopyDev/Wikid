import { test, expect, createPage, openPage, unique } from './fixtures';
import { nameFieldValues, main, rowNames, newDatabaseFromSidebar, addNamedRow, typeNewRow } from './database-helpers';

// Database tables: creating them, rows, cells and columns, and editing them live with others.

test.describe('databases', () => {
  test('creates a database from a new page and saves its rows', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    const title = unique('Tasks');
    const id = await newDatabaseFromSidebar(page, title);
    await expect(main(page).getByText('No rows yet.')).toBeVisible();

    await addNamedRow(page, id, 'Write tests');
    await addNamedRow(page, id, 'Ship it');
    expect(await nameFieldValues(page, id)).toEqual(['Write tests', 'Ship it']);

    // Still there after reopening the page.
    await page.goto(`/doc/${id}`);
    await expect(rowNames(page).nth(0)).toHaveValue('Write tests');
    await expect(rowNames(page).nth(1)).toHaveValue('Ship it');
  });

  test("keeps typing in a new row while the row before's page is still being made", async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    const id = await newDatabaseFromSidebar(page, unique('Slow rows'));
    await expect(main(page).getByText('No rows yet.')).toBeVisible();
    // Each row's page arrives a little late, as on a slow server, so the first row's page lands
    // while the second row's name is being typed, and the table is redrawn under it
    await page.route(/\/api\/database-rows\/[^/]+\/page/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });

    await typeNewRow(page, 'Write tests');
    await typeNewRow(page, 'Ship it to everyone');
    await expect.poll(() => nameFieldValues(page, id)).toEqual(['Write tests', 'Ship it to everyone']);
  });

  test('moves columns from their menu or by dragging the header, and keeps the order', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId, { title: unique('Columns'), kind: 'DATABASE' });
    await page.goto(`/doc/${id}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    const headers = main(page).locator('thead th .db-header-label');
    for (const name of ['Alpha', 'Beta']) {
      await main(page).locator('thead th').last().locator('button').first().click();
      await page.locator('.db-add-column-menu input').fill(name);
      await page.locator('.db-add-column-menu .block-menu__item', { hasText: 'Text' }).click();
      await expect(headers.last()).toHaveText(name);
    }
    await expect(headers).toHaveText(['Name', 'Alpha', 'Beta']);
    const menu = page.locator('.db-field-menu');
    const openMenu = (name: string) => main(page).locator('thead th', { hasText: name }).locator('.db-header-button').click();

    // From the column's menu
    await openMenu('Beta');
    await menu.getByRole('button', { name: 'Move left' }).click();
    await expect(headers).toHaveText(['Name', 'Beta', 'Alpha']);
    // The first column can't go further left
    await openMenu('Name');
    await expect(menu.getByRole('button', { name: 'Move right' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Move left' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);

    // By dragging Alpha's header onto the left half of Name's
    await main(page).locator('thead th', { hasText: 'Alpha' }).locator('.db-header-button').evaluate((button) => {
      const data = new DataTransfer();
      const target = Array.from(document.querySelectorAll('thead th')).find((th) => th.textContent?.includes('Name'))!;
      const rect = target.getBoundingClientRect();
      const at = { clientX: rect.left + 4, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true, dataTransfer: data };
      button.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data }));
      target.dispatchEvent(new DragEvent('dragover', at));
      target.dispatchEvent(new DragEvent('drop', at));
      button.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }));
    });
    await expect(headers).toHaveText(['Alpha', 'Name', 'Beta']);

    // Kept after a reload
    await page.waitForTimeout(500);
    await page.reload();
    await expect(headers).toHaveText(['Alpha', 'Name', 'Beta']);
  });

  test('pauses editing while the table is connecting or reconnecting', async ({ alice: page, workspaceId }) => {
    // Hold back the live connection: each attempt is closed until allowed.
    let allowed = false;
    const sockets: { close: () => Promise<void> }[] = [];
    await page.routeWebSocket(/\/collab/, (ws) => {
      if (!allowed) {
        void ws.close();
        return;
      }
      ws.connectToServer();
      sockets.push(ws);
    });
    const id = await createPage(page, workspaceId, { title: unique('Offline table'), kind: 'DATABASE' });
    await page.goto(`/doc/${id}`);
    const notice = main(page).locator('.database-table__connection');
    const addRow = main(page).getByRole('button', { name: 'Add row' });
    await expect(notice).toContainText('Connecting…');
    await expect(addRow).toBeDisabled();

    allowed = true;
    await expect(notice).toHaveCount(0, { timeout: 15_000 });
    await expect(addRow).toBeEnabled();
    const before = await rowNames(page).count();
    await addRow.click();
    await expect(rowNames(page)).toHaveCount(before + 1);

    // Losing the connection later pauses editing again, until it's back.
    allowed = false;
    await Promise.all(sockets.splice(0).map((ws) => ws.close()));
    await expect(notice).toContainText('Reconnecting…');
    await expect(addRow).toBeDisabled();
    allowed = true;
    await expect(notice).toHaveCount(0, { timeout: 15_000 });
    await expect(addRow).toBeEnabled();
  });

  test('shows rows added by someone else live', async ({ alice, bob, workspaceId }) => {
    await openPage(alice, await createPage(alice, workspaceId));
    const id = await newDatabaseFromSidebar(alice, unique('Shared tasks'));
    await bob.goto(`/doc/${id}`);
    await expect(main(bob).getByRole('button', { name: 'Add row' })).toBeVisible();

    await addNamedRow(alice, id, 'Added by Alice');
    await expect(rowNames(bob).nth(0)).toHaveValue('Added by Alice');
  });

  test("shows which cell someone else is editing", async ({ alice, bob, workspaceId }) => {
    await openPage(alice, await createPage(alice, workspaceId));
    const id = await newDatabaseFromSidebar(alice, unique('Busy table'));
    await addNamedRow(alice, id, 'Row one');
    await bob.goto(`/doc/${id}`);
    await expect(rowNames(bob).nth(0)).toHaveValue('Row one');

    await rowNames(alice).nth(0).focus();
    await alice.keyboard.press('End');
    const bobsCell = main(bob).locator('tbody .db-cell--presence');
    await expect(bobsCell).toHaveCount(1);
    await expect(bobsCell.locator('.db-cell-input')).toHaveValue('Row one');

    // When Alice leaves the cell, it's no longer marked for Bob.
    await rowNames(alice).nth(0).blur();
    await expect(bobsCell).toHaveCount(0);
  });

  test('select, checkbox and number cells show and save their values', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    const id = await newDatabaseFromSidebar(page, unique('Typed'));
    await addNamedRow(page, id, 'First');
    const addField = async (data: Record<string, unknown>) => {
      const res = await page.request.post(`/api/pages/${id}/database/fields`, { data });
      expect(res.status()).toBe(201);
    };
    await addField({ name: 'Tags', type: 'MULTI_SELECT', options: { choices: [{ value: 'Red' }, { value: 'Blue' }] } });
    await addField({ name: 'Done', type: 'CHECKBOX' });
    await addField({ name: 'Count', type: 'NUMBER' });
    await page.reload();
    const row = main(page).locator('tbody tr').first();

    // Multi-select: pick an option from the cell's menu; it shows as a pill.
    await row.locator('.db-multi-cell').click();
    await page.locator('.db-multi-select-menu .db-multi-option', { hasText: 'Blue' }).click();
    await page.keyboard.press('Escape');
    await expect(row.locator('.db-multi-pill', { hasText: 'Blue' })).toBeVisible();

    // Checkbox.
    await row.locator('td input[type="checkbox"]').last().check();

    // Number: only digits are kept.
    const number = row.locator('input[inputmode="decimal"]');
    await number.focus();
    await page.keyboard.type('4x2', { delay: 50 });
    await page.keyboard.press('Enter');
    await expect(number).toHaveValue('42');

    // All three are still there after reopening the page.
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(row.locator('.db-multi-pill', { hasText: 'Blue' })).toBeVisible();
    await expect(row.locator('td input[type="checkbox"]').last()).toBeChecked();
    await expect(number).toHaveValue('42');
  });

  test("a change survives someone else opening the table, and a reload", async ({ alice, bob, workspaceId }) => {
    // Opening a table used to add the rows it loaded to the live document before syncing with the
    // server, competing with the server's copy of the same row; about half the time that wiped
    // recent changes for everyone.
    const id = await createPage(alice, workspaceId, { title: unique('Shared table'), kind: 'DATABASE' });
    const db = await (await alice.request.get(`/api/pages/${id}/database`)).json();
    const name = db.fields.find((f: any) => f.name === 'Name').id;
    await alice.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Tags', type: 'MULTI_SELECT', options: { choices: [{ value: 'Red' }, { value: 'Blue' }] } } });
    await alice.request.post(`/api/pages/${id}/database/rows`, { data: { data: { [name]: 'Row' } } });

    await alice.goto(`/doc/${id}`);
    const row = main(alice).locator('tbody tr').first();
    await row.locator('.db-multi-cell').click();
    await alice.locator('.db-multi-select-menu .db-multi-option', { hasText: 'Blue' }).click();
    await alice.keyboard.press('Escape');
    await expect(row.locator('.db-multi-pill', { hasText: 'Blue' })).toBeVisible();
    await alice.waitForTimeout(1000);

    await bob.goto(`/doc/${id}`);
    const bobRow = main(bob).locator('tbody tr').first();
    await expect(bobRow.locator('.db-multi-pill', { hasText: 'Blue' })).toBeVisible();
    await alice.reload();
    await expect(row.locator('.db-multi-pill', { hasText: 'Blue' })).toBeVisible();
    await bob.waitForTimeout(1500);
    await expect(bobRow.locator('.db-multi-pill', { hasText: 'Blue' })).toBeVisible();
  });

  test("a change survives someone else opening the row's page", async ({ alice, bob, workspaceId }) => {
    // The properties at the top of a row's page connect to the same live document as the table,
    // and had the same problem as above.
    const id = await createPage(alice, workspaceId, { title: unique('Shared table'), kind: 'DATABASE' });
    const db = await (await alice.request.get(`/api/pages/${id}/database`)).json();
    const name = db.fields.find((f: any) => f.name === 'Name').id;
    await alice.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Tags', type: 'MULTI_SELECT', options: { choices: [{ value: 'Red' }, { value: 'Blue' }] } } });
    const created = await (await alice.request.post(`/api/pages/${id}/database/rows`, { data: { data: { [name]: 'Row' } } })).json();
    const ensured = await (await alice.request.post(`/api/database-rows/${created.id}/page`, { data: { pageId: id } })).json();
    const rowPageId = ensured.page?.id ?? ensured.row?.pageId;
    expect(rowPageId).toBeTruthy();

    await alice.goto(`/doc/${id}`);
    const row = main(alice).locator('tbody tr').first();
    await row.locator('.db-multi-cell').click();
    await alice.locator('.db-multi-select-menu .db-multi-option', { hasText: 'Blue' }).click();
    await alice.keyboard.press('Escape');
    await expect(row.locator('.db-multi-pill', { hasText: 'Blue' })).toBeVisible();
    await alice.waitForTimeout(1000);

    await bob.goto(`/doc/${rowPageId}`);
    const tags = bob.locator('.page-properties__row', { hasText: 'Tags' });
    await expect(tags).toContainText('Blue');
    await bob.waitForTimeout(1500);
    await alice.reload();
    await expect(row.locator('.db-multi-pill', { hasText: 'Blue' })).toBeVisible();
  });
});
