// Decides when a paste should be treated as Markdown (Tiptap's Markdown extension then reads it).

export const looksLikeMarkdown = (text) => {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  const lines = trimmed.split(/\r?\n/);
  let hits = 0;
  for (let i = 0; i < Math.min(lines.length, 60); i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^```/.test(line)) hits += 3;
    else if (/^#{1,6}\s*\S/.test(line)) hits += 2;
    // A to-do ("- [ ] …") is Markdown even on its own: nobody types "[ ]" by chance
    else if (/^[-*+]\s+\[[ xX]\]\s+\S/.test(line)) hits += 2;
    else if (/^>\s+/.test(line)) hits += 1;
    else if (/^[-*+]\s+\S/.test(line)) hits += 1;
    else if (/^\d+[.)]\s*\S/.test(line)) hits += 1;
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) hits += 1;
    if (hits >= 2) return true;
  }
  if (lines.length > 1 && /\[[^\]]+\]\([^)]+\)/.test(trimmed)) return true;
  return hits > 0 && lines.length > 1;
};

export const htmlHasRichFormatting = (html) =>
  /<(h[1-6]|ul|ol|li|blockquote|pre|code|table|thead|tbody|tr|td|th|hr)\b/i.test(String(html || ''));

export const shouldHandleMarkdownPaste = (text, html, state) => {
  if (!looksLikeMarkdown(text)) return false;
  if (htmlHasRichFormatting(html)) return false;
  const parentType = state?.selection?.$from?.parent?.type?.name;
  if (parentType === 'codeBlock') return false;
  return true;
};

// Markdown images where the editor can't hold them inline. The editor reads pasted Markdown with
// images as blocks: an image in a heading made the whole paste fail, and one in a table cell too.
// A heading's image goes on a line of its own after it; a table cell's becomes a link to it (a
// table row is one line, with no room for a block).
const IMAGE = /!\[([^\]]*)\]\((<[^>\n]*>|[^)\s]+)(\s+"[^"]*")?\)/g;
export const liftImagesForPaste = (text) => {
  let fence = false;
  return String(text)
    .split('\n')
    .flatMap((line) => {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      if (fence || !line.includes('![')) return [line];
      if (/^\s{0,3}#{1,6}\s/.test(line)) {
        const images = [...line.matchAll(IMAGE)].map((match) => match[0]);
        if (!images.length) return [line];
        return [line.replace(IMAGE, '').replace(/\s+$/, ''), '', ...images.flatMap((image) => [image, ''])].slice(0, -1);
      }
      if (/^\s*\|/.test(line)) return [line.replace(IMAGE, (_, alt, target, title = '') => `[${alt || 'image'}](${target}${title})`)];
      return [line];
    })
    .join('\n');
};

