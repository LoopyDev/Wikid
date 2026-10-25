import { TextSelection } from 'prosemirror-state';

// Tab and Shift-Tab: indenting paragraphs and headings, and indenting lines inside code blocks.

export const INDENTABLE_TYPES = new Set(['paragraph', 'heading']);

export const INDENT_EXCLUDED_ANCESTORS = new Set(['listItem', 'taskItem', 'tableCell', 'tableHeader']);

export const CODE_INDENT_UNIT = '  ';

export const hasAncestorOfType = ($pos, typeSet) => {
  if (!$pos) return false;
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if (typeSet.has($pos.node(depth)?.type?.name)) return true;
  }
  return false;
};

export const findAncestorNodeByType = ($pos, typeName) => {
  if (!$pos || !typeName) return null;
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (node?.type?.name === typeName) {
      return { node, pos: $pos.before(depth) };
    }
  }
  return null;
};

export const findIndentTarget = ($pos) => {
  if (!$pos) return null;
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (INDENTABLE_TYPES.has(node.type?.name)) {
      return { node, pos: $pos.before(depth), $posAt: $pos };
    }
  }
  return null;
};

export const collectIndentTargets = (state) => {
  const targets = [];
  const seen = new Set();
  const { selection } = state;
  if (selection.empty) {
    const $from = selection.$from;
    if (hasAncestorOfType($from, INDENT_EXCLUDED_ANCESTORS)) return targets;
    const found = findIndentTarget($from);
    if (found) {
      targets.push(found);
    }
    return targets;
  }
  const { from, to } = selection;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isBlock) return;
    if (!INDENTABLE_TYPES.has(node.type?.name)) return;
    if (seen.has(pos)) return;
    const $pos = state.doc.resolve(pos);
    if (hasAncestorOfType($pos, INDENT_EXCLUDED_ANCESTORS)) return;
    targets.push({ node, pos, $posAt: $pos });
    seen.add(pos);
    return false;
  });
  return targets;
};

export const lineIndexAtOffset = (text, offset) => {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const head = text.slice(0, safeOffset);
  return Math.max(0, head.split('\n').length - 1);
};

export const applyCodeBlockIndentation = (state, dispatch, outdent = false) => {
  const { selection } = state;
  if (!(selection instanceof TextSelection)) return false;
  const fromCode = findAncestorNodeByType(selection.$from, 'codeBlock');
  const toCode = findAncestorNodeByType(selection.$to, 'codeBlock');
  if (!fromCode || !toCode || fromCode.pos !== toCode.pos) return false;

  const codeNode = fromCode.node;
  if (!codeNode) return false;
  const startPos = fromCode.pos + 1;
  const text = codeNode?.textContent || '';
  const fromOffset = Math.max(0, selection.from - startPos);
  const toOffset = Math.max(0, selection.to - startPos);
  const effectiveEndOffset = toOffset > fromOffset && text[toOffset - 1] === '\n'
    ? toOffset - 1
    : toOffset;

  const lines = text.split('\n');
  const lineStarts = [];
  let running = 0;
  for (let i = 0; i < lines.length; i += 1) {
    lineStarts.push(running);
    running += lines[i].length + 1;
  }

  const startLine = lineIndexAtOffset(text, fromOffset);
  const endLine = lineIndexAtOffset(text, effectiveEndOffset);
  if (startLine >= lines.length || endLine >= lines.length) return false;

  const changes = [];
  for (let i = startLine; i <= endLine; i += 1) {
    if (!outdent) {
      lines[i] = `${CODE_INDENT_UNIT}${lines[i]}`;
      changes.push({ offset: lineStarts[i], delta: CODE_INDENT_UNIT.length });
      continue;
    }
    let removed = 0;
    if (lines[i].startsWith('\t')) {
      removed = 1;
    } else if (lines[i].startsWith(CODE_INDENT_UNIT)) {
      removed = CODE_INDENT_UNIT.length;
    } else if (lines[i].startsWith(' ')) {
      removed = 1;
    }
    if (removed > 0) {
      lines[i] = lines[i].slice(removed);
      changes.push({ offset: lineStarts[i], delta: -removed });
    }
  }

  const nextText = lines.join('\n');
  if (nextText === text) return true;

  const adjustOffset = (offset) => {
    let next = offset;
    changes.forEach(({ offset: lineStart, delta }) => {
      if (delta > 0) {
        if (offset >= lineStart) next += delta;
      } else if (offset > lineStart) {
        next += delta;
      }
    });
    return Math.max(0, Math.min(nextText.length, next));
  };

  const nextFromOffset = adjustOffset(fromOffset);
  const nextToOffset = adjustOffset(toOffset);
  let tr = state.tr;
  const contentStart = startPos;
  const contentEnd = startPos + codeNode.content.size;
  if (nextText.length) {
    tr = tr.replaceWith(contentStart, contentEnd, state.schema.text(nextText));
  } else if (contentEnd > contentStart) {
    tr = tr.delete(contentStart, contentEnd);
  }
  if (selection.from === selection.to) {
    tr.setSelection(TextSelection.create(tr.doc, startPos + nextFromOffset));
  } else {
    tr.setSelection(TextSelection.create(tr.doc, startPos + nextFromOffset, startPos + nextToOffset));
  }
  dispatch(tr);
  return true;
};
