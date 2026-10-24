const EDITOR_VERSION = '3.11.1';

const fallbackContent = [
  {
    type: 'paragraph',
    content: [],
  },
];

export const fallbackDoc = {
  time: Date.now(),
  version: EDITOR_VERSION,
  type: 'doc',
  content: fallbackContent,
};

const clampLevel = (value) => {
  const num = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(num)) return 2;
  return Math.min(6, Math.max(1, num));
};

const safeString = (value) => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
};

const normalizeSpaces = (value) => safeString(value).replace(/&nbsp;/gi, ' ').replace(/\u00a0/g, ' ');

const extractTiptapContent = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.content)) return value.content;
  return [];
};

const extractText = (node) => {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.text === 'string') {
    const marks = Array.isArray(node.marks) ? node.marks : [];
    const link = marks.find((m) => m?.type === 'link');
    if (link?.attrs?.href) {
      const href = safeString(link.attrs.href).trim();
      if (href) return `[${node.text}](${href})`;
    }
    let text = node.text;
    const markNames = new Set(marks.map((m) => m?.type));
    if (markNames.has('code')) {
      text = `\`${text}\``;
    } else {
      if (markNames.has('strike')) text = `~~${text}~~`;
      if (markNames.has('bold') && markNames.has('italic')) text = `***${text}***`;
      else if (markNames.has('bold')) text = `**${text}**`;
      else if (markNames.has('italic')) text = `*${text}*`;
    }
    return text;
  }
  if (Array.isArray(node.content)) {
    return node.content.map(extractText).join('');
  }
  return '';
};

const extractListItemText = (item) => {
  // Extract text only from the first paragraph child, not nested lists
  const children = item.content || [];
  const textNode = children.find((c) => c?.type === 'paragraph' || c?.type === 'text');
  return normalizeSpaces(extractText(textNode || { content: children.filter((c) => c?.type !== 'bulletList' && c?.type !== 'orderedList') })).trim();
};

const renderListNodeToMarkdown = (node, depth) => {
  const ordered = node?.type === 'orderedList';
  const indent = '  '.repeat(depth);
  const lines = [];
  const items = (node.content || []).filter((c) => c?.type === 'listItem');
  items.forEach((item, i) => {
    const marker = ordered ? `${i + 1}.` : '-';
    const text = extractListItemText(item);
    lines.push(`${indent}${marker} ${text}`);
    // Render any nested lists inside this item
    for (const child of (item.content || [])) {
      if (child?.type === 'bulletList' || child?.type === 'orderedList') {
        lines.push(renderListNodeToMarkdown(child, depth + 1));
      }
    }
  });
  return lines.filter(Boolean).join('\n');
};

const tiptapContentToBlocks = (content) => {
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
          .filter((item) => item?.type === 'taskItem')
          .map((item) => ({
            text: normalizeSpaces(extractText(item)).trim(),
            checked: !!item?.attrs?.checked,
          }))
          .filter((item) => item.text.length > 0);
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
        const data = { style: 'line', size, align };
        if (color) data.color = color;
        return { type: 'delimiter', data };
      }
      if (node?.type === 'image') {
        const src = safeString(node?.attrs?.src || '').trim();
        if (!src) return null;
        const caption = safeString(node?.attrs?.alt || node?.attrs?.title || '').trim();
        return { type: 'image', data: { file: { url: src }, caption } };
      }
      if (node?.type === 'databaseView') {
        const pageId = safeString(node?.attrs?.pageId || '').trim();
        if (!pageId) return null;
        const title = safeString(node?.attrs?.title || '').trim();
        return { type: 'databaseView', data: { pageId, title } };
      }
      if (node?.type === 'pageLink') {
        const pageId = safeString(node?.attrs?.pageId || '').trim();
        if (!pageId) return null;
        const title = safeString(node?.attrs?.title || '').trim();
        const icon = safeString(node?.attrs?.icon || '').trim();
        const subpageCountRaw = Number.parseInt(node?.attrs?.subpageCount, 10);
        const payload = { pageId, title, icon };
        if (Number.isFinite(subpageCountRaw) && subpageCountRaw >= 0) {
          payload.subpageCount = subpageCountRaw;
        }
        return { type: 'pageLink', data: payload };
      }
      if (node?.type === 'codeBlock') {
        const codeText = (node.content || [])
          .map((child) => (typeof child?.text === 'string' ? child.text : extractText(child)))
          .join('');
        const language = safeString(node?.attrs?.language || '').trim();
        return { type: 'codeBlock', data: { text: codeText.replace(/\u00a0/g, ' '), language } };
      }
      if (node?.type === 'bulletList' || node?.type === 'orderedList') {
        const md = renderListNodeToMarkdown(node, 0);
        return md ? { type: 'list', data: { markdown: md } } : null;
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

const parseInput = (raw) => {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === 'object') return raw;
  return null;
};

export const normalizeEditorDoc = (raw) => {
  const parsed = parseInput(raw);
  const incomingContent = extractTiptapContent(parsed?.content);

  const content = incomingContent.length ? incomingContent : fallbackContent;
  const time = typeof parsed?.time === 'number' ? parsed.time : Date.now();
  const version = typeof parsed?.version === 'string' ? parsed.version : EDITOR_VERSION;
  const type = typeof parsed?.type === 'string' ? parsed.type : 'doc';

  return { time, version, type, content };
};

const renderChecklistItem = (item) => `- [${item.checked ? 'x' : ' '}] ${item.text}`;

/**
 * Render a database API response (fields + rows) as a GitHub-flavoured markdown table.
 * @param {{ fields: Array<{id:string,name:string}>, rows: Array<{data:object}> }} db
 * @param {string} [fallbackTitle]
 * @returns {string}
 */
export const renderDatabaseAsMarkdownTable = (db, fallbackTitle) => {
  const title = fallbackTitle || db?.title || 'Database';
  const fields = db?.fields ?? [];
  const rows = db?.rows ?? [];
  if (!fields.length) return `[Database: ${title}]`;

  const cellValue = (val) => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'boolean') return val ? 'Yes' : 'No';
    if (Array.isArray(val)) return val.join(', ');
    return safeString(val).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  };

  const header = `| ${fields.map((f) => f.name.replace(/\|/g, '\\|')).join(' | ')} |`;
  const separator = `| ${fields.map(() => '---').join(' | ')} |`;
  const dataRows = rows.map((row) => {
    const cells = fields.map((f) => cellValue(row?.data?.[f.id]));
    return `| ${cells.join(' | ')} |`;
  });

  return [`**${title}**`, header, separator, ...dataRows].join('\n');
};

export const editorDocToMarkdown = (raw) => {
  const normalized = normalizeEditorDoc(raw);
  const blocks = tiptapContentToBlocks(normalized.content);
  const lines = blocks.map((block) => {
    if (block.type === 'header') {
      const level = Math.min(Math.max(block.data.level || 2, 1), 6);
      const hashes = '#'.repeat(level);
      return `${hashes} ${normalizeSpaces(block.data.text)}`;
    }
    if (block.type === 'checklist') {
      return block.data.items.map((item) => renderChecklistItem({ ...item, text: normalizeSpaces(item.text) })).join('\n');
    }
    if (block.type === 'linkTool') {
      const url = block.data.link || '';
      const title = block.data?.meta?.title || url;
      const desc = block.data?.meta?.description;
      const linkLine = url ? `[${title}](${url})` : title || '';
      if (linkLine && desc) return `${linkLine}\n\n${desc}`;
      return linkLine;
    }
    if (block.type === 'codeBlock') {
      const body = typeof block.data.text === 'string' ? block.data.text : `${block.data.text || ''}`;
      const lang = safeString(block.data.language || '').trim();
      const fence = lang ? `\`\`\`${lang}` : '```';
      return [fence, body.replace(/\u00a0/g, ' '), '```'].join('\n');
    }
    if (block.type === 'list') {
      return block.data.markdown;
    }
    if (block.type === 'delimiter') {
      const style = block.data?.style || 'line';
      if (style === 'stars') return '***';
      return '---';
    }
    if (block.type === 'image') {
      const url = block.data?.file?.url || block.data?.url || '';
      const caption = block.data.caption || '';
      if (!url) return '';
      return `![${caption || 'image'}](${url})`;
    }
    if (block.type === 'databaseView') {
      return `[Database: ${block.data.title || 'Untitled'}]`;
    }
    return normalizeSpaces(block.data.text || '');
  });
  return lines.filter(Boolean).join('\n\n').trim();
};

/**
 * Like editorDocToMarkdown but fetches database rows for any inline database views,
 * rendering them as full markdown tables.
 *
 * @param {*} raw - raw doc JSON
 * @param {(pageId: string) => Promise<{fields: any[], rows: any[]}>} fetchDatabase
 * @returns {Promise<string>}
 */
export const editorDocToMarkdownAsync = async (raw, fetchDatabase) => {
  const normalized = normalizeEditorDoc(raw);
  const blocks = tiptapContentToBlocks(normalized.content);

  const dbViews = blocks.filter((b) => b.type === 'databaseView');
  const dbData = {};
  if (fetchDatabase && dbViews.length) {
    await Promise.all(
      dbViews.map(async (b) => {
        try {
          dbData[b.data.pageId] = await fetchDatabase(b.data.pageId);
        } catch {
          // leave undefined; falls back to stub below
        }
      }),
    );
  }

  const lines = blocks.map((block) => {
    if (block.type === 'header') {
      const level = Math.min(Math.max(block.data.level || 2, 1), 6);
      return `${'#'.repeat(level)} ${normalizeSpaces(block.data.text)}`;
    }
    if (block.type === 'checklist') {
      return block.data.items.map((item) => renderChecklistItem({ ...item, text: normalizeSpaces(item.text) })).join('\n');
    }
    if (block.type === 'linkTool') {
      const url = block.data.link || '';
      const title = block.data?.meta?.title || url;
      const desc = block.data?.meta?.description;
      const linkLine = url ? `[${title}](${url})` : title || '';
      if (linkLine && desc) return `${linkLine}\n\n${desc}`;
      return linkLine;
    }
    if (block.type === 'codeBlock') {
      const body = typeof block.data.text === 'string' ? block.data.text : `${block.data.text || ''}`;
      const lang = safeString(block.data.language || '').trim();
      const fence = lang ? `\`\`\`${lang}` : '```';
      return [fence, body.replace(/\u00a0/g, ' '), '```'].join('\n');
    }
    if (block.type === 'list') return block.data.markdown;
    if (block.type === 'delimiter') {
      return block.data?.style === 'stars' ? '***' : '---';
    }
    if (block.type === 'image') {
      const url = block.data?.file?.url || block.data?.url || '';
      const caption = block.data.caption || '';
      if (!url) return '';
      return `![${caption || 'image'}](${url})`;
    }
    if (block.type === 'databaseView') {
      const db = dbData[block.data.pageId];
      return db
        ? renderDatabaseAsMarkdownTable(db, block.data.title)
        : `[Database: ${block.data.title || 'Untitled'}]`;
    }
    return normalizeSpaces(block.data.text || '');
  });

  return lines.filter(Boolean).join('\n\n').trim();
};

export const editorDocToTiptap = (raw) => {
  const normalized = normalizeEditorDoc(raw);
  return {
    type: normalized.type || 'doc',
    content: normalized.content,
  };
};
