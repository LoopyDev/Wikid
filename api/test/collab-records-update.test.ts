import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { databaseRecordsUpdate } from '../src/collab/collab-database.util';

// A database coming out of compliance mode: its live document made to match its records

const NAME = '11111111-1111-4111-8111-111111111111';
const COUNT = '22222222-2222-4222-8222-222222222222';
const NOTES = '33333333-3333-4333-8333-333333333333';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// The live document as compliance mode found it: Name and Count, rows A and B
const liveState = () => {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap('fields').set(NAME, new Y.Map<any>([['name', 'Name'], ['type', 'TEXT'], ['options', {}]]));
    doc.getMap('fields').set(COUNT, new Y.Map<any>([['name', 'Count'], ['type', 'NUMBER'], ['options', {}]]));
    doc.getArray('fieldOrder').push([NAME, COUNT]);
    doc.getMap('rows').set(A, new Y.Map<any>([['data', new Y.Map<any>([[NAME, 'Gloves'], [COUNT, 1]])], ['createdBy', NAME]]));
    doc.getMap('rows').set(B, new Y.Map<any>([['data', new Y.Map<any>([[NAME, 'Old row']])]]));
    doc.getArray('rowOrder').push([A, B]);
  });
  return Y.encodeStateAsUpdate(doc);
};
const read = (state: Uint8Array, update: Uint8Array | null) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  if (update) Y.applyUpdate(doc, update);
  return {
    fields: (doc.getArray('fieldOrder').toArray() as string[]).map((id) => (doc.getMap('fields').get(id) as Y.Map<any>).get('name')),
    rows: (doc.getArray('rowOrder').toArray() as string[]).map((id) => ({ id, ...((doc.getMap('rows').get(id) as Y.Map<any>).get('data') as Y.Map<any>).toJSON() })),
    rowIds: [...doc.getMap('rows').keys()].sort(),
    createdBy: (doc.getMap('rows').get(A) as Y.Map<any> | undefined)?.get('createdBy'),
  };
};
const field = (id: string, name: string, type = 'TEXT') => ({ id, name, type, options: {} });

describe("a database's live document made to match its records", () => {
  it('takes their cells, columns, rows and order; drops what they no longer have', () => {
    const state = liveState();
    const update = databaseRecordsUpdate(
      state,
      [field(NAME, 'Name'), field(NOTES, 'Notes'), field(COUNT, 'Count', 'NUMBER')],
      [
        { id: C, data: { [NAME]: 'Masks', [NOTES]: 'Box of 50' } },
        { id: A, data: { [NAME]: 'Gloves', [COUNT]: 2 } },
      ],
    );
    expect(update).not.toBeNull();
    const after = read(state, update);
    expect(after.fields).toEqual(['Name', 'Notes', 'Count']);
    expect(after.rows).toEqual([
      { id: C, [NAME]: 'Masks', [NOTES]: 'Box of 50' },
      { id: A, [NAME]: 'Gloves', [COUNT]: 2 },
    ]);
    // Row B is gone from the records: gone here too
    expect(after.rowIds).toEqual([A, C].sort());
    // Who added a row stays as it was
    expect(after.createdBy).toBe(NAME);
  });

  it('a cell the records no longer have is cleared', () => {
    const state = liveState();
    const after = read(state, databaseRecordsUpdate(state, [field(NAME, 'Name'), field(COUNT, 'Count', 'NUMBER')], [
      { id: A, data: { [NAME]: 'Gloves' } },
      { id: B, data: { [NAME]: 'Old row' } },
    ]));
    expect(after.rows[0]).toEqual({ id: A, [NAME]: 'Gloves' });
  });

  it('nothing when it already matches, or when the document was never filled', () => {
    const state = liveState();
    expect(databaseRecordsUpdate(state, [field(NAME, 'Name'), field(COUNT, 'Count', 'NUMBER')], [
      { id: A, data: { [NAME]: 'Gloves', [COUNT]: 1 } },
      { id: B, data: { [NAME]: 'Old row' } },
    ])).toBeNull();
    expect(databaseRecordsUpdate(Y.encodeStateAsUpdate(new Y.Doc()), [field(NAME, 'Name')], [{ id: A, data: { [NAME]: 'Gloves' } }])).toBeNull();
  });
});
