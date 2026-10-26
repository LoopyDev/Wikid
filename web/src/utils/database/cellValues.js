import { h } from 'vue';
import * as Y from 'yjs';
import { getRelationConfig } from './fieldOptions';

// Values in database cells: normalising what is stored and turning it into what a cell shows.

export const normalizeFilterValues = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    return id ? [id] : [];
  }
  if (value === null || value === undefined) return [];
  const trimmed = String(value).trim();
  return trimmed ? [trimmed] : [];
};

export const stringifyValue = (value) => {
  if (value instanceof Y.Array) {
    return value.toArray().map((item) => stringifyValue(item)).filter(Boolean).join(', ');
  }
  if (value instanceof Y.Map) {
    const label = value.get('label') ?? value.get('id');
    return label ? String(label) : '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyValue(item)).filter(Boolean).join(', ');
  }
  if (value && typeof value === 'object') {
    const label = value.label ?? value.id;
    if (label !== undefined && label !== null && String(label).trim()) {
      return String(label);
    }
  }
  if (value === null || value === undefined) return '';
  return String(value);
};

export const getRowIdValue = (row) => (row?.id ? String(row.id) : '');

export const renderRowIdCell = (row) => {
  const value = getRowIdValue(row);
  return h('span', { class: 'db-readonly-cell db-row-id-cell', title: value }, value || '—');
};

export const normalizeCellValue = (field, value) => {
  const rawValue = String(value ?? '');
  if (!field) return rawValue;
  if (field.type === 'MULTI_SELECT') {
    if (Array.isArray(value)) {
      const cleaned = value.map((item) => String(item).trim()).filter(Boolean);
      return cleaned.length ? cleaned : null;
    }
    const raw = rawValue.trim();
    if (!raw) return null;
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const raw = rawValue;
  const trimmed = raw.trim();
  if (field.type === 'NUMBER') {
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  if (field.type === 'CHECKBOX') {
    if (!trimmed) return null;
    const normalized = trimmed.toLowerCase();
    if (['true', 'yes', '1', 'x', 'y'].includes(normalized)) return true;
    if (['false', 'no', '0'].includes(normalized)) return false;
    return true;
  }
  if (field.type === 'URL') {
    if (!trimmed) return null;
    return trimmed;
  }
  if (!trimmed) return null;
  return raw;
};

export const normalizeRelationEntry = (raw) => {
  if (!raw) return null;
  if (raw instanceof Y.Map) {
    const id = raw.get('id');
    const label = raw.get('label');
    if (id) return { id: String(id), label: label ? String(label) : '' };
    return null;
  }
  if (typeof raw === 'string') {
    const id = raw.trim();
    return id ? { id, label: '' } : null;
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id) return null;
    const label = typeof raw.label === 'string' ? raw.label.trim() : '';
    return { id, label };
  }
  return null;
};

export const getRelationEntries = (row, field) => {
  if (!row || !field) return [];
  const raw = row?.data?.[field.id];
  if (!raw) return [];
  if (raw instanceof Y.Array) {
    return raw.toArray().map((entry) => normalizeRelationEntry(entry)).filter(Boolean);
  }
  if (Array.isArray(raw)) {
    return raw.map((entry) => normalizeRelationEntry(entry)).filter(Boolean);
  }
  const entry = normalizeRelationEntry(raw);
  return entry ? [entry] : [];
};

export const shouldClearCell = (value) => value === null || value === '' || (Array.isArray(value) && value.length === 0);

export const valueForField = (row, field) => {
  const value = row?.data?.[field.id];
  if (field.type === 'RELATION') {
    const entry = getRelationEntries(row, field)[0];
    return entry?.id || '';
  }
  if (field.type === 'MULTI_SELECT') {
    if (Array.isArray(value)) return value.join(', ');
    if (value instanceof Y.Array) return value.toArray().map((item) => String(item).trim()).filter(Boolean).join(', ');
  }
  return value ?? '';
};

export const getAssetTagValue = (row, field) => {
  const raw = row?.data?.[field.id];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (raw !== null && raw !== undefined) return String(raw);
  return row?.id ? String(row.id) : '';
};

export const getMultiSelectValues = (row, field) => {
  if (!row || !field) return [];
  if (field.type === 'RELATION') {
    const relation = getRelationConfig(field);
    if (!relation?.allowMultiple) return [];
    return getRelationEntries(row, field).map((entry) => entry.id).filter(Boolean);
  }
  const value = row?.data?.[field.id];
  if (value instanceof Y.Array) {
    return value.toArray().map((item) => String(item).trim()).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

export const getMultiSelectValuesFromRaw = (value) => {
  if (value instanceof Y.Array) {
    return value.toArray().map((item) => String(item).trim()).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

export const pruneMultiSelectValues = (values, allowedSet) => values.filter((value) => allowedSet.has(value));
