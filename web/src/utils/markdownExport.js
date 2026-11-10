// Markdown exports. Each page's Markdown comes from the server (its converter, and what the page has
// now rather than the stored copy); here it gets what a file elsewhere needs: the images and splats
// uploaded to Wikid inside the download (their addresses need a login), its databases as tables,
// and links to other exported pages pointing at their files.

import { renderDatabaseAsMarkdownTable } from './editorDoc';
import { absoluteUploadSrc, uploadKey, uploadSrc } from './uploadUrl';
import { createZipBlob } from './zip';

const FOLDER = 'images';
// Fetched a few at a time, so a big workspace doesn't send hundreds of requests at once
const FETCHES_AT_ONCE = 6;
// A file or folder name's longest, in bytes: most file systems stop at 255, and ".md" or " (2)" go on
const NAME_BYTES = 200;

const fetchUpload = async (url) => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return new Uint8Array(await res.arrayBuffer());
};

// A file or folder name that unzips anywhere: no folder of its own ("/", "..") or characters Windows
// refuses, not ending in a dot or space, and not too long
export const safeName = (value) => {
  let name = String(value || '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[/\\?%*:|"<>]+/g, '-')
    .trim()
    .replace(/^\.+|[. ]+$/g, '') || 'page';
  const encoder = new TextEncoder();
  while (encoder.encode(name).length > NAME_BYTES) name = Array.from(name).slice(0, -1).join('');
  return name.replace(/[. ]+$/g, '') || 'page';
};

// A link's address in Markdown: ](address) or ](<address with spaces>)
const LINK_TARGET = /\]\((<[^>\n]*>|[^)\s]+)/g;
const unwrap = (target) => (target.startsWith('<') ? target.slice(1, -1) : target);
const rewriteLinks = (markdown, change) =>
  outsideCode(markdown, (line) =>
    line.replace(LINK_TARGET, (whole, target) => {
      const next = change(unwrap(target));
      return next ? `](${/[\s()<>]/.test(next) ? `<${next}>` : next}` : whole;
    }),
  );
// A change to the Markdown outside its fenced code blocks, which are left as they are
const outsideCode = (markdown, change) => {
  let fence = null;
  return markdown
    .split('\n')
    .map((line) => {
      const opening = line.match(/^(?:\s*>)*\s*(`{3,}|~{3,})/);
      if (fence) {
        if (opening && opening[1][0] === fence[0] && opening[1].length >= fence.length) fence = null;
        return line;
      }
      if (opening) {
        fence = opening[1];
        return line;
      }
      return change(line);
    })
    .join('\n');
};
const uploadsIn = (markdown) => {
  const found = [];
  outsideCode(markdown, (line) => {
    for (const match of line.matchAll(LINK_TARGET)) if (uploadKey(unwrap(match[1]))) found.push(unwrap(match[1]));
    return line;
  });
  return found;
};
// A file name in a link: encoded, brackets too (a ")" would end the link)
const linkSegment = (segment) => encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29');
// A link to another page, as the server writes it (its text may hold escaped brackets)
const PAGE_LINK = /\[((?:\\.|[^\]\\])*)\]\(wikid-page:([0-9a-f-]+)\)/g;

/**
 * Fetches every upload the pages link to, each to be saved at images/<file name>.
 * One that can't be fetched is left out, and the page keeps linking to its address.
 * @param {string[]} markdowns
 * @param {(url: string) => Promise<Uint8Array>} [fetchFile]
 */
export async function collectUploads(markdowns, fetchFile = fetchUpload) {
  const paths = new Map(); // upload key -> path in the zip
  const usedNames = new Set();
  for (const markdown of markdowns) {
    for (const src of uploadsIn(markdown)) {
      const key = uploadKey(src);
      if (!key || paths.has(key)) continue;
      const [pageId, fileName] = key.split('/');
      // File names are a time and a random part, so two pages sharing one is very unlikely
      const name = usedNames.has(fileName) ? `${pageId}-${fileName}` : fileName;
      usedNames.add(name);
      paths.set(key, `${FOLDER}/${name}`);
    }
  }

  const fetched = new Map();
  const queue = [...paths];
  const worker = async () => {
    while (queue.length) {
      const [key, path] = queue.shift();
      try {
        fetched.set(key, { path, data: await fetchFile(uploadSrc(`/uploads/${key}`)) });
      } catch (err) {
        console.warn(`Couldn't add ${key} to the export, keeping its link`, err);
      }
    }
  };
  await Promise.all(Array.from({ length: FETCHES_AT_ONCE }, worker));

  return {
    files: [...paths.keys()].filter((key) => fetched.has(key)).map((key) => fetched.get(key)),
    pathFor: (src) => fetched.get(uploadKey(src))?.path ?? null,
  };
}

/**
 * A page's Markdown, its databases as tables: a database page whole, a document page from the
 * server with its database views filled in.
 * @param {{ id: string, title?: string, kind?: string }} page
 * @param {{ getMarkdown: (pageId: string) => Promise<string>, fetchDatabase?: (pageId: string) => Promise<any> }} sources
 */
export async function pageMarkdown(page, { getMarkdown, fetchDatabase }) {
  const table = async (pageId, title) => {
    try {
      const db = fetchDatabase ? await fetchDatabase(pageId) : null;
      return db ? renderDatabaseAsMarkdownTable(db, title) : `[Database: ${title || 'Untitled'}]`;
    } catch {
      return `[Database: ${title || 'Untitled'}]`;
    }
  };
  if (page.kind === 'DATABASE') return table(page.id, page.title);
  const markdown = await getMarkdown(page.id);
  // On a line of its own, after what puts it in a quote or list ("> ", "  "): each line of the table gets that too
  const marker = /^([ >]*)\{\{wikid-database:([0-9a-f-]+)\}\}$/;
  const views = new Set();
  outsideCode(markdown, (line) => {
    const match = line.match(marker);
    if (match) views.add(match[2]);
    return line;
  });
  const tables = new Map(await Promise.all([...views].map(async (id) => [id, await table(id)])));
  return outsideCode(markdown, (line) => {
    const match = line.match(marker);
    return match ? tables.get(match[2]).split('\n').map((row) => `${match[1]}${row}`).join('\n') : line;
  });
}

/**
 * One page as Markdown: a .md file, or a zip with the .md and an images folder when it shows uploads.
 * @returns {Promise<{ blob: Blob, filename: string }>}
 */
export async function exportPageMarkdown({ page, getMarkdown, fetchDatabase, fetchFile }) {
  const name = safeName(page.title);
  const markdown = await pageMarkdown(page, { getMarkdown, fetchDatabase });
  const uploads = await collectUploads([markdown], fetchFile);
  // A link to another page has no file to go to here: it keeps its text
  const text = outsideCode(
    rewriteLinks(markdown, (src) => uploads.pathFor(src) || (uploadKey(src) ? absoluteUploadSrc(src) : null)),
    (line) => line.replace(PAGE_LINK, '$1'),
  );
  if (!uploads.files.length) {
    return { blob: new Blob([text], { type: 'text/markdown;charset=utf-8' }), filename: `${name}.md` };
  }
  return {
    blob: createZipBlob([{ path: `${name}.md`, data: text }, ...uploads.files]),
    filename: `${name}.zip`,
  };
}

/**
 * Where each page goes in a zip: its title, made unique among its siblings ("Notes", "Notes (2)"),
 * in its parent's folder. Pages whose parent isn't exported are at the top.
 * @param {Array<{ id: string, title?: string, parentId?: string | null }>} pages
 * @returns {Map<string, string>} page id -> path, without .md
 */
export function zipPaths(pages) {
  const ids = new Set(pages.map((page) => page.id));
  const byParent = new Map();
  pages.forEach((page) => {
    const parent = page.parentId && ids.has(page.parentId) ? page.parentId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), page]);
  });
  const paths = new Map();
  const place = (parentId, folder) => {
    const taken = new Set();
    for (const page of byParent.get(parentId) ?? []) {
      const base = safeName(page.title || 'Untitled page');
      let name = base;
      for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${base} (${n})`;
      taken.add(name.toLowerCase());
      const path = folder ? `${folder}/${name}` : name;
      paths.set(page.id, path);
      place(page.id, path);
    }
  };
  place(null, '');
  return paths;
}

const relative = (from, to) => {
  const fromParts = from.split('/').slice(0, -1);
  const toParts = to.split('/');
  let same = 0;
  while (same < fromParts.length && same < toParts.length - 1 && fromParts[same] === toParts[same]) same += 1;
  return [...Array(fromParts.length - same).fill('..'), ...toParts.slice(same)].join('/');
};

/**
 * Many pages as Markdown in one zip, each at its path (folders for subpages), with one images
 * folder, and links between them pointing at each other's files.
 * @param {Array<{ id: string, title?: string, parentId?: string | null, kind?: string }>} pages
 * @returns {Promise<Blob>}
 */
export async function exportPagesMarkdownZip(pages, { getMarkdown, fetchDatabase, fetchFile } = {}) {
  const paths = zipPaths(pages);
  // A few pages at a time: each is read from its live document on the server
  const markdowns = new Array(pages.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < pages.length) {
      const index = next;
      next += 1;
      try {
        markdowns[index] = await pageMarkdown(pages[index], { getMarkdown, fetchDatabase });
      } catch (err) {
        console.warn(`Couldn't export ${pages[index].id}`, err);
      }
    }
  };
  await Promise.all(Array.from({ length: FETCHES_AT_ONCE }, worker));
  const uploads = await collectUploads(markdowns.filter(Boolean), fetchFile);
  const entries = pages
    .map((page, index) => {
      const markdown = markdowns[index];
      if (markdown === null) return null;
      const path = paths.get(page.id);
      // From a page in a folder, the images folder is that many levels up
      const up = '../'.repeat(path.split('/').length - 1);
      // An upload it couldn't fetch keeps its address, in full, as Markdown is read outside Wikid
      const linked = rewriteLinks(markdown, (src) => {
        const file = uploads.pathFor(src);
        return file ? `${up}${file}` : uploadKey(src) ? absoluteUploadSrc(src) : null;
      });
      const withPageLinks = outsideCode(linked, (line) =>
        line.replace(PAGE_LINK, (_, text, id) =>
          paths.has(id) ? `[${text}](${relative(path, `${paths.get(id)}.md`).split('/').map(linkSegment).join('/')})` : text,
        ),
      );
      return { path: `${path}.md`, data: withPageLinks };
    })
    .filter(Boolean);
  return createZipBlob([...entries, ...uploads.files]);
}
