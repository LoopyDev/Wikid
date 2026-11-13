import { describe, it, expect } from 'vitest';
import { Fragment, Schema, Slice } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { canJoin } from 'prosemirror-transform';
import { blockHighlightKey, createBlockPositionExtension, isBlockId, newBlockId, withBlockIds } from './blockIds';
import { SYNCED_FROM_ATTR } from './editorShared';

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

// The block decorations are kept from one change to the next and rebuilt only around a change: after
// any edit they must be what building them afresh gives.
describe('block decorations', () => {
  const decoSchema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'text*', attrs: { id: { default: null }, [SYNCED_FROM_ATTR]: { default: null } }, toDOM: () => ['p', 0] },
      bulletList: { group: 'block', content: 'listItem+', attrs: { id: { default: null } }, toDOM: () => ['ul', 0] },
      listItem: { content: 'paragraph block*', attrs: { id: { default: null } }, toDOM: () => ['li', 0] },
      text: {},
    },
  });
  const p = (id, text, syncedFrom = null) => decoSchema.node('paragraph', { id, [SYNCED_FROM_ATTR]: syncedFrom }, text ? [decoSchema.text(text)] : []);
  const list = (id, ...items) => decoSchema.node('bulletList', { id }, items.map(([itemId, ...content]) => decoSchema.node('listItem', { id: itemId }, content)));
  const plugin = () => createBlockPositionExtension({ hasWorkspaceSyncedReference: () => false }).config.addProseMirrorPlugins.call({})[0];
  const decorationsOf = (state) =>
    blockHighlightKey
      .getState(state)
      .decos.find()
      .map((deco) => `${deco.from}-${deco.to} ${JSON.stringify(deco.type.attrs)}`)
      .sort();
  const afresh = (state) => {
    const { highlightId, highlightType } = blockHighlightKey.getState(state);
    const fresh = EditorState.create({ schema: decoSchema, doc: state.doc, plugins: [plugin()] });
    return decorationsOf(highlightId ? fresh.apply(fresh.tr.setMeta(blockHighlightKey, { highlightId, highlightType })) : fresh);
  };
  const start = () =>
    EditorState.create({
      schema: decoSchema,
      plugins: [plugin()],
      doc: decoSchema.node('doc', null, [p('a', 'First'), p('b', 'Second'), list('l', ['i1', p('c', 'Item')], ['i2', p('d', 'Other')]), p('e', 'Last')]),
    });

  const edits = {
    'typing in a block': (state) => state.tr.insertText('x', 3),
    'typing in a list': (state) => state.tr.insertText('x', state.doc.child(0).nodeSize + state.doc.child(1).nodeSize + 4),
    'a new block': (state) => state.tr.insert(state.doc.child(0).nodeSize, p('n', 'New')),
    'a block taken out': (state) => state.tr.delete(0, state.doc.child(0).nodeSize),
    'two blocks joined': (state) => (canJoin(state.doc, state.doc.child(0).nodeSize) ? state.tr.join(state.doc.child(0).nodeSize) : state.tr.insertText('j', 1)),
    'a block split': (state) => state.tr.split(3),
    'a block given a new id': (state) => state.tr.setNodeMarkup(0, null, { id: 'z' }),
    'the last block typed in': (state) => state.tr.insertText('!', state.doc.content.size - 1),
    'a synced copy of another block added': (state) => state.tr.insert(state.doc.content.size, p('s', 'Copy', 'b')),
    // How someone else's change arrives (y-tiptap): the whole page replaced by the new one
    'the whole page replaced, one block different': (state) => {
      const blocks = [];
      state.doc.forEach((node, _offset, index) => blocks.push(index === 1 ? p(node.attrs.id, `${node.textContent}r`) : node));
      return state.tr.replace(0, state.doc.content.size, new Slice(Fragment.from(blocks), 0, 0));
    },
    'a block highlighted, then another (a table of contents hovered)': (state) =>
      state.tr.setMeta(blockHighlightKey, { highlightId: blockHighlightKey.getState(state).highlightId === 'b' ? 'e' : 'b', highlightType: 'toc' }),
    'typing in a synced copy': (state) => {
      const tr = state.doc.lastChild.attrs[SYNCED_FROM_ATTR] ? state.tr : state.tr.insert(state.doc.content.size, p('s', 'Copy', 'b'));
      return tr.insertText('c', tr.doc.content.size - 1);
    },
    'a block highlighted while typing': (state) => state.tr.insertText('h', 1).setMeta(blockHighlightKey, { highlightId: 'b', highlightType: 'toc' }),
    'several changes in one': (state) => state.tr.insertText('m', 1).insert(state.doc.child(0).nodeSize + 1, p('m', 'Many')).delete(state.doc.content.size - 3, state.doc.content.size - 1),
  };
  for (const [name, edit] of Object.entries(edits)) {
    it(`match a fresh build after ${name}`, () => {
      let state = start();
      for (let round = 0; round < 3; round += 1) {
        state = state.apply(edit(state));
        expect(decorationsOf(state)).toEqual(afresh(state));
      }
    });
  }
});
