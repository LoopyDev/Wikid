import { describe, it, expect } from 'vitest';
import { PLACEHOLDER_TEXT, hasOfficePictures, picturesFromPaste, picturesFromRtf, withPicturePlaceholders } from './officePaste';

// RTF as Word writes a picture: a PNG (or JPEG) in \shppict, with its shape's properties in nested
// groups, and the same picture again as a metafile in \nonshppict
const shppict = (blip, hex) =>
  `{\\*\\shppict{\\pict{\\*\\picprop\\shplid1025{\\sp{\\sn shapeType}{\\sv 75}}{\\sp{\\sn fFlipH}{\\sv 0}}{\\sp{\\sn pibName}{\\sv abc123}}}\\picscalex100\\picscaley100\\piccropl0\\picw529\\pich529\\picwgoal300\\pichgoal300\\${blip}\\bliptag255{\\*\\blipuid 0123456789abcdef0123456789abcdef}${hex}}}`;
const nonshppict = '{\\nonshppict{\\pict\\picscalex100\\wmetafile8\\picw529 0100090000}}';

describe('pictures from Word RTF', () => {
  it('reads the PNG and JPEG pictures, in order, and leaves out the metafile copies', () => {
    const rtf = `{\\rtf1 Some text ${shppict('pngblip', '89504e47\n0d0a1a0a')}${nonshppict} more ${shppict('jpegblip', 'ffd8ffe0')}${nonshppict}}`;
    const pictures = picturesFromRtf(rtf);
    expect(pictures.map((p) => p.type)).toEqual(['image/png', 'image/jpeg']);
    expect([...pictures[0].bytes]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect([...pictures[1].bytes]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  it("keeps a place for a picture it can't read (a chart's metafile), so the rest line up", () => {
    const chart = '{\\pict\\emfblip\\picw100\\pich100 01000000}';
    const pictures = picturesFromRtf(`{\\rtf1 ${chart} text ${shppict('pngblip', '89504e47')}${nonshppict}}`);
    expect(pictures.map((p) => p && p.type)).toEqual([null, 'image/png']);
  });

  it('finds nothing in RTF without pictures, or something else', () => {
    expect(picturesFromRtf('{\\rtf1 Just text}')).toEqual([]);
    expect(picturesFromRtf(undefined)).toEqual([]);
  });

  it('puts a placeholder (with its id) in place of each local picture in the HTML, in order', () => {
    const html = '<p>Before</p><p><img src="file:///C:/Users/a/clip_image001.png" width="192" alt="Logo"></p><p>Middle</p><img src="https://example.com/x.png"><p><img src="file:///C:/Users/a/clip_image002.emz"></p><p>After</p>';
    const { html: out, shown } = withPicturePlaceholders(html, ['block-2aaa', null]);
    expect(out).toBe('<p>Before</p><div data-type="image-placeholder" id="block-2aaa">Pasted picture</div><p>Middle</p><img src="https://example.com/x.png"><p>After</p>');
    expect(shown).toEqual({ 'block-2aaa': { width: '192px', alt: 'Logo' } });
  });

  it("takes the place of Word's whole paragraph around a picture, spans and all; one sharing a line goes after it", () => {
    const word = '<p class="MsoNormal"><span style="mso-no-proof:yes"><img width="20" src="file:///a.png"></span><o:p></o:p></p><p class="MsoNormal">Logo <img src="file:///b.png"> here</p>';
    const { html } = withPicturePlaceholders(word, ['block-2aaa', 'block-2bbb']);
    expect(html).toBe('<div data-type="image-placeholder" id="block-2aaa">Pasted picture</div><p class="MsoNormal">Logo  here</p><div data-type="image-placeholder" id="block-2bbb">Pasted picture</div>');
  });

  it("skips a floating picture's fallback copy and picture bullets, and reads raw binary data", () => {
    const floating = `{\\shp{\\*\\shpinst${shppict('pngblip', '89504e47')}}{\\shprslt{\\pict\\wmetafile8 0100}}}`;
    const bullet = `{\\*\\listpicture{\\pict\\pngblip\\bliptag1 89504e47}}`;
    const binary = '{\\pict\\jpegblip\\bliptag2\\bin4 \xff{}\xe0}';
    const pictures = picturesFromRtf(`{\\rtf1 ${bullet} ${floating} ${binary}}`);
    expect(pictures.map((p) => p && p.type)).toEqual(['image/png', 'image/jpeg']);
    expect([...pictures[1].bytes]).toEqual([0xff, 0x7b, 0x7d, 0xe0]);
  });

  // As Word for Windows puts it on the clipboard (cut down): each picture is in the HTML itself, after
  // a VML copy (in a conditional comment) that points at a file
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  const wordParagraph = (src, width) => `<p class=MsoNormal style='mso-margin-top-alt:auto;line-height:normal;mso-outline-level:3'><b style='mso-bidi-font-weight:normal'><span
style='font-size:12.0pt;font-family:"Segoe UI Symbol",sans-serif;mso-no-proof:yes'><!--[if gte vml 1]><v:shape id="Picture_x0020_1" type="#_x0000_t75"
 style='width:333.75pt;height:63pt;visibility:visible'>
 <v:imagedata src="file:///C:/Users/someone/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png" o:title=""/>
</v:shape><![endif]--><![if !vml]><img width=${width} height=84
src="${src}"
v:shapes="Picture_x0020_1"><![endif]></span></b><b><span style='font-size:12.0pt'><o:p></o:p></span></b></p>`;
  const wordHtml = (pictures) => `<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><body lang=EN-GB>
<!--StartFragment--><p class=MsoNormal><span style='font-size:12.0pt'>Before<o:p></o:p></span></p>
${pictures.join('\n<p class=MsoNormal><span>Between<o:p></o:p></span></p>\n')}
<p class=MsoNormal><span>After<o:p></o:p></span></p><!--EndFragment--></body></html>`;

  it('reads the pictures Word puts in its HTML itself, in order', () => {
    const html = wordHtml([wordParagraph(`data:image/png;base64,${PNG}`, 445), wordParagraph(`data:image/jpeg;base64,/9j/4A==`, 701)]);
    const pictures = picturesFromPaste(html, '');
    expect(pictures.map((p) => p && p.type)).toEqual(['image/png', 'image/jpeg']);
    expect([...pictures[0].bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(pictures[1].extension).toBe('jpg');
    expect([...pictures[1].bytes]).toEqual([0xff, 0xd8, 0xff, 0xe0]);

    const { html: out, shown } = withPicturePlaceholders(html, ['block-2aaa', 'block-2bbb']);
    const doc = new DOMParser().parseFromString(out, 'text/html');
    expect([...doc.body.children].map((el) => el.getAttribute('id') || el.textContent.trim())).toEqual(['Before', 'block-2aaa', 'Between', 'block-2bbb', 'After']);
    expect(doc.querySelectorAll('img')).toHaveLength(0);
    expect(doc.querySelector('#block-2aaa').textContent).toBe(PLACEHOLDER_TEXT);
    expect(shown['block-2aaa'].width).toBe('445px');
    expect(shown['block-2bbb'].width).toBe('701px');
  });

  it("leaves a place for an embedded picture it can't read, and lines up file pictures with the RTF", () => {
    const html = `<p><img src="data:image/x-wmf;base64,AQAJAA=="></p><p><img src="file:///a.png"></p><p><img src="data:image/png;base64,${PNG}"></p>`;
    const rtf = `{\\rtf1 ${shppict('jpegblip', 'ffd8ffe0')}}`;
    expect(picturesFromPaste(html, rtf).map((p) => p && p.type)).toEqual([null, 'image/jpeg', 'image/png']);
    // An RTF without one picture for each file picture: those can't be matched up
    expect(picturesFromPaste(html, '{\\rtf1 none}').map((p) => p && p.type)).toEqual([null, null, 'image/png']);
    expect(picturesFromPaste('<p><img src="data:image/png;base64,!!!"></p>', '')).toEqual([null]);
    expect(picturesFromPaste('<p><img src="https://example.com/x.png"></p>', '')).toEqual([]);
  });

  it('lines up file pictures with an RTF that has every picture, those in the HTML too', () => {
    const html = `<p><img src="data:image/png;base64,${PNG}"></p><p><img src="file:///b.png"></p>`;
    const rtf = `{\\rtf1 ${shppict('pngblip', '89504e47')} ${shppict('jpegblip', 'ffd8ffe0')}}`;
    expect(picturesFromPaste(html, rtf).map((p) => p && p.type)).toEqual(['image/png', 'image/jpeg']);
  });

  it('reads other formats, and data: addresses with parameters', () => {
    const html = `<p><img src="data:image/jpg;base64,/9j/4A=="></p><p><img src="data:image/bmp;name=a.bmp;base64,Qk0="></p><p><img src="data:image/svg+xml;base64,PHN2Zz4="></p>`;
    expect(picturesFromPaste(html, '').map((p) => p && p.type)).toEqual(['image/jpeg', 'image/bmp', null]);
  });

  it("keeps a picture the page can show that shares a paragraph with one it can't", () => {
    const { html } = withPicturePlaceholders(`<p><img src="data:image/png;base64,${PNG}"><img src="https://example.com/x.png"></p>`, ['block-2aaa']);
    expect(html).toBe('<p><img src="https://example.com/x.png"></p><div data-type="image-placeholder" id="block-2aaa">Pasted picture</div>');
  });

  it("is only for Office's HTML: a web page's data: icon is left out as before", () => {
    expect(hasOfficePictures(wordHtml([wordParagraph(`data:image/png;base64,${PNG}`, 20)]))).toBe(true);
    expect(hasOfficePictures(`<p class="MsoNormal"><img src=" file:///a.png"></p>`)).toBe(true);
    expect(hasOfficePictures(`<p>Hi <img src="data:image/png;base64,${PNG}"> there</p>`)).toBe(false);
    expect(hasOfficePictures('<p class="MsoNormal"><img src="https://example.com/x.png"></p>')).toBe(false);
  });
});
