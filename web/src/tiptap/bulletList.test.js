import { describe, it, expect } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { sinkListItem, liftListItem } from 'prosemirror-schema-list';

// ── Minimal schema ────────────────────────────────────────────────────────────
// Mirrors the listItem/bulletList structure used by Tiptap's StarterKit.

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM: () => ['p', 0],
    },
    bulletList: {
      group: 'block',
      content: 'listItem+',
      toDOM: () => ['ul', 0],
    },
    listItem: {
      // 'paragraph block*' allows nesting another bulletList inside a listItem
      content: 'paragraph block*',
      toDOM: () => ['li', 0],
    },
    text: { group: 'inline' },
  },
  marks: {},
});

const n = schema.nodes;

// ── Builders ──────────────────────────────────────────────────────────────────

const p = (str = '') => (str ? n.paragraph.create(null, schema.text(str)) : n.paragraph.create());
const li = (...content) => n.listItem.create(null, content.length ? content : [p()]);
const ul = (...items) => n.bulletList.create(null, items);
const doc = (...blocks) => n.doc.create(null, blocks);

/** Create EditorState with cursor placed at `pos`. */
function stateAt(d, pos) {
  const sel = TextSelection.near(d.resolve(pos));
  return EditorState.create({ schema, doc: d, selection: sel });
}

/** Return the position of the first occurrence of `searchText` in the doc. */
function posOfText(docNode, searchText) {
  let found = null;
  docNode.descendants((node, pos) => {
    if (node.isText && node.text.includes(searchText) && found === null) {
      found = pos + node.text.indexOf(searchText);
    }
  });
  return found;
}

/**
 * Run a ProseMirror command. Returns the new EditorState if the command
 * dispatched a transaction, or null if the command returned false.
 */
function applyCommand(command, state) {
  let nextState = null;
  const dispatched = command(state, (tr) => {
    nextState = state.apply(tr);
  });
  return dispatched ? nextState : null;
}

// ── Pure depth-counting logic (mirrors bulletDepthPlugin) ─────────────────────

/**
 * Counts how many ancestor `bulletList` nodes sit above the bulletList at
 * `bulletListPos`, then returns that count mod 3.
 * This mirrors the decoration logic in bulletDepthPlugin inside TiptapEditor.vue.
 */
function computeBulletDepth(docNode, bulletListPos) {
  const $pos = docNode.resolve(bulletListPos);
  let count = 0;
  for (let i = 1; i <= $pos.depth; i++) {
    if ($pos.node(i).type.name === 'bulletList') count++;
  }
  return count % 3;
}

/**
 * Walk the doc and collect the `data-bullet-depth` value that bulletDepthPlugin
 * would assign to every bulletList node, in document order.
 */
function collectBulletDepths(docNode) {
  const depths = [];
  docNode.descendants((node, pos) => {
    if (node.type.name === 'bulletList') {
      depths.push(computeBulletDepth(docNode, pos));
    }
  });
  return depths;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('bullet depth cycling (bulletDepthPlugin logic)', () => {
  it('single-level list has depth 0', () => {
    const d = doc(ul(li(p('A')), li(p('B'))));
    expect(collectBulletDepths(d)).toEqual([0]);
  });

  it('once-nested list: outer=0, inner=1', () => {
    // ul > li("A" + ul > li("B"))
    const d = doc(ul(li(p('A'), ul(li(p('B'))))));
    expect(collectBulletDepths(d)).toEqual([0, 1]);
  });

  it('twice-nested list: 0, 1, 2', () => {
    const d = doc(ul(li(p('A'), ul(li(p('B'), ul(li(p('C'))))))));
    expect(collectBulletDepths(d)).toEqual([0, 1, 2]);
  });

  it('three-times nested cycles back to 0: 0, 1, 2, 0', () => {
    const d = doc(ul(li(p('A'), ul(li(p('B'), ul(li(p('C'), ul(li(p('D'))))))))));
    expect(collectBulletDepths(d)).toEqual([0, 1, 2, 0]);
  });

  it('four-times nested continues cycling: 0, 1, 2, 0, 1', () => {
    const d = doc(ul(li(p('A'), ul(li(p('B'), ul(li(p('C'), ul(li(p('D'), ul(li(p('E'))))))))))));
    expect(collectBulletDepths(d)).toEqual([0, 1, 2, 0, 1]);
  });

  it('sibling lists at the same nesting level get the same depth', () => {
    // Two top-level lists, both should be depth 0
    const d = doc(ul(li(p('A'))), ul(li(p('B'))));
    expect(collectBulletDepths(d)).toEqual([0, 0]);
  });
});

// ── sinkListItem (Tab → indent) ───────────────────────────────────────────────

describe('sinkListItem (Tab → indent)', () => {
  const sink = sinkListItem(n.listItem);

  it('nests the second item under the first when cursor is on second item', () => {
    const d = doc(ul(li(p('Alpha')), li(p('Beta'))));
    const state = stateAt(d, posOfText(d, 'Beta'));
    const next = applyCommand(sink, state);

    expect(next).not.toBeNull();

    const list = next.doc.child(0); // top-level bulletList
    // After sinking, only Alpha is at the top level
    expect(list.childCount).toBe(1);

    const alphaItem = list.child(0);
    // Alpha's listItem now has paragraph + nested bulletList
    expect(alphaItem.childCount).toBe(2);
    expect(alphaItem.child(1).type.name).toBe('bulletList');

    // Beta lives inside the nested list
    const nestedBeta = alphaItem.child(1).child(0).child(0).textContent;
    expect(nestedBeta).toBe('Beta');
  });

  it('does nothing when cursor is on the first item (nothing to sink under)', () => {
    const d = doc(ul(li(p('Alpha')), li(p('Beta'))));
    const state = stateAt(d, posOfText(d, 'Alpha'));
    const next = applyCommand(sink, state);
    expect(next).toBeNull();
  });

  it('does nothing when there is only one item in the list', () => {
    const d = doc(ul(li(p('Only'))));
    const state = stateAt(d, posOfText(d, 'Only'));
    const next = applyCommand(sink, state);
    expect(next).toBeNull();
  });

  it('nests third item under the second (not the first)', () => {
    const d = doc(ul(li(p('A')), li(p('B')), li(p('C'))));
    const state = stateAt(d, posOfText(d, 'C'));
    const next = applyCommand(sink, state);

    expect(next).not.toBeNull();
    const list = next.doc.child(0);
    // A and B are at top level; C is nested under B
    expect(list.childCount).toBe(2);
    const bItem = list.child(1);
    expect(bItem.child(1).type.name).toBe('bulletList');
    expect(bItem.child(1).child(0).child(0).textContent).toBe('C');
  });

  it('increments bullet depth by 1 after sinking', () => {
    const d = doc(ul(li(p('Alpha')), li(p('Beta'))));
    const state = stateAt(d, posOfText(d, 'Beta'));
    const next = applyCommand(sink, state);

    expect(next).not.toBeNull();
    // The new nested bulletList should have depth 1
    const depths = collectBulletDepths(next.doc);
    expect(depths).toContain(1);
  });
});

// ── liftListItem (Shift+Tab → outdent) ───────────────────────────────────────

describe('liftListItem (Shift+Tab → outdent)', () => {
  const lift = liftListItem(n.listItem);

  it('un-nests a nested item back to the parent list level', () => {
    // ul > li(Alpha + ul > li(Beta)) + li(Gamma)
    const d = doc(ul(li(p('Alpha'), ul(li(p('Beta')))), li(p('Gamma'))));
    const state = stateAt(d, posOfText(d, 'Beta'));
    const next = applyCommand(lift, state);

    expect(next).not.toBeNull();
    const list = next.doc.child(0);
    // Alpha, Beta, Gamma should all be siblings at the top level
    expect(list.childCount).toBe(3);
    expect(list.child(0).child(0).textContent).toBe('Alpha');
    expect(list.child(1).child(0).textContent).toBe('Beta');
    expect(list.child(2).child(0).textContent).toBe('Gamma');
  });

  it('top-level item is lifted out of the list (becomes a paragraph)', () => {
    const d = doc(ul(li(p('Alpha')), li(p('Beta'))));
    const state = stateAt(d, posOfText(d, 'Alpha'));
    const next = applyCommand(lift, state);

    expect(next).not.toBeNull();
    // Alpha is now a standalone paragraph; Beta remains in the bulletList
    expect(next.doc.childCount).toBe(2);
    expect(next.doc.child(0).type.name).toBe('paragraph');
    expect(next.doc.child(0).textContent).toBe('Alpha');
    expect(next.doc.child(1).type.name).toBe('bulletList');
  });

  it('round-trips: sink then lift restores the original list structure', () => {
    const sink = sinkListItem(n.listItem);

    const d = doc(ul(li(p('Alpha')), li(p('Beta'))));

    // Sink Beta under Alpha
    const state1 = stateAt(d, posOfText(d, 'Beta'));
    const afterSink = applyCommand(sink, state1);
    expect(afterSink).not.toBeNull();

    // Now lift Beta back out
    const state2 = stateAt(afterSink.doc, posOfText(afterSink.doc, 'Beta'));
    const afterLift = applyCommand(lift, state2);
    expect(afterLift).not.toBeNull();

    // Should be back to two top-level items
    const list = afterLift.doc.child(0);
    expect(list.childCount).toBe(2);
    expect(list.child(0).child(0).textContent).toBe('Alpha');
    expect(list.child(1).child(0).textContent).toBe('Beta');
  });

  it('decrements bullet depth by 1 after lifting', () => {
    // Start with a nested structure and verify depth decreases
    const d = doc(ul(li(p('Alpha'), ul(li(p('Beta'))))));
    const depthsBefore = collectBulletDepths(d);
    expect(depthsBefore).toContain(1); // Beta's list is at depth 1

    const state = stateAt(d, posOfText(d, 'Beta'));
    const next = applyCommand(lift, state);
    expect(next).not.toBeNull();

    const depthsAfter = collectBulletDepths(next.doc);
    // After lifting, there is only one (flat) bulletList at depth 0
    expect(depthsAfter).toEqual([0]);
  });
});
