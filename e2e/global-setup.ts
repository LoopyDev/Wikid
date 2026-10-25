// Fail fast with a clear message when no stack is running.
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
}
