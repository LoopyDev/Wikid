#!/usr/bin/env node
// Runs the API in development: tsc recompiles src into dist on every change, and node --watch restarts
// the server when dist changes. This replaces ts-node, which needs TypeScript's JavaScript API (gone in
// TypeScript 7), and runs the same compiled output as production. tsx can't be used here: esbuild
// doesn't emit the decorator metadata NestJS needs to inject services.
//
// Run from api/:  npm run start:dev

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';

const tsc = ['tsc', '-p', 'tsconfig.build.json'];

// A first full build, so the server has something to start. Type errors are printed but don't stop it,
// as with ts-node --transpile-only (tsc still writes the output).
spawnSync(tsc[0], tsc.slice(1), { stdio: 'inherit' });

// The compliance client is imported from ../../prisma/generated, which from dist/src is dist/prisma/generated
// (the Docker build copies it there)
if (!existsSync('dist/prisma/generated')) {
  mkdirSync('dist/prisma', { recursive: true });
  symlinkSync('../../prisma/generated', 'dist/prisma/generated');
}

const children = [
  spawn(tsc[0], [...tsc.slice(1), '--watch', '--preserveWatchOutput'], { stdio: 'inherit' }),
  spawn(process.execPath, ['--watch', 'dist/src/main.js'], { stdio: 'inherit' }),
];

// Ctrl+C reaches both directly; if either stops on its own, stop the other too
for (const child of children) {
  child.on('exit', (code) => {
    for (const other of children) other.kill();
    process.exitCode = code ?? 0;
  });
}
