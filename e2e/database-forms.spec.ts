import { test, expect, createPage, openPage, unique } from './fixtures';
import { main, newDatabaseFromSidebar } from './database-helpers';

// A database's forms: building one and editing its messages.

test.describe('database forms', () => {
  test('builds a form: a required field, a success message, and a preview', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    const id = await newDatabaseFromSidebar(page, unique('Sign-ups'));
    const forms = async () => (await (await page.request.get(`/api/pages/${id}/database`)).json()).forms ?? [];

    await main(page).getByRole('button', { name: /^Forms/ }).click();
    // "Form name" (prompt), then "Generate form fields from current database columns?" (confirm).
    page.on('dialog', (dialog) => dialog.accept(dialog.type() === 'prompt' ? 'Sign-up form' : undefined));
    await main(page).getByRole('button', { name: 'New form' }).click();
    await expect.poll(async () => (await forms()).map((f: any) => f.name)).toEqual(['Sign-up form']);

    const builder = main(page).locator('.db-form-builder');
    const nameField = builder.locator('.db-form-field', { hasText: 'Name' });
    await expect(nameField).toBeVisible();
    await nameField.getByLabel('Required').check();
    const message = builder.getByPlaceholder('Thanks! Your response has been saved.');
    await message.fill('Thanks for signing up');
    await message.press('Tab');

    const stored = async () => {
      const [form] = await forms();
      const fields = Array.isArray(form?.fields) ? form.fields : form?.fields?.fields ?? [];
      const config = form?.config ?? form?.fields?.config ?? {};
      return { required: fields.some((f: any) => f.required), message: config.successMessage };
    };
    await expect.poll(stored).toEqual({ required: true, message: 'Thanks for signing up' });

    // The layout tab previews the form as people will fill it in.
    await builder.getByRole('button', { name: 'Layout' }).click();
    await expect(builder.locator('form').getByText('Preview only. Submissions are disabled.')).toBeVisible();
  });

  test("keeps a form message you're typing when another save finishes", async ({ alice: page, workspaceId }) => {
    // The form re-rendered when a save's response arrived and put back the stored (empty) message,
    // so what you'd typed was never saved.
    await openPage(page, await createPage(page, workspaceId));
    const id = await newDatabaseFromSidebar(page, unique('Sign-ups'));
    const forms = async () => (await (await page.request.get(`/api/pages/${id}/database`)).json()).forms ?? [];
    await main(page).getByRole('button', { name: /^Forms/ }).click();
    page.on('dialog', (dialog) => dialog.accept(dialog.type() === 'prompt' ? 'Sign-up form' : undefined));
    await main(page).getByRole('button', { name: 'New form' }).click();
    await expect.poll(async () => (await forms()).length).toBe(1);
    const builder = main(page).locator('.db-form-builder');
    const nameField = builder.locator('.db-form-field', { hasText: 'Name' });
    await expect(nameField).toBeVisible();

    // Hold the "Required" save's response back until the message has been typed.
    let released = false;
    await page.route('**/database-forms/**', async (route) => {
      if (route.request().method() === 'PATCH' && (route.request().postData() || '').includes('"fields"')) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        released = true;
      }
      await route.continue();
    });
    await nameField.getByLabel('Required').check();
    const message = builder.getByPlaceholder('Thanks! Your response has been saved.');
    await message.fill('Thanks for signing up');
    await expect.poll(() => released).toBe(true);
    await page.waitForTimeout(300);
    await expect(message).toHaveValue('Thanks for signing up');
    await message.press('Tab');
    await expect.poll(async () => {
      const [form] = await forms();
      return (form?.config ?? form?.fields?.config ?? {}).successMessage;
    }).toBe('Thanks for signing up');
  });
  test('a date field can start on today, and be changed', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    const id = await newDatabaseFromSidebar(page, unique('Intake'));
    const received = await (await page.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Received', type: 'DATE' } })).json();
    await page.reload();
    const forms = async () => (await (await page.request.get(`/api/pages/${id}/database`)).json()).forms ?? [];
    await main(page).getByRole('button', { name: /^Forms/ }).click();
    page.on('dialog', (dialog) => dialog.accept(dialog.type() === 'prompt' ? 'Intake form' : undefined));
    await main(page).getByRole('button', { name: 'New form' }).click();
    await expect.poll(async () => (await forms()).length).toBe(1);

    // Autofill: Today, offered for the date field only
    const builder = main(page).locator('.db-form-builder');
    const autofill = (name: string) =>
      builder
        .locator('.db-form-field', { has: page.locator('.db-form-field-name', { hasText: new RegExp(`^${name}$`) }) })
        .locator('.db-form-field-controls', { hasText: 'Autofill' })
        .locator('select');
    await expect(autofill('Name').locator('option[value="today"]')).toBeDisabled();
    await autofill('Received').selectOption('today');
    const autoOf = async () => {
      const [form] = await forms();
      const fields = Array.isArray(form?.fields) ? form.fields : form?.fields?.fields ?? [];
      return fields.find((f: any) => f.fieldId === received.id)?.auto ?? null;
    };
    await expect.poll(autoOf).toEqual({ type: 'today' });
    // Editable (the default), it's a starting value
    await expect(
      builder.locator('.db-form-field', { has: page.locator('.db-form-field-name', { hasText: /^Received$/ }) }).locator('.db-form-field-hint')
    ).toContainText('Filled in, but can be changed');

    // The form starts on today's date, which can be changed
    const [form] = await forms();
    await page.goto(`/form/${form.id}`);
    const today = await page.evaluate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    });
    const dateInput = page.locator('input[type="date"]');
    await expect(dateInput).toHaveValue(today);
    await expect(dateInput).toBeEnabled();
    await dateInput.fill('2026-01-15');
    await page.getByRole('button', { name: /^Submit/ }).click();
    await expect.poll(async () => {
      const db = await (await page.request.get(`/api/pages/${id}/database`)).json();
      return db.rows.map((row: any) => row.data[received.id]);
    }).toEqual(['2026-01-15']);
  });

  test("a date field set to no future won't take a later date", async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    const id = await newDatabaseFromSidebar(page, unique('Incidents'));
    const happened = await (await page.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Happened', type: 'DATE' } })).json();
    await page.reload();
    const forms = async () => (await (await page.request.get(`/api/pages/${id}/database`)).json()).forms ?? [];
    await main(page).getByRole('button', { name: /^Forms/ }).click();
    page.on('dialog', (dialog) => dialog.accept(dialog.type() === 'prompt' ? 'Incident form' : undefined));
    await main(page).getByRole('button', { name: 'New form' }).click();
    await expect.poll(async () => (await forms()).length).toBe(1);

    // Offered on the date field only
    const builder = main(page).locator('.db-form-builder');
    const fieldBlock = (name: string) =>
      builder.locator('.db-form-field', { has: page.locator('.db-form-field-name', { hasText: new RegExp(`^${name}$`) }) });
    await expect(fieldBlock('Name').getByLabel('No future')).toHaveCount(0);
    await fieldBlock('Happened').getByLabel('No future').check();
    await expect.poll(async () => {
      const [form] = await forms();
      const fields = Array.isArray(form?.fields) ? form.fields : form?.fields?.fields ?? [];
      return fields.find((f: any) => f.fieldId === happened.id)?.noFuture ?? false;
    }).toBe(true);

    const [form] = await forms();
    await page.goto(`/form/${form.id}`);
    const dayFrom = (offset: number) =>
      page.evaluate((offset) => {
        const day = new Date(Date.now() + offset * 86_400_000);
        return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      }, offset);
    const dateInput = page.locator('input[type="date"]');
    // The picker stops at today
    await expect(dateInput).toHaveAttribute('max', await dayFrom(0));
    await dateInput.fill(await dayFrom(2));
    await page.getByRole('button', { name: /^Submit/ }).click();
    // The browser holds the form back, saying the latest date it takes
    await expect.poll(() => dateInput.evaluate((input: HTMLInputElement) => input.validity.rangeOverflow)).toBe(true);
    const dates = async () =>
      (await (await page.request.get(`/api/pages/${id}/database`)).json()).rows.map((row: any) => row.data[happened.id]);
    expect(await dates()).toEqual([]);

    const yesterday = await dayFrom(-1);
    await dateInput.fill(yesterday);
    await page.getByRole('button', { name: /^Submit/ }).click();
    await expect.poll(dates).toEqual([yesterday]);
  });

  test('a field can be required when a select is any of several choices', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    const id = await newDatabaseFromSidebar(page, unique('Reports'));
    const kind = await (await page.request.post(`/api/pages/${id}/database/fields`, {
      data: { name: 'Kind', type: 'SELECT', options: { choices: ['Bug', 'Outage', 'Idea'] } },
    })).json();
    await page.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Impact', type: 'TEXT' } });
    await page.reload();
    const forms = async () => (await (await page.request.get(`/api/pages/${id}/database`)).json()).forms ?? [];
    await main(page).getByRole('button', { name: /^Forms/ }).click();
    page.on('dialog', (dialog) => dialog.accept(dialog.type() === 'prompt' ? 'Report form' : undefined));
    await main(page).getByRole('button', { name: 'New form' }).click();
    await expect.poll(async () => (await forms()).length).toBe(1);

    const impact = main(page)
      .locator('.db-form-builder .db-form-field')
      .filter({ has: page.locator('.db-form-field-name', { hasText: /^Impact$/ }) });
    const control = (label: string) =>
      impact.locator('.db-form-field-controls').filter({ has: page.locator('.db-form-field-label', { hasText: new RegExp(`^${label}$`) }) });
    await control('Required when').locator('select').selectOption({ label: 'Kind' });
    await control('Condition').locator('select').selectOption({ label: 'Is any of' });
    const values = control('Condition values');
    // Starts with the first choice, which can't be unticked while it's the only one
    await expect(values.getByLabel('Bug')).toBeChecked();
    await expect(values.getByLabel('Bug')).toBeDisabled();
    await values.getByLabel('Outage').check();
    const condition = async () => {
      const [form] = await forms();
      const fields = Array.isArray(form?.fields) ? form.fields : form?.fields?.fields ?? [];
      return fields.find((f: any) => f.requiredWhen)?.requiredWhen ?? null;
    };
    await expect.poll(condition).toEqual({ fieldId: kind.id, op: 'isAnyOf', value: ['Bug', 'Outage'] });

    // On the form, Impact is required for an outage or a bug, not an idea
    const [form] = await forms();
    await page.goto(`/form/${form.id}`);
    const formField = (label: string) => page.locator('.form-field').filter({ has: page.locator('.form-field__label', { hasText: new RegExp(`^${label}$`) }) });
    const impactRequired = formField('Impact').locator('.form-field__required');
    await expect(impactRequired).toHaveCount(0);
    await formField('Kind').locator('select').selectOption('Outage');
    await expect(impactRequired).toBeVisible();
    await formField('Kind').locator('select').selectOption('Idea');
    await expect(impactRequired).toHaveCount(0);
    await formField('Kind').locator('select').selectOption('Bug');
    await expect(impactRequired).toBeVisible();
  });

  test('a form fills its author in, and lets you pick a person', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId, { title: unique('Requests'), kind: 'DATABASE' });
    const db = async () => (await (await page.request.get(`/api/pages/${id}/database`)).json());
    const nameField = (await db()).fields.find((f: any) => f.name === 'Name').id;
    const add = async (data: Record<string, unknown>) => (await (await page.request.post(`/api/pages/${id}/database/fields`, { data })).json()).id;
    const author = await add({ name: 'Author', type: 'PERSON' });
    const reviewer = await add({ name: 'Reviewer', type: 'PERSON' });
    const form = await (await page.request.post(`/api/pages/${id}/database/forms`, {
      data: { name: 'Request', fields: [{ fieldId: nameField }, { fieldId: author, auto: { type: 'currentUser' }, editable: false }, { fieldId: reviewer }] },
    })).json();

    await page.goto(`/form/${form.id}`);
    const formField = (label: string) =>
      page.locator('.form-field').filter({ has: page.locator('.form-field__label', { hasText: new RegExp(`^${label}$`) }) });
    // The author is whoever fills it in, and can't be changed
    await expect(formField('Author').locator('select')).toBeDisabled();
    await expect(formField('Author').locator('select option:checked')).toHaveText('Alice');
    await formField('Reviewer').locator('select').selectOption({ label: 'Bob' });
    await formField('Name').locator('input').first().fill('More coffee');
    await page.getByRole('button', { name: /^Submit/ }).click();
    await expect.poll(async () => {
      const row = (await db()).rows.find((r: any) => r.data[nameField] === 'More coffee');
      return row ? [row.data[author], row.data[reviewer]] : null;
    }).toEqual([['00000000-0000-0000-0000-000000000011'], ['00000000-0000-0000-0000-000000000012']]);
  });

  test('a form shows one input for each field', async ({ alice: page, workspaceId }) => {
    // The notes under relation fields used to start the inputs' v-if chain again, adding a
    // text box under most fields
    const id = await createPage(page, workspaceId, { title: unique('Visits'), kind: 'DATABASE' });
    const db = async () => (await (await page.request.get(`/api/pages/${id}/database`)).json());
    const nameField = (await db()).fields.find((f: any) => f.name === 'Name').id;
    const fieldIds = [nameField];
    for (const data of [
      { name: 'Count', type: 'NUMBER' },
      { name: 'Day', type: 'DATE' },
      { name: 'Kind', type: 'SELECT', options: { choices: ['School', 'Family'] } },
      { name: 'Paid', type: 'CHECKBOX' },
      { name: 'Link', type: 'URL' },
      { name: 'Host', type: 'PERSON' },
    ]) {
      fieldIds.push((await (await page.request.post(`/api/pages/${id}/database/fields`, { data })).json()).id);
    }
    const form = await (await page.request.post(`/api/pages/${id}/database/forms`, {
      data: { name: 'Visit', fields: fieldIds.map((fieldId) => ({ fieldId })) },
    })).json();
    await page.goto(`/form/${form.id}`);
    const fields = page.locator('.form-field').filter({ has: page.locator('.form-field__label', { hasText: /^(Name|Count|Day|Kind|Paid|Link|Host)$/ }) });
    await expect(fields).toHaveCount(7);
    for (const field of await fields.all()) {
      await expect(field.locator('input, select, textarea'), await field.locator('.form-field__label').innerText()).toHaveCount(1);
    }
  });

  test("a form shows the record's ID only when the database has asset tags", async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId, { title: unique('Loans'), kind: 'DATABASE' });
    const nameField = (await (await page.request.get(`/api/pages/${id}/database`)).json()).fields.find((f: any) => f.name === 'Name').id;
    const formFor = async () =>
      (await (await page.request.post(`/api/pages/${id}/database/forms`, { data: { name: unique('Loan'), fields: [{ fieldId: nameField }] } })).json()).id;
    const itemId = page.locator('.form-field__label', { hasText: /^Item ID$/ });

    await page.goto(`/form/${await formFor()}`);
    await expect(page.locator('.form-field__label', { hasText: /^Name$/ })).toBeVisible();
    await expect(itemId).toHaveCount(0);

    await page.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Tag', type: 'TEXT', options: { source: 'assetTag', readonly: true } } });
    await page.goto(`/form/${await formFor()}`);
    await expect(itemId).toBeVisible();
  });

  test("a form shows a column as it was just changed in the table, not as of the last save", async ({ alice: page, workspaceId }) => {
    // A change made in the table reached the database's own tables, which forms read, only at the
    // next periodic save, so a relation pointed elsewhere still offered the old database's rows
    const target = async (title: string, row: string) => {
      const id = await createPage(page, workspaceId, { title: unique(title), kind: 'DATABASE' });
      const name = (await (await page.request.get(`/api/pages/${id}/database`)).json()).fields.find((f: any) => f.name === 'Name').id;
      await page.request.post(`/api/pages/${id}/database/rows`, { data: { data: { [name]: row } } });
      return id;
    };
    const zones = await target('Zones', 'Zone A');
    const exhibitsTitle = unique('Exhibits');
    const exhibits = await createPage(page, workspaceId, { title: exhibitsTitle, kind: 'DATABASE' });
    const exhibitName = (await (await page.request.get(`/api/pages/${exhibits}/database`)).json()).fields.find((f: any) => f.name === 'Name').id;
    await page.request.post(`/api/pages/${exhibits}/database/rows`, { data: { data: { [exhibitName]: 'Dinosaurs' } } });

    const id = await createPage(page, workspaceId, { title: unique('Visits'), kind: 'DATABASE' });
    const place = await (await page.request.post(`/api/pages/${id}/database/fields`, {
      data: { name: 'Place', type: 'RELATION', options: { relation: { pageId: zones, allowMultiple: false } } },
    })).json();
    const form = await (await page.request.post(`/api/pages/${id}/database/forms`, { data: { name: 'Visit', fields: [{ fieldId: place.id }] } })).json();

    // Point the relation at Exhibits from the table
    await page.goto(`/doc/${id}`);
    await expect(main(page).locator('thead th', { hasText: 'Place' })).toBeVisible();
    await main(page).locator('thead th', { hasText: 'Place' }).locator('button').first().click();
    const menu = page.locator('.db-field-menu');
    await menu.locator('.block-menu__item', { hasText: 'Relation' }).first().click();
    await menu.locator('.db-relation-settings__field', { hasText: 'Target database' }).locator('select').selectOption({ label: exhibitsTitle });
    // Clicking away keeps the change (Escape would cancel it)
    await page.mouse.click(5, 300);
    await expect(menu).toBeHidden();

    // Straight to the form: Exhibits' rows, not Zones'
    await page.goto(`/form/${form.id}`);
    const placeSelect = page.locator('.form-field').filter({ has: page.locator('.form-field__label', { hasText: /^Place$/ }) }).locator('select');
    await expect(placeSelect.locator('option', { hasText: 'Dinosaurs' })).toHaveCount(1);
    await expect(placeSelect.locator('option', { hasText: 'Zone A' })).toHaveCount(0);
  });

  test('a form can be renamed, and its fields labelled and described for the people filling it in', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId, { title: unique('Faults'), kind: 'DATABASE' });
    const forms = async () => (await (await page.request.get(`/api/pages/${id}/database`)).json()).forms ?? [];
    const nameField = (await (await page.request.get(`/api/pages/${id}/database`)).json()).fields.find((f: any) => f.name === 'Name').id;
    await page.request.post(`/api/pages/${id}/database/forms`, { data: { name: 'Form', fields: [{ fieldId: nameField }] } });
    await page.goto(`/doc/${id}`);
    await main(page).getByRole('button', { name: /^Forms/ }).click();
    await main(page).getByRole('button', { name: 'Edit', exact: true }).click();
    const builder = main(page).locator('.db-form-builder');

    const title = builder.getByLabel('Form name');
    await title.fill('Report a fault');
    await title.press('Enter');
    const nameBlock = builder.locator('.db-form-field', { has: page.locator('.db-form-field-name', { hasText: /^Name$/ }) });
    const label = nameBlock.getByLabel('Label on the form');
    await label.fill("What's the fault?");
    await label.blur();
    const description = nameBlock.getByLabel('Description');
    await description.fill('The exhibit and what is wrong with it');
    await description.blur();
    await expect.poll(async () => {
      const [form] = await forms();
      const fields = Array.isArray(form?.fields) ? form.fields : form?.fields?.fields ?? [];
      return [form?.name, fields[0]?.label, fields[0]?.description];
    }).toEqual(['Report a fault', "What's the fault?", 'The exhibit and what is wrong with it']);

    const [form] = await forms();
    await page.goto(`/form/${form.id}`);
    await expect(page.getByText('Report a fault', { exact: true })).toBeVisible();
    // The field's own label, in place of the column's name
    const field = page.locator('.form-field').filter({ has: page.locator('.form-field__label', { hasText: "What's the fault?" }) });
    await expect(field.locator('.form-field__description')).toHaveText('The exhibit and what is wrong with it');
  });
});
