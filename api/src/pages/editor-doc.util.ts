export type EditorDocument = {
  time: number;
  version: string;
  type?: 'doc' | string;
  content: any[];
};

const EDITOR_VERSION = '3.11.1';

// Keep in sync with BLOCK_ID_TYPES in web/src/components/TiptapEditor.vue
export const BLOCK_ID_TYPES = [
  'paragraph',
  'heading',
  'toggleHeading',
  'codeBlock',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'horizontalRule',
  'image',
  'pageLink',
  'databaseView',
  'databaseForm',
  'table',
  'callout',
  'tableOfContents',
];

const fallbackContent = [
  {
    type: 'paragraph',
    content: [],
  },
];

export const fallbackEditorDoc: EditorDocument = {
  time: Date.now(),
  version: EDITOR_VERSION,
  type: 'doc',
  content: fallbackContent,
};

const clampLevel = (value: unknown) => {
  const num = Number.parseInt(String(value ?? ''), 10);
  if (Number.isNaN(num)) return 2;
  return Math.min(6, Math.max(1, num));
};

const safeString = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
};

const normalizeSpaces = (value: unknown) => safeString(value).replace(/&nbsp;/gi, ' ').replace(/\u00a0/g, ' ');

const extractTiptapContent = (value: any): any[] => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray((value as any).content)) return (value as any).content;
  return [];
};

const extractText = (node: any): string => {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.text === 'string') {
    const linkMark = Array.isArray(node.marks) ? node.marks.find((mark: any) => mark?.type === 'link') : null;
    if (linkMark?.attrs?.href) {
      const href = safeString(linkMark.attrs.href).trim();
      if (href) return `[${node.text}](${href})`;
    }
    return node.text;
  }
  if (Array.isArray(node.content)) {
    return node.content.map(extractText).join(' ');
  }
  return '';
};

const tiptapContentToBlocks = (content: any): any[] => {
  const nodes = extractTiptapContent(content);
  if (!nodes.length) return [];
  return nodes
    .flatMap((node) => {
      if (node?.type === 'toggleHeading') {
        const children = Array.isArray(node.content) ? node.content : [];
        const [titleNode, ...rest] = children;
        const level = clampLevel(titleNode?.attrs?.level);
        const text = normalizeSpaces(extractText(titleNode)).trim();
        const headingBlock = text ? { type: 'header', data: { text, level } } : null;
        const nestedBlocks = rest.length ? tiptapContentToBlocks(rest) : [];
        return headingBlock ? [headingBlock, ...nestedBlocks] : nestedBlocks;
      }
      if (node?.type === 'heading') {
        const text = normalizeSpaces(extractText(node)).trim();
        if (!text) return null;
        return { type: 'header', data: { text, level: clampLevel(node?.attrs?.level) } };
      }
      if (node?.type === 'taskList') {
        const items = (node.content || [])
          .filter((item: any) => item?.type === 'taskItem')
          .map((item: any) => ({
            text: normalizeSpaces(extractText(item)).trim(),
            checked: !!item?.attrs?.checked,
          }))
          .filter((item: any) => item.text.length > 0);
        if (!items.length) return null;
        return { type: 'checklist', data: { items } };
      }
      if (node?.type === 'taskItem') {
        const text = normalizeSpaces(extractText(node)).trim();
        if (!text) return null;
        return { type: 'checklist', data: { items: [{ text, checked: !!node?.attrs?.checked }] } };
      }
      if (node?.type === 'horizontalRule') {
        const size = safeString(node?.attrs?.size || '').trim() || 'medium';
        const color = safeString(node?.attrs?.color || '').trim();
        const align = safeString(node?.attrs?.align || '').trim() || 'middle';
        const data: Record<string, any> = { style: 'line', size, align };
        if (color) data.color = color;
        return { type: 'delimiter', data };
      }
      if (node?.type === 'image') {
        const src = safeString(node?.attrs?.src || '').trim();
        if (!src) return null;
        const caption = safeString(node?.attrs?.alt || node?.attrs?.title || '').trim();
        return { type: 'image', data: { file: { url: src }, caption } };
      }
      if (node?.type === 'pageLink') {
        const pageId = safeString(node?.attrs?.pageId || '').trim();
        if (!pageId) return null;
        const title = safeString(node?.attrs?.title || '').trim();
        const icon = safeString(node?.attrs?.icon || '').trim();
        const subpageCountRaw = Number.parseInt(String(node?.attrs?.subpageCount ?? ''), 10);
        const payload: Record<string, any> = { pageId, title, icon };
        if (Number.isFinite(subpageCountRaw) && subpageCountRaw >= 0) {
          payload.subpageCount = subpageCountRaw;
        }
        return { type: 'pageLink', data: payload };
      }
      if (node?.type === 'bulletList' || node?.type === 'orderedList') {
        const items = (node.content || [])
          .filter((child: any) => child?.type === 'listItem')
          .map((child: any) => normalizeSpaces(extractText(child)).trim())
          .filter(Boolean);
        const text = items.join('\n');
        return text ? { type: 'paragraph', data: { text } } : null;
      }
      const text = normalizeSpaces(extractText(node)).trim();
      if (!text && node?.type === 'paragraph') {
        return { type: 'paragraph', data: { text: '' } };
      }
      if (!text) return null;
      return { type: 'paragraph', data: { text } };
    })
    .filter(Boolean);
};

const parseInput = (raw: unknown) => {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === 'object') return raw as any;
  return null;
};

const parseCounter = (id: unknown) => {
  if (typeof id !== 'string') return null;
  const match = id.match(/block-(\d+)/);
  if (!match) return null;
  const num = Number.parseInt(match[1], 10);
  return Number.isFinite(num) && num >= 0 ? num : null;
};

const ensureBlockIds = (nodes: any[]): any[] => {
  const seen = new Set<string>();
  let nextId = 1;

  const assign = (node: any): any => {
    if (!node || typeof node !== 'object') return node;

    let updated: any = node;

    if (BLOCK_ID_TYPES.includes(node.type)) {
      const attrs = typeof node.attrs === 'object' && node.attrs !== null ? { ...(node.attrs as any) } : {};
      const currentId = typeof attrs.id === 'string' ? attrs.id : null;
      const num = parseCounter(currentId);
      const isDuplicate = currentId && seen.has(currentId);
      const needsId = !currentId || num === null || isDuplicate;
      if (currentId && !isDuplicate && num !== null) {
        seen.add(currentId);
      }
      if (needsId) {
        const newId = `block-${nextId}`;
        nextId += 1;
        seen.add(newId);
        attrs.id = newId;
      }
      updated = { ...updated, attrs };
    }

    if (Array.isArray(updated.content)) {
      updated = { ...updated, content: updated.content.map(assign) };
    }

    return updated;
  };

  return nodes.map(assign);
};

export const normalizeEditorContent = (raw: unknown): EditorDocument => {
  const parsed = parseInput(raw) as any;

  const incomingContent = extractTiptapContent(parsed?.content);
  const baseContent = incomingContent.length ? incomingContent : fallbackContent;
  const content = ensureBlockIds(baseContent);
  const time = typeof parsed?.time === 'number' ? parsed.time : Date.now();
  const version = typeof parsed?.version === 'string' ? parsed.version : EDITOR_VERSION;
  const type = typeof parsed?.type === 'string' ? parsed.type : 'doc';

  return { time, version, type, content };
};

// Retain helper for markdown/export parity with the client
export const tiptapContentToBlocksForExport = (content: any) => tiptapContentToBlocks(content);
