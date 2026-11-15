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

  it('finds part of a word: a word cut off part way, or from its middle', async () => {
    const tag = word('t');
    const page = await createPage(alice, workspaceId, { title: `Quarterly organization review ${tag}` });
    await alice.put(`/pages/${page.id}/content`, { content: docWithParagraphs('The deployment of the authentication service went well.') });
    // Cut off part way: these are stored under their stems ("organ", "deploy"), which a cut-off
    // word isn't the start of
    for (const q of ['organiz', 'quarterl', 'deploym', 'authenticat']) {
      expect((await search(alice, `${q} ${tag}`)).map((r) => r.pageId), q).toEqual([page.id]);
    }
    // From the middle of a word
    for (const q of ['nization', 'ployment', 'thentica']) {
      expect((await search(alice, `${q} ${tag}`)).map((r) => r.pageId), q).toEqual([page.id]);
    }
    // The part found is marked, in the title and the text
    const [result] = await search(alice, `nization ployment ${tag}`);
    expect(result.titleHighlight).toContain('orga[[[nization]]]');
    expect(result.snippet).toContain('de[[[ployment]]]');
  });

  it("a part-word's snippet keeps a long word running through the match whole", async () => {
    const tag = word('u');
    const page = await createPage(alice, workspaceId, { title: 'Links' });
    const filler = 'Some words before the link go on for a while here so that the text is long enough. ';
    await alice.put(`/pages/${page.id}/content`, { content: docWithParagraphs(`${filler}See https://example.com/a/very/long/path/to/the/x${tag}y-guide and then more words after it to fill the line out.`) });
    const [result] = await search(alice, tag);
    expect(result.snippet).toContain(`x[[[${tag}]]]y-guide`);
    expect(result.snippet.startsWith('…')).toBe(true);
  });

  it('a page with the whole word comes before one with it inside a longer word', async () => {
    const tag = word('w');
    const inside = await createPage(alice, workspaceId, { title: `Pre${tag}post` });
    const whole = await createPage(alice, workspaceId, { title: `About ${tag}` });
    expect((await search(alice, tag)).map((r) => r.pageId)).toEqual([whole.id, inside.id]);
  });

  it('finds part of a word in a database row', async () => {
    const tag = word('r');
    const db = await createPage(alice, workspaceId, { kind: 'DATABASE', title: 'Clusters' });
    const notes = (await alice.post(`/pages/${db.id}/database/fields`, { name: 'Notes', type: 'TEXT' })).body.id;
    await alice.post(`/pages/${db.id}/database/rows`, { data: { [notes]: `kube${tag}rnetes` } });
    const results = await search(bob, tag);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ type: 'row', databaseTitle: 'Clusters' });
    expect(results[0].snippet).toContain(`kube[[[${tag}]]]rnetes`);
  });

  it('searches one workspace when asked', async () => {
    const tag = word('s');
    const other = await createWorkspace(alice);
    const here = await createPage(alice, workspaceId, { title: `Here ${tag}` });
    const there = await createPage(alice, other, { title: `There ${tag}` });
    const ids = async (q: string) => (await alice.get(q)).body.results.map((r: any) => r.pageId).sort();
    expect(await ids(`/search?q=${tag}`)).toEqual([here.id, there.id].sort());
    expect(await ids(`/search?q=${tag}&workspaceId=${workspaceId}`)).toEqual([here.id]);
    expect(await ids(`/search?q=${tag}&workspaceId=${other}`)).toEqual([there.id]);
    // Not one of yours: nothing (not someone else's pages)
    expect((await carol.get(`/search?q=${tag}&workspaceId=${workspaceId}`)).body.results).toEqual([]);
    // Not a workspace id: said so, not "no results"
    expect((await alice.get(`/search?q=${tag}&workspaceId=nope`)).status).toBe(400);
    expect((await alice.get(`/search?q=${tag}&workspaceId=${workspaceId}&workspaceId=${other}`)).status).toBe(400);
  });

  it('returns nothing for an empty or symbols-only search', async () => {
    expect(await search(alice, '')).toEqual([]);
    expect(await search(alice, ' !!! ')).toEqual([]);
    expect((await alice.get('/search')).body.results).toEqual([]);
  });
});
