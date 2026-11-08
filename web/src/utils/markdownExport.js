// Markdown exports, with the images and splats uploaded to Wikid inside the download. Their
// addresses need a login, so a Markdown file that only links to them can't show them anywhere else.

import { editorDocToMarkdownAsync, fileSrcsInDoc } from './editorDoc';
import { uploadKey, uploadSrc } from './uploadUrl';
import { createZipBlob } from './zip';

const FOLDER = 'images';
// Fetched a few at a time, so a big workspace doesn't send hundreds of requests at once
const FETCHES_AT_ONCE = 6;

const fetchUpload = async (url) => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return new Uint8Array(await res.arrayBuffer());
};

// A file or folder name with nothing that would make a folder of its own when unzipped
const safeName = (value) => String(value || '').trim().replace(/[/\\]+/g, '-') || 'page';

/**
 * Fetches every upload the docs show, each to be saved at images/<file name>.
 * One that can't be fetched is left out, and the page keeps linking to its address.
 * @param {unknown[]} docs
 * @param {(url: string) => Promise<Uint8Array>} [fetchFile]
 * @returns {Promise<{ files: Array<{ path: string, data: Uint8Array }>, pathFor: (src: string) => string | null }>}
 */
export async function collectUploads(docs, fetchFile = fetchUpload) {
  const paths = new Map(); // upload key -> path in the zip
  const usedNames = new Set();
  for (const doc of docs) {
    for (const src of fileSrcsInDoc(doc)) {
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
 * One page as Markdown: a .md file, or a zip with the .md and an images folder when it shows uploads.
 * @returns {Promise<{ blob: Blob, filename: string }>}
 */
export async function exportPageMarkdown({ doc, title, fetchDatabase, fetchFile }) {
  const name = safeName(title);
  const uploads = await collectUploads([doc], fetchFile);
  const markdown = await editorDocToMarkdownAsync(doc, fetchDatabase, { fileLink: uploads.pathFor });
  if (!uploads.files.length) {
    return { blob: new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), filename: `${name}.md` };
  }
  return {
    blob: createZipBlob([{ path: `${name}.md`, data: markdown }, ...uploads.files]),
    filename: `${name}.zip`,
  };
}

/**
 * Many pages as Markdown in one zip, each at its path (folders for subpages), with one images folder.
 * @param {Array<{ path: string, doc: unknown }>} pages paths without .md, such as "Parent/Child"
 * @returns {Promise<Blob>}
 */
export async function exportPagesMarkdownZip(pages, { fetchDatabase, fetchFile } = {}) {
  const uploads = await collectUploads(pages.map((page) => page.doc), fetchFile);
  const entries = await Promise.all(
    pages.map(async ({ path, doc }) => {
      // From a page in a folder, the images folder is that many levels up
      const up = '../'.repeat(path.split('/').length - 1);
      const fileLink = (src) => {
        const filePath = uploads.pathFor(src);
        return filePath ? `${up}${filePath}` : null;
      };
      const markdown = await editorDocToMarkdownAsync(doc, fetchDatabase, { fileLink });
      return { path: `${path}.md`, data: markdown };
    }),
  );
  return createZipBlob([...entries, ...uploads.files]);
}
