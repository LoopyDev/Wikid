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

const IMAGE_PLACEHOLDER = /^\[Image to add(?::\s*([^\]\n]*))?\]$/;

const paragraph = (content: ContentNode[]): ContentNode => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });

/** Inline Markdown tokens as text nodes with marks; images come out separately. */
function inline(tokens: Token[] | undefined, marks: Mark[] = []): ContentNode[] {
  return mergeText(inlineNodes(tokens, marks));
}

// Neighbouring text with the same marks as one node ("\[" and the text after it are one)
function mergeText(nodes: ContentNode[]): ContentNode[] {
  const out: ContentNode[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (node.type === 'text' && last?.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(node.marks ?? [])) {
      out[out.length - 1] = { ...last, text: (last.text ?? '') + (node.text ?? '') };
    } else {
      out.push(node);
    }
  }
  return out;
}

function inlineNodes(tokens: Token[] | undefined, marks: Mark[] = []): ContentNode[] {
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
      case 'paragraph': {
        // "[Image to add: …]" on a line of its own is an image placeholder (unescaped brackets only:
        // a paragraph that just says it is written with \[ \])
        const placeholder = token.raw.trim().match(IMAGE_PLACEHOLDER);
        if (placeholder) {
          const text = (placeholder[1] ?? '').trim();
          out.push(text ? { type: 'imagePlaceholder', content: [{ type: 'text', text }] } : { type: 'imagePlaceholder' });
        } else {
          out.push(...paragraphs(token.tokens));
        }
        break;
      }
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

// ---- Columns and toggles ----
//
// Markdown has neither, so Wikid reads (and, for tools, writes) them as fenced sections:
//
//   ::: columns            ::: toggle
//   Left side              ## Heading
//   ::: column             What it opens to
//   Right side             :::
//   :::
//
// "::: column" starts each column after the first. Lines inside code blocks are left alone.

export class MarkdownSyntaxError extends Error {}

const DIRECTIVE = /^:::\s*(columns|column|toggle)?\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

type Section = { kind: 'root' | 'columns' | 'toggle'; columns: string[][]; lines: string[] };

/** Markdown as page content blocks (without block ids: the content is normalised before saving). */
export function markdownToContent(markdown: string): ContentNode[] {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const stack: Section[] = [{ kind: 'root', columns: [], lines: [] }];
  const current = () => stack[stack.length - 1];
  // The lines of what's open now: a column's, or the section's own
  const sink = () => {
    const section = current();
    return section.kind === 'columns' ? section.columns[section.columns.length - 1] : section.lines;
  };
  // Finished sections: each leaves a placeholder line where it sat, swapped back after parsing
  const done: ContentNode[][] = [];
  let fence: string | null = null;

  for (const line of lines) {
    const opened = line.match(FENCE);
    if (fence) {
      if (opened && opened[1][0] === fence[0] && opened[1].length >= fence.length && !line.trim().slice(opened[1].length).trim()) fence = null;
      sink().push(line);
      continue;
    }
    if (opened) {
      fence = opened[1];
      sink().push(line);
      continue;
    }
    const directive = line.trim().match(DIRECTIVE);
    if (!directive) {
      sink().push(line);
      continue;
    }
    const kind = directive[1];
    if (kind === 'columns' || kind === 'toggle') {
      if (kind === 'columns' && stack.some((s) => s.kind === 'columns')) throw new MarkdownSyntaxError('Columns can’t go inside columns');
      stack.push({ kind, columns: kind === 'columns' ? [[]] : [], lines: [] });
    } else if (kind === 'column') {
      if (current().kind !== 'columns') throw new MarkdownSyntaxError('"::: column" belongs inside "::: columns"');
      current().columns.push([]);
    } else {
      // ":::" closes the innermost section
      if (stack.length === 1) throw new MarkdownSyntaxError('A ":::" with no "::: columns" or "::: toggle" to close');
      const section = stack.pop()!;
      done.push([build(section, done)]);
      sink().push(placeholder(done.length - 1));
    }
  }
  if (stack.length > 1) throw new MarkdownSyntaxError(`A "::: ${stack[stack.length - 1].kind}" that isn't closed with ":::"`);
  return resolve(parse(stack[0].lines), done);
}

// Where a finished section goes, in the Markdown around it: a paragraph of its own
const placeholder = (index: number) => `\n\u2063wikid-section-${index}\u2063\n`;
const PLACEHOLDER = /^\u2063wikid-section-(\d+)\u2063$/;

const parse = (lines: string[]) => blocks(marked.lexer(lines.join('\n'), { gfm: true }));

function resolve(nodes: ContentNode[], done: ContentNode[][]): ContentNode[] {
  return nodes.flatMap((node) => {
    const text = node.type === 'paragraph' && node.content?.length === 1 ? node.content[0].text : undefined;
    const match = text?.match(PLACEHOLDER);
    if (match) return done[Number(match[1])];
    return node.content ? [{ ...node, content: resolve(node.content, done) }] : [node];
  });
}

// Sections close innermost first, so any inside this one are already in `done`
function build(section: Section, done: ContentNode[][]): ContentNode {
  if (section.kind === 'columns') {
    return { type: 'columns', content: section.columns.map((lines) => ({ type: 'column', content: nonEmpty(resolve(parse(lines), done)) })) };
  }
  const content = resolve(parse(section.lines), done);
  // A toggle opens with its heading; without one, its first line becomes it
  if (content[0]?.type !== 'heading') {
    const first = content.shift();
    content.unshift({ type: 'heading', attrs: { level: 2 }, content: first?.type === 'paragraph' ? first.content : undefined });
  }
  return { type: 'toggleHeading', content };
}

const nonEmpty = (content: ContentNode[]) => (content.length ? content : [paragraph([])]);
