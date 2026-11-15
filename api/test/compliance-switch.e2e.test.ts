import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Session, USERS, createPage, createWorkspace, loginAs } from './helpers';

// Compliance databases are an alpha feature: off unless the system admin turns them on (Admin →
// Settings). Off, no database can be put into compliance mode; ones already in it keep working.
// (The tests' global setup turns it on; this file turns it off and back.)

let alice: Session;
let admin: Session;
let workspaceId: string;
let wasOn: boolean; // as found, and left

const setSwitch = async (on: boolean) => {
  const res = await admin.patch('/admin/settings', { complianceEnabled: on });
  expect(res.status).toBe(200);
  expect(res.body.compliance.enabled).toBe(on);
};

beforeAll(async () => {
  alice = await loginAs(USERS.alice.email);
  admin = await loginAs(USERS.admin.email);
  workspaceId = await createWorkspace(alice);
  wasOn = (await admin.get('/admin/settings')).body.compliance.enabled;
});

afterAll(async () => {
  await setSwitch(wasOn);
});

describe('the compliance switch', () => {
  it('off: nothing can be put into compliance mode, and the app is told so; ones already in it keep working', async () => {
    // Made while it's on
    await setSwitch(true);
    const kept = await createPage(alice, workspaceId, { kind: 'DATABASE', complianceMode: true, title: 'Assets' });
    expect(kept.databaseComplianceMode).toBe(true);
    const plain = await createPage(alice, workspaceId, { kind: 'DATABASE', title: 'Plain' });
    const pending = await createPage(alice, workspaceId, { setupStatus: 'PENDING', title: 'Not chosen yet' });

    await setSwitch(false);
    expect((await alice.get('/config')).body.compliance).toEqual({ available: false });
    const refused = await alice.post('/pages', { workspaceId, kind: 'DATABASE', complianceMode: true, title: 'New assets' });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/turned off/);
    expect((await alice.patch(`/pages/${pending.id}/setup`, { kind: 'DATABASE', setupStatus: 'COMPLETE', complianceMode: true })).status).toBe(403);
    expect((await alice.patch(`/pages/${plain.id}/database`, { complianceMode: true })).status).toBe(403);
    // Only when a compliance database would be made: a page still to be set up takes the flag as ever
    expect((await alice.post('/pages', { workspaceId, setupStatus: 'PENDING', complianceMode: true, title: 'Later' })).status).toBe(201);
    // A plain database is still made as ever
    expect((await alice.patch(`/pages/${pending.id}/setup`, { kind: 'DATABASE', setupStatus: 'COMPLETE' })).status).toBe(200);

    // The one already in compliance mode: still there and working, and it can be taken out of it
    const existing = await alice.get(`/pages/${kept.id}/database`);
    expect(existing.status).toBe(200);
    expect(existing.body.complianceMode).toBe(true);
    expect((await alice.patch(`/pages/${kept.id}/database`, { complianceMode: false })).status).toBe(200);
  });

  it('on: compliance databases are made as before; only the admin changes the switch', async () => {
    await setSwitch(true);
    expect((await alice.get('/config')).body.compliance).toEqual({ available: true });
    const made = await alice.post('/pages', { workspaceId, kind: 'DATABASE', complianceMode: true, title: 'Records' });
    expect(made.status).toBe(201);
    expect((await alice.patch('/admin/settings', { complianceEnabled: false })).status).toBe(403);
    expect((await admin.patch('/admin/settings', { complianceEnabled: 'yes' })).status).toBe(400);
  });
});
