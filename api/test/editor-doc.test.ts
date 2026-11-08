import { describe, expect, it } from 'vitest';
import { normalizeEditorContent } from '../src/pages/editor-doc.util';

const p = (text: string, id?: string) => ({ type: 'paragraph', ...(id ? { attrs: { id } } : {}), content: [{ type: 'text', text }] });
const ids = (doc: { content: any[] }) => {
  const out: string[] = [];
  const walk = (nodes: any[]) => nodes?.forEach((node) => {
    if (node?.attrs?.id) out.push(node.attrs.id);
    walk(node?.content);
  });
  walk(doc.content);
  return out;
};

describe('block ids', () => {
  it('gives new blocks ids no other block has', () => {
    const doc = normalizeEditorContent({ type: 'doc', content: [p('Kept', 'block-1'), p('Kept too', 'block-2'), p('New')] });
    expect(ids(doc)).toEqual(['block-1', 'block-2', 'block-3']);
  });

  it("doesn't reuse an id a later block has", () => {
    const doc = normalizeEditorContent({ type: 'doc', content: [p('New'), p('Old', 'block-1')] });
    expect(ids(doc)).toEqual(['block-2', 'block-1']);
  });

  it('gives a repeated id to the first block only', () => {
    const list = { type: 'bulletList', attrs: { id: 'block-4' }, content: [{ type: 'listItem', attrs: { id: 'block-4' }, content: [p('Item', 'block-5')] }] };
    expect(ids(normalizeEditorContent({ type: 'doc', content: [list, p('Other')] }))).toEqual(['block-4', 'block-6', 'block-5', 'block-7']);
  });
});
