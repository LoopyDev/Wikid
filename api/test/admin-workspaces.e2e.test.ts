import { beforeAll, describe, expect, it } from 'vitest';
import { Session, USERS, addMember, createPage, createWorkspace, loginAs } from './helpers';

// The system admin and other people's workspaces (in production, as the test stack runs): every
// workspace listed, an owner set or a member removed to repair one, each change shown to its
// members, and private pages never readable.

let alice: Session;
let bob: Session;
let admin: Session;

beforeAll(async () => {
  alice = await loginAs(USERS.alice.email);
  bob = await loginAs(USERS.bob.email);
  admin = await loginAs(USERS.admin.email);
});

describe("the admin and other people's workspaces", () => {
  it("lists every workspace for the admin, not only the admin's own", async () => {
    const workspaceId = await createWorkspace(alice);
    const listed = await admin.get('/workspaces?adminId=x');
    expect(listed.status).toBe(200);
    expect((listed.body as any[]).map((entry) => entry.workspace?.id)).toContain(workspaceId);
    // Not for anyone else
    expect((await bob.get('/workspaces?adminId=x')).status).toBe(403);
  });

  it('sets an owner and removes a member, but adds nobody else; each change is shown to the members', async () => {
    const workspaceId = await createWorkspace(alice);
    await addMember(alice, workspaceId, USERS.bob.email, 'EDITOR');
    // Not an editor or a viewer: giving access is the owners' to do
    expect((await admin.post(`/workspaces/${workspaceId}/members`, { adminId: 'x', login: USERS.bob.email, role: 'EDITOR' })).status).toBe(403);
    expect((await admin.patch(`/workspaces/${workspaceId}/members/${USERS.bob.id}`, { adminId: 'x', role: 'VIEWER' })).status).toBe(403);
    // An owner, yes
    expect((await admin.post(`/workspaces/${workspaceId}/members`, { adminId: 'x', login: USERS.bob.email, role: 'OWNER' })).status).toBe(201);
    expect((await admin.delete(`/workspaces/${workspaceId}/members/${USERS.alice.id}?adminId=x`)).status).toBe(200);

    const actions = await bob.get(`/workspaces/${workspaceId}/admin-actions`);
    expect(actions.status).toBe(200);
    expect((actions.body as any[]).map((a) => [a.action, a.targetUserId])).toEqual([
      ['REMOVE_MEMBER', USERS.alice.id],
      ['SET_OWNER', USERS.bob.id],
    ]);
    // Not for someone outside it
    const outsider = await alice.get(`/workspaces/${workspaceId}/admin-actions`);
    expect(outsider.status).toBe(403);
  });

  it("can't read private pages, even as the workspace's owner", async () => {
    const workspaceId = await createWorkspace(alice);
    const secret = await createPage(alice, workspaceId, { title: 'Alice only', visibility: 'PRIVATE' });
    expect((await admin.post(`/workspaces/${workspaceId}/members`, { adminId: 'x', login: USERS.admin.email, role: 'OWNER' })).status).toBe(201);
    expect((await admin.get(`/pages/${secret.id}`)).status).toBe(403);
    const listed = await admin.get(`/pages?workspaceId=${workspaceId}`);
    expect((listed.body as any[]).map((p) => p.id)).not.toContain(secret.id);
    // Its author still can
    expect((await alice.get(`/pages/${secret.id}`)).status).toBe(200);
  });

  it('deletes a workspace', async () => {
    const workspaceId = await createWorkspace(alice);
    expect((await admin.delete(`/workspaces/${workspaceId}`)).status).toBe(200);
    const left = await alice.get('/workspaces');
    expect((left.body as any[]).map((entry) => entry.workspace?.id)).not.toContain(workspaceId);
  });

  it("leaves personal workspaces alone, records nothing for no change, and says when the admin joins", async () => {
    // Alice's personal workspace, from the admin's list
    await alice.get('/pages?workspaceId=personal-' + USERS.alice.id);
    const all = (await admin.get('/workspaces?adminId=x')).body as any[];
    const personal = all.find((entry) => entry.workspace?.personalOwnerId === USERS.alice.id)?.workspace;
    expect(personal?.id).toBeTruthy();
    expect((await admin.post(`/workspaces/${personal.id}/members`, { adminId: 'x', login: USERS.bob.email, role: 'OWNER' })).status).toBe(403);
    expect((await admin.delete(`/workspaces/${personal.id}`)).status).toBe(403);

    const workspaceId = await createWorkspace(alice);
    // Alice is its owner already: nothing changes, nothing's recorded
    expect((await admin.post(`/workspaces/${workspaceId}/members`, { adminId: 'x', login: USERS.alice.email, role: 'OWNER' })).status).toBe(201);
    expect((await alice.get(`/workspaces/${workspaceId}/admin-actions`)).body).toEqual([]);
    // The admin joining (to read its shared pages) is there for its members to see
    expect((await admin.post(`/workspaces/${workspaceId}/members`, { adminId: 'x', login: USERS.admin.email, role: 'OWNER' })).status).toBe(201);
    const actions = (await alice.get(`/workspaces/${workspaceId}/admin-actions`)).body as any[];
    expect(actions.map((a) => [a.action, a.targetUserId])).toEqual([['SET_OWNER', USERS.admin.id]]);
    // A workspace id that isn't one: not found, not a server error
    expect((await alice.get('/workspaces/not-a-workspace/admin-actions')).status).toBe(404);
  });
});

