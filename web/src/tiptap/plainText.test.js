import { describe, it, expect } from 'vitest';
import { Schema } from 'prosemirror-model';
import { plainText } from './plainText';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    bulletList: { group: 'block', content: 'listItem+' },
    listItem: { content: 'paragraph block*' },
    table: { group: 'block', content: 'tableRow+' },
    tableRow: { content: 'tableCell+' },
    tableCell: { content: 'paragraph+' },
    horizontalRule: { group: 'block' },
    hardBreak: { group: 'inline', inline: true },
    mention: { group: 'inline', inline: true, attrs: { label: {} } },
    text: { group: 'inline' },
  },
});
const n = schema.nodes;
const p = (...content) => n.paragraph.create(null, content.map((c) => (typeof c === 'string' ? schema.text(c) : c)));
const li = (...content) => n.listItem.create(null, content);
const cell = (text) => n.tableCell.create(null, [p(text)]);

describe('plain text for copying', () => {
  it('puts list items and table rows (cells apart by tabs) on lines of their own, with a blank line between blocks', () => {
    const doc = n.doc.create(null, [
      p('Intro'),
      n.bulletList.create(null, [li(p('One')), li(p('Two'), n.bulletList.create(null, [li(p('Two a'))])), li(p('Three'))]),
      n.horizontalRule.create(),
      n.table.create(null, [n.tableRow.create(null, [cell('A'), cell('B')]), n.tableRow.create(null, [cell('C'), cell('D')])]),
      p('End', n.hardBreak.create(), 'line'),
    ]);
    expect(plainText(doc.content)).toBe('Intro\n\nOne\nTwo\nTwo a\nThree\n\nA\tB\nC\tD\n\nEnd\nline');
  });

  it('uses the text a node gives itself, and copies part of a line as it is', () => {
    const doc = n.doc.create(null, [p('Hi ', n.mention.create({ label: 'Sam' }), '!')]);
    const serializers = { mention: ({ node }) => `@${node.attrs.label}` };
    expect(plainText(doc.content, serializers)).toBe('Hi @Sam!');
    expect(plainText(doc.slice(2, 5).content, serializers)).toBe('i @Sam');
  });
});
