import { DEMO_PASSWORD, USERS } from './fixtures';

// Fail fast with a clear message when no stack is running. Then compliance databases (an alpha
// feature, off unless the admin turns it on) are turned on, as the tests use them.
export default async function setup() {
  const base = process.env.WIKID_BASE_URL || 'http://localhost:8088';
  try {
    const res = await fetch(`${base}/api/auth/me`);
    if (res.status !== 401 && res.status !== 200) throw new Error(`unexpected status ${res.status}`);
  } catch (err) {
    throw new Error(
      `Can't reach Wikid at ${base} (${(err as Error).message}).\n` +
        'Start a stack first, for example:\n' +
        '  docker compose -p wikid-dockertest -f docker-compose.yml up -d --build --wait\n' +
        'or point WIKID_BASE_URL at a running instance.',
    );
  }
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: USERS.admin.email, password: DEMO_PASSWORD }),
  });
  if (login.status !== 201) throw new Error(`Signing in as the admin failed: ${login.status} ${await login.text()}`);
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const res = await fetch(`${base}/api/admin/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ complianceEnabled: true }),
  });
  if (res.status !== 200) throw new Error(`Turning on compliance databases failed: ${res.status} ${await res.text()}`);
}
