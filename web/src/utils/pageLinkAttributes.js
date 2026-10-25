import * as Y from 'yjs';

// Page links can show attributes of the linked page from its database row. These helpers read
// the database fields and rows, including from its live-editing (Yjs) data.

export const pageLinkBuiltinAttributes = [
  { id: 'builtin:createdAt', label: 'Created' },
  { id: 'builtin:updatedAt', label: 'Last modified' },
  { id: 'builtin:kind', label: 'Page type' },
  { id: 'builtin:visibility', label: 'Visibility' },
];

export const parsePageLinkAttribute = (value) => {
  if (typeof value !== 'string') return { kind: '', key: '' };
  const trimmed = value.trim();
  if (!trimmed) return { kind: '', key: '' };
  if (trimmed.startsWith('builtin:')) return { kind: 'builtin', key: trimmed.slice(8) };
  if (trimmed.startsWith('field:')) return { kind: 'field', key: trimmed.slice(6) };
  return { kind: '', key: '' };
};

export const normalizePageLinkFieldOptions = (field) => {
  const options = field?.options && typeof field.options === 'object' && !Array.isArray(field.options) ? field.options : {};
  const rawChoices = Array.isArray(options.choices) ? options.choices : [];
  const choices = rawChoices
    .map((choice) => {
      if (typeof choice === 'string') {
        const value = choice.trim();
        return value ? { value, color: null } : null;
      }
      if (choice && typeof choice === 'object') {
        const value = typeof choice.value === 'string' ? choice.value.trim() : '';
        if (!value) return null;
        const label = typeof choice.label === 'string' ? choice.label.trim() : '';
        const color = typeof choice.color === 'string' && choice.color.trim() ? choice.color.trim() : null;
        return { value, label: label || null, color };
      }
      return null;
    })
    .filter(Boolean);
  return { ...options, choices };
};

export const getPageLinkFieldSource = (field) => normalizePageLinkFieldOptions(field).source || null;

export const resolvePageLinkRow = (rows, pageId) => {
  if (!Array.isArray(rows) || !pageId) return null;
  return rows.find((row) => row?.pageId === pageId || row?.data?.__pageId === pageId) || null;
};

export const pageLinkToPlainValue = (value) => {
  if (value instanceof Y.Map) {
    const obj = {};
    value.forEach((item, key) => {
      obj[key] = pageLinkToPlainValue(item);
    });
    return obj;
  }
  if (value instanceof Y.Array) {
    return value.toArray().map((item) => pageLinkToPlainValue(item));
  }
  return value;
};

export const pageLinkGetEntryValue = (entry, key) => {
  if (!entry) return undefined;
  if (entry instanceof Y.Map) return entry.get(key);
  return entry[key];
};

export const readPageLinkCollabOrder = (order) => {
  if (!order) return [];
  const raw = typeof order.toArray === 'function' ? order.toArray() : [];
  return raw.map((id) => String(id)).filter(Boolean);
};

export const buildPageLinkFieldsFromCollab = (fieldsMap, fieldOrder) => {
  if (!fieldsMap) return [];
  const order = readPageLinkCollabOrder(fieldOrder);
  const seen = new Set();
  const result = [];
  const pushField = (id) => {
    if (!id || seen.has(id)) return;
    const entry = fieldsMap.get(id);
    if (!entry) return;
    const name = String(pageLinkGetEntryValue(entry, 'name') ?? '');
    const type = String(pageLinkGetEntryValue(entry, 'type') || 'TEXT');
    const rawOptions = pageLinkToPlainValue(pageLinkGetEntryValue(entry, 'options'));
    const options =
      rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions) ? rawOptions : {};
    result.push({ id, name, type, options: normalizePageLinkFieldOptions({ options }) });
    seen.add(id);
  };
  order.forEach((id) => pushField(id));
  fieldsMap.forEach((_, id) => {
    if (!seen.has(id)) pushField(String(id));
  });
  return result;
};

export const buildPageLinkRowsFromCollab = (rowsMap, rowOrder) => {
  if (!rowsMap) return [];
  const order = readPageLinkCollabOrder(rowOrder);
  const seen = new Set();
  const result = [];
  const pushRow = (id) => {
    if (!id || seen.has(id)) return;
    const entry = rowsMap.get(id);
    if (!entry) return;
    const rawData = pageLinkGetEntryValue(entry, 'data');
    const rawPageId = pageLinkGetEntryValue(entry, 'pageId');
    let data = {};
    if (rawData instanceof Y.Map) {
      rawData.forEach((value, key) => {
        data[key] = pageLinkToPlainValue(value);
      });
    } else {
      const plain = pageLinkToPlainValue(rawData);
      if (plain && typeof plain === 'object' && !Array.isArray(plain)) {
        data = { ...plain };
      }
    }
    const pageId = typeof rawPageId === 'string' ? rawPageId : null;
    result.push({ id, data, pageId });
    seen.add(id);
  };
  order.forEach((id) => pushRow(id));
  rowsMap.forEach((_, id) => {
    if (!seen.has(id)) pushRow(String(id));
  });
  return result;
};

export const isPageLinkCollabEmpty = (state) => {
  if (!state) return true;
  const hasFields = state.fieldsMap && state.fieldsMap.size > 0;
  const hasRows = state.rowsMap && state.rowsMap.size > 0;
  const hasFieldOrder = state.fieldOrder && state.fieldOrder.length > 0;
  const hasRowOrder = state.rowOrder && state.rowOrder.length > 0;
  return !hasFields && !hasRows && !hasFieldOrder && !hasRowOrder;
};
