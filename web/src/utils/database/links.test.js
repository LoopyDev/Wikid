import { describe, it, expect } from 'vitest';
import { linkHref } from './links';

describe('linkHref', () => {
  it('opens web addresses and email links', () => {
    expect(linkHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(linkHref(' http://example.com ')).toBe('http://example.com/');
    expect(linkHref('example.com/docs')).toBe('https://example.com/docs');
    expect(linkHref('mailto:ada@example.com')).toBe('mailto:ada@example.com');
    expect(linkHref('first.last@example.com')).toBe('mailto:first.last@example.com');
    expect(linkHref('example.com:8080/x')).toBe('https://example.com:8080/x');
    expect(linkHref('localhost:3000')).toBe('https://localhost:3000/');
  });

  it("doesn't open anything else", () => {
    for (const value of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,hi', 'vbscript:x', 'file:///etc/passwd', 'not a link', 'hello', '', null, 'mailto:nobody', 'https://', '3.14', 'v1.2', 'https://bank.example.com@evil.example/', 'https://user:pw@example.com']) {
      expect(linkHref(value), String(value)).toBeNull();
    }
  });
});
