import { execFileSync } from 'node:child_process';
import { test, expect, signIn, placeCursor, USERS } from './fixtures';

// Builds a small demo workspace and retakes the README screenshots in docs/images/.
// Skipped normally; run it, against a Docker Compose stack, with:
//   WIKID_SCREENSHOTS=1 npm run test:e2e -- readme-screenshots
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const h = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const todo = (text: string, checked = false) => ({ type: 'taskItem', attrs: { checked }, content: [p(text)] });
const bullet = (text: string) => ({ type: 'listItem', content: [p(text)] });

test.use({ viewport: { width: 1440, height: 900 } });

test('readme screenshots', async ({ browser }) => {
  test.skip(!process.env.WIKID_SCREENSHOTS, 'only when retaking the README screenshots');
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await signIn(context, USERS.alice.email);
    await context.addInitScript((t) => localStorage.setItem('wikid:theme', t), theme);
    const page = await context.newPage();
    const api = context.request;

    // A run that failed part-way leaves its workspace behind, and names are unique
    for (const member of await (await api.get('/api/workspaces')).json()) {
      if (member.workspace?.name === 'Northwind Lab') await api.delete(`/api/workspaces/${member.workspace.id}`);
    }
    const ws = (await (await api.post('/api/workspaces', { data: { name: 'Northwind Lab' } })).json()).workspace.id;
    const mk = async ({ icon, ...data }: any) => {
      const id = (await (await api.post('/api/pages', { data: { workspaceId: ws, kind: 'DOC', setupStatus: 'COMPLETE', ...data } })).json()).id as string;
      if (icon) await api.patch(`/api/pages/${id}`, { data: { icon } });
      return id as string;
    };
    const welcome = await mk({ title: 'Welcome', icon: '👋' });
    const onboarding = await mk({ title: 'Onboarding', icon: '🧭' });
    const firstWeek = await mk({ title: 'Your first week', icon: '🗓️', parentId: onboarding });
    await mk({ title: 'IT setup', icon: '💻', parentId: onboarding });
    await mk({ title: 'Lab safety', icon: '🧪' });
    const meetingNotes = await mk({ title: 'Meeting notes', icon: '📝' });
    await api.put(`/api/pages/${welcome}/content`, { data: { content: { type: 'doc', content: [p('The team wiki for Northwind Lab.')] } } });
    await api.put(`/api/pages/${firstWeek}/content`, {
      data: {
        content: {
          type: 'doc',
          content: [
            p('Everything you need for your first five days. Tick things off as you go.'),
            { type: 'callout', attrs: { icon: '💡' }, content: [p('Your buddy for the first month is listed on the Team page. Ask them anything.')] },
            h(2, 'Day one'),
            { type: 'taskList', content: [todo('Collect your laptop and badge from reception', true), todo('Log in to Wikid and set your own password', true), todo('Read the Lab safety page'), todo('Book your induction with the lab manager')] },
            h(2, 'Good to know'),
            { type: 'bulletList', content: [bullet('Equipment is booked through the Equipment database.'), bullet('Incidents are reported with the form on the Lab safety page.'), bullet('Press ⌘K to search everything.')] },
          ],
        },
      },
    });

    // An equipment database with a board view.
    const equipment = await mk({ title: 'Equipment', icon: '🔬', kind: 'DATABASE' });
    const db = await (await api.get(`/api/pages/${equipment}/database`)).json();
    const name = db.fields.find((f: any) => f.name === 'Name').id;
    const field = async (data: any) => (await (await api.post(`/api/pages/${equipment}/database/fields`, { data })).json()).id as string;
    const status = await field({ name: 'Status', type: 'SELECT', options: { choices: [{ value: 'Available', color: 'green' }, { value: 'In use', color: 'blue' }, { value: 'Needs service', color: 'orange' }] } });
    const location = await field({ name: 'Location', type: 'TEXT' });
    const serviced = await field({ name: 'Last serviced', type: 'DATE' });
    const rows: [string, string, string, string][] = [
      ['Centrifuge A', 'Available', 'Lab 2', '2026-09-14'],
      ['Microscope (confocal)', 'In use', 'Imaging room', '2026-08-02'],
      ['PCR machine', 'Available', 'Lab 1', '2026-10-01'],
      ['Fume hood 3', 'Needs service', 'Lab 3', '2026-03-19'],
      ['Freezer -80', 'In use', 'Cold room', '2026-07-22'],
      ['Spectrophotometer', 'Available', 'Lab 1', '2026-06-30'],
    ];
    for (const [n, s, l, d] of rows) {
      await api.post(`/api/pages/${equipment}/database/rows`, { data: { data: { [name]: n, [status]: s, [location]: l, [serviced]: d } } });
    }
    await api.post(`/api/pages/${equipment}/database/views`, { data: { name: 'By status', type: 'BOARD', config: { groupFieldId: status } } }).catch(() => {});

    // 1. The editor.
    await page.goto(`/doc/${firstWeek}`);
    await expect(page.locator('.ProseMirror')).toBeVisible();
    const onboardingItem = page.getByRole('complementary').locator('.sidebar__item', { hasText: 'Onboarding' }).first();
    await onboardingItem.hover();
    await onboardingItem.locator('.page-chevron').click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `docs/images/editor-${theme}.png` });

    // 2. The database board.
    await page.goto(`/doc/${equipment}`);
    await expect(page.getByRole('main').getByRole('button', { name: 'Add row' })).toBeVisible();
    await page.waitForTimeout(800);
    const board = page.getByRole('main').getByRole('button', { name: /By status/ });
    if (await board.count()) {
      await board.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `docs/images/database-board-${theme}.png` });
    }

    // 3. Search.
    await page.goto(`/doc/${welcome}`);
    await expect(page.locator('.ProseMirror')).toBeVisible();
    await page.waitForTimeout(800);
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('searchbox').fill('lab');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `docs/images/search-${theme}.png` });

    // 4. Two people editing the same page: Bob's named cursor, from Alice's window. The page has
    // an earlier version (from three hours ago), for the page history in 5.
    const withId = (id: number, node: any) => ({ ...node, attrs: { ...node.attrs, id: `block-${id}` } });
    const agenda = (...items: [number, string][]) =>
      withId(3, { type: 'bulletList', content: items.map(([id, text]) => withId(id, { type: 'listItem', content: [withId(id + 1, p(text))] })) });
    const task = (id: number, text: string) => withId(id, { ...todo(text), content: [withId(id + 1, p(text))] });
    const meeting = (first: string, items: [number, string][]) => ({
      type: 'doc',
      content: [
        withId(1, p(first)),
        withId(2, h(2, 'Agenda')),
        agenda(...items),
        withId(20, h(2, 'Actions')),
        withId(21, { type: 'taskList', content: [task(22, 'Call the freezer engineer'), task(24, 'Book inductions for next week')] }),
      ],
    });
    await api.put(`/api/pages/${meetingNotes}/content`, {
      data: { content: meeting('Weekly lab meeting.', [[4, 'Freezer -80 temperature alarms'], [6, 'New starters: induction dates'], [8, 'Lab tour for visitors']]) },
    });
    // Moved back three hours, so what follows makes a version of its own. Straight in the database,
    // as nothing in Wikid changes a version's time: run this against a Docker Compose stack.
    execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'wikid-tiptap', '-qc',
      `UPDATE "PageVersion" SET "createdAt" = "createdAt" - interval '3 hours', "updatedAt" = "updatedAt" - interval '3 hours' WHERE "pageId" = '${meetingNotes}'`]);
    await api.put(`/api/pages/${meetingNotes}/content`, {
      data: { content: meeting('Weekly lab meeting, Monday 9:30.', [[4, 'Freezer -80 temperature alarms'], [6, 'New starters: induction dates'], [10, 'Fume hood 3 service']]) },
    });
    await api.post(`/api/workspaces/${ws}/members`, { data: { email: USERS.bob.email, role: 'EDITOR' } });
    const bobContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await signIn(bobContext, USERS.bob.email);
    await bobContext.addInitScript((t) => localStorage.setItem('wikid:theme', t), theme);
    const bob = await bobContext.newPage();
    await page.goto(`/doc/${meetingNotes}`);
    await expect(page.locator('.ProseMirror')).toContainText('Weekly lab meeting');
    await bob.goto(`/doc/${meetingNotes}`);
    await expect(bob.locator('.ProseMirror')).toContainText('Weekly lab meeting');
    // Alice adds to the first line, Bob to the actions
    await placeCursor(page, 0, 'end');
    await page.keyboard.type(' Notes by Alice.', { delay: 40 });
    await bob.locator('.ProseMirror p', { hasText: 'Book inductions for next week' }).click();
    await bob.keyboard.press('End');
    // As a person would: typing straight after the click, the editor hasn't caught up with it yet
    await bob.waitForTimeout(300);
    await bob.keyboard.type(', and send the dates round', { delay: 40 });
    await expect(page.locator('.collaboration-carets__label', { hasText: 'Bob' })).toBeVisible();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `docs/images/collaboration-${theme}.png` });

    // 5. Page history: the version Alice and Bob just made, with what it changed.
    await expect.poll(async () => (await (await api.get(`/api/pages/${meetingNotes}/versions`)).json())[0]?.editors?.length).toBe(2);
    await page.locator('.topbar-menu-btn').click();
    await page.locator('.topbar-menu__dropdown').getByRole('button', { name: 'Page history' }).click();
    const history = page.locator('.page-history');
    await expect(history.locator('.page-history__changes')).toContainText('1 removed');
    await page.mouse.move(0, 0);
    await page.waitForTimeout(800);
    await history.screenshot({ path: `docs/images/page-history-${theme}.png` });
    await bobContext.close();

    await api.delete(`/api/workspaces/${ws}`);
    await context.close();
  }
});
