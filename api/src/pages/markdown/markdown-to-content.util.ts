import { marked, type Token, type Tokens } from 'marked';

// Markdown into page content: the blocks the editor uses (headings, lists, to-dos, code, tables,
// quotes, images), for writing pages from outside the editor (the MCP server, import). A quote
// starting with an emoji becomes a callout, as the Markdown export writes one.

type Mark = { type: string; attrs?: Record<string, unknown> };
export type ContentNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ContentNode[];
  text?: string;
  marks?: Mark[];
};

// An emoji (with its variation selectors and joiners) at the start of a quote's text
const LEADING_EMOJI = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:[\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]|\p{Extended_Pictographic})*)\s+/u;

const paragraph = (content: ContentNode[]): ContentNode => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });

/** Inline Markdown tokens as text nodes with marks; images come out separately. */
function inline(tokens: Token[] | undefined, marks: Mark[] = []): ContentNode[] {
  const out: ContentNode[] = [];
  const text = (value: string) => {
    if (!value) return;
    out.push(marks.length ? { type: 'text', text: value, marks } : { type: 'text', text: value });
  };
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'strong':
        out.push(...inline(token.tokens, [...marks, { type: 'bold' }]));
        break;
      case 'em':
        out.push(...inline(token.tokens, [...marks, { type: 'italic' }]));
        break;
      case 'del':
        out.push(...inline(token.tokens, [...marks, { type: 'strike' }]));
        break;
      case 'codespan':
        out.push({ type: 'text', text: decode(token.text), marks: [...marks, { type: 'code' }] });
        break;
      case 'link':
        out.push(...inline(token.tokens, [...marks, { type: 'link', attrs: { href: token.href } }]));
        break;
      case 'br':
        out.push({ type: 'hardBreak' });
        break;
      case 'image':
        out.push({ type: 'image', attrs: { src: token.href, alt: token.text || null, title: token.title || null } });
        break;
      case 'text':
        // Text in a list item holds its own inline tokens
        if ('tokens' in token && token.tokens?.length) out.push(...inline(token.tokens, marks));
        // A line break inside a paragraph is a space
        else text(decode(token.text).replace(/\n/g, ' '));
        break;
      default:
        text(decode(('text' in token && typeof token.text === 'string' ? token.text : token.raw) || ''));
    }
  }
  return out;
}

// marked leaves HTML entities in text: &amp; and the like
const decode = (value: string) =>
  value.replace(/&(amp|lt|gt|quot|#39);/g, (_m, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity] ?? _m);

/** A paragraph's inline content, split where it holds images: images are blocks of their own. */
function paragraphs(tokens: Token[] | undefined): ContentNode[] {
  const blocks: ContentNode[] = [];
  let current: ContentNode[] = [];
  const flush = () => {
    // Spaces left beside an image
    if (current[0]?.type === 'text') current[0] = { ...current[0], text: current[0].text!.trimStart() };
    const last = current.length - 1;
    if (current[last]?.type === 'text') current[last] = { ...current[last], text: current[last].text!.trimEnd() };
    current = current.filter((node) => node.type !== 'text' || node.text);
    if (current.length) blocks.push(paragraph(current));
    current = [];
  };
  for (const node of inline(tokens)) {
    if (node.type === 'image') {
      flush();
      blocks.push(node);
    } else {
      current.push(node);
    }
  }
  flush();
  return blocks.length ? blocks : [paragraph([])];
}

function listItem(item: Tokens.ListItem, task: boolean): ContentNode {
  const content: ContentNode[] = [];
  for (const token of item.tokens) {
    if (token.type === 'checkbox') continue;
    if (token.type === 'text') content.push(...paragraphs((token as Tokens.Text).tokens ?? [token]));
    else content.push(...blocks([token]));
  }
  // An item starts with a paragraph
  if (!content.length || content[0].type !== 'paragraph') content.unshift(paragraph([]));
  return task ? { type: 'taskItem', attrs: { checked: !!item.checked }, content } : { type: 'listItem', content };
}

function list(token: Tokens.List): ContentNode {
  // A list with any to-dos is a to-do list
  const task = token.items.some((item) => item.task);
  if (task) return { type: 'taskList', content: token.items.map((item) => listItem(item, true)) };
  const items = token.items.map((item) => listItem(item, false));
  return token.ordered ? { type: 'orderedList', content: items } : { type: 'bulletList', content: items };
}

function quote(token: Tokens.Blockquote): ContentNode {
  const content = blocks(token.tokens);
  const first = content[0];
  const firstText = first?.type === 'paragraph' ? first.content?.[0] : undefined;
  const emoji = firstText?.type === 'text' && !firstText.marks?.length ? firstText.text?.match(LEADING_EMOJI) : null;
  if (!emoji || !firstText) return { type: 'blockquote', content: content.length ? content : [paragraph([])] };
  // "> 💡 Text" is a callout with that emoji
  firstText.text = firstText.text!.slice(emoji[0].length);
  if (!firstText.text) first.content!.shift();
  if (!first.content!.length) delete first.content;
  return { type: 'callout', attrs: { icon: emoji[1] }, content };
}

function table(token: Tokens.Table): ContentNode {
  const cell = (type: string, value: Tokens.TableCell): ContentNode => ({ type, content: [paragraph(inline(value.tokens))] });
  return {
    type: 'table',
    content: [
      { type: 'tableRow', content: token.header.map((value) => cell('tableHeader', value)) },
      ...token.rows.map((row) => ({ type: 'tableRow', content: row.map((value) => cell('tableCell', value)) })),
    ],
  };
}

function blocks(tokens: Token[]): ContentNode[] {
  const out: ContentNode[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'space':
      case 'def':
        break;
      case 'heading':
        out.push({ type: 'heading', attrs: { level: Math.min(Math.max(token.depth, 1), 6) }, content: inline(token.tokens) });
        break;
      case 'paragraph':
        out.push(...paragraphs(token.tokens));
        break;
      case 'list':
        out.push(list(token as Tokens.List));
        break;
      case 'blockquote':
        out.push(quote(token as Tokens.Blockquote));
        break;
      case 'code': {
        const language = (token as Tokens.Code).lang?.trim().split(/\s+/)[0] || null;
        const code = (token as Tokens.Code).text;
        out.push({ type: 'codeBlock', attrs: { language }, ...(code ? { content: [{ type: 'text', text: code }] } : {}) });
        break;
      }
      case 'hr':
        out.push({ type: 'horizontalRule' });
        break;
      case 'table':
        out.push(table(token as Tokens.Table));
        break;
      default: {
        // HTML and anything else: as text, so nothing is silently dropped
        const raw = (token.raw || '').trim();
        if (raw) out.push(paragraph([{ type: 'text', text: raw }]));
      }
    }
  }
  return out;
}

/** Markdown as page content blocks (without block ids: the content is normalised before saving). */
export function markdownToContent(markdown: string): ContentNode[] {
  return blocks(marked.lexer(String(markdown ?? ''), { gfm: true }));
}
