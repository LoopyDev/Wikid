import { markdownToContent, type ContentNode } from './markdown-to-content.util';

// Page content as Markdown, and the page as Markdown units with their block ids, so a tool can
// change one block and leave the rest (columns, database views) as they are. Pure: no Prisma, so
// it's unit tested on its own.

// Blocks that hold blocks: their contents are units of their own
const CONTAINERS = new Set(['callout', 'toggleHeading', 'columns', 'column']);
// Blocks with no Markdown form: shown as a labelled placeholder, and can't be rewritten
const EMBEDS = new Set(['databaseView', 'databaseForm', 'pageLink', 'tableOfContents', 'drawio', 'gaussianSplat']);

const blockId = (node: ContentNode | undefined) => (typeof node?.attrs?.id === 'string' && node.attrs.id ? (node.attrs.id as string) : null);

// ---- Inline ----

const markKey = (marks: ContentNode['marks']) => JSON.stringify((marks ?? []).map((m) => [m.type, m.attrs?.href ?? null]));

// Characters that would otherwise read as Markdown
const escapeText = (text: string) => text.replace(/([\\`*_[\]<>|])/g, '\\$1');

function renderInline(nodes: ContentNode[] | undefined): string {
  // Neighbouring text with the same marks as one run, so bold across two nodes is **ab**, not **a****b**
  const runs: ContentNode[] = [];
  for (const node of nodes ?? []) {
    const last = runs[runs.length - 1];
    if (node.type === 'text' && last?.type === 'text' && markKey(last.marks) === markKey(node.marks)) {
      last.text = (last.text ?? '') + (node.text ?? '');
    } else {
      runs.push({ ...node });
    }
  }
  return runs
    .map((node) => {
      if (node.type === 'hardBreak') return '\\\n';
      if (node.type !== 'text') return '';
      const marks = node.marks ?? [];
      const has = (type: string) => marks.some((m) => m.type === type);
      if (has('code')) {
        const text = node.text ?? '';
        const fence = text.includes('`') ? '``' : '`';
        return `${fence}${text}${fence}`;
      }
      let text = escapeText(node.text ?? '');
      // Spaces stay outside the markers: "** bold**" isn't bold
      const [, lead, core, trail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/) ?? ['', '', text, ''];
      text = core;
      if (text) {
        if (has('strike')) text = `~~${text}~~`;
        if (has('italic')) text = `*${text}*`;
        if (has('bold')) text = `**${text}**`;
        const link = marks.find((m) => m.type === 'link');
        if (link?.attrs?.href) text = `[${text}](${link.attrs.href})`;
      }
      return `${lead}${text}${trail}`;
    })
    .join('');
}

// A paragraph starting with what would read as a heading, list or quote
const escapeStart = (text: string) => text.replace(/^(#{1,6}\s|[-+]\s|\d+[.)]\s|>)/, '\\$1');

// ---- Blocks ----

const indentLines = (text: string, prefix: string) =>
  text
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : line))
    .join('\n');

const quoteLines = (text: string) =>
  text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');

function renderListItems(node: ContentNode): string {
  const ordered = node.type === 'orderedList';
  return (node.content ?? [])
    .map((item, index) => {
      const marker = node.type === 'taskList' ? `- [${item.attrs?.checked ? 'x' : ' '}] ` : ordered ? `${index + 1}. ` : '- ';
      const [first, ...rest] = item.content ?? [];
      const head = first?.type === 'paragraph' ? renderInline(first.content) : renderBlock(first);
      const tail = rest.map((child) => indentLines(renderBlock(child), ' '.repeat(marker.length))).join('\n');
      return tail ? `${marker}${head}\n${tail}` : `${marker}${head}`;
    })
    .join('\n');
}

const tableCellText = (cell: ContentNode) =>
  (cell.content ?? [])
    .map((block) => renderInline(block.content))
    .join(' ')
    .replace(/\n/g, ' ');

function renderTable(node: ContentNode): string {
  const rows = (node.content ?? []).map((row) => (row.content ?? []).map(tableCellText));
  if (!rows.length) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  return [line(rows[0]), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

/** What a block with no Markdown form shows as. */
export function embedLabel(node: ContentNode): string {
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case 'databaseView':
      return `[Database view: ${attrs.title || 'Untitled'}]`;
    case 'databaseForm':
      return `[Database form: ${attrs.name || 'Untitled'}]`;
    case 'pageLink':
      return `[Link to page: ${attrs.title || 'Untitled'}]`;
    case 'tableOfContents':
      return '[Table of contents]';
    case 'drawio':
      return '[draw.io diagram]';
    case 'gaussianSplat':
      return `[Gaussian splat${attrs.src ? `: ${attrs.src}` : ''}]`;
    default:
      return `[${node.type}]`;
  }
}

export function renderBlock(node: ContentNode | undefined): string {
  if (!node) return '';
  switch (node.type) {
    case 'paragraph':
      return escapeStart(renderInline(node.content));
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
      return `${'#'.repeat(level)} ${renderInline(node.content)}`;
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return renderListItems(node);
    case 'codeBlock': {
      const code = (node.content ?? []).map((t) => t.text ?? '').join('');
      const fence = code.includes('```') ? '````' : '```';
      return `${fence}${node.attrs?.language || ''}\n${code}\n${fence}`;
    }
    case 'blockquote':
      return quoteLines(renderBlocks(node.content));
    case 'callout': {
      const icon = typeof node.attrs?.icon === 'string' && node.attrs.icon && !node.attrs.icon.startsWith('icon:') ? node.attrs.icon : '';
      const inner = renderBlocks(node.content);
      return quoteLines(icon ? `${icon} ${inner}` : inner);
    }
    case 'toggleHeading':
    case 'columns':
    case 'column':
      return renderBlocks(node.content);
    case 'horizontalRule':
      return '---';
    case 'image': {
      const src = node.attrs?.src;
      if (!src) return '';
      const title = node.attrs?.title ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"` : '';
      return `![${escapeText(String(node.attrs?.alt || ''))}](${src}${title})`;
    }
    case 'table':
      return renderTable(node);
    default:
      return EMBEDS.has(node.type) ? embedLabel(node) : renderInline(node.content);
  }
}

const renderBlocks = (nodes: ContentNode[] | undefined) =>
  (nodes ?? [])
    .map(renderBlock)
    .filter((text) => text !== '')
    .join('\n\n');

/** The whole page as Markdown. */
export const contentToMarkdown = (content: ContentNode[]) => renderBlocks(content);

// ---- Would Markdown keep it? ----

// A block as the content it means, without ids or settings left at nothing, so Markdown's version
// and the editor's compare equal when nothing would be lost
function comparable(node: ContentNode): unknown {
  const attrs = Object.fromEntries(
    Object.entries(node.attrs ?? {}).filter(([key, value]) => key !== 'id' && key !== 'syncedFrom' && value !== null && value !== undefined && value !== 0 && value !== false && value !== ''),
  );
  const marks = (node.marks ?? []).map((m) => ({ type: m.type, ...(m.attrs?.href ? { href: m.attrs.href } : {}) })).sort((a, b) => a.type.localeCompare(b.type));
  const content: unknown[] = [];
  for (const child of node.content ?? []) {
    const last = content[content.length - 1] as { type?: string; text?: string; marks?: unknown } | undefined;
    const next = comparable(child) as { type?: string; text?: string; marks?: unknown };
    if (next.type === 'text' && last?.type === 'text' && JSON.stringify(last.marks) === JSON.stringify(next.marks)) {
      last.text = (last.text ?? '') + (next.text ?? '');
    } else {
      content.push(next);
    }
  }
  return {
    type: node.type,
    ...(Object.keys(attrs).length ? { attrs: Object.keys(attrs).sort().reduce((o, k) => ({ ...o, [k]: attrs[k] }), {}) } : {}),
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(marks.length ? { marks } : {}),
    ...(content.length ? { content } : {}),
  };
}

/** Whether writing these blocks as Markdown and reading them back gives the same blocks. */
export function markdownKeeps(nodes: ContentNode[]): boolean {
  if (nodes.some((node) => EMBEDS.has(node.type) || CONTAINERS.has(node.type) && node.type !== 'callout')) return false;
  const back = markdownToContent(renderBlocks(nodes));
  return JSON.stringify(back.map(comparable)) === JSON.stringify(nodes.map(comparable));
}

// ---- Units ----

export type MarkdownUnit = {
  id: string | null;
  type: string;
  markdown: string;
  /** The block it's inside (a callout or toggle heading), if any */
  parentId: string | null;
  /** Inside columns: which one, from 1 */
  column: number | null;
  /** A block with no Markdown form: it can be moved past or deleted, but not rewritten */
  embed: boolean;
  /** Rewriting it from this Markdown would lose nothing (colours, image sizes and the like) */
  exact: boolean;
};

/** The page as the units a tool reads and changes: blocks, with containers opened up. */
export function markdownUnits(content: ContentNode[]): MarkdownUnit[] {
  const units: MarkdownUnit[] = [];
  const walk = (nodes: ContentNode[] | undefined, parentId: string | null, column: number | null) => {
    for (const node of nodes ?? []) {
      if (node.type === 'columns') {
        (node.content ?? []).forEach((col, index) => walk(col.content, parentId, index + 1));
        continue;
      }
      if (node.type === 'callout' || node.type === 'toggleHeading') {
        walk(node.content, blockId(node) ?? parentId, column);
        continue;
      }
      const embed = EMBEDS.has(node.type);
      units.push({ id: blockId(node), type: node.type, markdown: renderBlock(node), parentId, column, embed, exact: !embed && markdownKeeps([node]) });
    }
  };
  walk(content, null, null);
  return units;
}

// ---- Changing blocks ----

export class BlockOperationError extends Error {}

type Location = { siblings: ContentNode[]; index: number; parent: ContentNode | null };

function locate(content: ContentNode[], id: string): Location | null {
  const search = (siblings: ContentNode[], parent: ContentNode | null): Location | null => {
    for (let index = 0; index < siblings.length; index += 1) {
      const node = siblings[index];
      if (blockId(node) === id) return { siblings, index, parent };
      if (node.content?.length) {
        const found = search(node.content, node);
        if (found) return found;
      }
    }
    return null;
  };
  return search(content, null);
}

// Units live in the page, a callout, a toggle heading or a column: not inside lists or tables,
// which are rewritten whole
const UNIT_PARENTS = new Set([null, 'callout', 'toggleHeading', 'column']);

function locateUnit(content: ContentNode[], id: string): Location {
  const found = locate(content, id);
  if (!found || !UNIT_PARENTS.has(found.parent?.type ?? null)) {
    throw new BlockOperationError(`No block ${id} on this page (list items and table cells are changed with their list or table)`);
  }
  return found;
}

const copy = (content: ContentNode[]) => JSON.parse(JSON.stringify(content)) as ContentNode[];

/** Replaces a block with the blocks of some Markdown (one or several). */
export function updateBlock(content: ContentNode[], id: string, markdown: string): ContentNode[] {
  const next = copy(content);
  const { siblings, index } = locateUnit(next, id);
  if (EMBEDS.has(siblings[index].type)) throw new BlockOperationError(`Block ${id} is ${embedLabel(siblings[index])}, which has no Markdown form: delete it, or leave it`);
  const blocks = markdownToContent(markdown);
  // The block it replaces keeps its id, so links to it still work
  if (blocks[0]) blocks[0].attrs = { ...blocks[0].attrs, id };
  siblings.splice(index, 1, ...blocks);
  if (!siblings.length) siblings.push({ type: 'paragraph' });
  return next;
}

/** Puts the blocks of some Markdown after or before a block, or at the end of the page. */
export function insertBlocks(content: ContentNode[], markdown: string, where: { afterId?: string; beforeId?: string } = {}): ContentNode[] {
  const next = copy(content);
  const blocks = markdownToContent(markdown);
  if (!blocks.length) return next;
  const id = where.afterId ?? where.beforeId;
  if (!id) {
    // At the end, over a last empty paragraph if there is one
    const last = next[next.length - 1];
    if (last?.type === 'paragraph' && !last.content?.length) next.pop();
    next.push(...blocks);
    return next;
  }
  const { siblings, index } = locateUnit(next, id);
  siblings.splice(where.afterId ? index + 1 : index, 0, ...blocks);
  return next;
}

export function deleteBlock(content: ContentNode[], id: string): ContentNode[] {
  const next = copy(content);
  const { siblings, index } = locateUnit(next, id);
  siblings.splice(index, 1);
  // A callout, column or page can't be left with nothing in it
  if (!siblings.length) siblings.push({ type: 'paragraph' });
  return next;
}

const isBlank = (content: ContentNode[]) => content.every((node) => node.type === 'paragraph' && !node.content?.length);

/** The whole page from Markdown: only where Markdown would lose nothing that's there now. */
export function replaceAll(content: ContentNode[], markdown: string): ContentNode[] {
  if (!isBlank(content) && !markdownKeeps(content)) {
    throw new BlockOperationError(
      'This page has blocks Markdown can’t hold (columns, database views, colours, image sizes and the like): rewriting it whole would lose them. Change it block by block instead.',
    );
  }
  const blocks = markdownToContent(markdown);
  return blocks.length ? blocks : [{ type: 'paragraph' }];
}
