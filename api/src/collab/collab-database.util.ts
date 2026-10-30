import * as Y from 'yjs';
import { DatabaseFieldType } from '@prisma/client';
import { isUuid } from '../utils/uuid.util';

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

const VALID_FIELD_TYPES = new Set(Object.values(DatabaseFieldType));


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
  const type = VALID_FIELD_TYPES.has(rawType) ? rawType : DatabaseFieldType.TEXT;
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

export const databaseStateFromYjsState = (state: Buffer): CollabDatabaseState => {
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

export const updateCollabDatabaseRowState = (
  state: Buffer,
  row: { id: string; data?: Record<string, any> | null; pageId?: string | null; createdBy?: string | null }
) => {
  if (!row?.id) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  const rowsMap = doc.getMap('rows');
  const rowOrder = doc.getArray('rowOrder');
  const storedRow = rowsMap.get(row.id);
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
  return Buffer.from(Y.encodeStateAsUpdate(doc));
};

export const deleteCollabDatabaseRowState = (state: Buffer, rowId: string) => {
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
  return Buffer.from(Y.encodeStateAsUpdate(doc));
};
