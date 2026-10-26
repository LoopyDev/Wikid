import { describe, it, expect } from 'vitest';
import {
  formatFieldType,
  getMultiSelectChoiceValues,
  getRelationConfig,
  isFieldDeleteLocked,
  isFieldOptionsLocked,
  isFieldReadOnly,
  isFieldTypeLocked,
  isPageFieldEditable,
  normalizeFieldOptions,
} from './fieldOptions';

const withSource = (source, extra = {}) => ({ type: 'TEXT', options: { source, ...extra } });

describe('field options', () => {
  it('cleans up choices', () => {
    expect(normalizeFieldOptions({ options: { choices: [' Open ', '', { value: 'Done', color: ' #0f0 ' }, { value: ' ' }] } }).choices).toEqual([
      { value: 'Open', color: null },
      { value: 'Done', label: null, color: '#0f0' },
    ]);
    expect(normalizeFieldOptions({ options: null })).toEqual({ choices: [] });
    expect(getMultiSelectChoiceValues({ choices: ['a', { value: 'b' }] })).toEqual(['a', 'b']);
  });

  it('reads relation settings, including history', () => {
    expect(getRelationConfig({ options: { relation: { pageId: ' p1 ', allowMultiple: true } } })).toEqual({
      pageId: 'p1',
      allowMultiple: true,
      history: null,
    });
    expect(getRelationConfig({ options: { relation: { pageId: 'p1', history: true } } }).history).toEqual({ enabled: true, pageId: '' });
    expect(getRelationConfig({ options: { relation: { pageId: 'p1', history: { enabled: true, pageId: 'h1' } } } }).history).toEqual({
      enabled: true,
      pageId: 'h1',
    });
    expect(getRelationConfig({ options: { relation: { pageId: '' } } })).toBeNull();
    expect(getRelationConfig({ options: {} })).toBeNull();
  });

  it('names field types', () => {
    expect(formatFieldType('MULTI_SELECT')).toBe('Multi-select');
    expect(formatFieldType('SOMETHING')).toBe('SOMETHING');
    expect(formatFieldType(undefined)).toBe('Field');
  });
});

describe('system-managed fields', () => {
  it('locks the type and options of system fields and asset tags', () => {
    for (const source of ['page', 'members', 'lastEdited', 'assetTag']) {
      expect(isFieldTypeLocked(withSource(source)), source).toBe(true);
      expect(isFieldOptionsLocked(withSource(source)), source).toBe(true);
    }
    expect(isFieldTypeLocked({ type: 'TEXT', options: {} })).toBe(false);
  });

  it('only stops system fields from being deleted', () => {
    expect(isFieldDeleteLocked(withSource('members'))).toBe(true);
    expect(isFieldDeleteLocked(withSource('assetTag'))).toBe(false);
  });

  it('makes "last edited" read-only, and page fields editable unless marked read-only', () => {
    expect(isFieldReadOnly(withSource('lastEdited'))).toBe(true);
    expect(isFieldReadOnly(withSource('page'))).toBe(false);
    expect(isFieldReadOnly(withSource('page', { readonly: true }))).toBe(true);
    expect(isPageFieldEditable(withSource('page'))).toBe(true);
    expect(isPageFieldEditable(withSource('page', { readonly: true }))).toBe(false);
  });
});
