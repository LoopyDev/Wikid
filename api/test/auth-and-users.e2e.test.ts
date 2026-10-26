import { describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, Session, USERS, loginAs, unique } from './helpers';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

async function createTempUser(admin: Session, password: string, { mustChangePassword = false } = {}) {
  const email = `${unique('user').replace(/\s/g, '-').toLowerCase()}@example.com`;
  const res = await admin.post('/admin/users', { adminId: 'x', displayName: 'Temp User', email, password, mustChangePassword });
  expect(res.status).toBe(201);
  expect(res.body).toMatchObject({ email, displayName: 'Temp User' });
  expect(res.body.passwordHash).toBeUndefined();
  return { id: res.body.id as string, email };
}

describe('login and sessions', () => {
  it('logs in, reports the current user and logs out', async () => {
    const session = new Session();
    const login = await session.login(USERS.alice.email);
    expect(login.status).toBe(201);
    expect(login.body.user).toMatchObject({ id: USERS.alice.id, email: USERS.alice.email });
    expect(login.body.user.passwordHash).toBeUndefined();

    const me = await session.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ id: USERS.alice.id, displayName: USERS.alice.name });

    expect((await session.post('/auth/logout')).status).toBe(201);
    expect((await session.get('/auth/me')).status).toBe(401);
  });

  it('accepts the email in any case and with spaces', async () => {
    const res = await new Session().login('  Alice@Wikid.LOCAL ');
    expect(res.status).toBe(201);
  });

  it('rejects a wrong password or unknown email', async () => {
    const wrong = await new Session().login(USERS.alice.email, 'not-the-password');
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).toBe('Invalid email or password');
    expect((await new Session().login('nobody@example.com')).status).toBe(401);
    expect((await new Session().post('/auth/login', { email: USERS.alice.email })).status).toBe(400);
  });

  it('refuses requests without a session', async () => {
    const anon = new Session();
    for (const path of ['/auth/me', '/pages', '/workspaces', '/admin/users']) {
      const res = await anon.get(path);
      expect(res.status, path).toBe(401);
    }
    expect((await anon.post('/pages', { title: 'x' })).status).toBe(401);
  });

  it('acts as the logged-in user even when the request names someone else', async () => {
    const bob = await loginAs(USERS.bob.email);
    const me = await bob.get(`/users/${USERS.bob.id}?userId=${USERS.admin.id}`);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(USERS.bob.id);
    // Pretending to be the admin doesn't unlock admin routes.
    expect((await bob.get(`/admin/users?adminId=${USERS.admin.id}`)).status).toBe(403);
  });
});

describe('user profile and preferences', () => {
  it("lets users read their own profile but not other people's", async () => {
    const alice = await loginAs(USERS.alice.email);
    const own = await alice.get(`/users/${USERS.alice.id}`);
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ id: USERS.alice.id, email: USERS.alice.email });
    expect(own.body.passwordHash).toBeUndefined();
    expect((await alice.get(`/users/${USERS.bob.id}`)).status).toBe(403);
  });

  it('merges known preferences and ignores unknown ones', async () => {
    const alice = await loginAs(USERS.alice.email);
    const res = await alice.patch(`/users/${USERS.alice.id}/preferences`, {
      preferences: { sidebarHidden: true, somethingElse: 'ignored' },
    });
    expect(res.status).toBe(200);
    expect(res.body.preferences).toMatchObject({ sidebarHidden: true });
    expect(res.body.preferences.somethingElse).toBeUndefined();
    await alice.patch(`/users/${USERS.alice.id}/preferences`, { preferences: { sidebarHidden: false } });
    expect((await alice.patch(`/users/${USERS.bob.id}/preferences`, { preferences: {} })).status).toBe(403);
  });

  it('does not return the password hash when saving preferences', async () => {
    const alice = await loginAs(USERS.alice.email);
    const res = await alice.patch(`/users/${USERS.alice.id}/preferences`, { preferences: { sidebarHidden: false } });
    expect(res.status).toBe(200);
    expect(res.body.passwordHash).toBeUndefined();
  });
});

describe('admin user management and passwords', () => {
  it('only lets the system admin manage users', async () => {
    const alice = await loginAs(USERS.alice.email);
    expect((await alice.get('/admin/users?adminId=x')).status).toBe(403);
    expect(
      (await alice.post('/admin/users', { adminId: 'x', displayName: 'X', email: 'x@example.com', password: 'p' })).status,
    ).toBe(403);
  });

  it('creates, renames and resets the password of a user', async () => {
    const admin = await loginAs(USERS.admin.email);
    const { id: userId, email } = await createTempUser(admin, 'first-pass');

    const list = await admin.get('/admin/users?adminId=x');
    expect(list.status).toBe(200);
    expect(list.body.map((u: any) => u.id)).toContain(userId);
    expect(list.body.every((u: any) => u.passwordHash === undefined)).toBe(true);

    const duplicate = await admin.post('/admin/users', { adminId: 'x', displayName: 'Again', email, password: 'x' });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.message).toBe('A user with that email already exists');
    expect((await admin.post('/admin/users', { adminId: 'x', email: 'a@b.c', password: 'x' })).status).toBe(400);

    // New users can log in and own a personal workspace.
    const user = await loginAs(email, 'first-pass');
    const workspaces = await user.get('/workspaces');
    expect(workspaces.status).toBe(200);
    expect(workspaces.body.some((m: any) => m.userId === userId && m.role === 'OWNER')).toBe(true);

    const renamed = await admin.patch(`/admin/users/${userId}`, { adminId: 'x', displayName: 'Renamed User' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.displayName).toBe('Renamed User');
    const clash = await admin.patch(`/admin/users/${userId}`, { adminId: 'x', email: USERS.alice.email });
    expect(clash.status).toBe(400);

    expect((await admin.post(`/admin/users/${userId}/reset-password`, { adminId: 'x', newPassword: 'second-pass' })).status).toBe(201);
    expect((await new Session().login(email, 'first-pass')).status).toBe(401);
    expect((await new Session().login(email, 'second-pass')).status).toBe(201);
  });

  it('makes a user the admin set a password for choose their own before anything else', async () => {
    const admin = await loginAs(USERS.admin.email);
    const { id: userId, email } = await createTempUser(admin, 'given-pass', { mustChangePassword: true });
    expect((await admin.get('/admin/users?adminId=x')).body.find((u: any) => u.id === userId).mustChangePassword).toBe(true);

    const user = new Session();
    const login = await user.login(email, 'given-pass');
    expect(login.status).toBe(201);
    expect(login.body.user.mustChangePassword).toBe(true);
    const blocked = await user.get('/workspaces');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    // Keeping the same password doesn't count.
    expect((await user.put(`/users/${userId}/password`, { currentPassword: 'given-pass', newPassword: 'given-pass' })).status).toBe(400);
    expect((await user.put(`/users/${userId}/password`, { currentPassword: 'given-pass', newPassword: 'own-pass' })).status).toBe(200);
    expect((await user.get('/workspaces')).status).toBe(200);

    // An admin reset asks again, unless the admin says not to.
    await admin.post(`/admin/users/${userId}/reset-password`, { adminId: 'x', newPassword: 'reset-pass' });
    expect((await user.get('/workspaces')).body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await admin.post(`/admin/users/${userId}/reset-password`, { adminId: 'x', newPassword: 'reset-pass', mustChangePassword: false });
    expect((await user.get('/workspaces')).status).toBe(200);
    await admin.delete(`/admin/users/${userId}?adminId=x`);
  });

  it('asks new users to choose their own password unless the admin says not to', async () => {
    const admin = await loginAs(USERS.admin.email);
    const email = `${unique('default').replace(/\s/g, '-').toLowerCase()}@example.com`;
    const created = await admin.post('/admin/users', { adminId: 'x', displayName: 'Default', email, password: 'p' });
    expect(created.body.mustChangePassword).toBe(true);
    await admin.delete(`/admin/users/${created.body.id}?adminId=x`);
  });

  it('refuses to delete the system admin or a user that does not exist', async () => {
    const admin = await loginAs(USERS.admin.email);
    expect((await admin.delete(`/admin/users/${USERS.admin.id}?adminId=x`)).status).toBe(400);
    expect((await admin.delete(`/admin/users/${MISSING_ID}?adminId=x`)).status).toBe(404);
  });

  it('deletes a user with their personal workspace and private pages, keeping their public pages', async () => {
    const admin = await loginAs(USERS.admin.email);
    const { id: userId, email } = await createTempUser(admin, 'pass');
    const user = await loginAs(email, 'pass');

    // A shared workspace owned by alice, where the user writes a public and a private page.
    const alice = await loginAs(USERS.alice.email);
    const shared = (await alice.post('/workspaces', { name: unique('Shared') })).body.workspace.id;
    expect((await alice.post(`/workspaces/${shared}/members`, { email, role: 'EDITOR' })).status).toBe(201);
    const publicPage = (await user.post('/pages', { workspaceId: shared, title: 'Public notes' })).body;
    const privatePage = (await user.post('/pages', { workspaceId: shared, title: 'Private notes', visibility: 'PRIVATE' })).body;
    const privateChild = (await user.post('/pages', { workspaceId: shared, parentId: privatePage.id })).body;
    // A workspace they co-own with alice, and their personal workspace with a database that has a view.
    const own = (await user.post('/workspaces', { name: unique('Own') })).body.workspace.id;
    expect((await user.post(`/workspaces/${own}/members`, { email: USERS.alice.email, role: 'OWNER' })).status).toBe(201);
    const personal = (await user.get('/workspaces')).body.find((m: any) => m.workspaceId !== shared && m.workspaceId !== own);
    const personalPage = (await user.post('/pages', { workspaceId: personal.workspaceId, kind: 'DATABASE' })).body;
    expect((await user.post(`/pages/${personalPage.id}/database/views`, { name: 'Board', type: 'BOARD' })).status).toBe(201);
    // Alice isn't a member there: she gets 403 while the page exists, 404 once it's gone.
    expect((await alice.get(`/pages/${personalPage.id}`)).status).toBe(403);

    const deleted = await admin.delete(`/admin/users/${userId}?adminId=x`);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ ok: true });
    expect((await new Session().login(email, 'pass')).status).toBe(401);

    const kept = await alice.get(`/pages/${publicPage.id}`);
    expect(kept.status).toBe(200);
    expect(kept.body.authorId).toBeNull();
    expect((await alice.get(`/pages/${privatePage.id}`)).status).toBe(404);
    expect((await alice.get(`/pages/${privateChild.id}`)).status).toBe(404);
    const members = (await alice.get(`/workspaces/${shared}/members`)).body.map((m: any) => m.userId);
    expect(members).not.toContain(userId);
    // The co-owned workspace stays with alice; the personal workspace is gone.
    expect((await alice.get(`/workspaces/${own}/members`)).body.map((m: any) => m.userId)).toEqual([USERS.alice.id]);
    expect((await alice.get(`/pages/${personalPage.id}`)).status).toBe(404);
  });

  it("refuses to delete the only owner of a shared workspace", async () => {
    const admin = await loginAs(USERS.admin.email);
    const { id: userId, email } = await createTempUser(admin, 'pass');
    const user = await loginAs(email, 'pass');
    const name = unique('Sole');
    await user.post('/workspaces', { name });
    const res = await admin.delete(`/admin/users/${userId}?adminId=x`);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(`Temp User is the only owner of ${name}. Make someone else an owner first.`);
    expect((await new Session().login(email, 'pass')).status).toBe(201);
  });

  it('lets users change their own password only', async () => {
    const admin = await loginAs(USERS.admin.email);
    const { id: userId, email } = await createTempUser(admin, 'old-pass');

    const user = await loginAs(email, 'old-pass');
    expect((await user.put(`/users/${USERS.alice.id}/password`, { currentPassword: DEMO_PASSWORD, newPassword: 'x' })).status).toBe(403);
    expect((await user.put(`/users/${userId}/password`, { currentPassword: 'old-pass' })).status).toBe(400);
    const changed = await user.put(`/users/${userId}/password`, { currentPassword: 'old-pass', newPassword: 'new-pass' });
    expect(changed.status).toBe(200);
    expect((await new Session().login(email, 'new-pass')).status).toBe(201);
  });

  it('rejects a wrong current password without signalling a logged-out session', async () => {
    const admin = await loginAs(USERS.admin.email);
    const { id: userId, email } = await createTempUser(admin, 'old-pass');
    const user = await loginAs(email, 'old-pass');
    const res = await user.put(`/users/${userId}/password`, { currentPassword: 'wrong', newPassword: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Current password is incorrect');
    expect((await user.get('/auth/me')).status).toBe(200);
  });
});
