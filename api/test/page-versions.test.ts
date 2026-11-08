import { describe, expect, it } from 'vitest';
import { VERSION_IDLE_MS, VERSION_MAX_MS, planVersion, sameContent, type LatestVersion } from '../src/collab/page-versions.util';

const MINUTE = 60 * 1000;
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 8, 9, 0) + minutes * MINUTE);
const doc = (...texts: string[]) => ({ type: 'doc', content: texts.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) });
const ALICE = '00000000-0000-4000-8000-000000000001';
const BOB = '00000000-0000-4000-8000-000000000002';

const version = (overrides: Partial<LatestVersion> = {}): LatestVersion => ({
  id: 'v1',
  title: 'Notes',
  content: doc('Hello'),
  editorIds: [ALICE],
  createdAt: at(0),
  updatedAt: at(0),
  ...overrides,
});

describe('page history: what a save does', () => {
  it("starts the page's first version", () => {
    const plan = planVersion(null, { title: 'Notes', content: doc('Hello'), editorIds: [ALICE] }, at(0));
    expect(plan).toMatchObject({ kind: 'create', data: { title: 'Notes', editorIds: [ALICE] } });
  });

  it("notes nothing for a new page that's still blank", () => {
    expect(planVersion(null, { title: '', content: { type: 'doc', content: [{ type: 'paragraph' }] }, editorIds: [ALICE] }, at(0)).kind).toBe('skip');
  });

  it('adds to the newest version while editing carries on, crediting everyone who edited', () => {
    const plan = planVersion(version({ updatedAt: at(3) }), { title: 'Notes', content: doc('Hello there'), editorIds: [BOB] }, at(6));
    expect(plan).toMatchObject({ kind: 'update', id: 'v1', data: { editorIds: [ALICE, BOB], updatedAt: at(6) } });
  });

  it(`starts a new version after ${VERSION_IDLE_MS / MINUTE} minutes without changes`, () => {
    const latest = version({ updatedAt: at(10) });
    expect(planVersion(latest, { title: 'Notes', content: doc('Later'), editorIds: [ALICE] }, at(14.9)).kind).toBe('update');
    expect(planVersion(latest, { title: 'Notes', content: doc('Later'), editorIds: [ALICE] }, at(15)).kind).toBe('create');
  });

  it(`starts a new version once one has covered ${VERSION_MAX_MS / MINUTE} minutes of steady editing`, () => {
    const latest = version({ createdAt: at(0), updatedAt: at(29) });
    expect(planVersion(latest, { title: 'Notes', content: doc('More'), editorIds: [ALICE] }, at(29.9)).kind).toBe('update');
    const plan = planVersion(latest, { title: 'Notes', content: doc('More'), editorIds: [BOB] }, at(30));
    // A new version credits only who edited in it
    expect(plan).toMatchObject({ kind: 'create', data: { editorIds: [BOB], createdAt: at(30) } });
  });

  it('notes nothing when saved again unchanged, so a quiet page keeps its versions apart', () => {
    expect(planVersion(version(), { title: 'Notes', content: doc('Hello'), editorIds: [BOB] }, at(1)).kind).toBe('skip');
    expect(planVersion(version(), { title: 'Notes', content: doc('Hello'), editorIds: [] }, at(60)).kind).toBe('skip');
  });

  it('notes a rename', () => {
    expect(planVersion(version(), { title: 'Meeting notes', content: doc('Hello'), editorIds: [ALICE] }, at(1)).kind).toBe('update');
  });
});

describe('sameContent', () => {
  it('ignores the order of keys, which Postgres changes', () => {
    expect(sameContent({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'a', indent: 0 } }] }, { content: [{ attrs: { indent: 0, id: 'a' }, type: 'paragraph' }], type: 'doc' })).toBe(true);
    expect(sameContent(doc('a'), doc('b'))).toBe(false);
  });
});
