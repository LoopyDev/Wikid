// Database forms: form field defaults and the conditions a form field can depend on.

export const DEFAULT_FORM_ICON = 'icon:pencil-square';

export const buildFormField = (field) => ({
  fieldId: field.id,
  label: null,
  required: false,
  editable: true,
  auto: null,
  selectSource: null,
  requiredWhen: null,
  visibleWhen: null,
});

export const normalizeRequiredWhenOp = (op) => {
  if (op === 'equals' || op === 'isAnyOf' || op === 'isFilled' || op === 'isEmpty') return op;
  return '';
};

// The choices a condition matches: one for "Equals", several for "Is any of"
export const conditionValues = (condition) => {
  const raw = condition?.value;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim());
};

export const getConditionOpOptions = (fieldType, hasChoices) => {
  const options = [];
  if (fieldType === 'SELECT' && hasChoices) {
    options.push({ value: 'equals', label: 'Equals' }, { value: 'isAnyOf', label: 'Is any of' });
  }
  options.push({ value: 'isFilled', label: 'Value is filled' }, { value: 'isEmpty', label: 'Value is empty' });
  return options;
};

export const normalizeFormIcon = (rawIcon) => {
  if (typeof rawIcon !== 'string') return DEFAULT_FORM_ICON;
  const trimmed = rawIcon.trim();
  return trimmed ? trimmed : DEFAULT_FORM_ICON;
};
