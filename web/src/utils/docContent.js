// Whether a document (as JSON) holds anything someone typed: text, or a block other than an empty
// paragraph. An empty bullet ("- " typed), heading or divider counts, though it has no text yet: a
// new page's first editor and the live one taking over from it judge alike with this, and judged
// by text alone, a bullet just started was left out of the handover.
export const hasTypedContent = (node) => {
  if (!node) return false;
  if (node.type === 'text') return typeof node.text === 'string' && node.text.trim().length > 0;
  if (node.type && node.type !== 'doc' && node.type !== 'paragraph') return true;
  return (Array.isArray(node.content) ? node.content : []).some(hasTypedContent);
};
