// Copying as plain text: a line for each line of text, with a blank line between blocks, and none
// between the items of a list or the cells of a table. Tiptap's own put a blank line before every
// block, lists and items too, so a list came out with three to five blank lines between its items.

// Blocks whose lines go one under the other (a table: a line for each row, its cells apart by tabs,
// as a spreadsheet takes them)
const TIGHT = new Set(['bulletList', 'orderedList', 'taskList', 'table']);

const inlineText = (content, parent, textSerializers) => {
  let text = '';
  content.forEach((child, offset, index) => {
    const serialize = textSerializers[child.type.name];
    if (serialize) text += serialize({ node: child, pos: offset, parent, index, range: { from: 0, to: content.size } });
    else if (child.isText) text += child.text;
    else if (child.type.name === 'hardBreak') text += '\n';
  });
  return text;
};

/** The plain text of a fragment (a copied slice's content). */
export function plainText(fragment, textSerializers = {}) {
  // Part of one line
  if (fragment.firstChild?.isInline) return inlineText(fragment, null, textSerializers);
  const lines = [];
  const walk = (node, group, parent, index) => {
    if (node.isTextblock) {
      lines.push({ text: inlineText(node.content, node, textSerializers), group });
      return;
    }
    if (node.type.name === 'tableRow') {
      const cells = [];
      node.forEach((cell) => cells.push(plainText(cell.content, textSerializers).replace(/\s*\n+\s*/g, ' ')));
      lines.push({ text: cells.join('\t'), group });
      return;
    }
    const serialize = textSerializers[node.type.name];
    if (serialize) {
      lines.push({ text: serialize({ node, pos: 0, parent, index, range: { from: 0, to: node.nodeSize } }), group });
      return;
    }
    const inner = group || (TIGHT.has(node.type.name) ? node : null);
    node.forEach((child, _offset, i) => walk(child, inner, node, i));
  };
  fragment.forEach((child, _offset, i) => walk(child, null, null, i));
  return lines.reduce((out, line, i) => (i === 0 ? line.text : `${out}${line.group && line.group === lines[i - 1].group ? '\n' : '\n\n'}${line.text}`), '');
}
