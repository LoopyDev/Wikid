import { describe, expect, it } from 'vitest';
import { replaceAll } from '../src/pages/markdown/content-to-markdown.util';
import { normalizeEditorContent } from '../src/pages/editor-doc.util';
import { initialStateFromContent, normalizeCollabDocState } from '../src/collab/collab-doc.util';

// Block ids: links and synced copies point at them, so a block keeps its id, and a new one never
// takes another's.

const p = (id: string | null, text: string, extra: Record<string, unknown> = {}) => ({
  type: 'paragraph',
  attrs: { ...(id ? { id } : {}), ...extra },
  content: [{ type: 'text', text }],
});
const ids = (nodes: any[]) => nodes.map((n) => n.attrs?.id ?? null);

describe('block ids', () => {
  it('a whole-page rewrite keeps the ids of blocks it leaves alone or edits in place, and synced copies', () => {
    const before = [p('block-1', 'Intro'), p('block-7', 'Shared text'), p('block-9', 'Shared text', { syncedFrom: 'block-7' }), p('block-12', 'Last line')];
    const after = replaceAll(before as any, 'Intro\n\nShared text\n\nShared text\n\nLast line, changed\n\nA new line') as any[];
    expect(ids(after).slice(0, 4)).toEqual(['block-1', 'block-7', 'block-9', 'block-12']);
    expect(after[2].attrs.syncedFrom).toBe('block-7');
    expect(after[4].attrs?.id ?? null).toBeNull(); // given one when saved (below)
  });

  it('a block added at the top of a rewrite takes no one else\'s id', () => {
    const after = replaceAll([p('block-1', 'One'), p('block-2', 'Two'), p('block-3', 'Three')] as any, 'Zero\n\nOne\n\nTwo, changed\n\nThree') as any[];
    expect(ids(after)).toEqual([null, 'block-1', 'block-2', 'block-3']);
  });

  it('a block added above an edited one doesn\'t take its id', () => {
    const after = replaceAll([p('block-1', 'One'), p('block-2', 'Two')] as any, 'Zero\n\nOne, changed\n\nTwo') as any[];
    expect(ids(after)).toEqual([null, 'block-1', 'block-2']);
    const rewritten = replaceAll([p('block-1', 'One'), p('block-2', 'Two')] as any, 'Something else\n\nAnd more\n\nTwo') as any[];
    expect(ids(rewritten)).toEqual([null, null, 'block-2']); // nothing like it: no id rather than a wrong one
  });

  it('an id a link can\'t point at is replaced', () => {
    const [kept, replaced] = ids(normalizeEditorContent({ type: 'doc', content: [p('block-4', 'A'), p('intro', 'B')] }).content as any[]);
    expect(kept).toBe('block-4');
    expect(replaced).toMatch(/^block-/);
  });

  it('gives new blocks ids nothing else has had, and keeps any id already there', () => {
    const doc = normalizeEditorContent({ type: 'doc', content: [p('block-1', 'Old'), p('block-my-own', 'Kept'), p(null, 'New'), p('block-1', 'Pasted copy')] });
    const [first, second, third, fourth] = ids(doc.content as any[]);
    expect(first).toBe('block-1');
    expect(second).toBe('block-my-own');
    for (const id of [third, fourth]) expect(id).toMatch(/^block-[2-9][a-z0-9]{9}$/);
    expect(third).not.toBe(fourth);
    expect(fourth).not.toBe('block-2'); // not counted on from the highest
  });

  it('a live document keeps random ids as they are', async () => {
    const state = initialStateFromContent({ type: 'doc', content: [p('block-k3x9q2m7ab', 'One'), p('block-4', 'Two')] }, 'Page');
    expect(state).not.toBeNull();
    const result = await normalizeCollabDocState(state!);
    expect(result.hadInvalidIds).toBe(false);
    expect(result.repairedState).toBeNull();
    expect(ids(result.normalized.content as any[])).toEqual(['block-k3x9q2m7ab', 'block-4']);
  });

  it('an empty table counts as something on the page when a live document is first filled', () => {
    const table = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] };
    expect(initialStateFromContent({ type: 'doc', content: [table] }, null)).not.toBeNull();
  });
});
