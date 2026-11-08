import { beforeAll, describe, expect, it } from 'vitest';
import { Session, USERS, addMember, createPage, createWorkspace, docWithParagraphs, loginAs, paragraphTexts } from './helpers';

// Saves made through the API go into the page's history like live edits do. The rules for
// grouping saves into versions are unit tested in page-versions.test.ts.

let alice: Session;
let bob: Session;
let workspaceId: string; // alice owns it, bob is a viewer

beforeAll(async () => {
  alice = await loginAs(USERS.alice.email);
  bob = await loginAs(USERS.bob.email);
  workspaceId = await createWorkspace(alice);
  await addMember(alice, workspaceId, USERS.bob.email, 'VIEWER');
});

const save = async (session: Session, pageId: string, ...texts: string[]) =>
  expect((await session.put(`/pages/${pageId}/content`, { content: docWithParagraphs(...texts) })).status).toBe(200);

describe('page history', () => {
  it('keeps saves close together as one version, with who made them', async () => {
    const page = await createPage(alice, workspaceId, { title: 'Plans' });
    // A new page's blank content is not a version
    expect((await alice.get(`/pages/${page.id}/versions`)).body).toEqual([]);

    await save(alice, page.id, 'First draft');
    await save(alice, page.id, 'First draft, longer');
    const versions = (await alice.get(`/pages/${page.id}/versions`)).body;
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ title: 'Plans', restoredFromId: null, editors: [{ id: USERS.alice.id, name: USERS.alice.name }] });
    expect(versions[0]).not.toHaveProperty('content');

    const version = (await alice.get(`/pages/${page.id}/versions/${versions[0].id}`)).body;
    expect(paragraphTexts(version.content)).toEqual(['First draft, longer']);
  });

  it('restores a version as a new one, keeping what came before', async () => {
    const page = await createPage(alice, workspaceId);
    await save(alice, page.id, 'Original');
    const [original] = (await alice.get(`/pages/${page.id}/versions`)).body;

    const restored = await alice.post(`/pages/${page.id}/versions/${original.id}/restore`, {});
    expect(restored.status).toBe(201);
    expect(paragraphTexts(restored.body.content)).toEqual(['Original']);
    // The restorer's editor puts it on the page; its saves go into the restore's version
    await save(alice, page.id, 'Original, then changed');
    await save(alice, page.id, 'Original, then changed again');

    const versions = (await alice.get(`/pages/${page.id}/versions`)).body;
    expect(versions.map((v: any) => v.restoredFromId)).toEqual([original.id, null]);
    expect(versions[0].id).toBe(restored.body.versionId);
    const newest = (await alice.get(`/pages/${page.id}/versions/${versions[0].id}`)).body;
    expect(paragraphTexts(newest.content)).toEqual(['Original, then changed again']);
    const first = (await alice.get(`/pages/${page.id}/versions/${original.id}`)).body;
    expect(paragraphTexts(first.content)).toEqual(['Original']);
  });

  it('shows the history to anyone who can read the page, and restores only for editors', async () => {
    const page = await createPage(alice, workspaceId);
    await save(alice, page.id, 'Shared');
    const versions = await bob.get(`/pages/${page.id}/versions`);
    expect(versions.status).toBe(200);
    expect(versions.body).toHaveLength(1);
    expect((await bob.get(`/pages/${page.id}/versions/${versions.body[0].id}`)).status).toBe(200);
    expect((await bob.post(`/pages/${page.id}/versions/${versions.body[0].id}/restore`, {})).status).toBe(403);
  });

  it("doesn't show the history to people outside the workspace, or a version through another page", async () => {
    const page = await createPage(alice, workspaceId);
    await save(alice, page.id, 'Secret');
    const [version] = (await alice.get(`/pages/${page.id}/versions`)).body;
    const bobsWorkspace = await createWorkspace(bob);
    const bobsPage = await createPage(bob, bobsWorkspace);

    expect((await bob.get(`/pages/${bobsPage.id}/versions/${version.id}`)).status).toBe(404);
    expect((await bob.post(`/pages/${bobsPage.id}/versions/${version.id}/restore`, {})).status).toBe(404);
    await alice.delete(`/workspaces/${workspaceId}/members/${USERS.bob.id}`);
    try {
      expect((await bob.get(`/pages/${page.id}/versions`)).status).toBe(403);
      expect((await bob.get(`/pages/${page.id}/versions/${version.id}`)).status).toBe(403);
    } finally {
      await addMember(alice, workspaceId, USERS.bob.email, 'VIEWER');
    }
  });
});
