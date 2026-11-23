import { describe, it, expect } from 'vitest';
import { absoluteUploadSrc, uploadSrc, uploadSrcOn } from './uploadUrl';

const key = '869980ec-a19d-40e0-9a53-c664fa6c66ff/1793147717474-3f5bff92.png';

describe('uploadSrc', () => {
  it('points an upload saved with another site name at this Wikid', () => {
    expect(uploadSrc(`https://wiki.loopydev.co.uk/api/uploads/${key}`, '/api')).toBe(`/api/uploads/${key}`);
    expect(uploadSrc(`http://localhost:8088/api/uploads/${key}`, '/api')).toBe(`/api/uploads/${key}`);
  });

  it('keeps an upload saved without a site name', () => {
    expect(uploadSrc(`/api/uploads/${key}`, '/api')).toBe(`/api/uploads/${key}`);
  });

  it('reaches the API where it runs on its own, in development', () => {
    expect(uploadSrc(`/api/uploads/${key}`, 'http://localhost:3000')).toBe(`http://localhost:3000/uploads/${key}`);
    expect(uploadSrc(`http://localhost:3000/uploads/${key}`, '/api')).toBe(`/api/uploads/${key}`);
  });

  it('leaves anything else alone', () => {
    for (const src of [
      'https://example.com/photo.png',
      'https://example.com/uploads/photo.png',
      `https://example.com/api/uploads/${key}?size=2`,
      'data:image/png;base64,AAAA',
      '',
    ]) {
      expect(uploadSrc(src, '/api')).toBe(src);
    }
    expect(uploadSrc(null, '/api')).toBe(null);
  });
});

describe('absoluteUploadSrc', () => {
  it("gives an upload this site's full address", () => {
    expect(absoluteUploadSrc(`https://old.example.com/api/uploads/${key}`, '/api', 'https://wiki.example.com'))
      .toBe(`https://wiki.example.com/api/uploads/${key}`);
  });

  it('leaves other images alone', () => {
    expect(absoluteUploadSrc('https://example.com/photo.png', '/api', 'https://wiki.example.com')).toBe('https://example.com/photo.png');
  });
});

describe('uploadSrcOn', () => {
  const own = key.split('/')[0];
  const other = '0b6f6a52-6f0e-4c1a-9d43-2f7d1b9e8a11';

  it("says which page it's shown on when that isn't the upload's own", () => {
    expect(uploadSrcOn(`/api/uploads/${key}`, other, '/api')).toBe(`/api/uploads/${key}?page=${other}`);
  });

  it("leaves the address plain on its own page, or when the page isn't known", () => {
    expect(uploadSrcOn(`/api/uploads/${key}`, own, '/api')).toBe(`/api/uploads/${key}`);
    expect(uploadSrcOn(`/api/uploads/${key}`, own.toUpperCase(), '/api')).toBe(`/api/uploads/${key}`);
    expect(uploadSrcOn(`/api/uploads/${key}`, null, '/api')).toBe(`/api/uploads/${key}`);
  });

  it('leaves anything that isn\'t an upload alone', () => {
    expect(uploadSrcOn('https://example.com/photo.png', other, '/api')).toBe('https://example.com/photo.png');
  });
});
