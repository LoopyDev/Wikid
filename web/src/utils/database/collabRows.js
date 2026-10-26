import * as Y from 'yjs';

// Reading and writing database rows in their live-editing (Yjs) document.

export const cloneForSeed = (value) => JSON.parse(JSON.stringify(value));

export const hydrateRow = (row) => ({
  ...row,
  data: row?.data && typeof row.data === 'object' ? { ...row.data } : {},
});

export const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const hex = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
};

export const toPlainValue = (value) => {
  if (value instanceof Y.Map) {
    const obj = {};
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

export const getEntryValue = (entry, key) => {
  if (!entry) return undefined;
  if (entry instanceof Y.Map) return entry.get(key);
  return entry[key];
};

export const clearYMap = (map) => {
  if (!map) return;
  map.forEach((_, key) => {
    map.delete(key);
  });
};

export const readCollabOrder = (order) => {
  if (!order) return [];
  const raw = typeof order.toArray === 'function' ? order.toArray() : [];
  return raw.map((id) => String(id)).filter(Boolean);
};

export const ensureCollabRowDataMap = (rowMap) => {
  if (!rowMap) return null;
  const entry = rowMap.get('data');
  if (entry instanceof Y.Map) return entry;
  const dataMap = new Y.Map();
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    Object.entries(entry).forEach(([key, value]) => {
      dataMap.set(key, value);
    });
  }
  rowMap.set('data', dataMap);
  return dataMap;
};
