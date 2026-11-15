import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { DOMSerializer } from 'prosemirror-model';
import Callout from './callout';
import Columns from './columns';
import ToggleHeading from './toggleHeading';
import ImagePlaceholder from './imagePlaceholder';

// A block that holds other content says where it goes in its HTML (the 0 in renderHTML): without
// it, copying the block put it on the clipboard empty, and pasting brought back an empty box (as
// callouts and toggle headings did).

describe("blocks holding content keep it in their HTML (copying, exports)", () => {
  it('every one of ours has a place for its content', () => {
    const schema = getSchema([StarterKit, Callout, Columns, ToggleHeading, ImagePlaceholder]);
    const holders = Object.values(schema.nodes).filter((type) => !type.isLeaf && !type.isText && type.spec.toDOM && type.name !== 'doc');
    expect(holders.map((type) => type.name)).toEqual(expect.arrayContaining(['callout', 'toggleHeading', 'columns', 'column']));
    for (const type of holders) {
      const node = type.createAndFill();
      const { contentDOM } = DOMSerializer.renderSpec(document, type.spec.toDOM(node));
      expect(contentDOM, type.name).toBeTruthy();
    }
  });
});
