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

  test("changing a column's type converts what fits and keeps the rest, until replaced or changed back", async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId, { title: unique('Stock'), kind: 'DATABASE' });
    const nameField = (await (await page.request.get(`/api/pages/${id}/database`)).json()).fields.find((f: any) => f.name === 'Name').id;
    const amount = await (await page.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Amount', type: 'TEXT' } })).json();
    for (const [name, value] of [['Bolts', '12'], ['Nuts', 'about ten'], ['Washers', 'n/a']]) {
      await page.request.post(`/api/pages/${id}/database/rows`, { data: { data: { [nameField]: name, [amount.id]: value } } });
    }
    await page.goto(`/doc/${id}`);
    await expect(main(page).locator('tbody tr')).toHaveCount(3);

    const setType = async (label: string) => {
      await main(page).locator('thead th', { hasText: 'Amount' }).locator('button').first().click();
      const menu = page.locator('.db-field-menu');
      await menu.locator('.block-menu__item', { hasText: 'Type' }).first().click();
      await menu.locator('.block-menu__item', { has: page.locator('.block-menu__title', { hasText: new RegExp(`^${label}$`) }) }).click();
    };
    // (The server's saved copy, made from the live document a minute or so later, is checked in the API tests)
    const reload = async () => {
      await page.reload();
      await expect(main(page).locator('tbody tr')).toHaveCount(3);
    };
    const amountInput = (name: string) =>
      main(page).locator('tbody tr').nth(['Bolts', 'Nuts', 'Washers'].indexOf(name)).locator('td').nth(1).locator('input');

    // To Number: a warning first, saying how many cells don't fit
    let warning = '';
    page.once('dialog', (dialog) => {
      warning = dialog.message();
      void dialog.accept();
    });
    await setType('Number');
    await expect.poll(() => warning).toContain("2 cells don't fit");
    // What doesn't fit is shown greyed in its cell
    await expect(main(page).locator('.db-cell--kept')).toHaveCount(2);
    await expect(main(page).locator('.db-cell--kept', { hasText: 'about ten' })).toBeVisible();
    await expect(amountInput('Bolts')).toHaveValue('12');
    await reload();
    await expect(main(page).locator('.db-cell--kept')).toHaveCount(2);

    // A new value replaces what was kept
    await amountInput('Washers').focus();
    await page.keyboard.type('7');
    await page.keyboard.press('Enter');
    await expect(main(page).locator('.db-cell--kept')).toHaveCount(1);

    // Back to Text: the kept value comes back, with no warning as everything fits
    page.once('dialog', (dialog) => {
      warning = 'unexpected';
      void dialog.dismiss();
    });
    await setType('Text');
    await expect(amountInput('Nuts')).toHaveValue('about ten');
    await expect(amountInput('Washers')).toHaveValue('7');
    expect(warning).not.toBe('unexpected');
    await reload();
    await expect(amountInput('Nuts')).toHaveValue('about ten');
    await expect(main(page).locator('.db-cell--kept')).toHaveCount(0);
    await expect(main(page).locator('.db-cell--kept')).toHaveCount(0);
  });

  test('a person column holds workspace members, one or several', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId, { title: unique('Tasks'), kind: 'DATABASE' });
    const nameField = (await (await page.request.get(`/api/pages/${id}/database`)).json()).fields.find((f: any) => f.name === 'Name').id;
    await page.request.post(`/api/pages/${id}/database/rows`, { data: { data: { [nameField]: 'Launch' } } });
    await page.goto(`/doc/${id}`);
    await expect(main(page).locator('tbody tr')).toHaveCount(1);

    // Added from the column menu like any other type
    await main(page).locator('thead th').last().locator('button').first().click();
    await page.locator('.db-add-column-menu .block-menu__item', { has: page.locator('.block-menu__title', { hasText: /^Person$/ }) }).click();
    await expect(main(page).locator('thead th')).toHaveCount(3);
    await page.keyboard.press('Escape');
    const cell = main(page).locator('tbody tr').first().locator('.db-multi-cell');
    await expect(cell).toHaveText('Add person');

    // One person: choosing someone sets them and closes the picker
    const picker = page.locator('.db-multi-select-menu');
    await cell.click();
    await picker.locator('.db-multi-option', { hasText: 'Bob' }).click();
    await expect(picker).toBeHidden();
    await expect(cell.locator('.db-multi-pill')).toHaveText(['Bob']);
    await cell.click();
    await picker.locator('.db-multi-option', { hasText: 'Alice' }).click();
    await expect(cell.locator('.db-multi-pill')).toHaveText(['Alice']);

    // Several, once allowed
    await main(page).locator('thead th').nth(1).locator('button').first().click();
    await page.locator('.db-field-menu').getByLabel('Allow multiple people').check();
    await page.keyboard.press('Escape');
    await cell.click();
    await picker.locator('.db-multi-option', { hasText: 'Bob' }).click();
    await page.keyboard.press('Escape');
    await expect(cell.locator('.db-multi-pill')).toHaveText(['Alice', 'Bob']);

    await page.reload();
    await expect(main(page).locator('tbody tr').first().locator('.db-multi-pill')).toHaveText(['Alice', 'Bob']);
  });

  test('a "Created by" column shows who added each row, and can\'t be changed', async ({ alice, bob, workspaceId }) => {
    const id = await createPage(alice, workspaceId, { title: unique('Faults'), kind: 'DATABASE' });
    await alice.goto(`/doc/${id}`);
    await bob.goto(`/doc/${id}`);
    for (const page of [alice, bob]) await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();

    // Each adds a row in the table
    await main(alice).getByRole('button', { name: 'Add row' }).click();
    await expect(main(bob).locator('tbody tr')).toHaveCount(1);
    await main(bob).getByRole('button', { name: 'Add row' }).click();
    await expect(main(alice).locator('tbody tr')).toHaveCount(2);

    // Offered once, from the new column menu
    await main(alice).locator('thead th').last().locator('button').first().click();
    const menu = alice.locator('.db-add-column-menu');
    await menu.locator('.block-menu__item', { hasText: 'Created by' }).click();
    await expect(main(alice).locator('thead th', { hasText: 'Created by' })).toBeVisible();
    for (const page of [alice, bob]) {
      const cells = main(page).locator('tbody tr').locator('.db-multi-cell');
      await expect(cells.nth(0)).toHaveText('Alice');
      await expect(cells.nth(1)).toHaveText('Bob');
      // Read-only: nothing to pick
      await expect(cells.first()).toBeDisabled();
    }
    await main(alice).locator('thead th').last().locator('button').first().click();
    await expect(menu.locator('.block-menu__item', { hasText: 'Created by' })).toHaveCount(0);
    await alice.keyboard.press('Escape');

    await alice.reload();
    await expect(main(alice).locator('tbody tr').nth(1).locator('.db-multi-cell')).toHaveText('Bob');
  });

  test('columns added, changed and deleted through the API show up live, and stay', async ({ alice: page, workspaceId }) => {
    // They used to change only the database, not the live document, whose next save then
    // deleted a new column (with its cells and form fields) and put back a changed one
    const id = await createPage(page, workspaceId, { title: unique('Exhibits'), kind: 'DATABASE' });
    await page.goto(`/doc/${id}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    const headers = main(page).locator('thead th');
    const header = (name: string) => headers.filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) });

    const field = await (await page.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Zone', type: 'TEXT' } })).json();
    await expect(header('Zone')).toHaveCount(1);
    await page.request.patch(`/api/database-fields/${field.id}`, { data: { name: 'Thematic zone', type: 'NUMBER' } });
    await expect(header('Thematic zone')).toHaveCount(1);
    const extra = await (await page.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Notes', type: 'TEXT' } })).json();
    await expect(header('Notes')).toHaveCount(1);
    await page.request.delete(`/api/database-fields/${extra.id}`);
    await expect(header('Notes')).toHaveCount(0);

    await page.reload();
    await expect(header('Thematic zone')).toHaveCount(1);
    await expect(header('Notes')).toHaveCount(0);
  });
});
