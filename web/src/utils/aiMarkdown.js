import { DOMParser as PMDOMParser, Fragment } from 'prosemirror-model';

/**
 * Serialize inline content (text nodes with marks) to markdown.
 *
 * Supported marks:
 *   bold (**), italic (*), bold+italic (***), code (`), strikethrough (~~), link ([text](url))
 *
 * Marks with no markdown equivalent (highlight, textStyle) pass through as plain text.
 *
 * @param {import('prosemirror-model').Node} pmNode - A node whose direct children are inline (text, hardBreak)
 * @returns {string}
 */
function inlineContentToMarkdown(pmNode) {
  const parts = [];

  pmNode.content.forEach((child) => {
    if (child.type.name === 'hardBreak') {
      parts.push('\n');
      return;
    }
    if (!child.isText) return;

    let text = child.text;
    const link = child.marks.find((m) => m.type.name === 'link');
    const markNames = new Set(child.marks.map((m) => m.type.name));

    if (link) {
      const href = link.attrs.href || '';
      text = `[${text}](${href})`;
    } else if (markNames.has('code')) {
      text = `\`${text}\``;
    } else {
      if (markNames.has('strike')) text = `~~${text}~~`;
      if (markNames.has('bold') && markNames.has('italic')) {
        text = `***${text}***`;
      } else if (markNames.has('bold')) {
        text = `**${text}**`;
      } else if (markNames.has('italic')) {
        text = `*${text}*`;
      }
    }

    parts.push(text);
  });

  return parts.join('');
}

/**
 * Serialize a list node (bulletList / orderedList) to markdown, handling nesting.
 *
 * @param {import('prosemirror-model').Node} listNode
 * @param {string} indent - current indentation prefix
 * @param {boolean} ordered - whether this is an ordered list
 * @returns {string}
 */
function listToMarkdown(listNode, indent = '', ordered = false) {
  const lines = [];
  let counter = 1;

  listNode.content.forEach((listItem) => {
    const prefix = ordered ? `${counter}. ` : '- ';
    counter++;

    listItem.content.forEach((child, _offset, childIndex) => {
      if (child.type.name === 'paragraph') {
        const text = inlineContentToMarkdown(child);
        if (childIndex === 0) {
          lines.push(`${indent}${prefix}${text}`);
        } else {
          // Continuation paragraph inside the same list item
          lines.push(`${indent}  ${text}`);
        }
      } else if (child.type.name === 'bulletList') {
        lines.push(listToMarkdown(child, indent + '  ', false));
      } else if (child.type.name === 'orderedList') {
        lines.push(listToMarkdown(child, indent + '  ', true));
      } else {
        // Fallback for other nested blocks
        const text = child.textContent;
        if (text) lines.push(`${indent}  ${text}`);
      }
    });
  });

  return lines.join('\n');
}

/**
 * Serialize a taskList node to markdown with [x] / [ ] checkbox syntax.
 *
 * @param {import('prosemirror-model').Node} taskListNode
 * @param {string} indent
 * @returns {string}
 */
function taskListToMarkdown(taskListNode, indent = '') {
  const lines = [];

  taskListNode.content.forEach((taskItem) => {
    const checked = taskItem.attrs.checked ? 'x' : ' ';
    const prefix = `- [${checked}] `;

    taskItem.content.forEach((child, _offset, childIndex) => {
      if (child.type.name === 'paragraph') {
        const text = inlineContentToMarkdown(child);
        if (childIndex === 0) {
          lines.push(`${indent}${prefix}${text}`);
        } else {
          lines.push(`${indent}      ${text}`);
        }
      } else if (child.type.name === 'taskList') {
        lines.push(taskListToMarkdown(child, indent + '  '));
      } else if (child.type.name === 'bulletList') {
        lines.push(listToMarkdown(child, indent + '  ', false));
      } else if (child.type.name === 'orderedList') {
        lines.push(listToMarkdown(child, indent + '  ', true));
      } else {
        const text = child.textContent;
        if (text) lines.push(`${indent}      ${text}`);
      }
    });
  });

  return lines.join('\n');
}

/**
 * Serialize a ProseMirror block node to markdown.
 * Handles paragraphs, headings, blockquotes, codeBlocks, lists, task lists, and callouts.
 *
 * @param {import('prosemirror-model').Node} pmNode - A block-level ProseMirror node
 * @returns {string}
 */
export function nodeToInlineMarkdown(pmNode) {
  const typeName = pmNode.type.name;

  if (typeName === 'bulletList') {
    return listToMarkdown(pmNode, '', false);
  }
  if (typeName === 'orderedList') {
    return listToMarkdown(pmNode, '', true);
  }
  if (typeName === 'taskList') {
    return taskListToMarkdown(pmNode, '');
  }
  if (typeName === 'callout') {
    const lines = [];
    pmNode.content.forEach((child) => {
      if (child.type.name === 'paragraph') {
        lines.push(inlineContentToMarkdown(child));
      } else if (child.type.name === 'bulletList') {
        lines.push(listToMarkdown(child, '', false));
      } else if (child.type.name === 'orderedList') {
        lines.push(listToMarkdown(child, '', true));
      } else {
        const text = child.textContent;
        if (text) lines.push(text);
      }
    });
    return `[Callout] ${lines.join('\n')}`;
  }

  // Default: flat inline content (paragraph, heading, blockquote, codeBlock)
  return inlineContentToMarkdown(pmNode);
}

/**
 * Convert inline markdown to HTML for DOM-based parsing.
 * Pure function — no ProseMirror dependency.
 *
 * @param {string} text
 * @returns {string} HTML string
 */
export function inlineMarkdownToHtml(text) {
  if (!text) return '';

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Split on code spans first to protect their content from inline formatting
  const parts = text.split(/(`[^`]*`)/);

  const processed = parts.map((part, i) => {
    if (i % 2 === 1) {
      // Code span — escape content, never apply further marks inside
      return `<code>${esc(part.slice(1, -1))}</code>`;
    }

    let s = esc(part);
    // Links before bold/italic to avoid conflicts with bracket content
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
    // Bold+italic must come before bold and italic individually
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/~~(.+?)~~/g, '<s>$1</s>');
    s = s.replace(/\n/g, '<br>');
    return s;
  });

  return processed.join('');
}

/**
 * Convert a markdown list string back into HTML for DOM-based parsing.
 * Handles nested lists via indentation (2-space indent = nesting level).
 *
 * @param {string} markdown
 * @returns {string} HTML string
 */
function listMarkdownToHtml(markdown) {
  const lines = markdown.split('\n').filter((l) => l.trimEnd());

  function parseLine(line) {
    // Task list: - [x] or - [ ]
    const taskMatch = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)/);
    if (taskMatch) {
      return {
        indent: taskMatch[1].length,
        ordered: false,
        task: true,
        checked: taskMatch[2].toLowerCase() === 'x',
        text: taskMatch[3],
      };
    }
    const match = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)/);
    if (!match) return null;
    const indent = match[1].length;
    const ordered = /^\d+\./.test(match[2]);
    const text = match[3];
    return { indent, ordered, task: false, checked: false, text };
  }

  function buildList(startIdx, baseIndent) {
    const items = [];
    let i = startIdx;
    let listOrdered = null;
    let isTaskList = null;

    while (i < lines.length) {
      const parsed = parseLine(lines[i]);
      if (!parsed || parsed.indent < baseIndent) break;
      if (parsed.indent > baseIndent) {
        // Nested list — attach to the last item
        const { html: nestedHtml, nextIdx } = buildList(i, parsed.indent);
        if (items.length) {
          items[items.length - 1].nested += nestedHtml;
        }
        i = nextIdx;
        continue;
      }
      if (listOrdered === null) listOrdered = parsed.ordered;
      if (isTaskList === null) isTaskList = parsed.task;
      items.push({ text: parsed.text, nested: '', checked: parsed.checked, task: parsed.task });
      i++;
    }

    if (isTaskList) {
      const inner = items
        .map((item) => {
          const checkedAttr = item.checked ? ' data-checked="true"' : '';
          return `<li data-type="taskItem"${checkedAttr}><p>${inlineMarkdownToHtml(item.text)}</p>${item.nested}</li>`;
        })
        .join('');
      return { html: `<ul data-type="taskList">${inner}</ul>`, nextIdx: i };
    }

    const tag = listOrdered ? 'ol' : 'ul';
    const inner = items
      .map((item) => `<li><p>${inlineMarkdownToHtml(item.text)}</p>${item.nested}</li>`)
      .join('');
    return { html: `<${tag}>${inner}</${tag}>`, nextIdx: i };
  }

  const { html } = buildList(0, 0);
  return html;
}

/**
 * Convert a markdown block string into a full ProseMirror Node.
 * Handles list markdown (lines starting with - or 1.) by parsing into list HTML.
 *
 * @param {string} markdown
 * @param {import('prosemirror-model').Schema} schema
 * @param {string} blockType - the original block type name
 * @returns {import('prosemirror-model').Node|null}
 */
export function markdownToBlockNode(markdown, schema, blockType) {
  if (!markdown) return null;

  const isList = blockType === 'bulletList' || blockType === 'orderedList' || blockType === 'taskList';
  const isCallout = blockType === 'callout';

  if (!isList && !isCallout) return null;

  try {
    let html;
    if (isList) {
      html = listMarkdownToHtml(markdown);
    } else {
      // Callout: strip [Callout] prefix if present, wrap content
      const content = markdown.replace(/^\[Callout\]\s*/, '');
      const hasListLines = content.split('\n').some((l) => /^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l));
      if (hasListLines) {
        html = `<div data-callout>${listMarkdownToHtml(content)}</div>`;
      } else {
        html = `<div data-callout><p>${inlineMarkdownToHtml(content)}</p></div>`;
      }
    }

    const div = document.createElement('div');
    div.innerHTML = html;
    const parser = PMDOMParser.fromSchema(schema);
    const doc = parser.parse(div);
    // Return the first matching block node
    let result = null;
    doc.forEach((node) => {
      if (!result && (node.type.name === blockType || isList)) {
        result = node;
      }
    });
    return result;
  } catch (err) {
    console.warn('[aiMarkdown] block parse failed:', err);
    return null;
  }
}

/**
 * Parse inline markdown into a ProseMirror Fragment using the editor's schema.
 * Uses the schema's own parseDOM rules so custom marks (highlight, textStyle, link)
 * are handled correctly without any manual configuration.
 *
 * Falls back to a plain text node if parsing fails.
 *
 * @param {string} markdown
 * @param {import('prosemirror-model').Schema} schema
 * @returns {import('prosemirror-model').Fragment}
 */
export function markdownToInlineFragment(markdown, schema) {
  if (!markdown) return Fragment.empty;

  const html = inlineMarkdownToHtml(markdown);
  try {
    const div = document.createElement('div');
    div.innerHTML = html;
    const parser = PMDOMParser.fromSchema(schema);
    const doc = parser.parse(div);
    const firstChild = doc.firstChild;
    if (firstChild) return firstChild.content;
  } catch (err) {
    console.warn('[aiMarkdown] parse failed, falling back to plain text:', err);
  }

  // Fallback: plain text node
  try {
    return Fragment.from(schema.text(markdown));
  } catch {
    return Fragment.empty;
  }
}
