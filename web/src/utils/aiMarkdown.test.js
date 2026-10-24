import { describe, it, expect } from 'vitest';
import { Schema, Fragment } from 'prosemirror-model';
import { nodeToInlineMarkdown, inlineMarkdownToHtml, markdownToInlineFragment } from './aiMarkdown';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMark(typeName, attrs = {}) {
  return { type: { name: typeName }, attrs };
}

function makeText(text, marks = []) {
  return {
    type: { name: 'text' },
    isText: true,
    text,
    marks,
  };
}

function makeHardBreak() {
  return { type: { name: 'hardBreak' }, isText: false, text: null, marks: [] };
}

function makeBlock(...children) {
  return {
    content: { forEach: (fn) => children.forEach((child, i) => fn(child, i, i)) },
  };
}

// Minimal ProseMirror schema for markdownToInlineFragment tests
const testSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      parseDOM: [{ tag: 'p' }, { tag: 'div' }],
      toDOM: () => ['p', 0],
    },
    text: { group: 'inline' },
    hardBreak: {
      group: 'inline',
      inline: true,
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM: () => ['br'],
    },
  },
  marks: {
    bold: {
      parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
      toDOM: () => ['strong', 0],
    },
    italic: {
      parseDOM: [{ tag: 'em' }, { tag: 'i' }],
      toDOM: () => ['em', 0],
    },
    code: {
      parseDOM: [{ tag: 'code' }],
      toDOM: () => ['code', 0],
    },
    strike: {
      parseDOM: [{ tag: 's' }, { tag: 'del' }],
      toDOM: () => ['s', 0],
    },
    link: {
      attrs: { href: { default: '' }, title: { default: null } },
      parseDOM: [{ tag: 'a[href]', getAttrs: (dom) => ({ href: dom.getAttribute('href'), title: dom.getAttribute('title') }) }],
      toDOM: (mark) => ['a', { href: mark.attrs.href }, 0],
    },
  },
});

// ── nodeToInlineMarkdown ──────────────────────────────────────────────────────

describe('nodeToInlineMarkdown', () => {
  it('returns empty string for empty block', () => {
    expect(nodeToInlineMarkdown(makeBlock())).toBe('');
  });

  it('serializes plain text', () => {
    const block = makeBlock(makeText('Hello world'));
    expect(nodeToInlineMarkdown(block)).toBe('Hello world');
  });

  it('serializes bold text', () => {
    const block = makeBlock(makeText('bold', [makeMark('bold')]));
    expect(nodeToInlineMarkdown(block)).toBe('**bold**');
  });

  it('serializes italic text', () => {
    const block = makeBlock(makeText('italic', [makeMark('italic')]));
    expect(nodeToInlineMarkdown(block)).toBe('*italic*');
  });

  it('serializes bold+italic text', () => {
    const block = makeBlock(makeText('both', [makeMark('bold'), makeMark('italic')]));
    expect(nodeToInlineMarkdown(block)).toBe('***both***');
  });

  it('serializes inline code', () => {
    const block = makeBlock(makeText('code', [makeMark('code')]));
    expect(nodeToInlineMarkdown(block)).toBe('`code`');
  });

  it('serializes strikethrough', () => {
    const block = makeBlock(makeText('deleted', [makeMark('strike')]));
    expect(nodeToInlineMarkdown(block)).toBe('~~deleted~~');
  });

  it('serializes bold+strikethrough (strike outermost)', () => {
    const block = makeBlock(makeText('both', [makeMark('bold'), makeMark('strike')]));
    expect(nodeToInlineMarkdown(block)).toBe('**~~both~~**');
  });

  it('serializes links', () => {
    const block = makeBlock(makeText('click here', [makeMark('link', { href: 'https://example.com' })]));
    expect(nodeToInlineMarkdown(block)).toBe('[click here](https://example.com)');
  });

  it('passes through highlight mark as plain text', () => {
    const block = makeBlock(makeText('highlighted', [makeMark('highlight')]));
    expect(nodeToInlineMarkdown(block)).toBe('highlighted');
  });

  it('passes through textStyle mark as plain text', () => {
    const block = makeBlock(makeText('colored', [makeMark('textStyle', { color: '#ff0000' })]));
    expect(nodeToInlineMarkdown(block)).toBe('colored');
  });

  it('serializes mixed content', () => {
    const block = makeBlock(
      makeText('Hello '),
      makeText('world', [makeMark('bold')]),
      makeText(' and '),
      makeText('italic', [makeMark('italic')]),
    );
    expect(nodeToInlineMarkdown(block)).toBe('Hello **world** and *italic*');
  });

  it('serializes hardBreak as newline', () => {
    const block = makeBlock(
      makeText('line one'),
      makeHardBreak(),
      makeText('line two'),
    );
    expect(nodeToInlineMarkdown(block)).toBe('line one\nline two');
  });

  it('skips non-text, non-hardBreak nodes', () => {
    const inlineWidget = { type: { name: 'pageLink' }, isText: false, text: null, marks: [] };
    const block = makeBlock(makeText('before '), inlineWidget, makeText(' after'));
    expect(nodeToInlineMarkdown(block)).toBe('before  after');
  });
});

// ── inlineMarkdownToHtml ──────────────────────────────────────────────────────

describe('inlineMarkdownToHtml', () => {
  it('returns empty string for empty input', () => {
    expect(inlineMarkdownToHtml('')).toBe('');
    expect(inlineMarkdownToHtml(null)).toBe('');
    expect(inlineMarkdownToHtml(undefined)).toBe('');
  });

  it('passes through plain text unchanged', () => {
    expect(inlineMarkdownToHtml('hello world')).toBe('hello world');
  });

  it('escapes HTML entities in plain text', () => {
    expect(inlineMarkdownToHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });

  it('converts bold', () => {
    expect(inlineMarkdownToHtml('**bold**')).toBe('<strong>bold</strong>');
  });

  it('converts italic', () => {
    expect(inlineMarkdownToHtml('*italic*')).toBe('<em>italic</em>');
  });

  it('converts bold+italic', () => {
    expect(inlineMarkdownToHtml('***both***')).toBe('<strong><em>both</em></strong>');
  });

  it('converts inline code', () => {
    expect(inlineMarkdownToHtml('`code`')).toBe('<code>code</code>');
  });

  it('escapes HTML entities inside code span', () => {
    expect(inlineMarkdownToHtml('`a < b`')).toBe('<code>a &lt; b</code>');
  });

  it('does not apply bold inside code span', () => {
    expect(inlineMarkdownToHtml('`**not bold**`')).toBe('<code>**not bold**</code>');
  });

  it('converts strikethrough', () => {
    expect(inlineMarkdownToHtml('~~strike~~')).toBe('<s>strike</s>');
  });

  it('converts links', () => {
    expect(inlineMarkdownToHtml('[click](https://example.com)')).toBe('<a href="https://example.com">click</a>');
  });

  it('converts hard break (newline)', () => {
    expect(inlineMarkdownToHtml('line one\nline two')).toBe('line one<br>line two');
  });

  it('converts mixed content', () => {
    const result = inlineMarkdownToHtml('Hello **world** and *italic*');
    expect(result).toBe('Hello <strong>world</strong> and <em>italic</em>');
  });

  it('converts bold with strikethrough nested', () => {
    // nodeToInlineMarkdown outputs **~~text~~** (strike innermost)
    const result = inlineMarkdownToHtml('**~~text~~**');
    expect(result).toBe('<strong><s>text</s></strong>');
  });

  it('handles code span mixed with other marks', () => {
    const result = inlineMarkdownToHtml('**bold** and `code` and *italic*');
    expect(result).toBe('<strong>bold</strong> and <code>code</code> and <em>italic</em>');
  });

  it('handles link with bold text around it', () => {
    const result = inlineMarkdownToHtml('**bold** [link](https://x.com) *italic*');
    expect(result).toBe('<strong>bold</strong> <a href="https://x.com">link</a> <em>italic</em>');
  });

  it('leaves unmatched markers as-is', () => {
    expect(inlineMarkdownToHtml('hello * world')).toBe('hello * world');
    expect(inlineMarkdownToHtml('hello ** world')).toBe('hello ** world');
  });
});

// ── Round-trip: nodeToInlineMarkdown → inlineMarkdownToHtml ──────────────────

describe('round-trip: serialize then convert to HTML', () => {
  function roundTrip(...children) {
    return inlineMarkdownToHtml(nodeToInlineMarkdown(makeBlock(...children)));
  }

  it('plain text round-trip', () => {
    expect(roundTrip(makeText('hello'))).toBe('hello');
  });

  it('bold round-trip', () => {
    expect(roundTrip(makeText('bold', [makeMark('bold')]))).toBe('<strong>bold</strong>');
  });

  it('italic round-trip', () => {
    expect(roundTrip(makeText('italic', [makeMark('italic')]))).toBe('<em>italic</em>');
  });

  it('bold+italic round-trip', () => {
    expect(roundTrip(makeText('both', [makeMark('bold'), makeMark('italic')]))).toBe('<strong><em>both</em></strong>');
  });

  it('code round-trip', () => {
    expect(roundTrip(makeText('code', [makeMark('code')]))).toBe('<code>code</code>');
  });

  it('strike round-trip', () => {
    expect(roundTrip(makeText('del', [makeMark('strike')]))).toBe('<s>del</s>');
  });

  it('link round-trip', () => {
    expect(roundTrip(makeText('example', [makeMark('link', { href: 'https://example.com' })]))).toBe(
      '<a href="https://example.com">example</a>',
    );
  });

  it('mixed content round-trip', () => {
    const html = roundTrip(
      makeText('See '),
      makeText('docs', [makeMark('link', { href: 'https://docs.example.com' })]),
      makeText(' for '),
      makeText('details', [makeMark('bold')]),
    );
    expect(html).toBe('See <a href="https://docs.example.com">docs</a> for <strong>details</strong>');
  });
});

// ── markdownToInlineFragment ──────────────────────────────────────────────────

describe('markdownToInlineFragment', () => {
  it('returns Fragment.empty for empty string', () => {
    const frag = markdownToInlineFragment('', testSchema);
    expect(frag).toBe(Fragment.empty);
  });

  it('parses plain text into a single text node', () => {
    const frag = markdownToInlineFragment('hello world', testSchema);
    expect(frag.childCount).toBe(1);
    expect(frag.firstChild.isText).toBe(true);
    expect(frag.firstChild.text).toBe('hello world');
    expect(frag.firstChild.marks).toHaveLength(0);
  });

  it('parses bold text', () => {
    const frag = markdownToInlineFragment('**bold**', testSchema);
    expect(frag.childCount).toBe(1);
    const child = frag.firstChild;
    expect(child.isText).toBe(true);
    expect(child.text).toBe('bold');
    expect(child.marks.some((m) => m.type.name === 'bold')).toBe(true);
  });

  it('parses italic text', () => {
    const frag = markdownToInlineFragment('*italic*', testSchema);
    const child = frag.firstChild;
    expect(child.isText).toBe(true);
    expect(child.text).toBe('italic');
    expect(child.marks.some((m) => m.type.name === 'italic')).toBe(true);
  });

  it('parses inline code', () => {
    const frag = markdownToInlineFragment('`code`', testSchema);
    const child = frag.firstChild;
    expect(child.isText).toBe(true);
    expect(child.text).toBe('code');
    expect(child.marks.some((m) => m.type.name === 'code')).toBe(true);
  });

  it('parses a link', () => {
    const frag = markdownToInlineFragment('[click](https://example.com)', testSchema);
    const child = frag.firstChild;
    expect(child.isText).toBe(true);
    expect(child.text).toBe('click');
    const linkMark = child.marks.find((m) => m.type.name === 'link');
    expect(linkMark).toBeTruthy();
    expect(linkMark.attrs.href).toBe('https://example.com');
  });

  it('parses mixed bold and plain text', () => {
    const frag = markdownToInlineFragment('Hello **world**', testSchema);
    // Should have "Hello " as plain text and "world" as bold
    const texts = [];
    frag.forEach((child) => { if (child.isText) texts.push({ text: child.text, marks: child.marks }); });
    expect(texts.some((t) => t.text === 'Hello ' && t.marks.length === 0)).toBe(true);
    expect(texts.some((t) => t.text === 'world' && t.marks.some((m) => m.type.name === 'bold'))).toBe(true);
  });
});
