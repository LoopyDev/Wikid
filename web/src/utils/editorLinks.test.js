import { describe, it, expect } from 'vitest';
import { normalizeLinkHref, parseBlockUrl } from './editorLinks';

describe('normalizeLinkHref', () => {
  it('adds https:// to bare addresses', () => {
    expect(normalizeLinkHref(' example.com/page ')).toBe('https://example.com/page');
  });

  it('keeps addresses that already have a scheme, and relative links', () => {
    expect(normalizeLinkHref('http://example.com')).toBe('http://example.com');
    expect(normalizeLinkHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(normalizeLinkHref('#section')).toBe('#section');
    expect(normalizeLinkHref('/doc/123')).toBe('/doc/123');
    expect(normalizeLinkHref('../up')).toBe('../up');
  });

  it('returns an empty string for empty input', () => {
    expect(normalizeLinkHref('   ')).toBe('');
    expect(normalizeLinkHref(undefined)).toBe('');
  });
});

describe('parseBlockUrl', () => {
  it('reads the page, workspace and block from a block link', () => {
    expect(parseBlockUrl('https://wiki.example.com/ws/team%20a/doc/page-1#block-42')).toEqual({
      blockId: 'block-42',
      pageId: 'page-1',
      workspaceId: 'team a',
    });
  });

  it('accepts a bare block anchor', () => {
    expect(parseBlockUrl('#block-7')).toMatchObject({ blockId: 'block-7' });
  });

  it('fixes a doubled block- prefix', () => {
    expect(parseBlockUrl('/doc/p#block-block-9').blockId).toBe('block-9');
  });

  it('ignores text without a block anchor', () => {
    expect(parseBlockUrl('https://example.com/doc/p')).toBeNull();
    expect(parseBlockUrl(null)).toBeNull();
  });
});
