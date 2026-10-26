// Database fields: their types and options, and which fields are system-managed or locked.

export const fieldTypes = [
  { value: 'TEXT', label: 'Text' },
  { value: 'NUMBER', label: 'Number' },
  { value: 'DATE', label: 'Date' },
  { value: 'CHECKBOX', label: 'Checkbox' },
  { value: 'SELECT', label: 'Select' },
  { value: 'MULTI_SELECT', label: 'Multi-select' },
  { value: 'RELATION', label: 'Relation' },
  { value: 'URL', label: 'URL' },
];

export const fieldTypeIcons = {
  TEXT: 'Tx',
  NUMBER: '#',
  DATE: 'Dt',
  CHECKBOX: '[]',
  SELECT: 'Sel',
  MULTI_SELECT: 'Mul',
  RELATION: 'Rel',
  URL: 'URL',
};

export const formatFieldType = (type) => fieldTypes.find((entry) => entry.value === type)?.label || type || 'Field';

export const normalizeChoice = (choice) => {
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
};

export const normalizeFieldOptions = (field) => {
  const options = field?.options && typeof field.options === 'object' && !Array.isArray(field.options) ? field.options : {};
  const rawChoices = Array.isArray(options.choices) ? options.choices : [];
  const choices = rawChoices.map(normalizeChoice).filter(Boolean);
  return { ...options, choices };
};

export const getFieldSource = (field) => normalizeFieldOptions(field).source || null;

export const isMembersField = (field) => getFieldSource(field) === 'members';

export const isPageField = (field) => getFieldSource(field) === 'page';

export const isLastEditedField = (field) => getFieldSource(field) === 'lastEdited';

export const isAssetTagField = (field) => getFieldSource(field) === 'assetTag';

export const isRelationField = (field) => field?.type === 'RELATION';

export const getRelationConfig = (field) => {
  const options = normalizeFieldOptions(field);
  const relation = options?.relation;
  if (!relation || typeof relation !== 'object' || Array.isArray(relation)) return null;
  const pageId = typeof relation.pageId === 'string' ? relation.pageId.trim() : '';
  if (!pageId) return null;
  const rawHistory = relation.history;
  let history = null;
  if (rawHistory === true) {
    history = { enabled: true, pageId: '' };
  } else if (rawHistory && typeof rawHistory === 'object' && !Array.isArray(rawHistory) && rawHistory.enabled === true) {
    const historyPageId = typeof rawHistory.pageId === 'string' ? rawHistory.pageId.trim() : '';
    history = { enabled: true, pageId: historyPageId || '' };
  }
  return { pageId, allowMultiple: relation.allowMultiple === true, history };
};

export const isSystemField = (field) => {
  const source = getFieldSource(field);
  return source === 'page' || source === 'members' || source === 'lastEdited';
};

export const isFieldTypeLocked = (field) => isSystemField(field) || isAssetTagField(field);

export const isFieldOptionsLocked = (field) => isSystemField(field) || isAssetTagField(field);

export const isFieldDeleteLocked = (field) => isSystemField(field);

export const isFieldReadOnly = (field) => {
  const options = normalizeFieldOptions(field);
  if (options.source === 'lastEdited') return true;
  if (options.source === 'page') return !!options.readonly;
  return !!options.readonly;
};

export const isPageFieldEditable = (field) => isPageField(field) && !normalizeFieldOptions(field).readonly;

export const isSelectField = (field) => field?.type === 'SELECT' || field?.type === 'MULTI_SELECT';

export const getMultiSelectChoiceValues = (options) => {
  const normalized = normalizeFieldOptions({ options });
  return normalized.choices.map((choice) => choice.value).filter(Boolean);
};
