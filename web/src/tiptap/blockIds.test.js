import { describe, it, expect } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { isBlockId, newBlockId, withBlockIds } from './blockIds';

// Block ids: existing ones are kept, and new ones are random, so they never repeat an old one.

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*', attrs: { id: { default: null } }, toDOM: () => ['p', 0] },
    text: {},
  },
});
const para = (id, text) => schema.node('paragraph', { id }, text ? [schema.text(text)] : []);
const ids = (doc) => { const out = []; doc.forEach((node) => out.push(node.attrs.id)); return out; };

describe('block ids', () => {
  it('keeps existing ids, numbered or random', () => {
    const state = EditorState.create({ schema, doc: schema.node('doc', null, [para('block-3', 'a'), para('block-k3x9q2m7ab', 'b')]) });
    expect(withBlockIds(state)).toBeNull();
  });

  it('gives a missing id, and the second of two sharing one, a new random id', () => {
    const state = EditorState.create({ schema, doc: schema.node('doc', null, [para('block-5', 'a'), para('block-5', 'a split'), para(null, 'new')]) });
    const [first, second, third] = ids(withBlockIds(state).doc);
    expect(first).toBe('block-5');
    for (const id of [second, third]) expect(id).toMatch(/^block-[2-9][a-z0-9]{9}$/);
    expect(second).not.toBe(third);
    expect(second).not.toBe('block-6');
  });

  it('after Enter at the start of a block, its id stays with its text, not the empty line above', () => {
    const state = EditorState.create({ schema, doc: schema.node('doc', null, [para('block-7', null), para('block-7', 'Linked text')]) });
    const [empty, text] = ids(withBlockIds(state).doc);
    expect(text).toBe('block-7');
    expect(empty).not.toBe('block-7');
  });

  it('makes ids that pass its own check', () => {
    const made = new Set(Array.from({ length: 200 }, newBlockId));
    expect(made.size).toBe(200);
    for (const id of made) expect(isBlockId(id)).toBe(true);
    expect(isBlockId('has space')).toBe(false);
    expect(isBlockId('intro')).toBe(false); // links need the block- prefix
    expect(isBlockId('')).toBe(false);
  });
});
