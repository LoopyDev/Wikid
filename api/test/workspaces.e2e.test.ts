import { beforeAll, describe, expect, it } from 'vitest';
import { Session, USERS, addMember, createPage, createWorkspace, loginAs, unique } from './helpers';

let alice: Session;
let bob: Session;

beforeAll(async () => {
  alice = await loginAs(USERS.alice.email);
  bob = await loginAs(USERS.bob.email);
});

const memberIds = async (session: Session, workspaceId: string) =>
  ((await session.get(`/workspaces/${workspaceId}/members`)).body as any[]).map((m) => [m.user.email, m.role]);

describe('workspaces', () => {
  it('creates a workspace owned by its creator and lists it', async () => {
    const name = unique('Workspace');
    const res = await alice.post('/workspaces', { name: `  ${name}  ` });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ role: 'OWNER', workspace: { name } });

    const list = await alice.get('/workspaces');
    expect(list.status).toBe(200);
    const entry = list.body.find((m: any) => m.workspaceId === res.body.workspace.id);
    expect(entry).toMatchObject({ role: 'OWNER', workspace: { name } });
    // Others don't see it.
    expect((await bob.get('/workspaces')).body.some((m: any) => m.workspaceId === res.body.workspace.id)).toBe(false);
  });

  it('rejects a missing or taken name', async () => {
    expect((await alice.post('/workspaces', {})).status).toBe(400);
    expect((await alice.post('/workspaces', { name: '   ' })).status).toBe(400);
    const name = unique('Taken');
    await alice.post('/workspaces', { name });
    const taken = await bob.post('/workspaces', { name });
    expect(taken.status).toBe(409);
    expect(taken.body.message).toBe('Workspace name already exists');
  });

  it('lets owners rename a workspace, and nobody else', async () => {
    const id = await createWorkspace(alice);
    await addMember(alice, id, USERS.bob.email, 'EDITOR');
    const name = unique('Renamed');
    const renamed = await alice.patch(`/workspaces/${id}`, { name });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe(name);
    expect((await alice.patch(`/workspaces/${id}`, { name: ' ' })).status).toBe(400);
    expect((await bob.patch(`/workspaces/${id}`, { name: unique('Bob') })).status).toBe(403);
    expect((await alice.patch('/workspaces/00000000-0000-4000-8000-000000000000', { name: 'x' })).status).toBe(404);
  });

  it('lets owners delete a workspace with its pages and databases', async () => {
    const id = await createWorkspace(alice);
    await addMember(alice, id, USERS.bob.email, 'EDITOR');
    const doc = await createPage(alice, id);
    const db = await createPage(alice, id, { kind: 'DATABASE' });
    await alice.post(`/pages/${db.id}/database/rows`, { data: {} });
    await alice.post(`/pages/${db.id}/database/forms`, { name: 'Form' });

    expect((await bob.delete(`/workspaces/${id}`)).status).toBe(403);
    const deleted = await alice.delete(`/workspaces/${id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ ok: true });
    expect((await alice.get(`/pages/${doc.id}`)).status).toBe(404);
    expect((await alice.get('/workspaces')).body.some((m: any) => m.workspaceId === id)).toBe(false);
    expect((await alice.delete(`/workspaces/${id}`)).status).toBe(404);
  });

  it('deletes a workspace whose database has views, forms and row pages', async () => {
    const id = await createWorkspace(alice);
    const db = await createPage(alice, id, { kind: 'DATABASE' });
    const titleField = (await alice.get(`/pages/${db.id}/database`)).body.fields[0].id;
    expect((await alice.post(`/pages/${db.id}/database/views`, { name: 'Board', type: 'BOARD' })).status).toBe(201);
    expect((await alice.post(`/pages/${db.id}/database/forms`, { name: 'Form' })).status).toBe(201);
    expect((await alice.post(`/pages/${db.id}/database/rows`, { data: { [titleField]: 'Row with a page' } })).status).toBe(201);
    expect((await alice.delete(`/workspaces/${id}`)).status).toBe(200);
    expect((await alice.get(`/pages/${db.id}`)).status).toBe(404);
  });
});

describe('workspace members', () => {
  it('adds members by email, in any case, and lists them', async () => {
    const id = await createWorkspace(alice);
    const added = await alice.post(`/workspaces/${id}/members`, { email: ' Bob@Wikid.Local ', role: 'VIEWER' });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ userId: USERS.bob.id, workspaceId: id, role: 'VIEWER' });
    expect(await memberIds(alice, id)).toEqual([
      [USERS.alice.email, 'OWNER'],
      [USERS.bob.email, 'VIEWER'],
    ]);
    // Members can see the member list too.
    expect((await bob.get(`/workspaces/${id}/members`)).status).toBe(200);

    // Adding again updates the role; the default role is EDITOR.
    expect((await alice.post(`/workspaces/${id}/members`, { email: USERS.bob.email })).body.role).toBe('EDITOR');
  });

  it('reports unknown emails and missing input clearly', async () => {
    const id = await createWorkspace(alice);
    const unknown = await alice.post(`/workspaces/${id}/members`, { email: 'nobody@example.com' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.message).toContain('No user with the email nobody@example.com');
    const empty = await alice.post(`/workspaces/${id}/members`, {});
    expect(empty.status).toBe(400);
    expect(empty.body.message).toBe('Enter the email address of the person to add');
  });

  it('only lets owners manage members', async () => {
    const id = await createWorkspace(alice);
    await addMember(alice, id, USERS.bob.email, 'EDITOR');
    expect((await bob.post(`/workspaces/${id}/members`, { email: USERS.admin.email })).status).toBe(403);
    expect((await bob.patch(`/workspaces/${id}/members/${USERS.alice.id}`, { role: 'VIEWER' })).status).toBe(403);
    expect((await bob.delete(`/workspaces/${id}/members/${USERS.alice.id}`)).status).toBe(403);

    const outsider = await createWorkspace(bob);
    expect((await alice.get(`/workspaces/${outsider}/members`)).status).toBe(403);
  });

  it('changes roles and removes members, keeping at least one owner', async () => {
    const id = await createWorkspace(alice);
    await addMember(alice, id, USERS.bob.email, 'EDITOR');

    const promoted = await alice.patch(`/workspaces/${id}/members/${USERS.bob.id}`, { role: 'OWNER' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.role).toBe('OWNER');
    expect((await alice.patch(`/workspaces/${id}/members/${USERS.alice.id}`, { role: 'VIEWER' })).status).toBe(200);
    const lastOwner = await bob.patch(`/workspaces/${id}/members/${USERS.bob.id}`, { role: 'EDITOR' });
    expect(lastOwner.status).toBe(400);
    expect(lastOwner.body.message).toBe('Workspace must have at least one owner');
    expect((await bob.delete(`/workspaces/${id}/members/${USERS.bob.id}`)).status).toBe(400);

    expect((await bob.patch(`/workspaces/${id}/members/${USERS.admin.id}`, { role: 'EDITOR' })).status).toBe(404);
    const removed = await bob.delete(`/workspaces/${id}/members/${USERS.alice.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ count: 1 });
    expect(await memberIds(bob, id)).toEqual([[USERS.bob.email, 'OWNER']]);
    expect((await bob.delete(`/workspaces/${id}/members/${USERS.alice.id}`)).body).toEqual({ count: 0 });
    // Alice has lost access.
    expect((await alice.get(`/workspaces/${id}/members`)).status).toBe(403);
  });

  it('lets the system admin manage any workspace with adminId', async () => {
    const admin = await loginAs(USERS.admin.email);
    const id = await createWorkspace(alice);
    expect((await admin.get(`/workspaces/${id}/members?adminId=x`)).status).toBe(200);
    expect((await admin.post(`/workspaces/${id}/members?adminId=x`, { email: USERS.bob.email })).status).toBe(201);
    expect((await admin.delete(`/workspaces/${id}/members/${USERS.bob.id}?adminId=x`)).status).toBe(200);
    expect((await alice.get(`/workspaces/${id}/members?adminId=x`)).status).toBe(403);
  });
});
