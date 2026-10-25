import { API_URL } from './helpers';

// Fail fast with a clear message when no stack is running.
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
}
