// Turns pasted markdown into HTML the editor can parse, and decides when a paste should be treated as markdown.

export const escapeHtml = (text) =>
  String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const formatInlineMarkdown = (text) => {
  if (!text) return '';
  const tokens = [];
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_match, code) => {
    const token = `%%CODE_${tokens.length}%%`;
    tokens.push(`<code>${code}</code>`);
    return token;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => `<a href="${url}">${label}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/_([^_]+)_/g, '<em>$1</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  tokens.forEach((html, index) => {
    // A function, so `$&` and the like in the code aren't read as replacement patterns
    out = out.replace(`%%CODE_${index}%%`, () => html);
  });
  return out;
};

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
    else if (/^>\s+/.test(line)) hits += 1;
    else if (/^[-*+]\s+\S/.test(line)) hits += 1;
    else if (/^\d+[.)]\s*\S/.test(line)) hits += 1;
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) hits += 1;
    if (hits >= 2) return true;
  }
  if (lines.length > 1 && /\[[^\]]+\]\([^)]+\)/.test(trimmed)) return true;
  return hits > 0 && lines.length > 1;
};

export const stripHtmlToText = (html) =>
  String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const htmlHasRichFormatting = (html) =>
  /<(h[1-6]|ul|ol|li|blockquote|pre|code|table|thead|tbody|tr|td|th|hr)\b/i.test(String(html || ''));

export const shouldHandleMarkdownPaste = (text, html, state) => {
  if (!looksLikeMarkdown(text)) return false;
  if (htmlHasRichFormatting(html)) return false;
  const parentType = state?.selection?.$from?.parent?.type?.name;
  if (parentType === 'codeBlock') return false;
  return true;
};

export function markdownToHtml(input, depth = 0) {
  if (typeof input !== 'string' || !input.trim()) return '';
  if (depth > 2) return `<p>${formatInlineMarkdown(input.trim())}</p>`;
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  const chunks = [];
  let paragraph = [];
  let list = null;
  let listPendingBlank = false;
  let blockquote = [];
  let inCode = false;
  let codeLang = '';
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    chunks.push(`<p>${formatInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join('');
    chunks.push(`<${list.type}>${items}</${list.type}>`);
    list = null;
  };
  const flushBlockquote = () => {
    if (!blockquote.length) return;
    const inner = markdownToHtml(blockquote.join('\n'), depth + 1);
    chunks.push(`<blockquote>${inner}</blockquote>`);
    blockquote = [];
  };
  const flushCode = () => {
    if (!inCode) return;
    const lang = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : '';
    const code = escapeHtml(codeLines.join('\n'));
    chunks.push(`<pre><code${lang}>${code}</code></pre>`);
    inCode = false;
    codeLang = '';
    codeLines = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (inCode) {
      if (/^```/.test(trimmed)) {
        flushCode();
      } else {
        codeLines.push(line);
      }
      return;
    }

    if (/^```/.test(trimmed)) {
      flushParagraph();
      flushList();
      flushBlockquote();
      inCode = true;
      codeLang = trimmed.slice(3).trim();
      codeLines = [];
      return;
    }

    if (!trimmed) {
      flushParagraph();
      flushBlockquote();
      if (list) {
        listPendingBlank = true;
      } else {
        flushList();
      }
      return;
    }

    if (trimmed.startsWith('>')) {
      flushParagraph();
      flushList();
      blockquote.push(trimmed.replace(/^>\s?/, ''));
      return;
    }

    if (blockquote.length) {
      flushBlockquote();
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s*(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      chunks.push(`<h${level}>${formatInlineMarkdown(headingMatch[2])}</h${level}>`);
      return;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      chunks.push('<hr />');
      return;
    }

    const taskMatch = trimmed.match(/^[-*+]\s+\[( |x|X)\]\s+(.*)$/);
    const bulletMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    const orderedMatch = trimmed.match(/^\d+[.)]\s*(.+)$/);
    const listMatch = taskMatch || bulletMatch || orderedMatch;
    if (listMatch) {
      const nextType = orderedMatch ? 'ol' : 'ul';
      const content = listMatch[listMatch.length - 1];
      flushParagraph();
      if (!list || list.type !== nextType) {
        flushList();
        list = { type: nextType, items: [] };
      }
      listPendingBlank = false;
      list.items.push(content);
      return;
    }

    if (listPendingBlank) {
      flushList();
      listPendingBlank = false;
    } else if (list) {
      flushList();
    }
    paragraph.push(trimmed);
  });

  if (inCode) flushCode();
  flushBlockquote();
  flushList();
  flushParagraph();
  return chunks.join('');
}
