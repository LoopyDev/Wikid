import { describe, expect, it } from 'vitest';
import { renderMarkdownSafely } from './safeMarkdown';

describe('renderMarkdownSafely', () => {
  it('keeps ordinary Markdown formatting', () => {
    const html = renderMarkdownSafely('**Bold** and [a link](https://example.com)\n\n- one\n- two');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('<li>one</li>');
  });

  it('removes anything that could run', () => {
    const html = renderMarkdownSafely(
      'Hi <img src=x onerror="alert(1)"> <script>alert(2)</script> [click](javascript:alert(3)) <a href="javascript:alert(4)">x</a> <svg onload="alert(5)"></svg>',
    );
    expect(html).not.toMatch(/onerror|onload|<script|javascript:/i);
    expect(html).toContain('Hi');
  });
});
