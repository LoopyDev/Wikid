// Chooses which part of a long page to send to the AI, based on where the cursor is.

// ── AI Suggestion API (exposed to parent via defineExpose) ───────────────────
export const AI_SERIALIZABLE_TYPES = new Set([
  'paragraph', 'heading', 'blockquote', 'codeBlock',
  'bulletList', 'orderedList', 'taskList', 'callout',
]);

export const SMALL_PAGE_THRESHOLD = 15;

// Returns a Set of block indices (into the top-level doc children array) that
// belong to the heading section the cursor is in. Falls back to a 15-block
// window if there are no headings. Returns null for small pages (send all).
export function detectTargetSection(cursorPos, doc) {
  const blocks = [];
  doc.forEach((node, offset, index) => {
    if (!AI_SERIALIZABLE_TYPES.has(node.type.name)) return;
    blocks.push({ index, node, offset, end: offset + node.nodeSize });
  });

  if (blocks.length <= SMALL_PAGE_THRESHOLD) {
    return new Set(blocks.map((b) => b.index));
  }

  // Find which block the cursor sits in
  let cursorBlockIdx = blocks.findIndex((b) => cursorPos >= b.offset && cursorPos <= b.end);
  if (cursorBlockIdx === -1) {
    // Cursor between serializable blocks — pick the closest block above
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].end <= cursorPos) { cursorBlockIdx = i; break; }
    }
  }
  if (cursorBlockIdx === -1) cursorBlockIdx = 0;

  // Walk upward to find the nearest heading that opens this section
  let sectionStart = 0;
  let anchorLevel = null;
  for (let i = cursorBlockIdx; i >= 0; i--) {
    if (blocks[i].node.type.name === 'heading') {
      anchorLevel = blocks[i].node.attrs.level;
      sectionStart = i;
      break;
    }
  }

  // No heading found — use a 15-block window centred on the cursor
  if (anchorLevel === null) {
    const half = 7;
    const from = Math.max(0, cursorBlockIdx - half);
    const to = Math.min(blocks.length - 1, cursorBlockIdx + half);
    return new Set(blocks.slice(from, to + 1).map((b) => b.index));
  }

  // Walk forward to find where this section ends (next heading at same/higher level)
  let sectionEnd = blocks.length - 1;
  for (let i = sectionStart + 1; i < blocks.length; i++) {
    if (blocks[i].node.type.name === 'heading' && blocks[i].node.attrs.level <= anchorLevel) {
      sectionEnd = i - 1;
      break;
    }
  }

  return new Set(blocks.slice(sectionStart, sectionEnd + 1).map((b) => b.index));
}
