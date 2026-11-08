import { describe, expect, it } from 'vitest';
import { collabSchema } from '../src/collab/collab-doc.schema';
import { markdownToContent } from '../src/pages/markdown/markdown-to-content.util';
import { BUILTIN_TEMPLATES } from '../src/templates/builtin-templates';
import { describeCleanup, templateContent } from '../src/templates/template-content.util';

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('what a template may hold', () => {
  it('turns images into image placeholders saying what they showed', () => {
    const { content, cleanup } = templateContent([
      { type: 'image', attrs: { id: 'block-1', src: '/api/uploads/x/a.png', alt: 'The finished site' } },
      { type: 'image', attrs: { src: '/api/uploads/x/b.png' } },
    ]);
    expect(content).toEqual([
      { type: 'imagePlaceholder', attrs: { id: 'block-1' }, content: [{ type: 'text', text: 'The finished site' }] },
      { type: 'imagePlaceholder' },
    ]);
    expect(cleanup.images).toBe(2);
  });

  it('leaves out what belongs to one workspace, and keeps a callout or column it emptied valid', () => {
    const { content, cleanup } = templateContent([
      p('Keep me'),
      { type: 'databaseView', attrs: { pageId: 'db' } },
      { type: 'callout', attrs: { icon: '💡' }, content: [{ type: 'pageLink', attrs: { pageId: 'x' } }] },
      { type: 'columns', content: [{ type: 'column', content: [{ type: 'databaseForm', attrs: {} }] }, { type: 'column', content: [p('Right')] }] },
      { type: 'gaussianSplat', attrs: { src: '/api/uploads/x/s.spz' } },
    ]);
    expect(content).toEqual([
      p('Keep me'),
      { type: 'callout', attrs: { icon: '💡' }, content: [{ type: 'paragraph' }] },
      { type: 'columns', content: [{ type: 'column', content: [{ type: 'paragraph' }] }, { type: 'column', content: [p('Right')] }] },
    ]);
    expect(cleanup).toEqual({ images: 0, databaseViews: 1, databaseForms: 1, pageLinks: 1, splats: 1 });
    expect(describeCleanup(cleanup)).toEqual(['Left out, as they belong to one workspace: 1 database view, 1 database form, 1 page link, 1 Gaussian splat']);
  });

  it('makes a synced block a plain copy, and an emptied page a blank one', () => {
    expect(templateContent([{ ...p('Shared'), attrs: { syncedFrom: 'block-9' } }]).content).toEqual([{ ...p('Shared'), attrs: { syncedFrom: null } }]);
    expect(templateContent([{ type: 'databaseView', attrs: {} }]).content).toEqual([{ type: 'paragraph' }]);
  });

  it('says what changed, or nothing when nothing did', () => {
    expect(describeCleanup(templateContent([p('Plain')]).cleanup)).toEqual([]);
    const one = templateContent([{ type: 'image', attrs: { src: 'a' } }]).cleanup;
    expect(describeCleanup(one)).toEqual(['1 image became an image placeholder, saying what it showed']);
    const two = templateContent([{ type: 'image', attrs: { src: 'a' } }, { type: 'image', attrs: { src: 'b' } }]).cleanup;
    expect(describeCleanup(two)).toEqual(['2 images became image placeholders, saying what they showed']);
  });
});

describe('built-in templates', () => {
  it('are the four agreed, each valid content for the editor', () => {
    expect(BUILTIN_TEMPLATES.map((t) => t.title)).toEqual(['Meeting notes', 'Project brief', 'How-to guide', 'Decision record']);
    for (const template of BUILTIN_TEMPLATES) {
      const content = markdownToContent(template.markdown);
      expect(content.length).toBeGreaterThan(3);
      // Fits the schema the live document uses: a mistake here would leave the page empty
      collabSchema.nodeFromJSON({ type: 'doc', content }).check();
      // Nothing that belongs to one workspace
      expect(templateContent(content as any).cleanup).toEqual({ images: 0, databaseViews: 0, databaseForms: 0, pageLinks: 0, splats: 0 });
    }
  });

  it('use callouts, columns, toggles and image placeholders', () => {
    const types = new Set<string>();
    const walk = (nodes: any[] | undefined) => nodes?.forEach((n) => { types.add(n.type); walk(n.content); });
    BUILTIN_TEMPLATES.forEach((t) => walk(markdownToContent(t.markdown) as any[]));
    for (const type of ['callout', 'columns', 'toggleHeading', 'imagePlaceholder', 'taskList', 'table']) expect(types.has(type)).toBe(true);
  });
});
