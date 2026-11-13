// Checks docker/update.sh without Docker: a server checkout of a throwaway repository, updated from
// its own "origin", with a stand-in `docker` that only notes what it was asked to do.
//   npm run test:update
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), 'wikid-update-test-'));
const origin = join(work, 'origin.git');
const server = join(work, 'server');
const dev = join(work, 'dev');
const bin = join(work, 'bin');
const dockerLog = join(work, 'docker.log');

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures += 1;
};

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
// A commit in the developer's copy, pushed to origin
const pushChange = (files, message) => {
  for (const [path, text] of Object.entries(files)) write(join(dev, path), text);
  git(dev, 'add', '-A');
  git(dev, 'commit', '-q', '-m', message);
  git(dev, 'push', '-q', 'origin', 'HEAD:main');
};
const run = (args = [], env = {}) => {
  writeFileSync(dockerLog, '');
  const result = spawnSync('sh', ['docker/update.sh', ...args], {
    cwd: server,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BACKUP_DIR: join(work, 'backups'), DOCKER_LOG: dockerLog, ...env },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}`, docker: readFileSync(dockerLog, 'utf8') };
};

try {
  // `docker` that writes down each call; `compose config --services` lists a stack with Caddy
  mkdirSync(bin);
  write(
    join(bin, 'docker'),
    '#!/bin/sh\necho "$*" >> "$DOCKER_LOG"\n' +
      // DOCKER_FAIL: a call with this in it fails (a backup or a check going wrong)
      'if [ -n "${DOCKER_FAIL:-}" ] && echo "$*" | grep -q "$DOCKER_FAIL"; then exit 1; fi\n' +
      '[ "$1 $2 $3" = "compose config --services" ] && printf "api\\nweb\\ncaddy\\n"\nexit 0\n'
  );
  chmodSync(join(bin, 'docker'), 0o755);

  git(work, 'init', '-q', '--bare', '-b', 'main', origin);
  git(work, 'clone', '-q', origin, dev);
  git(dev, 'config', 'user.email', 'dev@example.com');
  git(dev, 'config', 'user.name', 'Dev');
  for (const script of ['update.sh', 'backup.sh']) {
    mkdirSync(join(dev, 'docker'), { recursive: true });
    copyFileSync(join(root, 'docker', script), join(dev, 'docker', script));
  }
  pushChange({ 'docker/caddy/Caddyfile': 'example.com\n', 'api/prisma/migrations/1_first/migration.sql': '-- first\n' }, 'First');
  git(work, 'clone', '-q', origin, server);
  git(server, 'config', 'user.email', 'server@example.com');
  git(server, 'config', 'user.name', 'Server');

  // Nothing new: the images are refreshed (security fixes), without a backup or a Caddy restart
  let result = run();
  check(result.status === 0, 'nothing new: succeeds');
  check(/build --pull/.test(result.docker) && /up -d --wait/.test(result.docker), 'nothing new: rebuilds and restarts');
  check(/compose pull/.test(result.docker), 'nothing new: fetches the images that are not built');
  check(!/pg_dump/.test(result.docker), 'nothing new: no backup');
  check(!/restart caddy/.test(result.docker), 'nothing new: Caddy left alone');

  // New commits with a migration and a Caddyfile change
  pushChange({ 'docker/caddy/Caddyfile': 'example.com {\n}\n', 'api/prisma/migrations/2_second/migration.sql': '-- second\n' }, 'Second change');
  const before = git(server, 'rev-parse', 'HEAD');
  result = run();
  check(result.status === 0, 'new commits: succeeds');
  check(git(server, 'rev-parse', 'HEAD') === git(dev, 'rev-parse', 'HEAD'), 'new commits: the checkout is at the new commit');
  const at = (call) => result.docker.indexOf(call);
  check(at('build --pull') >= 0 && at('build --pull') < at('pg_dump') && at('pg_dump') < at('up -d --wait'), 'new commits: backs up once built, just before restarting');
  check(at('caddy validate') >= 0 && at('caddy validate') < at('restart caddy'), 'new commits: checks the changed Caddyfile, then restarts Caddy');
  check(/\.\/docker\/restore\.sh \d{8}-\d{6}/.test(result.output), 'new commits: names the backup to restore');
  check(result.output.includes('Second change'), 'new commits: lists what came in');
  check(result.output.includes(before.slice(0, 7)), 'new commits: says which commit it was at, to go back to');
  check(/migration/i.test(result.output), 'new commits: says a database migration came in');

  // An update to the update script itself: the new one carries on
  const script = readFileSync(join(dev, 'docker/update.sh'), 'utf8');
  pushChange({ 'docker/update.sh': script.replace('set -eu\n', 'set -eu\necho "Updater from the new commit"\n') }, 'Newer updater');
  result = run();
  check(result.status === 0, 'new updater: succeeds');
  check(result.output.includes('Updater from the new commit'), 'new updater: the pulled script carries on');
  check(!/restart caddy/.test(result.docker), 'new updater: Caddy left alone');

  // Only a seed change under api/prisma: no migration warning
  pushChange({ 'api/prisma/seed.ts': '// seed\n' }, 'Seed changed');
  result = run();
  check(result.status === 0 && !/migration/i.test(result.output), 'no migration: no migration warning');

  // --no-backup
  pushChange({ 'api/prisma/migrations/3_third/migration.sql': '-- third\n' }, 'Third');
  result = run(['--no-backup']);
  check(result.status === 0 && !/pg_dump/.test(result.docker), '--no-backup: no backup');
  check(/No backup was taken/.test(result.output) && !/restore\.sh \d/.test(result.output), '--no-backup: says so, and names no backup');
  check(/old code may not run on the migrated data/.test(result.output), '--no-backup: warns that going back needs an older backup');

  // The backup fails: stopped before restarting, saying how to go back
  pushChange({ 'api/prisma/migrations/4_fourth/migration.sql': '-- fourth\n' }, 'Fourth');
  let was = git(server, 'rev-parse', '--short', 'HEAD');
  result = run([], { DOCKER_FAIL: 'pg_dump' });
  check(result.status !== 0, 'backup fails: stops');
  check(!/up -d --wait/.test(result.docker), 'backup fails: the running services are left as they were');
  check(result.output.includes(`git reset --hard ${was}`), 'backup fails: says how to go back');
  git(server, 'reset', '-q', '--hard', was);

  // A broken new Caddyfile: Caddy keeps the old one
  pushChange({ 'docker/caddy/Caddyfile': 'broken {\n' }, 'Broken Caddyfile');
  was = git(server, 'rev-parse', '--short', 'HEAD');
  result = run([], { DOCKER_FAIL: 'caddy validate' });
  check(result.status !== 0, 'broken Caddyfile: stops');
  check(!/restart caddy/.test(result.docker), 'broken Caddyfile: Caddy not restarted');
  check(/Updated, but the new Caddyfile/.test(result.output) && !/stopped part-way/.test(result.output), 'broken Caddyfile: says only the Caddyfile needs fixing');
  pushChange({ 'docker/caddy/Caddyfile': 'example.com {\n}\n' }, 'Caddyfile fixed');
  check(run().status === 0, 'broken Caddyfile: the next update goes through');

  // --check: what would come in, and nothing else
  pushChange({ 'README.md': 'Readme\n' }, 'Readme added');
  const head = git(server, 'rev-parse', 'HEAD');
  result = run(['--check']);
  check(result.status === 0, '--check: succeeds');
  check(result.output.includes('Readme added'), '--check: lists what would come in');
  check(git(server, 'rev-parse', 'HEAD') === head, '--check: the checkout is unchanged');
  check(result.docker === '', '--check: nothing done with Docker');

  // Changes made on the server: refused, before anything is done
  write(join(server, 'docker/caddy/Caddyfile'), 'edited on the server\n');
  result = run();
  check(result.status !== 0, 'local edits: refused');
  check(result.docker === '', 'local edits: nothing done with Docker');
  check(git(server, 'rev-parse', 'HEAD') === head, 'local edits: the checkout is unchanged');
  git(server, 'checkout', '--', '.');

  // Staged changes, and a new file of its own: refused too
  write(join(server, 'notes.txt'), 'mine\n');
  result = run();
  check(result.status !== 0 && result.docker === '', 'untracked file: refused, nothing done');
  git(server, 'add', 'notes.txt');
  result = run();
  check(result.status !== 0 && result.docker === '', 'staged change: refused, nothing done');
  git(server, 'rm', '-q', '--cached', 'notes.txt');
  rmSync(join(server, 'notes.txt'));

  check(run(['--everything']).status === 2, 'unknown option: refused');

  // Not on a branch that follows one
  git(server, 'checkout', '-q', '--detach');
  result = run();
  check(result.status !== 0 && result.docker === '', 'no upstream: refused, nothing done');
  git(server, 'checkout', '-q', 'main');

  // A commit made on the server: the branches differ, so no update (not a merge on the server)
  git(server, 'commit', '-q', '--allow-empty', '-m', 'Made on the server');
  result = run();
  check(result.status !== 0, 'diverged: refused');
  check(result.docker === '', 'diverged: no backup, nothing done with Docker');
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('All checks passed');
