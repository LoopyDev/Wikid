import { describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, Session, USERS, loginAs, unique } from './helpers';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

async function createTempUser(admin: Session, password: string) {
  const email = `${unique('user').replace(/\s/g, '-').toLowerCase()}@example.com`;
  const res = await admin.post('/admin/users', { adminId: 'x', displayName: 'Temp User', email, password });
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

  // Known bug: the response is the full user record, including the password hash.
  it.fails('does not return the password hash when saving preferences', async () => {
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

  it('refuses to delete the system admin or a user that does not exist', async () => {
    const admin = await loginAs(USERS.admin.email);
    expect((await admin.delete(`/admin/users/${USERS.admin.id}?adminId=x`)).status).toBe(400);
    expect((await admin.delete(`/admin/users/${MISSING_ID}?adminId=x`)).status).toBe(404);
  });

  // Known bug: deleting a user fails with 500 because their workspace memberships
  // (every user has a personal workspace) still point at them.
  it.fails('deletes a user', async () => {
    const admin = await loginAs(USERS.admin.email);
    const { id: userId, email } = await createTempUser(admin, 'pass');
    expect((await admin.delete(`/admin/users/${userId}?adminId=x`)).status).toBe(200);
    expect((await new Session().login(email, 'pass')).status).toBe(401);
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

  // Known bug: a wrong current password answers 401, which the web app treats as
  // "session expired" and logs the user out.
  it.fails('rejects a wrong current password without signalling a logged-out session', async () => {
    const admin = await loginAs(USERS.admin.email);
    const { id: userId, email } = await createTempUser(admin, 'old-pass');
    const user = await loginAs(email, 'old-pass');
    const res = await user.put(`/users/${userId}/password`, { currentPassword: 'wrong', newPassword: 'x' });
    expect(res.body.message).toBe('Current password is incorrect');
    expect(res.status).not.toBe(401);
  });
});
