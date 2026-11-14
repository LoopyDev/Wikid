import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyCollabColumnChange } from '../src/collab/collab-database.util';

// A column changed through the API, into the live document: each row's cells as worked out from the
// database, except a row whose cells changed in the live document meanwhile

const FIELD = '11111111-1111-4111-8111-111111111111';

const liveDocument = (cells: Record<string, string>) => {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap('fields').set(FIELD, new Y.Map<any>([['name', 'Status'], ['type', 'SELECT'], ['options', { choices: [{ value: 'Old' }, { value: 'Other' }] }]]));
    doc.getArray('fieldOrder').push([FIELD]);
    for (const [rowId, value] of Object.entries(cells)) {
      doc.getMap('rows').set(rowId, new Y.Map<any>([['data', new Y.Map<any>([[FIELD, value]])]]));
      doc.getArray('rowOrder').push([rowId]);
    }
  });
  return doc;
};

describe('a choice renamed through the API, in the live document', () => {
  it('renames the cells still holding the old choice, and leaves one picked meanwhile', () => {
    const doc = liveDocument({ r1: 'Old', r2: 'Other' });
    // Worked out from the database, where both rows held "Old": r2 has since been picked again here
    const change = { id: FIELD, name: 'Status', type: 'SELECT', options: { choices: [{ value: 'New' }, { value: 'Other' }] } };
    applyCollabColumnChange(doc, change, [
      { rowId: 'r1', values: { [FIELD]: 'New' }, was: { [FIELD]: ['Old', null] } },
      { rowId: 'r2', values: { [FIELD]: 'New' }, was: { [FIELD]: ['Old', null] } },
    ]);
    const cell = (rowId: string) => ((doc.getMap('rows').get(rowId) as Y.Map<any>).get('data') as Y.Map<any>).get(FIELD);
    expect(cell('r1')).toBe('New');
    expect(cell('r2')).toBe('Other');
  });

  it("takes a cell's value in either form the database may keep it in (in the cell, or kept beside it)", () => {
    // The database moved a value that didn't fit beside the cell; the live document has it in the cell
    const doc = liveDocument({ r1: 'Gone' });
    const change = { id: FIELD, name: 'Status', type: 'SELECT', options: { choices: [{ value: 'Back' }] } };
    applyCollabColumnChange(doc, change, [{ rowId: 'r1', values: { [FIELD]: 'Back' }, was: { [FIELD]: [null, 'Gone'] } }]);
    expect(((doc.getMap('rows').get('r1') as Y.Map<any>).get('data') as Y.Map<any>).get(FIELD)).toBe('Back');
  });
});
