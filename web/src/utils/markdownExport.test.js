import { describe, it, expect, vi } from 'vitest';
import { collectUploads, exportPageMarkdown, exportPagesMarkdownZip } from './markdownExport';
import { readStoredZip } from './zip';

const pageId = '869980ec-a19d-40e0-9a53-c664fa6c66ff';
const otherPageId = '11111111-2222-3333-4444-555555555555';
const upload = (id, name) => `/api/uploads/${id}/${name}`;

const doc = (...content) => ({ type: 'doc', content });
const image = (src, alt = '') => ({ type: 'image', attrs: { src, alt } });
const splat = (src) => ({ type: 'gaussianSplat', attrs: { src } });
const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

const bytesFor = (url) => new TextEncoder().encode(`bytes of ${url.split('/').pop()}`);
const fetchFile = vi.fn(async (url) => bytesFor(url));

// The test browser's Blob can only be read with a FileReader
const blobBytes = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(new Uint8Array(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsArrayBuffer(blob);
});
const unzip = async (blob) => readStoredZip(await blobBytes(blob));
const text = (bytes) => new TextDecoder().decode(bytes);

describe('exportPageMarkdown', () => {
  it('stays a plain Markdown file when the page has no uploads', async () => {
    const { blob, filename } = await exportPageMarkdown({
      doc: doc(paragraph('Hello'), image('https://example.com/cat.png', 'cat')),
      title: 'Notes',
      fetchFile,
    });
    expect(filename).toBe('Notes.md');
    expect(text(await blobBytes(blob))).toBe('Hello\n\n![cat](https://example.com/cat.png)');
  });

  it('puts uploaded images and splats in a zip, linked from the Markdown', async () => {
    const { blob, filename } = await exportPageMarkdown({
      doc: doc(
        image(`https://wiki.example.com${upload(pageId, '1-a.png')}`, 'Diagram'),
        image(upload(pageId, '1-a.png')),
        splat(upload(pageId, '2-b.spz')),
        image('https://example.com/cat.png', 'cat'),
      ),
      title: 'Plans / ideas',
      fetchFile,
    });
    expect(filename).toBe('Plans - ideas.zip');
    const files = await unzip(blob);
    expect([...files.keys()]).toEqual(['Plans - ideas.md', 'images/1-a.png', 'images/2-b.spz']);
    expect(text(files.get('Plans - ideas.md'))).toBe([
      '![Diagram](images/1-a.png)',
      '![image](images/1-a.png)',
      '[Gaussian splat](images/2-b.spz)',
      '![cat](https://example.com/cat.png)',
    ].join('\n\n'));
    expect(text(files.get('images/1-a.png'))).toBe('bytes of 1-a.png');
  });

  it("keeps the address of an upload it couldn't fetch, and still exports", async () => {
    const failing = async (url) => {
      if (url.endsWith('gone.png')) throw new Error('404');
      return bytesFor(url);
    };
    const { blob } = await exportPageMarkdown({
      doc: doc(image(upload(pageId, 'gone.png')), image(upload(pageId, 'here.png'))),
      title: 'Page',
      fetchFile: failing,
    });
    const files = await unzip(blob);
    expect([...files.keys()]).toEqual(['Page.md', 'images/here.png']);
    expect(text(files.get('Page.md'))).toMatch(/^!\[image\]\(https?:\/\/\S+\/uploads\/869980ec-a19d-40e0-9a53-c664fa6c66ff\/gone\.png\)\n\n!\[image\]\(images\/here\.png\)$/);
  });
});

describe('exportPagesMarkdownZip', () => {
  it('links images from pages in folders back up to one images folder', async () => {
    const blob = await exportPagesMarkdownZip([
      { path: 'Home', doc: doc(image(upload(pageId, 'shared.png'))) },
      { path: 'Home/Trips/Spain', doc: doc(image(upload(pageId, 'shared.png')), image(upload(otherPageId, 'beach.jpg'))) },
    ], { fetchFile });
    const files = await unzip(blob);
    expect([...files.keys()]).toEqual(['Home.md', 'Home/Trips/Spain.md', 'images/shared.png', 'images/beach.jpg']);
    expect(text(files.get('Home.md'))).toBe('![image](images/shared.png)');
    expect(text(files.get('Home/Trips/Spain.md'))).toBe('![image](../../images/shared.png)\n\n![image](../../images/beach.jpg)');
  });
});

describe('collectUploads', () => {
  it('gives two uploads with the same file name different paths', async () => {
    const uploads = await collectUploads([doc(image(upload(pageId, 'same.png')), image(upload(otherPageId, 'same.png')))], fetchFile);
    expect(uploads.files.map((f) => f.path)).toEqual(['images/same.png', `images/${otherPageId}-same.png`]);
    expect(uploads.pathFor(upload(otherPageId, 'same.png'))).toBe(`images/${otherPageId}-same.png`);
  });
});

describe('blocks inside callouts, quotes and columns', () => {
  const callout = (icon, ...content) => ({ type: 'callout', attrs: { icon }, content });
  const columns = (...cols) => ({ type: 'columns', content: cols.map((content) => ({ type: 'column', content })) });

  it('exports images in columns, one column after another, with the files in the zip', async () => {
    const { blob, filename } = await exportPageMarkdown({
      doc: doc(paragraph('Before and after'), columns([image(upload(pageId, 'before.png'), 'Before')], [image(upload(pageId, 'after.png'), 'After')])),
      title: 'Bugs',
      fetchFile,
    });
    expect(filename).toBe('Bugs.zip');
    const files = await unzip(blob);
    expect([...files.keys()]).toEqual(['Bugs.md', 'images/before.png', 'images/after.png']);
    expect(text(files.get('Bugs.md'))).toBe('Before and after\n\n![Before](images/before.png)\n\n![After](images/after.png)');
  });

  it('writes a callout as a quote with its emoji, images and all', async () => {
    const { blob } = await exportPageMarkdown({
      doc: doc(callout('💡', paragraph('Remember this'), image(upload(pageId, 'tip.png')), paragraph('And this'))),
      title: 'Tips',
      fetchFile,
    });
    const files = await unzip(blob);
    expect(text(files.get('Tips.md'))).toBe('> 💡 Remember this\n>\n> ![image](images/tip.png)\n>\n> And this');
    expect(files.has('images/tip.png')).toBe(true);
  });

  it("leaves out a callout's Wikid icon, which has no text form, and writes a quote as a quote", async () => {
    const quote = { type: 'blockquote', content: [paragraph('Said once')] };
    const { blob } = await exportPageMarkdown({ doc: doc(callout('icon:house', paragraph('Home')), quote), title: 'Q', fetchFile });
    expect(text(await blobBytes(blob))).toBe('> Home\n\n> Said once');
  });
});
