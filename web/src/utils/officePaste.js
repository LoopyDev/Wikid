// Pasting from Word (and other Office apps) with text and pictures together. The HTML it puts on the
// clipboard points each picture at a file on the computer (file:///…/clip_image001.png), which a web
// page can't read, so the pictures were dropped. Its RTF copy holds the pictures themselves, in the
// same order: they're read from there.

import { isLocalImageSrc } from '../tiptap/resizableImage';

const FORMATS = { pngblip: ['image/png', 'png'], jpegblip: ['image/jpeg', 'jpg'] };
const CONTROL_WORD = /\\([a-zA-Z]+)(-?\d+)? ?/y;

const hexValue = (code) => (code <= 57 ? code - 48 : (code | 32) - 87);

// Groups holding a second copy of a picture shown elsewhere (\nonshppict: an older format beside
// \shppict; \shprslt: a floating shape's fallback), or one that's no picture in the text (a list's
// picture bullets)
const COPIES = new Set(['nonshppict', 'shprslt', 'listpicture']);

/**
 * The pictures in RTF from Word, one for each it shows, in order. A picture in a format a browser
 * can't show (a chart's metafile, say) is null, so the rest still line up with the pictures in the
 * HTML.
 * @param {string} rtf
 * @returns {Array<{ type: string, extension: string, bytes: Uint8Array } | null>}
 */
export function picturesFromRtf(rtf, { decode = true } = {}) {
  if (typeof rtf !== 'string' || !rtf.includes('\\pict')) return [];
  const pictures = [];
  const groups = [];
  let i = 0;
  while (i < rtf.length) {
    const c = rtf.charCodeAt(i);
    const group = groups[groups.length - 1];
    if (c === 123) { // {
      groups.push({ word: null, copy: !!group && (group.copy || COPIES.has(group.word)), pict: false, format: null, hex: [], binary: null });
      i += 1;
      continue;
    }
    if (c === 125) { // }
      groups.pop();
      // Without decode, only which pictures there are (cheap: decoding a big picture isn't)
      if (group?.pict && !group.copy) pictures.push(decode ? toPicture(group) : FORMATS[group.format] ? {} : null);
      i += 1;
      continue;
    }
    if (c === 92) { // \
      CONTROL_WORD.lastIndex = i;
      const match = CONTROL_WORD.exec(rtf);
      if (match) {
        i = CONTROL_WORD.lastIndex;
        if (group) {
          if (group.word === null) {
            group.word = match[1];
            if (match[1] === 'pict') group.pict = true;
          } else if (group.pict && FORMATS[match[1]]) {
            group.format = match[1];
          }
        }
        // \binN: N bytes of the picture as they are, which may be anything (braces too)
        if (match[1] === 'bin') {
          const length = Math.max(0, Number(match[2]) || 0);
          if (group?.pict) group.binary = rtf.slice(i, i + length);
          i += length;
        }
        continue;
      }
      // A control symbol: \' and two hex digits, or one character (\*, \\, \{ …)
      i += rtf[i + 1] === "'" ? 4 : 2;
      continue;
    }
    // Text up to the next control word or group; in a picture's own group (not one inside it, such as
    // its properties), that's its data as hex
    let end = i + 1;
    while (end < rtf.length) {
      const next = rtf.charCodeAt(end);
      if (next === 92 || next === 123 || next === 125) break;
      end += 1;
    }
    if (group?.pict) group.hex.push(rtf.slice(i, end));
    i = end;
  }
  return pictures;
}

function toPicture(group) {
  const format = FORMATS[group.format];
  if (!format) return null;
  if (group.binary !== null) {
    const bytes = new Uint8Array(group.binary.length);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = group.binary.charCodeAt(i) & 0xff;
    return bytes.length ? { type: format[0], extension: format[1], bytes } : null;
  }
  const hex = group.hex.join('').replace(/[^\da-fA-F]/g, '');
  if (!hex || hex.length % 2) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = (hexValue(hex.charCodeAt(i * 2)) << 4) | hexValue(hex.charCodeAt(i * 2 + 1));
  return { type: format[0], extension: format[1], bytes };
}

/** How many pictures in the HTML point at files on the computer. */
export const localImageCount = (html) =>
  [...new DOMParser().parseFromString(String(html || ''), 'text/html').querySelectorAll('img')].filter((img) => isLocalImageSrc(img.getAttribute('src'))).length;

// What a pasted picture's placeholder says until the picture takes its place
export const PLACEHOLDER_TEXT = 'Picture pasted from Word';

/**
 * The HTML with its local pictures as image placeholders, each with the block id given for it, in
 * order (the pictures take their places once uploaded); one without an id (a picture that can't be
 * read) is left out. A placeholder is a block: it takes the place of the paragraph a picture is alone
 * in (Word wraps it in spans), or goes after the paragraph it shares with text. Also returns, by id,
 * the size Word showed each picture at (its width) and its description.
 */
export function withPicturePlaceholders(html, ids) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const shown = {};
  const lastAfter = new Map(); // a paragraph -> the last placeholder put after it
  let next = 0;
  for (const img of [...doc.querySelectorAll('img')]) {
    if (!isLocalImageSrc(img.getAttribute('src'))) continue;
    const id = ids[next];
    next += 1;
    const block = img.closest('p, li, h1, h2, h3, h4, h5, h6, td, th') || null;
    const alone = block && block.tagName === 'P' && !block.textContent.trim() && [...block.querySelectorAll('img')].filter((other) => isLocalImageSrc(other.getAttribute('src'))).length === 1;
    if (!id) {
      (alone ? block : img).remove();
      continue;
    }
    const width = Number.parseInt(img.getAttribute('width') || '', 10);
    shown[id] = { width: Number.isFinite(width) && width > 0 ? `${width}px` : null, alt: img.getAttribute('alt')?.trim() || null };
    const placeholder = doc.createElement('div');
    placeholder.setAttribute('data-type', 'image-placeholder');
    placeholder.setAttribute('id', id);
    placeholder.textContent = PLACEHOLDER_TEXT;
    if (alone) {
      block.replaceWith(placeholder);
    } else if (block && block.tagName === 'P') {
      img.remove();
      (lastAfter.get(block) || block).after(placeholder);
      lastAfter.set(block, placeholder);
    } else {
      // In a list item or table cell, where a block can go: in place of the picture
      img.replaceWith(placeholder);
    }
  }
  return { html: doc.body.innerHTML, shown };
}
