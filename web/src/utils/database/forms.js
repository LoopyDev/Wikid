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
  if (op === 'equals' || op === 'isFilled' || op === 'isEmpty') return op;
  return '';
};

export const getConditionOpOptions = (fieldType, hasChoices) => {
  const options = [];
  if (fieldType === 'SELECT' && hasChoices) {
    options.push({ value: 'equals', label: 'Equals' });
  }
  options.push({ value: 'isFilled', label: 'Value is filled' }, { value: 'isEmpty', label: 'Value is empty' });
  return options;
};

export const normalizeFormIcon = (rawIcon) => {
  if (typeof rawIcon !== 'string') return DEFAULT_FORM_ICON;
  const trimmed = rawIcon.trim();
  return trimmed ? trimmed : DEFAULT_FORM_ICON;
};
