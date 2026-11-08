import { describe, it, expect } from 'vitest';
import { looksLikeMarkdown, shouldHandleMarkdownPaste } from './markdownPaste';

const stateIn = (parentType) => ({ selection: { $from: { parent: { type: { name: parentType } } } } });

describe('looksLikeMarkdown', () => {
  it('recognises typical markdown', () => {
    expect(looksLikeMarkdown('# Title\n\nSome text')).toBe(true);
    expect(looksLikeMarkdown('- one\n- two')).toBe(true);
    expect(looksLikeMarkdown('```js\ncode\n```')).toBe(true);
    expect(looksLikeMarkdown('Intro\nsee [docs](https://example.com)')).toBe(true);
  });

  it('takes a single to-do line as Markdown, but not a single bullet', () => {
    expect(looksLikeMarkdown('- [ ] Okay')).toBe(true);
    expect(looksLikeMarkdown('- [x] Done')).toBe(true);
    expect(looksLikeMarkdown('* [X] Done')).toBe(true);
    expect(looksLikeMarkdown('- a single bullet')).toBe(false);
    expect(looksLikeMarkdown('- [link] text')).toBe(false);
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
