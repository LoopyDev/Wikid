import { beforeAll, describe, expect, it } from 'vitest';
import { Session, USERS, loginAs, unique } from './helpers';

// Signed-in sessions end when they should: on logging out, and on a password change (the other
// ones) or reset (all of them), not 14 days later.

let admin: Session;

beforeAll(async () => {
  admin = await loginAs(USERS.admin.email);
});

async function newUser(password: string) {
  const email = `${unique('session').replace(/\s/g, '-').toLowerCase()}@example.com`;
  const res = await admin.post('/admin/users', { adminId: 'x', displayName: 'Session test', email, password, mustChangePassword: false });
  expect(res.status).toBe(201);
  return { id: res.body.id as string, email };
}

const signedIn = async (session: Session) => (await session.get('/auth/me')).status === 200;

describe('sessions', () => {
  it('ends on logging out, even for a copy of its cookie', async () => {
    const { email } = await newUser('first-password');
    const session = await loginAs(email, 'first-password');
    const copied = session.copy();
    expect(await signedIn(copied)).toBe(true);
    expect((await session.post('/auth/logout')).status).toBe(201);
    expect(await signedIn(copied)).toBe(false);
  });

  it("ends one's other sessions on changing one's password, keeping this one", async () => {
    const { id, email } = await newUser('first-password');
    const laptop = await loginAs(email, 'first-password');
    const phone = await loginAs(email, 'first-password');
    expect((await laptop.put(`/users/${id}/password`, { currentPassword: 'first-password', newPassword: 'second-password' })).status).toBe(200);
    expect(await signedIn(laptop)).toBe(true);
    expect(await signedIn(phone)).toBe(false);
  });

  it("ends all of someone's sessions when an admin resets their password", async () => {
    const { id, email } = await newUser('first-password');
    const session = await loginAs(email, 'first-password');
    expect((await admin.post(`/admin/users/${id}/reset-password`, { adminId: 'x', newPassword: 'reset-password', mustChangePassword: false })).status).toBe(201);
    expect(await signedIn(session)).toBe(false);
  });

  it('stops guessing the current password when changing it', async () => {
    const { id, email } = await newUser('first-password');
    const session = await loginAs(email, 'first-password');
    for (let i = 0; i < 5; i += 1) {
      expect((await session.put(`/users/${id}/password`, { currentPassword: `wrong-${i}`, newPassword: 'second-password' })).status).toBe(400);
    }
    expect((await session.put(`/users/${id}/password`, { currentPassword: 'first-password', newPassword: 'second-password' })).status).toBe(429);
  });

  it('asks for a new password of at least 8 characters', async () => {
    const { id, email } = await newUser('first-password');
    const session = await loginAs(email, 'first-password');
    const short = await session.put(`/users/${id}/password`, { currentPassword: 'first-password', newPassword: 'x' });
    expect(short.status).toBe(400);
    expect(short.body.message).toMatch(/8 characters/);
    // Only text: a list of 8 things isn't a password of 8 characters
    const list = await session.put(`/users/${id}/password`, { currentPassword: 'first-password', newPassword: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] });
    expect(list.status).toBe(400);
  });
});
