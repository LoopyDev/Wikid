// Backs up a running stack, changes it, restores the backup, and checks it's as it was: a page's
// content, a page made afterwards gone, and an uploaded image's file back. Restoring replaces the
// whole stack's data, so run it on its own, never alongside other tests:
//   npm run test:restore         (against http://localhost:8088, or $WIKID_BASE_URL)
// Uses the demo admin account, so not for a production stack.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.env.WIKID_BASE_URL || 'http://localhost:8088').replace(/\/+$/, '');
const backupDir = mkdtempSync(join(tmpdir(), 'wikid-restore-test-'));
const root = new URL('..', import.meta.url).pathname;
// A 1×1 PNG
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let cookie = '';
async function api(method, path, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { cookie, ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  return res;
}
async function json(res, what) {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`);
  return res.json();
}
async function signIn() {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@wikid.local', password: 'wikid' }),
  });
  if (!res.ok) throw new Error(`login: ${res.status}`);
  cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
const contentOf = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const pageText = async (id) => JSON.stringify((await json(await api('GET', `/pages/${id}`), 'read page')).content);
const run = (script, args, env = {}) =>
  execFileSync(join(root, 'docker', script), args, { cwd: root, stdio: 'inherit', env: { ...process.env, BACKUP_DIR: backupDir, ...env } });
const check = (ok, message) => {
  if (!ok) throw new Error(message);
  console.log(`  ok: ${message}`);
};

let workspaceId = null;
try {
  await signIn();
  workspaceId = (await json(await api('POST', '/workspaces', { name: `Restore test ${Date.now()}` }), 'create workspace')).workspace.id;
  const newPage = async (title) =>
    (await json(await api('POST', '/pages', { workspaceId, title, kind: 'DOC', setupStatus: 'COMPLETE' }), 'create page')).id;
  const pageId = await newPage('Backed up');
  await json(await api('PUT', `/pages/${pageId}/content`, { content: contentOf('Before the backup') }), 'save content');
  const form = new FormData();
  form.append('image', new Blob([png], { type: 'image/png' }), 'dot.png');
  form.append('pageId', pageId);
  const { key } = (await json(await api('POST', '/uploads', form), 'upload image')).file;

  console.log('Backing up');
  run('backup.sh', []);
  const dump = readdirSync(backupDir).find((name) => /^wikid-\d{8}-\d{6}\.dump$/.test(name));
  const stamp = dump.slice('wikid-'.length, -'.dump'.length);

  // Changes after the backup: new content, a new page, and the image's file lost
  await json(await api('PUT', `/pages/${pageId}/content`, { content: contentOf('After the backup') }), 'change content');
  const laterPageId = await newPage('Made after the backup');
  const minio = execFileSync('docker', ['compose', 'ps', '-q', 'minio'], { cwd: root }).toString().trim();
  execFileSync('docker', ['run', '--rm', '--volumes-from', minio, 'alpine:3.20', 'rm', '-rf', `/data/wikid/${key}`], { stdio: 'inherit' });
  check((await api('GET', `/uploads/${key}`)).status === 404, "the image's file is gone before restoring");

  console.log(`Restoring ${stamp}`);
  run('restore.sh', [stamp, '--yes']);

  await signIn();
  check((await pageText(pageId)).includes('Before the backup'), "the page's content is as it was backed up");
  check((await api('GET', `/pages/${laterPageId}`)).status !== 200, 'the page made after the backup is gone');
  const image = await api('GET', `/uploads/${key}`);
  check(image.ok && Buffer.from(await image.arrayBuffer()).equals(png), "the image's file is back, unchanged");
  console.log('Backup and restore work');
} finally {
  if (workspaceId) await api('DELETE', `/workspaces/${workspaceId}`).catch(() => {});
  rmSync(backupDir, { recursive: true, force: true });
}
