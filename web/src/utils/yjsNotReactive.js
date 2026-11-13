import * as Y from 'yjs';

// Yjs objects are never made reactive (the flag markRaw sets, on their prototypes): Vue wrapped every
// Yjs internal read through a ref on each keystroke, slowing typing as pages grew, and a wrapped
// type beside the plain one is, to Yjs, a different one (its updates then fail to encode).
for (const type of [Y.Doc, Y.AbstractType, Y.Item, Y.UndoManager]) {
  Object.defineProperty(type.prototype, '__v_skip', { value: true, configurable: true });
}
