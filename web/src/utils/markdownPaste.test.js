import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  formatInlineMarkdown,
  looksLikeMarkdown,
  markdownToHtml,
  shouldHandleMarkdownPaste,
} from './markdownPaste';

const stateIn = (parentType) => ({ selection: { $from: { parent: { type: { name: parentType } } } } });

describe('escapeHtml', () => {
  it('escapes the characters that matter in HTML', () => {
    expect(escapeHtml(`<a href="x">Tom & Jo's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jo&#39;s&lt;/a&gt;');
    expect(escapeHtml(null)).toBe('');
  });
});

describe('formatInlineMarkdown', () => {
  it('formats bold, italic, strikethrough, code and links', () => {
    expect(formatInlineMarkdown('**bold** and __bold__')).toBe('<strong>bold</strong> and <strong>bold</strong>');
    expect(formatInlineMarkdown('*it* and _it_')).toBe('<em>it</em> and <em>it</em>');
    expect(formatInlineMarkdown('~~gone~~')).toBe('<del>gone</del>');
    expect(formatInlineMarkdown('see [docs](https://example.com)')).toBe('see <a href="https://example.com">docs</a>');
  });

  it('leaves markdown inside inline code alone', () => {
    expect(formatInlineMarkdown('`**not bold**` but **bold**')).toBe('<code>**not bold**</code> but <strong>bold</strong>');
  });

  it('keeps $ sequences in inline code as typed', () => {
    expect(formatInlineMarkdown('Use `$&` here')).toBe('Use <code>$&amp;</code> here');
    expect(formatInlineMarkdown("Price `$'` here")).toBe('Price <code>$&#39;</code> here');
  });

  it('escapes HTML in the text', () => {
    expect(formatInlineMarkdown('<script>x</script> **b**')).toBe('&lt;script&gt;x&lt;/script&gt; <strong>b</strong>');
  });
});

describe('looksLikeMarkdown', () => {
  it('recognises typical markdown', () => {
    expect(looksLikeMarkdown('# Title\n\nSome text')).toBe(true);
    expect(looksLikeMarkdown('- one\n- two')).toBe(true);
    expect(looksLikeMarkdown('```js\ncode\n```')).toBe(true);
    expect(looksLikeMarkdown('Intro\nsee [docs](https://example.com)')).toBe(true);
  });

  it('ignores ordinary text', () => {
    expect(looksLikeMarkdown('Just a sentence.')).toBe(false);
    expect(looksLikeMarkdown('- a single bullet')).toBe(false);
    expect(looksLikeMarkdown('')).toBe(false);
    expect(looksLikeMarkdown(undefined)).toBe(false);
  });
});

describe('shouldHandleMarkdownPaste', () => {
  it('converts plain-text markdown pastes', () => {
    expect(shouldHandleMarkdownPaste('# Title\n- item', '', stateIn('paragraph'))).toBe(true);
  });

  it('keeps rich HTML pastes and pastes into code blocks as they are', () => {
    expect(shouldHandleMarkdownPaste('# Title\n- item', '<h1>Title</h1><ul><li>item</li></ul>', stateIn('paragraph'))).toBe(false);
    expect(shouldHandleMarkdownPaste('# Title\n- item', '', stateIn('codeBlock'))).toBe(false);
    expect(shouldHandleMarkdownPaste('plain text', '', stateIn('paragraph'))).toBe(false);
  });
});

describe('markdownToHtml', () => {
  it('converts headings, paragraphs and rules', () => {
    expect(markdownToHtml('# One\n### Three\nline a\nline b\n\n---')).toBe(
      '<h1>One</h1><h3>Three</h3><p>line a line b</p><hr />',
    );
  });

  it('converts bullet, numbered and task lists', () => {
    expect(markdownToHtml('- a\n* b\n+ c')).toBe('<ul><li>a</li><li>b</li><li>c</li></ul>');
    expect(markdownToHtml('1. one\n2) two')).toBe('<ol><li>one</li><li>two</li></ol>');
    // Task items become plain bullets.
    expect(markdownToHtml('- [ ] todo\n- [x] done')).toBe('<ul><li>todo</li><li>done</li></ul>');
  });

  it('keeps a list going across a blank line, and starts a new one when the type changes', () => {
    expect(markdownToHtml('- a\n\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(markdownToHtml('- a\n1. b')).toBe('<ul><li>a</li></ul><ol><li>b</li></ol>');
    expect(markdownToHtml('- a\n\nafter')).toBe('<ul><li>a</li></ul><p>after</p>');
  });

  it('converts code blocks with their language, escaping the code', () => {
    expect(markdownToHtml('```js\nif (a < b) {}\n```')).toBe('<pre><code class="language-js">if (a &lt; b) {}</code></pre>');
    // An unclosed fence still becomes a code block.
    expect(markdownToHtml('```\nno end')).toBe('<pre><code>no end</code></pre>');
  });

  it('converts blockquotes, including markdown inside them', () => {
    expect(markdownToHtml('> **quoted**\n> - item')).toBe('<blockquote><p><strong>quoted</strong></p><ul><li>item</li></ul></blockquote>');
  });

  it('returns nothing for empty input', () => {
    expect(markdownToHtml('')).toBe('');
    expect(markdownToHtml('   \n  ')).toBe('');
    expect(markdownToHtml(null)).toBe('');
  });
});
