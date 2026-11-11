import { describe, it, expect } from 'vitest';
import { localImageCount, picturesFromRtf, withPicturePlaceholders } from './officePaste';

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
    expect(localImageCount(html)).toBe(2);
    const { html: out, shown } = withPicturePlaceholders(html, ['block-2aaa', null]);
    expect(out).toBe('<p>Before</p><div data-type="image-placeholder" id="block-2aaa">Picture pasted from Word</div><p>Middle</p><img src="https://example.com/x.png"><p>After</p>');
    expect(shown).toEqual({ 'block-2aaa': { width: '192px', alt: 'Logo' } });
  });

  it("takes the place of Word's whole paragraph around a picture, spans and all; one sharing a line goes after it", () => {
    const word = '<p class="MsoNormal"><span style="mso-no-proof:yes"><img width="20" src="file:///a.png"></span><o:p></o:p></p><p class="MsoNormal">Logo <img src="file:///b.png"> here</p>';
    const { html } = withPicturePlaceholders(word, ['block-2aaa', 'block-2bbb']);
    expect(html).toBe('<div data-type="image-placeholder" id="block-2aaa">Picture pasted from Word</div><p class="MsoNormal">Logo  here</p><div data-type="image-placeholder" id="block-2bbb">Picture pasted from Word</div>');
  });

  it("skips a floating picture's fallback copy and picture bullets, and reads raw binary data", () => {
    const floating = `{\\shp{\\*\\shpinst${shppict('pngblip', '89504e47')}}{\\shprslt{\\pict\\wmetafile8 0100}}}`;
    const bullet = `{\\*\\listpicture{\\pict\\pngblip\\bliptag1 89504e47}}`;
    const binary = '{\\pict\\jpegblip\\bliptag2\\bin4 \xff{}\xe0}';
    const pictures = picturesFromRtf(`{\\rtf1 ${bullet} ${floating} ${binary}}`);
    expect(pictures.map((p) => p && p.type)).toEqual(['image/png', 'image/jpeg']);
    expect([...pictures[1].bytes]).toEqual([0xff, 0x7b, 0x7d, 0xe0]);
  });
});
