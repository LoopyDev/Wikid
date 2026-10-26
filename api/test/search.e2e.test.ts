import { beforeAll, describe, expect, it } from 'vitest';
import { Session, USERS, addMember, createPage, createWorkspace, docWithParagraphs, loginAs } from './helpers';

// Words nobody else's test data contains, so results are predictable across runs.
const word = (stem: string) => `${stem}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const search = async (session: Session, q: string) => {
  const res = await session.get(`/search?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  return res.body.results as any[];
};

let alice: Session;
let bob: Session;
let carol: Session; // the admin, not a member of alice's workspace
let workspaceId: string; // alice owns it, bob is an editor

beforeAll(async () => {
  alice = await loginAs(USERS.alice.email);
  bob = await loginAs(USERS.bob.email);
  carol = await loginAs(USERS.admin.email);
  workspaceId = await createWorkspace(alice);
  await addMember(alice, workspaceId, USERS.bob.email, 'EDITOR');
});

describe('search', () => {
  it('finds pages by title and by text, with the match highlighted', async () => {
    const titleWord = word('quokka');
    const bodyWord = word('wombat');
    const page = await createPage(alice, workspaceId, { title: `Notes about ${titleWord}` });
    await alice.put(`/pages/${page.id}/content`, { content: docWithParagraphs('Intro line', `The ${bodyWord} lives here`) });

    const byTitle = await search(alice, titleWord);
    expect(byTitle.map((r) => r.pageId)).toEqual([page.id]);
    expect(byTitle[0]).toMatchObject({ type: 'page', title: `Notes about ${titleWord}`, workspaceId });
    expect(byTitle[0].titleHighlight).toBe(`Notes about [[[${titleWord}]]]`);
    expect(byTitle[0].snippet).toBe(''); // only the title matched

    // The start of a word is enough, and every word has to match.
    const byText = await search(alice, `${bodyWord.slice(0, -3)} lives`);
    expect(byText.map((r) => r.pageId)).toEqual([page.id]);
    expect(byText[0].snippet).toContain(`[[[${bodyWord}]]]`);
    expect(await search(alice, `${bodyWord} elephantine`)).toEqual([]);
  });

  it('only shows what each person can see', async () => {
    const secret = word('aardvark');
    const priv = await createPage(alice, workspaceId, { title: `Private ${secret}`, visibility: 'PRIVATE' });
    const pub = await createPage(alice, workspaceId, { title: `Public ${secret}` });

    expect((await search(alice, secret)).map((r) => r.pageId).sort()).toEqual([priv.id, pub.id].sort());
    expect((await search(bob, secret)).map((r) => r.pageId)).toEqual([pub.id]);
    expect(await search(carol, secret)).toEqual([]); // not a member of the workspace

    // Pages in the Bin don't show.
    await alice.delete(`/pages/${pub.id}`);
    expect((await search(bob, secret)).map((r) => r.pageId)).toEqual([]);
  });

  it('finds database rows by their values, saying which database', async () => {
    const value = word('pangolin');
    const db = await createPage(alice, workspaceId, { kind: 'DATABASE', title: 'Animals' });
    const fields = (await alice.get(`/pages/${db.id}/database`)).body.fields;
    const nameField = fields.find((f: any) => f.name === 'Name').id;
    const notes = (await alice.post(`/pages/${db.id}/database/fields`, { name: 'Notes', type: 'TEXT' })).body.id;
    await alice.post(`/pages/${db.id}/database/rows`, { data: { [nameField]: 'Spiky one', [notes]: `A shy ${value}` } });

    const results = await search(bob, value);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ type: 'row', databaseTitle: 'Animals', workspaceId });
    expect(results[0].snippet).toContain(`[[[${value}]]]`);
  });

  it('returns nothing for an empty or symbols-only search', async () => {
    expect(await search(alice, '')).toEqual([]);
    expect(await search(alice, ' !!! ')).toEqual([]);
    expect((await alice.get('/search')).body.results).toEqual([]);
  });
});
