import { describe, it, expect } from 'vitest';
import { changesStyle, compareVersions } from './versionChanges';

const p = (id, text) => ({ type: 'paragraph', attrs: { id }, content: text ? [{ type: 'text', text }] : [] });
const item = (id, paragraphId, text) => ({ type: 'listItem', attrs: { id }, content: [p(paragraphId, text)] });
const list = (id, ...items) => ({ type: 'bulletList', attrs: { id }, content: items });
const doc = (...content) => ({ type: 'doc', content });
const texts = (node) => (node.content || []).map((child) => child.content?.map((c) => c.text ?? texts(c)).join('') ?? '');
const ids = (set) => [...set].sort();

describe('compareVersions', () => {
  it('finds nothing between the same version', () => {
    const v = doc(p('a', 'One'), list('l', item('i1', 'p1', 'Milk')));
    const result = compareVersions(v, structuredClone(v));
    expect([result.added.size, result.changed.size, result.removed.size]).toEqual([0, 0, 0]);
    expect(result.doc).toEqual(v);
  });

  it('marks added, changed and removed blocks', () => {
    const older = doc(p('a', 'Intro'), p('b', 'Old line'), p('c', 'Kept'));
    const newer = doc(p('a', 'Intro, edited'), p('c', 'Kept'), p('d', 'New line'));
    const { added, changed, removed, doc: shown } = compareVersions(older, newer);
    expect(ids(added)).toEqual(['d']);
    expect(ids(changed)).toEqual(['a']);
    expect(ids(removed)).toEqual(['b']);
    // The removed line is shown where it was
    expect(texts(shown)).toEqual(['Intro, edited', 'Old line', 'Kept', 'New line']);
  });

  it('marks the one item edited in a list, not the whole list', () => {
    const older = doc(list('l', item('i1', 'p1', 'Milk'), item('i2', 'p2', 'Eggs')));
    const newer = doc(list('l', item('i1', 'p1', 'Milk'), item('i2', 'p2', 'Eggs (a dozen)'), item('i3', 'p3', 'Bread')));
    const { added, changed, removed } = compareVersions(older, newer);
    expect(ids(changed)).toEqual(['p2']);
    expect(ids(added)).toEqual(['i3', 'p3']);
    expect(removed.size).toBe(0);
  });

  it('puts a removed list item back in its list, and a removed list back whole', () => {
    const older = doc(p('a', 'Shopping'), list('l', item('i1', 'p1', 'Milk'), item('i2', 'p2', 'Eggs')), list('m', item('j1', 'q1', 'Gone')));
    const newer = doc(p('a', 'Shopping'), list('l', item('i2', 'p2', 'Eggs')));
    const { removed, doc: shown } = compareVersions(older, newer);
    expect(ids(removed)).toEqual(['i1', 'j1', 'm', 'p1', 'q1']);
    expect(shown.content.map((node) => node.attrs.id)).toEqual(['a', 'l', 'm']);
    expect(shown.content[1].content.map((node) => node.attrs.id)).toEqual(['i1', 'i2']);
    expect(shown.content[2].content[0].content[0].content[0].text).toBe('Gone');
  });

  it("doesn't change the versions it's given", () => {
    const older = doc(p('a', 'One'), p('b', 'Two'));
    const newer = doc(p('a', 'One'));
    compareVersions(older, newer);
    expect(newer).toEqual(doc(p('a', 'One')));
  });

  it('notices a change of attributes, such as a ticked task', () => {
    const task = (checked) => ({ type: 'taskList', attrs: { id: 't' }, content: [{ type: 'taskItem', attrs: { id: 'ti', checked }, content: [p('tp', 'Call')] }] });
    expect(ids(compareVersions(doc(task(false)), doc(task(true))).changed)).toEqual(['ti']);
  });
});

describe('changesStyle', () => {
  it('marks each block by its id, inside the scope', () => {
    const css = changesStyle('.preview', { added: new Set(['a']), changed: new Set(), removed: new Set(['b"x']) });
    expect(css).toContain('.preview [data-block-id="a"]');
    expect(css).toContain('var(--history-added)');
    expect(css).toContain('line-through');
    expect(css).not.toContain('--history-changed');
    expect(css).toContain('[data-block-id="b\\"x"]');
  });
});

describe('compareVersions with versions held by Vue', () => {
  it('works on reactive versions', async () => {
    const { reactive } = await import('vue');
    const older = reactive(doc(p('a', 'One'), p('b', 'Two')));
    const newer = reactive(doc(p('a', 'One!')));
    const result = compareVersions(older, newer);
    expect(ids(result.changed)).toEqual(['a']);
    expect(ids(result.removed)).toEqual(['b']);
  });
});

describe('compareVersions between the live editor and the API', () => {
  it("doesn't count settings left at their defaults as a change", () => {
    const fromApi = doc(p('a', 'One'), { type: 'heading', attrs: { id: 'h', level: 2 }, content: [{ type: 'text', text: 'Title' }] });
    const fromEditor = doc(
      { ...p('a', 'One'), attrs: { id: 'a', indent: 0, syncedFrom: null } },
      { type: 'heading', attrs: { id: 'h', level: 2, syncedFrom: null }, content: [{ type: 'text', text: 'Title' }] },
    );
    expect(compareVersions(fromApi, fromEditor).changed.size).toBe(0);
    // A setting that is set still counts
    expect(ids(compareVersions(fromApi, doc({ ...p('a', 'One'), attrs: { id: 'a', indent: 1 } })).changed)).toEqual(['a']);
  });

  it("doesn't mark an empty paragraph coming or going", () => {
    const result = compareVersions(doc(p('a', 'One'), p('e1')), doc(p('a', 'One'), p('e2')));
    expect([result.added.size, result.removed.size]).toEqual([0, 0]);
    expect(texts(result.doc)).toEqual(['One', '']);
  });
});

describe('outermost', () => {
  it('keeps a new list item and leaves out its paragraph', async () => {
    const { outermost } = await import('./versionChanges');
    const v = doc(list('l', item('i1', 'p1', 'Milk')), p('a', 'Other'));
    expect(ids(outermost(new Set(['i1', 'p1', 'a']), v))).toEqual(['a', 'i1']);
  });
});
