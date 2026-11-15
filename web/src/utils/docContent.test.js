import { describe, expect, it } from 'vitest';
import { hasTypedContent } from './docContent';

const p = (text) => ({ type: 'paragraph', ...(text !== undefined ? { content: [{ type: 'text', text }] } : {}) });
const doc = (...content) => ({ type: 'doc', content });

describe('hasTypedContent', () => {
  it('an empty page, or blank lines, has nothing typed', () => {
    expect(hasTypedContent(doc(p()))).toBe(false);
    expect(hasTypedContent(doc(p(), p('   ')))).toBe(false);
    expect(hasTypedContent(null)).toBe(false);
  });

  it('text counts, and so does a block started with no text yet (a bullet, a heading, a divider)', () => {
    expect(hasTypedContent(doc(p('-')))).toBe(true);
    expect(hasTypedContent(doc({ type: 'bulletList', content: [{ type: 'listItem', content: [p()] }] }))).toBe(true);
    expect(hasTypedContent(doc({ type: 'heading', attrs: { level: 1 } }))).toBe(true);
    expect(hasTypedContent(doc({ type: 'horizontalRule' }, p()))).toBe(true);
  });
});
