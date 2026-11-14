import * as Y from 'yjs';
import type { DatabaseFieldType } from '@prisma/client';
import { isUuid } from '../utils/uuid.util';
import { encodeCollabState } from './collab-doc.util';

export type CollabDatabaseField = {
  id: string;
  name: string;
  type: DatabaseFieldType;
  options: Record<string, any>;
};

export type CollabDatabaseRow = {
  id: string;
  data: Record<string, any>;
  pageId?: string;
  // Who added the row, as the live document has it (stamped by the browser that added it)
  createdBy?: string;
};

export type CollabDatabaseState = {
  fields: CollabDatabaseField[];
  rows: CollabDatabaseRow[];
};

// Every field type, checked against Prisma's when compiled (a value import would need the generated
// client wherever this is loaded, its unit tests too)
const FIELD_TYPES = {
  TEXT: true,
  NUMBER: true,
  DATE: true,
  CHECKBOX: true,
  SELECT: true,
  MULTI_SELECT: true,
  URL: true,
  RELATION: true,
  LINKED_FROM: true,
  PERSON: true,
} satisfies Record<DatabaseFieldType, true>;
const VALID_FIELD_TYPES = new Set<string>(Object.keys(FIELD_TYPES));


const toPlainValue = (value: any): any => {
  if (value instanceof Y.Map) {
    const obj: Record<string, any> = {};
    value.forEach((item, key) => {
      obj[key] = toPlainValue(item);
    });
    return obj;
  }
  if (value instanceof Y.Array) {
    return value.toArray().map((item) => toPlainValue(item));
  }
  return value;
};

const readOrder = (order?: Y.Array<any>) => {
  if (!order) return [];
  return order.toArray().map((id) => String(id)).filter(Boolean);
};

const getEntryValue = (entry: any, key: string) => {
  if (!entry) return undefined;
  if (entry instanceof Y.Map) return entry.get(key);
  return entry[key];
};

const parseField = (id: string, entry: any): CollabDatabaseField | null => {
  if (!isUuid(id)) return null;
  if (!entry) return null;
  const rawName = getEntryValue(entry, 'name');
  const rawType = getEntryValue(entry, 'type');
  const rawOptions = getEntryValue(entry, 'options');
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  const type = (VALID_FIELD_TYPES.has(rawType) ? rawType : 'TEXT') as DatabaseFieldType;
  const options = toPlainValue(rawOptions);
  return {
    id,
    name,
    type,
    options: options && typeof options === 'object' && !Array.isArray(options) ? options : {},
  };
};

const parseRow = (id: string, entry: any): CollabDatabaseRow | null => {
  if (!isUuid(id)) return null;
  if (!entry) return null;
  const rawData = getEntryValue(entry, 'data');
  const rawPageId = getEntryValue(entry, 'pageId');
  let data: Record<string, any> = {};
  if (rawData instanceof Y.Map) {
    rawData.forEach((value: any, key: string) => {
      data[key] = toPlainValue(value);
    });
  } else {
    const plain = toPlainValue(rawData);
    if (plain && typeof plain === 'object' && !Array.isArray(plain)) {
      data = { ...plain };
    }
  }
  const pageId = typeof rawPageId === 'string' && isUuid(rawPageId) ? rawPageId : undefined;
  const rawCreatedBy = getEntryValue(entry, 'createdBy');
  const createdBy = typeof rawCreatedBy === 'string' && isUuid(rawCreatedBy) ? rawCreatedBy : undefined;
  return { id, data, pageId, ...(createdBy ? { createdBy } : {}) };
};

const databaseStateFromDoc = (doc: Y.Doc): CollabDatabaseState => {
  const fieldsMap = doc.getMap('fields');
  const rowsMap = doc.getMap('rows');
  const fieldOrder = doc.getArray('fieldOrder');
  const rowOrder = doc.getArray('rowOrder');

  const fields: CollabDatabaseField[] = [];
  const rows: CollabDatabaseRow[] = [];
  const seenFields = new Set<string>();
  const seenRows = new Set<string>();

  readOrder(fieldOrder).forEach((id) => {
    const field = parseField(id, fieldsMap.get(id));
    if (!field) return;
    seenFields.add(id);
    fields.push(field);
  });
  fieldsMap.forEach((value: any, id: string) => {
    if (seenFields.has(id)) return;
    const field = parseField(String(id), value);
    if (field) fields.push(field);
  });

  readOrder(rowOrder).forEach((id) => {
    const row = parseRow(id, rowsMap.get(id));
    if (!row) return;
    seenRows.add(id);
    rows.push(row);
  });
  rowsMap.forEach((value: any, id: string) => {
    if (seenRows.has(id)) return;
    const row = parseRow(String(id), value);
    if (row) rows.push(row);
  });

  return { fields, rows };
};

export const databaseStateFromYjsState = (state: Uint8Array): CollabDatabaseState => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  return databaseStateFromDoc(doc);
};

const normalizeRowData = (value: any) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
};

const valuesEqual = (left: any, right: any) => {
  const leftPlain = toPlainValue(left);
  const rightPlain = toPlainValue(right);
  if (Array.isArray(leftPlain) || Array.isArray(rightPlain)) {
    if (!Array.isArray(leftPlain) || !Array.isArray(rightPlain)) return false;
    if (leftPlain.length !== rightPlain.length) return false;
    for (let idx = 0; idx < leftPlain.length; idx += 1) {
      if (leftPlain[idx] !== rightPlain[idx]) return false;
    }
    return true;
  }
  if (leftPlain && rightPlain && typeof leftPlain === 'object' && typeof rightPlain === 'object') {
    try {
      return JSON.stringify(leftPlain) === JSON.stringify(rightPlain);
    } catch (err) {
      return false;
    }
  }
  return leftPlain === rightPlain;
};

// `values`: only these cells changed (the API's `cells`: to set, null to clear), so an edit made
// meanwhile in the live document to another cell stays; a row the document hasn't got yet goes in
// whole (`data`). The collab server has a copy (applyRowUpdate).
export const updateCollabDatabaseRowState = (
  state: Uint8Array,
  row: { id: string; data?: Record<string, any> | null; pageId?: string | null; createdBy?: string | null },
  values?: Record<string, unknown> | null
) => {
  if (!row?.id) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  const rowsMap = doc.getMap('rows');
  const rowOrder = doc.getArray('rowOrder');
  const storedRow = rowsMap.get(row.id);
  const storedCells = storedRow instanceof Y.Map ? storedRow.get('data') : null;
  if (values && storedRow instanceof Y.Map && storedCells instanceof Y.Map) {
    let changed = false;
    doc.transact(() => {
      changed = applyCells(storedCells, values);
      if (row.pageId && storedRow.get('pageId') !== row.pageId) {
        storedRow.set('pageId', row.pageId);
        changed = true;
      }
    }, 'db-row-server');
    return changed ? encodeCollabState(doc) : null;
  }
  let rowMap: Y.Map<any>;
  if (storedRow instanceof Y.Map) {
    rowMap = storedRow;
  } else {
    rowMap = new Y.Map();
    if (storedRow && typeof storedRow === 'object' && !Array.isArray(storedRow)) {
      Object.entries(storedRow).forEach(([key, value]) => {
        rowMap.set(key, value);
      });
    }
    rowsMap.set(row.id, rowMap);
  }
  const storedData = rowMap.get('data');
  let dataMap: Y.Map<any>;
  if (storedData instanceof Y.Map) {
    dataMap = storedData;
  } else {
    dataMap = new Y.Map();
    if (storedData && typeof storedData === 'object' && !Array.isArray(storedData)) {
      Object.entries(storedData).forEach(([key, value]) => {
        dataMap.set(key, value);
      });
    }
    rowMap.set('data', dataMap);
  }
  const nextData = normalizeRowData(row.data);
  const nextKeys = new Set(Object.keys(nextData));
  const existingKeys = new Set<string>();
  dataMap.forEach((_value, key) => {
    existingKeys.add(String(key));
  });
  const order = rowOrder.toArray().map((id) => String(id));
  const nextPageId = row.pageId || null;
  let changed = false;
  existingKeys.forEach((key) => {
    if (!nextKeys.has(key)) {
      changed = true;
    }
  });
  if (!changed) {
    for (const [key, value] of Object.entries(nextData)) {
      if (!valuesEqual(dataMap.get(key), value)) {
        changed = true;
        break;
      }
    }
  }
  const currentPageId = rowMap.get('pageId');
  if (!changed && (currentPageId || nextPageId) && currentPageId !== nextPageId) {
    changed = true;
  }
  if (!changed && !order.includes(row.id)) {
    changed = true;
  }
  // Who added it, once: never changed after
  const nextCreatedBy = row.createdBy && isUuid(row.createdBy) && !rowMap.get('createdBy') ? row.createdBy : null;
  if (nextCreatedBy) changed = true;
  if (!changed) return null;
  doc.transact(() => {
    if (nextCreatedBy) rowMap.set('createdBy', nextCreatedBy);
    existingKeys.forEach((key) => {
      if (!nextKeys.has(key)) {
        dataMap.delete(key);
      }
    });
    Object.entries(nextData).forEach(([key, value]) => {
      dataMap.set(key, value);
    });
    if (nextPageId) {
      rowMap.set('pageId', nextPageId);
    } else {
      rowMap.delete('pageId');
    }
    if (!order.includes(row.id)) {
      rowOrder.push([row.id]);
    }
  }, 'db-row-server');
  return encodeCollabState(doc);
};

// Cells to set, null to clear, into a row's data; whether anything changed
const applyCells = (data: Y.Map<any>, values: Record<string, unknown>) => {
  let changed = false;
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) {
      if (!data.has(key)) continue;
      data.delete(key);
    } else {
      if (valuesEqual(data.get(key), value)) continue;
      data.set(key, value);
    }
    changed = true;
  }
  return changed;
};

export const deleteCollabDatabaseRowState = (state: Uint8Array, rowId: string) => {
  if (!rowId) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  const rowsMap = doc.getMap('rows');
  const rowOrder = doc.getArray('rowOrder');
  const hasRow = rowsMap.has(rowId);
  const order = rowOrder.toArray().map((id) => String(id));
  const indices = order
    .map((id, index) => (id === rowId ? index : -1))
    .filter((index) => index >= 0);
  if (!hasRow && !indices.length) return null;
  doc.transact(() => {
    if (hasRow) {
      rowsMap.delete(rowId);
    }
    for (let idx = indices.length - 1; idx >= 0; idx -= 1) {
      rowOrder.delete(indices[idx], 1);
    }
  }, 'db-row-delete-server');
  return encodeCollabState(doc);
};

// A field (column) changed through the API, into the live document, so the next save from it
// doesn't undo the change: a field missing from it would be deleted, and an edit put back.
// Only into a document that's been filled in: an empty one is filled from the database when
// first opened, and one holding just this field would make that save delete everything else.
export type CollabFieldChange = { id: string; name: string; type: string; options: Record<string, any> };

export const updateCollabDatabaseFieldState = (state: Uint8Array, field: CollabFieldChange) => {
  if (!field?.id) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  return applyCollabFieldChange(doc, field) ? encodeCollabState(doc) : null;
};

export const deleteCollabDatabaseFieldState = (state: Uint8Array, fieldId: string) => {
  if (!fieldId) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  return applyCollabFieldDelete(doc, fieldId) ? encodeCollabState(doc) : null;
};

// The changes themselves, on a document (the collab server has a copy, for documents it has open)
export const applyCollabFieldChange = (doc: Y.Doc, field: CollabFieldChange) => {
  const fieldsMap = doc.getMap('fields');
  const fieldOrder = doc.getArray('fieldOrder');
  if (!fieldsMap.size) return false;
  const stored = fieldsMap.get(field.id);
  const order = fieldOrder.toArray().map((id) => String(id));
  const options = field.options && typeof field.options === 'object' && !Array.isArray(field.options) ? field.options : {};
  const same =
    stored instanceof Y.Map &&
    stored.get('name') === field.name &&
    stored.get('type') === field.type &&
    valuesEqual(stored.get('options'), options) &&
    order.includes(field.id);
  if (same) return false;
  doc.transact(() => {
    const fieldMap: Y.Map<any> = stored instanceof Y.Map ? (stored as Y.Map<any>) : new Y.Map<any>();
    if (fieldMap.get('name') !== field.name) fieldMap.set('name', field.name);
    if (fieldMap.get('type') !== field.type) fieldMap.set('type', field.type);
    if (!valuesEqual(fieldMap.get('options'), options)) fieldMap.set('options', options);
    if (!(stored instanceof Y.Map)) fieldsMap.set(field.id, fieldMap);
    if (!order.includes(field.id)) fieldOrder.push([field.id]);
  }, 'db-field-server');
  return true;
};

export const applyCollabFieldDelete = (doc: Y.Doc, fieldId: string) => {
  const fieldsMap = doc.getMap('fields');
  const fieldOrder = doc.getArray('fieldOrder');
  const order = fieldOrder.toArray().map((id) => String(id));
  if (!fieldsMap.has(fieldId) && !order.includes(fieldId)) return false;
  doc.transact(() => {
    fieldsMap.delete(fieldId);
    for (let index = order.length - 1; index >= 0; index -= 1) {
      if (order[index] === fieldId) fieldOrder.delete(index, 1);
    }
  }, 'db-field-delete-server');
  return true;
};

// A column changed through the API with its cells (a type change, or choices renamed or removed):
// the column and each row's cells in one change, so no one sees the column changed and its cells
// not yet. values: per row, the cells to set, null to clear; was: per cell, what it may hold for the
// change to apply (what it was worked out from, in any form the database keeps it), so a row whose
// cell changed here meanwhile (a choice picked while it was renamed) is left as it is now. Rows not
// in the document are left out (it is filled from the database when first opened). The collab
// server has a copy.
export type CollabCellChange = { rowId: string; values: Record<string, unknown>; was?: Record<string, unknown[]> };

export const updateCollabColumnChangeState = (state: Uint8Array, field: CollabFieldChange, cells: CollabCellChange[]) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  return applyCollabColumnChange(doc, field, cells) ? encodeCollabState(doc) : null;
};

export const applyCollabColumnChange = (doc: Y.Doc, field: CollabFieldChange, cells: CollabCellChange[]) => {
  if (!doc.getMap('fields').size) return false;
  let changed = false;
  doc.transact(() => {
    changed = applyCollabFieldChange(doc, field);
    const rowsMap = doc.getMap('rows');
    for (const cell of cells) {
      const row = rowsMap.get(cell.rowId);
      const data = row instanceof Y.Map ? row.get('data') : null;
      if (!(data instanceof Y.Map)) continue;
      if (cell.was && Object.entries(cell.was).some(([key, forms]) => !forms.some((form) => valuesEqual(data.get(key) ?? null, form ?? null)))) continue;
      if (applyCells(data, cell.values)) changed = true;
    }
  }, 'db-column-server');
  return changed;
};
