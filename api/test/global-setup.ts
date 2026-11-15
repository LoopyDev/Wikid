import { API_URL, USERS, loginAs } from './helpers';

// Fail fast with a clear message when no stack is running. Then compliance databases (an alpha
// feature, off unless the admin turns it on) are turned on, as the tests use them.
export default async function setup() {
  try {
    const res = await fetch(`${API_URL}/auth/me`);
    if (res.status !== 401 && res.status !== 200) throw new Error(`unexpected status ${res.status}`);
  } catch (err) {
    throw new Error(
      `Can't reach the Wikid API at ${API_URL} (${(err as Error).message}).\n` +
        'Start a stack first, for example:\n' +
        '  docker compose -p wikid-dockertest -f docker-compose.yml up -d --build --wait\n' +
        'or point WIKID_API_URL at a running API.',
    );
  }
  const admin = await loginAs(USERS.admin.email);
  const res = await admin.patch('/admin/settings', { complianceEnabled: true });
  if (res.status !== 200) throw new Error(`Turning on compliance databases failed: ${res.status} ${JSON.stringify(res.body)}`);
}
