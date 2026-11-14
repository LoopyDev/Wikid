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

describe('listing workspaces', () => {
  it('still lists them while workspaces are being deleted', async () => {
    // Deleting a workspace in the moment between reading someone's memberships and their
    // workspaces used to fail the whole list
    for (let round = 0; round < 3; round += 1) {
      const ids = await Promise.all(Array.from({ length: 6 }, () => createWorkspace(alice)));
      const results = await Promise.all([
        ...ids.map((id) => alice.delete(`/workspaces/${id}`)),
        ...Array.from({ length: 24 }, () => alice.get('/workspaces')),
      ]);
      const lists = results.slice(ids.length);
      expect(lists.map((res) => res.status)).toEqual(lists.map(() => 200));
      for (const res of lists) expect(Array.isArray(res.body)).toBe(true);
    }
  });
});

describe('workspace members', () => {
  it('invites people by email, in any case: members once they accept, and listed then', async () => {
    const name = unique('Invited to');
    const id = await createWorkspace(alice, name);
    const invited = await alice.post(`/workspaces/${id}/members`, { email: ' Bob@Wikid.Local ', role: 'VIEWER' });
    expect(invited.status).toBe(201);
    expect(invited.body.invitation).toMatchObject({ userId: USERS.bob.id, workspaceId: id, role: 'VIEWER' });
    // Not a member yet: not in the list, and the workspace isn't his to open
    expect(await memberIds(alice, id)).toEqual([[USERS.alice.email, 'OWNER']]);
    expect((await bob.get(`/workspaces/${id}/members`)).status).toBe(403);
    // Waiting, for the owners to see
    const pending = await alice.get(`/workspaces/${id}/invitations`);
    expect(pending.status).toBe(200);
    expect(pending.body.map((i: any) => [i.user.email, i.role])).toEqual([[USERS.bob.email, 'VIEWER']]);

    // Bob's to accept or decline: which workspace, as what, and from whom
    const mine = (await bob.get('/invitations')).body.find((i: any) => i.workspace.id === id);
    expect(mine).toMatchObject({ role: 'VIEWER', workspace: { id, name }, invitedBy: { displayName: USERS.alice.name } });
    const accepted = await bob.post(`/invitations/${mine.id}/accept`);
    expect(accepted.status).toBe(201);
    expect(accepted.body).toMatchObject({ userId: USERS.bob.id, workspaceId: id, role: 'VIEWER' });
    expect(await memberIds(alice, id)).toEqual([
      [USERS.alice.email, 'OWNER'],
      [USERS.bob.email, 'VIEWER'],
    ]);
    // Members can see the member list too.
    expect((await bob.get(`/workspaces/${id}/members`)).status).toBe(200);
    expect((await alice.get(`/workspaces/${id}/invitations`)).body).toEqual([]);
    expect((await bob.post(`/invitations/${mine.id}/accept`)).status).toBe(404);

    // Inviting a member is refused: roles change in the members list, which checks for the last owner
    expect((await alice.post(`/workspaces/${id}/members`, { email: USERS.bob.email })).status).toBe(409);
    expect(await memberIds(alice, id)).toContainEqual([USERS.bob.email, 'VIEWER']);
  });

  it('inviting again changes the role asked for; declined or cancelled, no one joins', async () => {
    const id = await createWorkspace(alice);
    await alice.post(`/workspaces/${id}/members`, { email: USERS.bob.email, role: 'EDITOR' });
    expect((await alice.post(`/workspaces/${id}/members`, { email: USERS.bob.email, role: 'VIEWER' })).status).toBe(201);
    const pending = (await alice.get(`/workspaces/${id}/invitations`)).body;
    expect(pending.map((i: any) => i.role)).toEqual(['VIEWER']);

    const invitation = (await bob.get('/invitations')).body.find((i: any) => i.workspace.id === id);
    expect((await bob.post(`/invitations/${invitation.id}/decline`)).status).toBe(201);
    expect((await bob.get('/invitations')).body.filter((i: any) => i.workspace.id === id)).toEqual([]);
    expect((await alice.get(`/workspaces/${id}/invitations`)).body).toEqual([]);
    expect(await memberIds(alice, id)).toEqual([[USERS.alice.email, 'OWNER']]);

    // Invited again, then the owner thinks better of it
    await alice.post(`/workspaces/${id}/members`, { email: USERS.bob.email });
    const again = (await alice.get(`/workspaces/${id}/invitations`)).body[0];
    expect((await alice.delete(`/workspaces/${id}/invitations/${again.id}`)).status).toBe(200);
    expect((await bob.get('/invitations')).body.filter((i: any) => i.workspace.id === id)).toEqual([]);
    expect((await bob.post(`/invitations/${again.id}/accept`)).status).toBe(404);
    expect(await memberIds(alice, id)).toEqual([[USERS.alice.email, 'OWNER']]);
  });

  it("only the person invited answers an invitation; only a workspace's owners see and cancel its own", async () => {
    const id = await createWorkspace(alice);
    await addMember(alice, id, USERS.admin.email, 'EDITOR');
    await alice.post(`/workspaces/${id}/members`, { email: USERS.bob.email });
    const invitation = (await alice.get(`/workspaces/${id}/invitations`)).body[0];
    // Not Alice's to accept or decline (nor anyone else's): as if there were none
    expect((await alice.post(`/invitations/${invitation.id}/accept`)).status).toBe(404);
    expect((await alice.post(`/invitations/${invitation.id}/decline`)).status).toBe(404);
    // An editor of the workspace, or the person invited, can't see or cancel its invitations
    const admin = await loginAs(USERS.admin.email);
    expect((await admin.get(`/workspaces/${id}/invitations`)).status).toBe(403);
    expect((await admin.delete(`/workspaces/${id}/invitations/${invitation.id}`)).status).toBe(403);
    expect((await bob.get(`/workspaces/${id}/invitations`)).status).toBe(403);
    // An invitation of another workspace, named under this one: not found
    const other = await createWorkspace(alice);
    expect((await alice.delete(`/workspaces/${other}/invitations/${invitation.id}`)).status).toBe(404);
    expect((await alice.get(`/workspaces/${id}/invitations`)).body).toHaveLength(1);
  });

  it('reports unknown emails and missing input clearly', async () => {
    const id = await createWorkspace(alice);
    const unknown = await alice.post(`/workspaces/${id}/members`, { email: 'nobody@example.com' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.message).toContain('No user with the email nobody@example.com');
    const empty = await alice.post(`/workspaces/${id}/members`, {});
    expect(empty.status).toBe(400);
    expect(empty.body.message).toBe('Enter the email address or username of the person to add');
    const unknownName = await alice.post(`/workspaces/${id}/members`, { login: 'no-such-user' });
    expect(unknownName.status).toBe(404);
    expect(unknownName.body.message).toContain('No user with the username no-such-user');
  });

  it("says a workspace that isn't one wasn't found, rather than failing", async () => {
    for (const id of ['undefined', 'not-a-workspace']) {
      expect((await alice.post(`/workspaces/${id}/members`, { login: USERS.bob.email })).status).toBe(404);
      expect((await alice.get(`/workspaces/${id}/members`)).status).toBe(404);
    }
  });

  it("an invitation from someone who's no longer an owner there can't be accepted", async () => {
    const admin = await loginAs(USERS.admin.email);
    for (const change of ['demoted', 'removed'] as const) {
      // The admin account, made an owner here, invites Bob; then Alice changes that
      const id = await createWorkspace(alice);
      await addMember(alice, id, USERS.admin.email, 'OWNER');
      expect((await admin.post(`/workspaces/${id}/members`, { email: USERS.bob.email, role: 'OWNER' })).status).toBe(201);
      const invitation = (await bob.get('/invitations')).body.find((i: any) => i.workspace.id === id);
      expect(invitation).toBeTruthy();
      if (change === 'demoted') expect((await alice.patch(`/workspaces/${id}/members/${USERS.admin.id}`, { role: 'EDITOR' })).status).toBe(200);
      else expect((await alice.delete(`/workspaces/${id}/members/${USERS.admin.id}`)).status).toBe(200);
      expect((await bob.get('/invitations')).body.filter((i: any) => i.workspace.id === id)).toEqual([]);
      expect((await alice.get(`/workspaces/${id}/invitations`)).body).toEqual([]);
      expect((await bob.post(`/invitations/${invitation.id}/accept`)).status).toBe(404);
      expect(await memberIds(alice, id)).not.toContainEqual([USERS.bob.email, 'OWNER']);
    }
  });

  it("the system admin making someone an owner ends the invitation they had", async () => {
    const admin = await loginAs(USERS.admin.email);
    const id = await createWorkspace(alice);
    await alice.post(`/workspaces/${id}/members`, { email: USERS.bob.email, role: 'VIEWER' });
    expect((await admin.post(`/workspaces/${id}/members?adminId=x`, { email: USERS.bob.email, role: 'OWNER' })).status).toBe(201);
    expect((await alice.get(`/workspaces/${id}/invitations`)).body).toEqual([]);
    expect((await bob.get('/invitations')).body.filter((i: any) => i.workspace.id === id)).toEqual([]);
    expect(await memberIds(alice, id)).toContainEqual([USERS.bob.email, 'OWNER']);
  });

  it('invites by username', async () => {
    const id = await createWorkspace(alice);
    const invited = await alice.post(`/workspaces/${id}/members`, { login: 'Bob', role: 'VIEWER' });
    expect(invited.status).toBe(201);
    expect(invited.body.invitation).toMatchObject({ userId: USERS.bob.id, role: 'VIEWER' });
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
    // Not as an ordinary member (giving access is the owners' to do; see admin-workspaces.e2e.test.ts)...
    expect((await admin.post(`/workspaces/${id}/members?adminId=x`, { email: USERS.bob.email })).status).toBe(403);
    // ...but as an owner: how an admin repairs a workspace left without one
    expect((await admin.post(`/workspaces/${id}/members?adminId=x`, { email: USERS.bob.email, role: 'OWNER' })).body.role).toBe('OWNER');
    expect((await admin.delete(`/workspaces/${id}/members/${USERS.bob.id}?adminId=x`)).status).toBe(200);
    expect((await alice.get(`/workspaces/${id}/members?adminId=x`)).status).toBe(403);
  });
});
