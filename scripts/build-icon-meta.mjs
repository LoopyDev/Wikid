#!/usr/bin/env node
// Builds web/src/utils/iconMeta.json: the category and search tags of each Bootstrap icon, for the
// icon picker. The npm package has only the SVGs; the categories and tags are in each icon's page
// in the Bootstrap Icons repo (docs/content/icons/<name>.md, MIT licensed), for the same version.
//
// Run it again after bumping bootstrap-icons:  node scripts/build-icon-meta.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'web', 'package.json'));
const { version } = require('bootstrap-icons/package.json');
const output = join(root, 'web', 'src', 'utils', 'iconMeta.json');

// The icon names the app has (the SVGs installed), so the data matches them exactly
const iconsDir = join(dirname(require.resolve('bootstrap-icons/package.json')), 'icons');
const installed = new Set(readdirSync(iconsDir).filter((file) => file.endsWith('.svg')).map((file) => file.slice(0, -4)));

// The repo at that version, downloaded into a folder of its own; only the icons' pages are unpacked
const work = mkdtempSync(join(tmpdir(), 'wikid-icon-meta-'));
try {
  const archive = join(work, 'icons.tar.gz');
  const res = await fetch(`https://codeload.github.com/twbs/icons/tar.gz/refs/tags/v${version}`);
  if (!res.ok) throw new Error(`Downloading Bootstrap Icons v${version} failed: ${res.status}`);
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  const pages = join(work, 'pages');
  execFileSync('mkdir', [pages]);
  // The archive's folder is named icons-<version>; naming the exact path works with any tar
  execFileSync('tar', ['-xzf', archive, '-C', pages, '--strip-components=4', `icons-${version}/docs/content/icons`], { stdio: 'inherit' });

  // Each page starts with front matter: title, then "categories:" and "tags:" lists
  const listsFrom = (text) => {
    const front = text.split(/^---\s*$/m)[1] || '';
    const lists = { categories: [], tags: [] };
    let current = null;
    for (const line of front.split('\n')) {
      const key = line.match(/^(\w+):\s*$/);
      if (key) {
        current = lists[key[1]] ? key[1] : null;
        continue;
      }
      const item = line.match(/^\s+-\s+(.+?)\s*$/);
      if (item && current) lists[current].push(item[1].replace(/^['"]|['"]$/g, ''));
      else if (/^\S/.test(line)) current = null;
    }
    return lists;
  };

  const categoryNames = new Set();
  const found = {};
  for (const file of readdirSync(pages).filter((name) => name.endsWith('.md'))) {
    const name = file.slice(0, -3);
    if (!installed.has(name)) continue;
    const { categories, tags } = listsFrom(readFileSync(join(pages, file), 'utf8'));
    categories.forEach((category) => categoryNames.add(category));
    found[name] = { categories, tags };
  }

  // Compact: category names once, then each icon's category indexes and its tags
  const categories = [...categoryNames].sort((a, b) => a.localeCompare(b));
  const index = new Map(categories.map((category, i) => [category, i]));
  const icons = {};
  for (const name of Object.keys(found).sort()) {
    const { categories: own, tags } = found[name];
    icons[name] = [own.map((category) => index.get(category)), tags.map((tag) => tag.toLowerCase())];
  }
  writeFileSync(output, `${JSON.stringify({ version, categories, icons })}\n`);
  const missing = [...installed].filter((name) => !found[name]);
  console.log(`Wrote ${Object.keys(icons).length} icons in ${categories.length} categories to ${output}${missing.length ? ` (${missing.length} without a page)` : ''}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
