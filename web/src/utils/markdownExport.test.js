import { describe, it, expect, vi } from 'vitest';
import { collectUploads, exportPageMarkdown, exportPagesMarkdownZip, safeName, zipPaths } from './markdownExport';
import { readStoredZip } from './zip';

// Each page's Markdown comes from the server (tested there); here, what an export adds to it.

const pageId = '869980ec-a19d-40e0-9a53-c664fa6c66ff';
const otherPageId = '11111111-2222-3333-4444-555555555555';
const upload = (id, name) => `/api/uploads/${id}/${name}`;

const bytesFor = (url) => new TextEncoder().encode(`bytes of ${url.split('/').pop()}`);
const fetchFile = vi.fn(async (url) => bytesFor(url));
// The server's Markdown for each page, by id
const fromServer = (markdownById) => async (id) => markdownById[id];

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
      page: { id: pageId, title: 'Notes' },
      getMarkdown: fromServer({ [pageId]: 'Hello\n\n![cat](https://example.com/cat.png)' }),
      fetchFile,
    });
    expect(filename).toBe('Notes.md');
    expect(text(await blobBytes(blob))).toBe('Hello\n\n![cat](https://example.com/cat.png)');
  });

  it('puts uploaded images and splats in a zip, linked from the Markdown', async () => {
    const { blob, filename } = await exportPageMarkdown({
      page: { id: pageId, title: 'Plans / ideas' },
      getMarkdown: fromServer({
        [pageId]: [`![Diagram](https://wiki.example.com${upload(pageId, '1-a.png')})`, `![](${upload(pageId, '1-a.png')})`, `[Gaussian splat](${upload(pageId, '2-b.spz')})`, '![cat](https://example.com/cat.png)'].join('\n\n'),
      }),
      fetchFile,
    });
    expect(filename).toBe('Plans - ideas.zip');
    const files = await unzip(blob);
    expect([...files.keys()]).toEqual(['Plans - ideas.md', 'images/1-a.png', 'images/2-b.spz']);
    expect(text(files.get('Plans - ideas.md'))).toBe(['![Diagram](images/1-a.png)', '![](images/1-a.png)', '[Gaussian splat](images/2-b.spz)', '![cat](https://example.com/cat.png)'].join('\n\n'));
    expect(text(files.get('images/1-a.png'))).toBe('bytes of 1-a.png');
  });

  it("keeps the full address of an upload it couldn't fetch, and still exports", async () => {
    const failing = async (url) => {
      if (url.endsWith('gone.png')) throw new Error('404');
      return bytesFor(url);
    };
    const { blob } = await exportPageMarkdown({
      page: { id: pageId, title: 'Page' },
      getMarkdown: fromServer({ [pageId]: `![](${upload(pageId, 'gone.png')})\n\n![](${upload(pageId, 'here.png')})` }),
      fetchFile: failing,
    });
    const files = await unzip(blob);
    expect([...files.keys()]).toEqual(['Page.md', 'images/here.png']);
    expect(text(files.get('Page.md'))).toMatch(/^!\[\]\(https?:\/\/\S+\/uploads\/869980ec-a19d-40e0-9a53-c664fa6c66ff\/gone\.png\)\n\n!\[\]\(images\/here\.png\)$/);
  });

  it('puts in the tables of the databases it shows, and a database page is its table', async () => {
    const db = { title: 'Stock', fields: [{ id: 'f1', name: 'Item' }], rows: [{ data: { f1: 'Bolts' } }] };
    const fetchDatabase = vi.fn(async () => db);
    const { blob } = await exportPageMarkdown({
      page: { id: pageId, title: 'Shop' },
      getMarkdown: fromServer({ [pageId]: `Intro\n\n{{wikid-database:${otherPageId}}}\n\nAnd [the other page](wikid-page:${otherPageId})` }),
      fetchDatabase,
      fetchFile,
    });
    expect(text(await blobBytes(blob))).toBe('Intro\n\n**Stock**\n| Item |\n| --- |\n| Bolts |\n\nAnd the other page');
    const own = await exportPageMarkdown({ page: { id: otherPageId, title: 'Stock', kind: 'DATABASE' }, getMarkdown: fromServer({}), fetchDatabase, fetchFile });
    expect(text(await blobBytes(own.blob))).toBe('**Stock**\n| Item |\n| --- |\n| Bolts |');
  });
});

describe('exportPagesMarkdownZip', () => {
  it('links images from pages in folders back up to one images folder, and pages to each other', async () => {
    const home = 'aaaaaaaa-0000-4000-8000-000000000001';
    const trips = 'aaaaaaaa-0000-4000-8000-000000000002';
    const spain = 'aaaaaaaa-0000-4000-8000-000000000003';
    const blob = await exportPagesMarkdownZip(
      [
        { id: home, title: 'Home' },
        { id: trips, title: 'Trips', parentId: home },
        { id: spain, title: 'Spain', parentId: trips },
      ],
      {
        getMarkdown: fromServer({
          [home]: `![](${upload(pageId, 'shared.png')})\n\nSee [Spain](wikid-page:${spain})`,
          [trips]: 'Trips',
          [spain]: `![](${upload(pageId, 'shared.png')})\n\n![](${upload(otherPageId, 'beach.jpg')})\n\nBack [home](wikid-page:${home})`,
        }),
        fetchFile,
      },
    );
    const files = await unzip(blob);
    expect([...files.keys()]).toEqual(['Home.md', 'Home/Trips.md', 'Home/Trips/Spain.md', 'images/shared.png', 'images/beach.jpg']);
    expect(text(files.get('Home.md'))).toBe('![](images/shared.png)\n\nSee [Spain](Home/Trips/Spain.md)');
    expect(text(files.get('Home/Trips/Spain.md'))).toBe('![](../../images/shared.png)\n\n![](../../images/beach.jpg)\n\nBack [home](../../Home.md)');
  });
});

describe('links and tables in the Markdown', () => {
  it('links to pages whatever their titles hold, puts tables inside callouts, and leaves code alone', async () => {
    const a = 'aaaaaaaa-0000-4000-8000-00000000000a';
    const b = 'aaaaaaaa-0000-4000-8000-00000000000b';
    const db = { title: 'Stock', fields: [{ id: 'f1', name: 'Item' }], rows: [{ data: { f1: 'Bolts' } }] };
    const blob = await exportPagesMarkdownZip([{ id: a, title: 'C# tips (a)' }, { id: b, title: 'Index' }], {
      getMarkdown: fromServer({
        [a]: `> 💡 Note\n>\n> {{wikid-database:${b}}}`,
        [b]: `See [Specs \\[v2\\]](wikid-page:${a})\n\n\`\`\`\n{{wikid-database:${b}}}\n![x](${upload(pageId, 'in-code.png')})\n\`\`\``,
      }),
      fetchDatabase: async () => db,
      fetchFile,
    });
    const files = await unzip(blob);
    expect(text(files.get('C# tips (a).md'))).toBe('> 💡 Note\n>\n> **Stock**\n> | Item |\n> | --- |\n> | Bolts |');
    expect(text(files.get('Index.md'))).toBe(`See [Specs \\[v2\\]](C%23%20tips%20%28a%29.md)\n\n\`\`\`\n{{wikid-database:${b}}}\n![x](${upload(pageId, 'in-code.png')})\n\`\`\``);
    expect(files.has('images/in-code.png')).toBe(false);
  });
});

describe('zipPaths', () => {
  it('gives pages with the same title their own files, rather than one over the other', () => {
    const paths = zipPaths([
      { id: 'a', title: 'Notes' },
      { id: 'b', title: 'Notes' },
      { id: 'c', title: 'notes' },
      { id: 'd', title: 'Child', parentId: 'b' },
    ]);
    expect(Object.fromEntries(paths)).toEqual({ a: 'Notes', b: 'Notes (2)', c: 'notes (3)', d: 'Notes (2)/Child' });
  });

  it('keeps names short enough for a file system', () => {
    const name = safeName('Ünïcödé '.repeat(60));
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(200);
    expect(safeName('a/b\\c')).toBe('a-b-c');
    // Nothing that leaves the folder, or that Windows won't unzip
    expect(safeName('..')).toBe('page');
    expect(safeName('Q3: plans?')).toBe('Q3- plans-');
    expect(safeName('Ends with a dot.')).toBe('Ends with a dot');
  });
});

describe('collectUploads', () => {
  it('gives two uploads with the same file name different paths', async () => {
    const uploads = await collectUploads([`![](${upload(pageId, 'same.png')})\n\n![](${upload(otherPageId, 'same.png')})`], fetchFile);
    expect(uploads.files.map((f) => f.path)).toEqual(['images/same.png', `images/${otherPageId}-same.png`]);
    expect(uploads.pathFor(upload(otherPageId, 'same.png'))).toBe(`images/${otherPageId}-same.png`);
  });
});
