<script setup>
import { computed, ref, watch } from 'vue';
import DatabaseFormPage from './DatabaseFormPage.vue';
import PageIcon from './PageIcon.vue';
import { AUTO_SIZE_RELATION_PLACEHOLDER } from '../utils/database/columnLayout';
import { api } from '../api/client';
import { auditStatusOptions, DEFAULT_INITIAL_STATUS, GOVERNANCE_FILTER_ID, governanceFilterChoices, governanceFilterOption } from '../utils/database/compliance';
import { buildFormField, conditionValues, DEFAULT_FORM_ICON, getConditionOpOptions, normalizeRequiredWhenOp } from '../utils/database/forms';
import { formatFieldType, getFieldSource, getRelationConfig, isFieldReadOnly, normalizeFieldOptions } from '../utils/database/fieldOptions';
import { normalizeFilterValues, stringifyValue } from '../utils/database/cellValues';

// The form builder for one form of a database: which fields it asks for and how (fixed or
// automatic values, choices from a relation, required/visible conditions), what new records
// start as, the success message, and a preview of the layout.
// `database` is what it needs from the table (see formBuilderContext in DatabaseTable.vue).
const props = defineProps({
  database: { type: Object, required: true },
});
const {
  embedded,
  canCreateForms,
  deleteFormView,
  isComplianceDatabase,
  isReadonly,
  openFormPage,
  activeUser,
  activeViewId,
  auditStatusIds,
  error,
  fieldById,
  fields,
  formViews,
  hasApi,
  loadRelationOptions,
  normalizeFormAuto,
  normalizeFormConfig,
  normalizeFormSelectSource,
  normalizeFormView,
  relationFieldsByPageId,
  relationOptionsErrorForPage,
  relationOptionsForPage,
  relationOptionsLoading,
  relationOptionsLoadingForPage,
  relationRowsByPageId,
  runWithSavingIndicator,
} = props.database;

const formFieldSelectId = ref('');

const formBuilderTab = ref('fields');

const formBuilderTabs = [
  { id: 'fields', label: 'Fields' },
  { id: 'rules', label: 'Rules' },
  { id: 'layout', label: 'Layout' },
];

const newRuleTargetFieldId = ref('');

const newRuleConditionFieldId = ref('');

const newVisibilityTargetFieldId = ref('');

const newVisibilityConditionFieldId = ref('');

const activeForm = computed(() => formViews.value.find((form) => form.id === activeViewId.value) || null);

const selectSourceValueOptions = (selectSource) => {
  if (!selectSource || selectSource.type !== 'relation') return [];
  const relationFieldId =
    typeof selectSource.relationFieldId === 'string' ? selectSource.relationFieldId.trim() : '';
  const targetFieldId = typeof selectSource.targetFieldId === 'string' ? selectSource.targetFieldId.trim() : '';
  if (!relationFieldId || !targetFieldId) return [];
  const relationField = relationFieldId ? fieldById.value.get(relationFieldId) : null;
  const relation = relationField ? getRelationConfig(relationField) : null;
  if (!relation?.pageId) return [];
  const rows = relationRowsForPage(relation.pageId);
  const seen = new Set();
  return rows
    .map((row) => {
      const data = row?.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data : {};
      const label = stringifyValue(data[targetFieldId]);
      if (!label) return null;
      const value = String(label);
      if (seen.has(value)) return null;
      seen.add(value);
      return { value, label: value };
    })
    .filter(Boolean);
};

const getAutoFixedChoices = (fieldId, selectSource) => {
  const field = fieldId ? fieldById.value.get(fieldId) : null;
  if (!field) return [];
  if (field.type === 'RELATION') {
    const relation = getRelationConfig(field);
    if (!relation?.pageId) return [];
    return relationOptionsForPage(relation.pageId).map((option) => ({
      value: option.id,
      label: option.label || option.id,
    }));
  }
  if (field.type !== 'SELECT') return [];
  if (selectSource?.type === 'relation') {
    return selectSourceValueOptions(selectSource);
  }
  return normalizeFieldOptions(field).choices;
};

const buildRequiredWhenCondition = (conditionFieldId, op, value) => {
  const trimmed = typeof conditionFieldId === 'string' ? conditionFieldId.trim() : '';
  if (!trimmed) return null;
  const conditionField = fieldById.value.get(trimmed);
  if (!conditionField) return null;
  const normalizedOp = normalizeRequiredWhenOp(op);
  if (!normalizedOp) return null;
  if (normalizedOp === 'isAnyOf') {
    if (conditionField.type !== 'SELECT') return null;
    const choices = normalizeFieldOptions(conditionField).choices;
    if (!choices.length) return null;
    const picked = conditionValues({ value }).filter((item) => choices.some((choice) => choice.value === item));
    return { fieldId: trimmed, op: normalizedOp, value: picked.length ? [...new Set(picked)] : [choices[0].value] };
  }
  if (normalizedOp === 'equals') {
    if (conditionField.type !== 'SELECT') return null;
    const choices = normalizeFieldOptions(conditionField).choices;
    if (!choices.length) return null;
    const rawValue = conditionValues({ value })[0] || '';
    const nextValue = rawValue && choices.some((choice) => choice.value === rawValue) ? rawValue : choices[0].value;
    if (!nextValue) return null;
    return { fieldId: trimmed, op: normalizedOp, value: nextValue };
  }
  return { fieldId: trimmed, op: normalizedOp };
};

const updateFormView = (formId, updater) => {
  if (!formId || typeof updater !== 'function') return;
  formViews.value = formViews.value.map((form) => (form.id === formId ? updater(form) : form));
};

const saveFormFields = async (formId, nextFields) => {
  if (!hasApi.value || !activeUser.value) return null;
  try {
    const res = await runWithSavingIndicator(() =>
      api.updateDatabaseForm(
        formId,
        { fields: nextFields },
        { userId: activeUser.value.id, userName: activeUser.value.name }
      )
    );
    const nextForm = normalizeFormView(res);
    if (nextForm) {
      updateFormView(nextForm.id, () => nextForm);
    }
    return nextForm || null;
  } catch (err) {
    console.warn('Update form failed', err);
    error.value = err?.message || 'Failed to update form';
    return null;
  }
};

const saveFormConfig = async (formId, nextConfig) => {
  if (!hasApi.value || !activeUser.value) return null;
  try {
    const res = await runWithSavingIndicator(() =>
      api.updateDatabaseForm(
        formId,
        { config: nextConfig },
        { userId: activeUser.value.id, userName: activeUser.value.name }
      )
    );
    const nextForm = normalizeFormView(res);
    if (nextForm) {
      updateFormView(nextForm.id, () => nextForm);
    }
    return nextForm || null;
  } catch (err) {
    console.warn('Update form failed', err);
    error.value = err?.message || 'Failed to update form';
    return null;
  }
};

const activeFormConfig = computed(() => normalizeFormConfig(activeForm.value?.config));

// Text boxes here save when you leave them. If the form re-renders while you're typing in one (say
// the response to another save arrives), Vue would put back the stored value and drop what you typed.
const vKeepTyping = {
  beforeUpdate(el) {
    el._typed = document.activeElement === el ? el.value : null;
  },
  updated(el) {
    if (el._typed != null && el.value !== el._typed) el.value = el._typed;
  },
};

const updateFormMode = async (mode) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form) return;
  const nextMode = mode === 'update' ? 'update' : 'create';
  const current = activeFormConfig.value;
  const nextConfig = {
    ...current,
    mode: nextMode,
    filter: nextMode === 'update' ? current.filter : null,
    ...(nextMode === 'update' ? {} : { transitionStatus: null }),
  };
  await saveFormConfig(form.id, nextConfig);
};

const updateFormFilterField = async (fieldId) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form) return;
  const current = activeFormConfig.value;
  const nextFieldId = typeof fieldId === 'string' ? fieldId : '';
  const filter = nextFieldId
    ? { fieldId: nextFieldId, op: current.filter?.op || 'isEmpty', value: current.filter?.value ?? '' }
    : null;
  await saveFormConfig(form.id, { ...current, filter });
};

const updateFormFilterOp = async (op) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form) return;
  const current = activeFormConfig.value;
  if (!current.filter) return;
  await saveFormConfig(form.id, { ...current, filter: { ...current.filter, op } });
};

const updateFormFilterValue = async (value) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form) return;
  const current = activeFormConfig.value;
  if (!current.filter) return;
  await saveFormConfig(form.id, { ...current, filter: { ...current.filter, value } });
};

const updateFormSuccessMessage = async (message) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form) return;
  const current = activeFormConfig.value;
  await saveFormConfig(form.id, { ...current, successMessage: message });
};

const updateFormShowReturnButton = async (value) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form) return;
  const current = activeFormConfig.value;
  await saveFormConfig(form.id, { ...current, showReturnButton: value === true });
};

const updateFormInitialStatus = async (status) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form) return;
  const rawStatus = typeof status === 'string' ? status.trim().toUpperCase() : '';
  const initialStatus = auditStatusIds.has(rawStatus) ? rawStatus : DEFAULT_INITIAL_STATUS;
  const current = activeFormConfig.value;
  await saveFormConfig(form.id, { ...current, initialStatus });
};

const updateFormTransitionStatus = async (status) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form) return;
  const rawStatus = typeof status === 'string' ? status.trim().toUpperCase() : '';
  const transitionStatus = auditStatusIds.has(rawStatus) ? rawStatus : '';
  const current = activeFormConfig.value;
  const nextConfig = { ...current };
  if (transitionStatus) {
    nextConfig.transitionStatus = transitionStatus;
  } else {
    delete nextConfig.transitionStatus;
  }
  await saveFormConfig(form.id, nextConfig);
};

const addFieldToActiveForm = async () => {
  const form = activeForm.value;
  const fieldId = formFieldSelectId.value;
  if (!form || !fieldId) return;
  const field = fields.value.find((item) => item.id === fieldId);
  if (!field) return;
  if (form.fields.some((entry) => entry.fieldId === fieldId)) {
    formFieldSelectId.value = '';
    return;
  }
  if (!hasApi.value || !activeUser.value) return;
  const nextFields = [...form.fields, buildFormField(field)];
  formFieldSelectId.value = '';
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldAutoType = async (fieldId, nextType) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  let nextAuto = null;
  if (nextType === 'currentUser') {
    nextAuto = { type: 'currentUser' };
  } else if (nextType === 'today') {
    nextAuto = normalizeFormAuto({ type: 'today' }, fieldId);
  } else if (nextType === 'template') {
    const current = form.fields.find((entry) => entry.fieldId === fieldId)?.auto;
    const template =
      current && typeof current === 'object' && typeof current.template === 'string' && current.template.trim()
        ? current.template.trim()
        : '{{counter}}';
    nextAuto = { type: 'template', template };
  } else if (nextType === 'fixed') {
    const entry = form.fields.find((entry) => entry.fieldId === fieldId);
    const selectSource = normalizeFormSelectSource(entry?.selectSource, fieldId);
    const choices = getAutoFixedChoices(fieldId, selectSource);
    const current = entry?.auto;
    const currentValue =
      current && typeof current === 'object' && typeof current.value === 'string' ? current.value.trim() : '';
    const value =
      currentValue && choices.some((choice) => choice.value === currentValue) ? currentValue : choices[0]?.value || '';
    if (value) {
      nextAuto = { type: 'fixed', value };
    }
  }
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    const nextEntry = { ...entry };
    if (nextAuto) {
      nextEntry.auto = nextAuto;
    } else {
      delete nextEntry.auto;
    }
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldAutoTemplate = async (fieldId, template) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const entry = form.fields.find((entry) => entry.fieldId === fieldId);
  const selectSource = normalizeFormSelectSource(entry?.selectSource, fieldId);
  const nextAuto = normalizeFormAuto({ type: 'template', template }, fieldId, selectSource);
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    const nextEntry = { ...entry };
    if (nextAuto) {
      nextEntry.auto = nextAuto;
    } else {
      delete nextEntry.auto;
    }
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldAutoMode = async (fieldId, mode) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const entry = form.fields.find((entry) => entry.fieldId === fieldId);
  const selectSource = normalizeFormSelectSource(entry?.selectSource, fieldId);
  const nextAuto = normalizeFormAuto({ type: 'currentUser', mode }, fieldId, selectSource);
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    const nextEntry = { ...entry };
    if (nextAuto) {
      nextEntry.auto = nextAuto;
    } else {
      delete nextEntry.auto;
    }
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldAutoFixedValue = async (fieldId, value) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const entry = form.fields.find((entry) => entry.fieldId === fieldId);
  const selectSource = normalizeFormSelectSource(entry?.selectSource, fieldId);
  const nextAuto = normalizeFormAuto({ type: 'fixed', value }, fieldId, selectSource);
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    const nextEntry = { ...entry };
    if (nextAuto) {
      nextEntry.auto = nextAuto;
    } else {
      delete nextEntry.auto;
    }
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldSelectSourceType = async (fieldId, nextType) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const type = nextType === 'relation' ? 'relation' : 'manual';
  const nextFields = await Promise.all(
    form.fields.map(async (entry) => {
      if (entry.fieldId !== fieldId) return entry;
      const nextEntry = { ...entry };
      if (type !== 'relation') {
        delete nextEntry.selectSource;
        return nextEntry;
      }
      const relationFields = formSelectSourceRelations.value;
      if (!relationFields.length) {
        delete nextEntry.selectSource;
        return nextEntry;
      }
      let relationFieldId = relationFields[0]?.id || '';
      if (!relationFieldId) {
        delete nextEntry.selectSource;
        return nextEntry;
      }
      const relationField = fieldById.value.get(relationFieldId);
      const relation = relationField ? getRelationConfig(relationField) : null;
      if (!relation?.pageId) {
        delete nextEntry.selectSource;
        return nextEntry;
      }
      if (!relationFieldsByPageId.value[relation.pageId] && !relationOptionsLoading.value[relation.pageId]) {
        await loadRelationOptions(relation.pageId);
      }
      const targets = relationFieldsForPage(relation.pageId);
      const targetFieldId = targets[0]?.id || '';
      if (!targetFieldId) {
        delete nextEntry.selectSource;
        return nextEntry;
      }
      nextEntry.selectSource = { type: 'relation', relationFieldId, targetFieldId };
      return nextEntry;
    })
  );
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldSelectSourceRelation = async (fieldId, relationFieldId) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextRelationId = typeof relationFieldId === 'string' ? relationFieldId.trim() : '';
  if (!nextRelationId) {
    const nextFields = form.fields.map((entry) => {
      if (entry.fieldId !== fieldId) return entry;
      const nextEntry = { ...entry };
      delete nextEntry.selectSource;
      return nextEntry;
    });
    await saveFormFields(form.id, nextFields);
    return;
  }
  const relationField = fieldById.value.get(nextRelationId) || null;
  const relation = relationField ? getRelationConfig(relationField) : null;
  if (!relation?.pageId) {
    const nextFields = form.fields.map((entry) => {
      if (entry.fieldId !== fieldId) return entry;
      const nextEntry = { ...entry };
      delete nextEntry.selectSource;
      return nextEntry;
    });
    await saveFormFields(form.id, nextFields);
    return;
  }
  if (!relationFieldsByPageId.value[relation.pageId] && !relationOptionsLoading.value[relation.pageId]) {
    await loadRelationOptions(relation.pageId);
  }
  const targets = relationFieldsForPage(relation.pageId);
  const nextTargetId = targets[0]?.id || '';
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    const nextEntry = { ...entry };
    if (nextRelationId && nextTargetId) {
      nextEntry.selectSource = { type: 'relation', relationFieldId: nextRelationId, targetFieldId: nextTargetId };
    } else {
      delete nextEntry.selectSource;
    }
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldSelectSourceTarget = async (fieldId, targetFieldId) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextTargetId = typeof targetFieldId === 'string' ? targetFieldId : '';
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    const nextEntry = { ...entry };
    const current = entry?.selectSource;
    const relationFieldId =
      current && typeof current === 'object' && typeof current.relationFieldId === 'string' ? current.relationFieldId : '';
    if (relationFieldId && nextTargetId) {
      nextEntry.selectSource = { type: 'relation', relationFieldId, targetFieldId: nextTargetId };
    } else {
      delete nextEntry.selectSource;
    }
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldEditable = async (fieldId, editable) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextEditable = editable === false ? false : true;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    return { ...entry, editable: nextEditable };
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldRequired = async (fieldId, required) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextRequired = !!required;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    return { ...entry, required: nextRequired };
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldNoFuture = async (fieldId, noFuture) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    const nextEntry = { ...entry };
    if (noFuture) nextEntry.noFuture = true;
    else delete nextEntry.noFuture;
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldRequiredWhenField = async (fieldId, conditionFieldId) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const trimmed = typeof conditionFieldId === 'string' ? conditionFieldId.trim() : '';
  const conditionField = trimmed ? fieldById.value.get(trimmed) : null;
  const choices = conditionField && conditionField.type === 'SELECT' ? normalizeFieldOptions(conditionField).choices : [];
  const nextCondition =
    trimmed && conditionField
      ? choices.length
        ? buildRequiredWhenCondition(trimmed, 'equals', choices[0].value)
        : buildRequiredWhenCondition(trimmed, 'isFilled')
      : null;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    const nextEntry = { ...entry };
    if (nextCondition) {
      nextEntry.requiredWhen = nextCondition;
    } else {
      delete nextEntry.requiredWhen;
    }
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldRequiredWhenValue = async (fieldId, nextValue) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    if (!entry?.requiredWhen || typeof entry.requiredWhen !== 'object' || Array.isArray(entry.requiredWhen)) return entry;
    if (entry.requiredWhen.op !== 'equals') return entry;
    const value = typeof nextValue === 'string' ? nextValue.trim() : '';
    if (!value) {
      const nextEntry = { ...entry };
      delete nextEntry.requiredWhen;
      return nextEntry;
    }
    return { ...entry, requiredWhen: { ...entry.requiredWhen, value } };
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldRequiredWhenOp = async (fieldId, op) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextOp = normalizeRequiredWhenOp(op);
  if (!nextOp) return;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    if (!entry?.requiredWhen || typeof entry.requiredWhen !== 'object' || Array.isArray(entry.requiredWhen)) return entry;
    const conditionFieldId = typeof entry.requiredWhen.fieldId === 'string' ? entry.requiredWhen.fieldId.trim() : '';
    if (!conditionFieldId) return entry;
    const nextCondition = buildRequiredWhenCondition(conditionFieldId, nextOp, entry.requiredWhen.value);
    if (!nextCondition) {
      const nextEntry = { ...entry };
      delete nextEntry.requiredWhen;
      return nextEntry;
    }
    return { ...entry, requiredWhen: nextCondition };
  });
  await saveFormFields(form.id, nextFields);
};

// Ticks or unticks one of an "Is any of" condition's choices (key: requiredWhen or visibleWhen)
const toggleFormFieldConditionValue = async (fieldId, key, choiceValue, checked) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    const condition = entry?.[key];
    if (!condition || condition.op !== 'isAnyOf') return entry;
    const current = conditionValues(condition);
    const next = checked ? [...new Set([...current, choiceValue])] : current.filter((value) => value !== choiceValue);
    // The last choice stays ticked: a condition needs one
    if (!next.length) return entry;
    return { ...entry, [key]: { ...condition, value: next } };
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldVisibleWhenField = async (fieldId, conditionFieldId) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const trimmed = typeof conditionFieldId === 'string' ? conditionFieldId.trim() : '';
  const conditionField = trimmed ? fieldById.value.get(trimmed) : null;
  const choices = conditionField && conditionField.type === 'SELECT' ? normalizeFieldOptions(conditionField).choices : [];
  const nextCondition =
    trimmed && conditionField
      ? choices.length
        ? buildRequiredWhenCondition(trimmed, 'equals', choices[0].value)
        : buildRequiredWhenCondition(trimmed, 'isFilled')
      : null;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    const nextEntry = { ...entry };
    if (nextCondition) {
      nextEntry.visibleWhen = nextCondition;
    } else {
      delete nextEntry.visibleWhen;
    }
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldVisibleWhenValue = async (fieldId, nextValue) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    if (!entry?.visibleWhen || typeof entry.visibleWhen !== 'object' || Array.isArray(entry.visibleWhen)) return entry;
    if (entry.visibleWhen.op !== 'equals') return entry;
    const value = typeof nextValue === 'string' ? nextValue.trim() : '';
    if (!value) {
      const nextEntry = { ...entry };
      delete nextEntry.visibleWhen;
      return nextEntry;
    }
    return { ...entry, visibleWhen: { ...entry.visibleWhen, value } };
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldVisibleWhenOp = async (fieldId, op) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextOp = normalizeRequiredWhenOp(op);
  if (!nextOp) return;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    if (!entry?.visibleWhen || typeof entry.visibleWhen !== 'object' || Array.isArray(entry.visibleWhen)) return entry;
    const conditionFieldId = typeof entry.visibleWhen.fieldId === 'string' ? entry.visibleWhen.fieldId.trim() : '';
    if (!conditionFieldId) return entry;
    const nextCondition = buildRequiredWhenCondition(conditionFieldId, nextOp, entry.visibleWhen.value);
    if (!nextCondition) {
      const nextEntry = { ...entry };
      delete nextEntry.visibleWhen;
      return nextEntry;
    }
    return { ...entry, visibleWhen: nextCondition };
  });
  await saveFormFields(form.id, nextFields);
};

const reorderFormFields = async (fromId, toId, position) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fromId || !toId || fromId === toId) return;
  const fromIndex = form.fields.findIndex((entry) => entry.fieldId === fromId);
  if (fromIndex < 0) return;
  const nextFields = [...form.fields];
  const [entry] = nextFields.splice(fromIndex, 1);
  const targetIndex = nextFields.findIndex((field) => field.fieldId === toId);
  if (targetIndex < 0) {
    nextFields.push(entry);
  } else {
    const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
    nextFields.splice(insertIndex, 0, entry);
  }
  await saveFormFields(form.id, nextFields);
};

const formFieldDragId = ref('');

const formFieldDragOverId = ref('');

const formFieldDragOverPosition = ref('before');

const clearFormFieldDrag = () => {
  formFieldDragId.value = '';
  formFieldDragOverId.value = '';
  formFieldDragOverPosition.value = 'before';
};

const handleFormFieldDragStart = (fieldId, event) => {
  if (!canCreateForms.value) return;
  formFieldDragId.value = fieldId;
  if (event?.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', fieldId);
  }
};

const handleFormFieldDragOver = (fieldId, event) => {
  if (!canCreateForms.value || !formFieldDragId.value) return;
  event?.preventDefault?.();
  formFieldDragOverId.value = fieldId;
  if (event?.currentTarget?.getBoundingClientRect) {
    const rect = event.currentTarget.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    formFieldDragOverPosition.value = event.clientY >= midpoint ? 'after' : 'before';
  }
  if (event?.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
};

const handleFormFieldDragLeave = (fieldId, event) => {
  if (formFieldDragOverId.value !== fieldId) return;
  const related = event?.relatedTarget;
  const current = event?.currentTarget;
  if (related && current && current.contains?.(related)) return;
  formFieldDragOverId.value = '';
  formFieldDragOverPosition.value = 'before';
};

const handleFormFieldDrop = async (fieldId, event) => {
  if (!canCreateForms.value || !formFieldDragId.value) return;
  event?.preventDefault?.();
  const fromId = formFieldDragId.value;
  const position = formFieldDragOverPosition.value;
  clearFormFieldDrag();
  await reorderFormFields(fromId, fieldId, position);
};

const handleFormFieldDragEnd = () => {
  clearFormFieldDrag();
};

const handleOpenFormPage = () => {
  if (!activeForm.value) return;
  if (typeof openFormPage === 'function') {
    openFormPage(activeForm.value.id);
  }
};

const relationFieldsForPage = (pageId) => relationFieldsByPageId.value[pageId] || [];

const relationRowsForPage = (pageId) => relationRowsByPageId.value[pageId] || [];

const formFieldOptions = computed(() => {
  const used = new Set(activeForm.value?.fields.map((field) => field.fieldId) ?? []);
  return fields.value
    // A "Linked from" field is worked out from another database, so there's nothing to fill in
    .filter((field) => field?.id && !used.has(field.id) && field.type !== 'LINKED_FROM')
    .map((field) => ({
      id: field.id,
      name: field.name || 'Field',
      type: field.type,
    }));
});

const formFilterFieldOptions = computed(() => {
  const base = fields.value.map((field) => ({
    id: field.id,
    name: field.name || 'Field',
    type: field.type,
  }));
  if (!isComplianceDatabase.value) return base;
  return [governanceFilterOption, ...base];
});

const formFilterField = computed(() => {
  const fieldId = activeFormConfig.value?.filter?.fieldId;
  if (!fieldId || fieldId === GOVERNANCE_FILTER_ID) return null;
  return fieldById.value.get(fieldId) || null;
});

const isGovernanceFilter = computed(() => activeFormConfig.value?.filter?.fieldId === GOVERNANCE_FILTER_ID);

const formFilterValueSelection = computed(() => {
  const filter = activeFormConfig.value?.filter;
  if (!filter) return '';
  if (isGovernanceFilter.value) {
    const values = normalizeFilterValues(filter.value);
    return values[0] || '';
  }
  const field = formFilterField.value;
  if (field && (field.type === 'SELECT' || field.type === 'RELATION')) {
    const values = normalizeFilterValues(filter.value);
    return values[0] || '';
  }
  if (Array.isArray(filter.value)) {
    const first = filter.value.find((item) => typeof item === 'string' && item.trim());
    return first ? first.trim() : '';
  }
  if (filter.value === null || filter.value === undefined) return '';
  if (typeof filter.value === 'string') return filter.value;
  return String(filter.value);
});

const formFilterUsesChoices = computed(() => {
  if (isGovernanceFilter.value) return true;
  const field = formFilterField.value;
  return !!field && field.type === 'SELECT';
});

const formFilterRelation = computed(() => {
  if (isGovernanceFilter.value) return null;
  const field = formFilterField.value;
  if (!field || field.type !== 'RELATION') return null;
  return getRelationConfig(field);
});

const formFilterRelationOptionsBase = computed(() => {
  const relation = formFilterRelation.value;
  if (!relation?.pageId) return [];
  return relationOptionsForPage(relation.pageId);
});

const formFilterRelationLoading = computed(() => {
  const relation = formFilterRelation.value;
  if (!relation?.pageId) return false;
  return relationOptionsLoadingForPage(relation.pageId);
});

const formFilterRelationError = computed(() => {
  const relation = formFilterRelation.value;
  if (!relation?.pageId) return '';
  return relationOptionsErrorForPage(relation.pageId);
});

const formFilterRelationMissingValue = computed(() => {
  const relation = formFilterRelation.value;
  if (!relation?.pageId) return '';
  if (formFilterRelationLoading.value || formFilterRelationError.value) return '';
  const filter = activeFormConfig.value?.filter;
  if (!filter || (filter.op !== 'equals' && filter.op !== 'notEquals')) return '';
  const value = formFilterValueSelection.value;
  if (!value) return '';
  const allowed = new Set(formFilterRelationOptionsBase.value.map((option) => option.id));
  return allowed.has(value) ? '' : value;
});

const formFilterRelationOptions = computed(() => {
  const options = formFilterRelationOptionsBase.value;
  const missing = formFilterRelationMissingValue.value;
  if (!missing) return options;
  return [{ id: missing, label: `Missing: ${missing}` }, ...options];
});

const formFilterRelationPlaceholder = computed(() => {
  if (formFilterRelationError.value) return 'Failed to load';
  if (formFilterRelationLoading.value) return 'Loading...';
  return AUTO_SIZE_RELATION_PLACEHOLDER;
});

const formFilterMissingValues = computed(() => {
  const filter = activeFormConfig.value?.filter;
  const field = formFilterField.value;
  if (!filter) return [];
  if (filter.op !== 'equals' && filter.op !== 'notEquals') return [];
  const values = normalizeFilterValues(filter.value);
  if (!values.length) return [];
  if (isGovernanceFilter.value) {
    const allowed = new Set(governanceFilterChoices.map((choice) => choice.value));
    return values.filter((value) => !allowed.has(value));
  }
  if (!field || field.type !== 'SELECT') return [];
  const allowed = new Set(normalizeFieldOptions(field).choices.map((choice) => choice.value));
  return values.filter((value) => !allowed.has(value));
});

const formFilterChoiceOptions = computed(() => {
  if (isGovernanceFilter.value) {
    const missing = formFilterMissingValues.value;
    if (!missing.length) return governanceFilterChoices;
    const extra = missing.map((value) => ({ value, label: `Missing: ${value}` }));
    return [...extra, ...governanceFilterChoices];
  }
  const field = formFilterField.value;
  if (!field || field.type !== 'SELECT') return [];
  const choices = normalizeFieldOptions(field).choices;
  const missing = formFilterMissingValues.value;
  if (!missing.length) return choices;
  const extra = missing.map((value) => ({ value, label: `Missing: ${value}` }));
  return [...extra, ...choices];
});

const formFilterWarning = computed(() => {
  const field = formFilterField.value;
  if (isGovernanceFilter.value) {
    const missing = formFilterMissingValues.value;
    if (!missing.length) return '';
    if (missing.length === 1) {
      return `Filter value "${missing[0]}" is no longer a governance status.`;
    }
    const values = missing.map((value) => `"${value}"`).join(', ');
    return `Filter values ${values} are no longer governance statuses.`;
  }
  if (!field) return '';
  if (field.type === 'SELECT') {
    const missing = formFilterMissingValues.value;
    if (!missing.length) return '';
    const label = field?.name || 'Field';
    if (missing.length === 1) {
      return `Filter value "${missing[0]}" is no longer an option for ${label}.`;
    }
    const values = missing.map((value) => `"${value}"`).join(', ');
    return `Filter values ${values} are no longer options for ${label}.`;
  }
  if (field.type === 'RELATION') {
    if (formFilterRelationError.value) {
      return `Relation options failed to load: ${formFilterRelationError.value}`;
    }
    const missing = formFilterRelationMissingValue.value;
    if (!missing) return '';
    const label = field?.name || 'Field';
    return `Filter value "${missing}" is no longer a related record for ${label}.`;
  }
  return '';
});

const formConditionFieldOptions = computed(() => {
  const form = activeForm.value;
  if (!form) return [];
  const inForm = new Set(form.fields.map((entry) => entry.fieldId));
  return fields.value
    .filter((field) => inForm.has(field.id))
    .map((field) => ({
      id: field.id,
      name: field.name || 'Field',
      type: field.type,
    }));
});

const formSelectSourceRelations = computed(() =>
  fields.value
    .filter((field) => field?.type === 'RELATION')
    .map((field) => {
      const relation = getRelationConfig(field);
      if (!relation?.pageId) return null;
      return {
        id: field.id,
        name: field.name || 'Field',
        pageId: relation.pageId,
      };
    })
    .filter(Boolean)
);

const hasFormSelectSourceRelations = computed(() => formSelectSourceRelations.value.length > 0);

const formFilterNeedsValue = computed(() => {
  const op = activeFormConfig.value?.filter?.op;
  return op === 'equals' || op === 'notEquals';
});

const resolvedActiveFormFields = computed(() => {
  const form = activeForm.value;
  if (!form) return [];
  return form.fields.map((entry) => {
    const field = fieldById.value.get(entry.fieldId);
    const rawLabel = typeof entry.label === 'string' ? entry.label.trim() : '';
    const name = rawLabel || field?.name || 'Field';
    const auto = entry?.auto && typeof entry.auto === 'object' && !Array.isArray(entry.auto) ? entry.auto : null;
    const source = field ? getFieldSource(field) : null;
    const autoType = typeof auto?.type === 'string' ? auto.type : '';
    const autoTemplate = autoType === 'template' && typeof auto?.template === 'string' ? auto.template : '';
    const autoMode =
      autoType === 'currentUser' && typeof auto?.mode === 'string'
        ? auto.mode
        : source === 'members'
        ? 'id'
        : 'name';
    const selectSource =
      entry?.selectSource && typeof entry.selectSource === 'object' && !Array.isArray(entry.selectSource)
        ? entry.selectSource
        : null;
    const selectSourceType = selectSource?.type === 'relation' ? 'relation' : 'manual';
    const selectSourceRelationFieldId =
      typeof selectSource?.relationFieldId === 'string' ? selectSource.relationFieldId : '';
    const selectSourceTargetFieldId =
      typeof selectSource?.targetFieldId === 'string' ? selectSource.targetFieldId : '';
    const selectSourceRelationField = selectSourceRelationFieldId ? fieldById.value.get(selectSourceRelationFieldId) : null;
    const selectSourceRelationConfig = selectSourceRelationField ? getRelationConfig(selectSourceRelationField) : null;
    const selectSourcePageId = selectSourceRelationConfig?.pageId || '';
    const selectSourceTargetOptions = selectSourcePageId ? relationFieldsForPage(selectSourcePageId) : [];
    const selectSourceLoading = selectSourcePageId ? relationOptionsLoadingForPage(selectSourcePageId) : false;
    const selectSourceError = selectSourcePageId ? relationOptionsErrorForPage(selectSourcePageId) : '';
    const autoFixedChoices = getAutoFixedChoices(entry.fieldId, selectSource);
    const autoFixedValue =
      autoType === 'fixed' && typeof auto?.value === 'string' ? auto.value.trim() : '';
    const autoFixedMissing =
      autoType === 'fixed' &&
      autoFixedValue &&
      autoFixedChoices.length > 0 &&
      !autoFixedChoices.some((choice) => choice.value === autoFixedValue);
    const relationConfig = field?.type === 'RELATION' ? getRelationConfig(field) : null;
    const relationPageId = relationConfig?.pageId || '';
    const autoFixedLoading =
      field?.type === 'RELATION'
        ? relationPageId
          ? relationOptionsLoadingForPage(relationPageId)
          : false
        : selectSourceType === 'relation'
        ? selectSourceLoading
        : false;
    const autoFixedError =
      field?.type === 'RELATION'
        ? relationPageId
          ? relationOptionsErrorForPage(relationPageId)
          : ''
        : selectSourceType === 'relation'
        ? selectSourceError
        : '';
    const autoFixedPlaceholder = autoFixedError
      ? 'Failed to load'
      : autoFixedLoading
      ? 'Loading...'
      : 'Select value';
    const autoFixedHint =
      autoType === 'fixed'
        ? autoFixedError
          ? `Relation options failed to load: ${autoFixedError}`
          : autoFixedLoading
          ? 'Loading relation options...'
          : autoFixedChoices.length === 0
          ? 'No related values available.'
          : autoFixedMissing
          ? 'Fixed value is no longer an option.'
          : ''
        : '';
    const selectSourceTargetMissing =
      selectSourceTargetFieldId &&
      !selectSourceLoading &&
      !selectSourceError &&
      !selectSourceTargetOptions.some((option) => option.id === selectSourceTargetFieldId);
    const selectSourcePlaceholder = selectSourceError
      ? 'Failed to load'
      : selectSourceLoading
      ? 'Loading...'
      : 'Select field...';
    const selectSourceWarning =
      selectSourceType !== 'relation'
        ? ''
        : !hasFormSelectSourceRelations.value
        ? 'No relation tables available.'
        : !selectSourceRelationFieldId
        ? 'Select a relation field.'
        : !selectSourceRelationField
        ? 'Relation field is missing.'
        : !selectSourcePageId
        ? 'Relation target is not configured.'
        : selectSourceError
        ? `Relation options failed to load: ${selectSourceError}`
        : selectSourceTargetMissing
        ? 'Related field is missing.'
        : '';
    const requiredWhen =
      entry?.requiredWhen && typeof entry.requiredWhen === 'object' && !Array.isArray(entry.requiredWhen)
        ? entry.requiredWhen
        : null;
    const requiredWhenFieldId = typeof requiredWhen?.fieldId === 'string' ? requiredWhen.fieldId : '';
    const requiredWhenValue = typeof requiredWhen?.value === 'string' ? requiredWhen.value : '';
    const requiredWhenValues = conditionValues(requiredWhen);
    const requiredWhenOp = normalizeRequiredWhenOp(requiredWhen?.op);
    const requiredWhenField = requiredWhenFieldId ? fieldById.value.get(requiredWhenFieldId) : null;
    const requiredWhenFieldType = requiredWhenField?.type || null;
    const requiredWhenChoices =
      requiredWhenField && requiredWhenField.type === 'SELECT' ? normalizeFieldOptions(requiredWhenField).choices : [];
    const visibleWhen =
      entry?.visibleWhen && typeof entry.visibleWhen === 'object' && !Array.isArray(entry.visibleWhen)
        ? entry.visibleWhen
        : null;
    const visibleWhenFieldId = typeof visibleWhen?.fieldId === 'string' ? visibleWhen.fieldId : '';
    const visibleWhenValue = typeof visibleWhen?.value === 'string' ? visibleWhen.value : '';
    const visibleWhenValues = conditionValues(visibleWhen);
    const visibleWhenOp = normalizeRequiredWhenOp(visibleWhen?.op);
    const visibleWhenField = visibleWhenFieldId ? fieldById.value.get(visibleWhenFieldId) : null;
    const visibleWhenFieldType = visibleWhenField?.type || null;
    const visibleWhenChoices =
      visibleWhenField && visibleWhenField.type === 'SELECT' ? normalizeFieldOptions(visibleWhenField).choices : [];
    return {
      id: entry.fieldId,
      name,
      type: field?.type || null,
      locked: field ? isFieldReadOnly(field) : false,
      missing: !field,
      required: !!entry.required,
      editable: entry?.editable !== false,
      noFuture: entry?.noFuture === true,
      auto,
      autoType,
      autoTemplate,
      autoMode,
      autoFixedValue,
      autoFixedChoices,
      autoFixedMissing,
      autoFixedPlaceholder,
      autoFixedHint,
      selectSourceType,
      selectSourceRelationFieldId,
      selectSourceTargetFieldId,
      selectSourceTargetOptions,
      selectSourcePlaceholder,
      selectSourceWarning,
      requiredWhen,
      requiredWhenFieldId,
      requiredWhenValue,
      requiredWhenValues,
      requiredWhenOp,
      requiredWhenFieldType,
      requiredWhenChoices,
      visibleWhen,
      visibleWhenFieldId,
      visibleWhenValue,
      visibleWhenValues,
      visibleWhenOp,
      visibleWhenFieldType,
      visibleWhenChoices,
    };
  });
});

const ruleBlocks = computed(() => resolvedActiveFormFields.value.filter((field) => field.requiredWhenFieldId));

const availableRuleTargets = computed(() =>
  resolvedActiveFormFields.value.filter((field) => !field.requiredWhenFieldId && !field.missing && !field.locked)
);

const visibilityBlocks = computed(() => resolvedActiveFormFields.value.filter((field) => field.visibleWhenFieldId));

const availableVisibilityTargets = computed(() =>
  resolvedActiveFormFields.value.filter((field) => !field.visibleWhenFieldId && !field.missing && !field.locked)
);

const clearFormFieldRequiredWhen = async (fieldId) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    if (!entry?.requiredWhen) return entry;
    const nextEntry = { ...entry };
    delete nextEntry.requiredWhen;
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const clearFormFieldVisibleWhen = async (fieldId) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    if (!entry?.visibleWhen) return entry;
    const nextEntry = { ...entry };
    delete nextEntry.visibleWhen;
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const addRequiredWhenRule = async () => {
  if (!canCreateForms.value) return;
  const targetFieldId = typeof newRuleTargetFieldId.value === 'string' ? newRuleTargetFieldId.value.trim() : '';
  const conditionFieldId =
    typeof newRuleConditionFieldId.value === 'string' ? newRuleConditionFieldId.value.trim() : '';
  if (!targetFieldId || !conditionFieldId) return;
  await updateFormFieldRequiredWhenField(targetFieldId, conditionFieldId);
  newRuleTargetFieldId.value = '';
  newRuleConditionFieldId.value = '';
};

const addVisibleWhenRule = async () => {
  if (!canCreateForms.value) return;
  const targetFieldId =
    typeof newVisibilityTargetFieldId.value === 'string' ? newVisibilityTargetFieldId.value.trim() : '';
  const conditionFieldId =
    typeof newVisibilityConditionFieldId.value === 'string' ? newVisibilityConditionFieldId.value.trim() : '';
  if (!targetFieldId || !conditionFieldId) return;
  await updateFormFieldVisibleWhenField(targetFieldId, conditionFieldId);
  newVisibilityTargetFieldId.value = '';
  newVisibilityConditionFieldId.value = '';
};

// Load the relation's rows for the form filter's value picker.
watch(
  () => formFilterRelation.value?.pageId || '',
  (pageId) => {
    if (!pageId) return;
    void loadRelationOptions(pageId);
  }
);
</script>

<template>
<div v-if="!activeForm" class="db-form-empty muted">Form not found.</div>
<template v-else>
  <div class="db-form-builder__header">
    <div class="db-form-builder__heading">
      <PageIcon
        class="db-form-builder__icon"
        :icon="activeForm.icon || DEFAULT_FORM_ICON"
        fallback="Fm"
        aria-hidden="true"
      />
      <div>
        <div class="db-form-builder__title">{{ activeForm.name }}</div>
        <div class="db-form-builder__meta">{{ activeForm.fields.length }} fields</div>
      </div>
    </div>
    <div class="db-form-builder__actions">
      <button
        v-if="!embedded && openFormPage"
        class="db-form-open-btn"
        type="button"
        @click="handleOpenFormPage"
      >
        Open form
      </button>
      <button
        v-if="canCreateForms"
        class="db-form-delete-btn"
        type="button"
        @click="deleteFormView(activeForm)"
      >
        Delete
      </button>
    </div>
  </div>
  <div class="db-form-builder__section">
    <div class="db-form-builder__section-title">Behavior</div>
    <div class="db-form-builder__row">
      <label class="db-form-builder__label">Mode</label>
      <select
        class="db-form-builder__select"
        :value="activeFormConfig.mode"
        :disabled="!canCreateForms || isReadonly"
        @change="updateFormMode($event.target.value)"
      >
        <option value="create">Create new records</option>
        <option value="update">Update existing records</option>
      </select>
    </div>
    <div
      v-if="isComplianceDatabase && activeFormConfig.mode === 'create'"
      class="db-form-builder__row"
    >
      <label class="db-form-builder__label">Initial status</label>
      <select
        class="db-form-builder__select"
        :value="activeFormConfig.initialStatus"
        :disabled="!canCreateForms || isReadonly"
        @change="updateFormInitialStatus($event.target.value)"
      >
        <option v-for="status in auditStatusOptions" :key="status.id" :value="status.id">
          {{ status.label }}
        </option>
      </select>
    </div>
    <div v-if="activeFormConfig.mode === 'update'" class="db-form-builder__row">
      <label class="db-form-builder__label">Filter field</label>
      <select
        class="db-form-builder__select"
        :value="activeFormConfig.filter?.fieldId || ''"
        :disabled="!canCreateForms || isReadonly"
        @change="updateFormFilterField($event.target.value)"
      >
        <option value="">Select field...</option>
        <option v-for="option in formFilterFieldOptions" :key="option.id" :value="option.id">
          {{ option.name }} ({{ formatFieldType(option.type) }})
        </option>
      </select>
    </div>
    <div v-if="activeFormConfig.mode === 'update' && activeFormConfig.filter" class="db-form-builder__row">
      <label class="db-form-builder__label">Condition</label>
      <select
        class="db-form-builder__select"
        :value="activeFormConfig.filter?.op || 'isEmpty'"
        :disabled="!canCreateForms || isReadonly"
        @change="updateFormFilterOp($event.target.value)"
      >
        <option value="isEmpty">Is empty</option>
        <option value="isNotEmpty">Is not empty</option>
        <option value="equals">Equals</option>
        <option value="notEquals">Does not equal</option>
      </select>
    </div>
    <div
      v-if="activeFormConfig.mode === 'update' && activeFormConfig.filter && formFilterNeedsValue"
      class="db-form-builder__row"
    >
      <label class="db-form-builder__label">Filter value</label>
      <select
        v-if="formFilterUsesChoices"
        class="db-form-builder__select"
        :value="formFilterValueSelection"
        :disabled="!canCreateForms || isReadonly"
        @change="updateFormFilterValue($event.target.value)"
      >
        <option value="">Select value...</option>
        <option v-for="choice in formFilterChoiceOptions" :key="choice.value" :value="choice.value">
          {{ choice.label || choice.value }}
        </option>
      </select>
      <select
        v-else-if="formFilterRelation"
        class="db-form-builder__select"
        :value="formFilterValueSelection"
        :disabled="!canCreateForms || isReadonly || !formFilterRelation?.pageId"
        @change="updateFormFilterValue($event.target.value)"
      >
        <option value="">{{ formFilterRelationPlaceholder }}</option>
        <option v-for="option in formFilterRelationOptions" :key="option.id" :value="option.id">
          {{ option.label || option.id }}
        </option>
      </select>
      <input
        v-else
        class="db-form-builder__input"
        type="text"
        :value="activeFormConfig.filter?.value ?? ''"
        :disabled="!canCreateForms || isReadonly"
        placeholder="Value"
        v-keep-typing
        @change="updateFormFilterValue($event.target.value)"
      />
    </div>
    <div v-if="activeFormConfig.mode === 'update' && formFilterWarning" class="db-form-builder__warning">
      {{ formFilterWarning }}
    </div>
    <div
      v-if="isComplianceDatabase && activeFormConfig.mode === 'update'"
      class="db-form-builder__row"
    >
      <label class="db-form-builder__label">Transition status</label>
      <select
        class="db-form-builder__select"
        :value="activeFormConfig.transitionStatus || ''"
        :disabled="!canCreateForms || isReadonly"
        @change="updateFormTransitionStatus($event.target.value)"
      >
        <option value="">No change</option>
        <option v-for="status in auditStatusOptions" :key="status.id" :value="status.id">
          {{ status.label }}
        </option>
      </select>
    </div>
    <div class="db-form-builder__row">
      <label class="db-form-builder__label">Success message</label>
      <textarea
        class="db-form-builder__textarea"
        :value="activeFormConfig.successMessage"
        :disabled="!canCreateForms || isReadonly"
        placeholder="Thanks! Your response has been saved."
        v-keep-typing
        @change="updateFormSuccessMessage($event.target.value)"
      ></textarea>
    </div>
    <label
      v-if="activeFormConfig.mode === 'update'"
      class="db-form-builder__toggle"
    >
      <input
        type="checkbox"
        :checked="activeFormConfig.showReturnButton"
        :disabled="!canCreateForms || isReadonly"
        @change="updateFormShowReturnButton($event.target.checked)"
      />
      Show “Back to list” button
    </label>
  </div>
  <div class="db-form-tabs">
    <button
      v-for="tab in formBuilderTabs"
      :key="tab.id"
      class="db-form-tab"
      :class="{ 'db-form-tab--active': formBuilderTab === tab.id }"
      type="button"
      @click="formBuilderTab = tab.id"
    >
      {{ tab.label }}
    </button>
  </div>
  <template v-if="formBuilderTab === 'fields'">
    <div class="db-form-fields">
      <div v-if="!activeForm.fields.length" class="db-form-empty muted">
        No fields yet. Add one from the database columns.
      </div>
      <div
        v-for="field in resolvedActiveFormFields"
        :key="field.id"
        class="db-form-field"
        :class="{
          'db-form-field--drag-over': formFieldDragOverId === field.id,
          'db-form-field--drop-before': formFieldDragOverId === field.id && formFieldDragOverPosition === 'before',
          'db-form-field--drop-after': formFieldDragOverId === field.id && formFieldDragOverPosition === 'after',
          'db-form-field--dragging': formFieldDragId === field.id,
        }"
        @dragover="handleFormFieldDragOver(field.id, $event)"
        @dragenter="handleFormFieldDragOver(field.id, $event)"
        @dragleave="handleFormFieldDragLeave(field.id, $event)"
        @drop="handleFormFieldDrop(field.id, $event)"
      >
        <div class="db-form-field__handle">
          <button
            class="db-form-field-handle drag-handle__btn drag-handle__btn--drag"
            type="button"
            :disabled="!canCreateForms"
            :draggable="canCreateForms"
            aria-label="Reorder field"
            @dragstart="handleFormFieldDragStart(field.id, $event)"
            @dragend="handleFormFieldDragEnd"
          >
            <PageIcon class="db-form-field-handle__icon" icon="icon:three-dots-vertical" fallback="···" aria-hidden="true" />
            <PageIcon class="db-form-field-handle__icon" icon="icon:three-dots-vertical" fallback="···" aria-hidden="true" />
          </button>
        </div>
        <div class="db-form-field__header">
          <div class="db-form-field__title">
            <div class="db-form-field-name">{{ field.name }}</div>
            <div class="db-form-field-meta">
              {{ field.missing ? 'Missing field' : formatFieldType(field.type) }}
            </div>
          </div>
          <span v-if="field.locked" class="db-form-field-lock">Locked</span>
        </div>
        <div class="db-form-field-controls">
          <label class="db-form-field-toggle">
            <input
              class="db-form-field-checkbox"
              type="checkbox"
              :checked="field.required"
              :disabled="field.missing || field.locked || isReadonly"
              @change="updateFormFieldRequired(field.id, $event.target.checked)"
            />
            Required
          </label>
          <label class="db-form-field-toggle">
            <input
              class="db-form-field-checkbox"
              type="checkbox"
              :checked="field.editable"
              :disabled="field.missing || field.locked || isReadonly"
              @change="updateFormFieldEditable(field.id, $event.target.checked)"
            />
            Editable
          </label>
          <label v-if="field.type === 'DATE'" class="db-form-field-toggle">
            <input
              class="db-form-field-checkbox"
              type="checkbox"
              :checked="field.noFuture"
              :disabled="field.missing || field.locked || isReadonly"
              @change="updateFormFieldNoFuture(field.id, $event.target.checked)"
            />
            No future
          </label>
        </div>
        <div class="db-form-field-controls">
          <label class="db-form-field-label">Required when</label>
          <select
            class="db-form-field-select"
            :value="field.requiredWhenFieldId"
            :disabled="field.missing || field.locked || isReadonly || !formConditionFieldOptions.length"
            @change="updateFormFieldRequiredWhenField(field.id, $event.target.value)"
          >
            <option value="">No condition</option>
            <option v-for="option in formConditionFieldOptions" :key="option.id" :value="option.id">
              {{ option.name }}
            </option>
          </select>
        </div>
        <div v-if="field.requiredWhenFieldId" class="db-form-field-controls">
          <label class="db-form-field-label">Condition</label>
          <select
            class="db-form-field-select"
            :value="field.requiredWhenOp"
            :disabled="field.missing || field.locked || isReadonly"
            @change="updateFormFieldRequiredWhenOp(field.id, $event.target.value)"
          >
            <option
              v-for="option in getConditionOpOptions(field.requiredWhenFieldType, field.requiredWhenChoices.length)"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </div>
        <div v-if="field.requiredWhenFieldId && field.requiredWhenOp === 'equals'" class="db-form-field-controls">
          <label class="db-form-field-label">Condition value</label>
          <select
            class="db-form-field-select"
            :value="field.requiredWhenValue"
            :disabled="field.missing || field.locked || isReadonly"
            @change="updateFormFieldRequiredWhenValue(field.id, $event.target.value)"
          >
            <option value="">Select value</option>
            <option v-for="choice in field.requiredWhenChoices" :key="choice.value" :value="choice.value">
              {{ choice.label || choice.value }}
            </option>
          </select>
        </div>
        <div v-if="field.requiredWhenFieldId && field.requiredWhenOp === 'isAnyOf'" class="db-form-field-controls">
          <label class="db-form-field-label">Condition values</label>
          <div class="db-form-condition-values">
            <label v-for="choice in field.requiredWhenChoices" :key="choice.value" class="db-form-condition-value">
              <input
                type="checkbox"
                :checked="field.requiredWhenValues.includes(choice.value)"
                :disabled="
                  field.missing ||
                  field.locked ||
                  isReadonly ||
                  (field.requiredWhenValues.length === 1 && field.requiredWhenValues.includes(choice.value))
                "
                @change="toggleFormFieldConditionValue(field.id, 'requiredWhen', choice.value, $event.target.checked)"
              />
              {{ choice.label || choice.value }}
            </label>
          </div>
        </div>
        <div v-if="field.type === 'SELECT'" class="db-form-field-controls">
          <label class="db-form-field-label">Options source</label>
          <select
            class="db-form-field-select"
            :value="field.selectSourceType"
            :disabled="field.missing || field.locked || isReadonly"
            @change="updateFormFieldSelectSourceType(field.id, $event.target.value)"
          >
            <option value="manual">Manual options</option>
            <option value="relation" :disabled="!hasFormSelectSourceRelations">Relation table</option>
          </select>
        </div>
        <div v-if="field.type === 'SELECT' && field.selectSourceType === 'relation'" class="db-form-field-controls">
          <label class="db-form-field-label">Relation field</label>
          <select
            class="db-form-field-select"
            :value="field.selectSourceRelationFieldId"
            :disabled="field.missing || field.locked || isReadonly || !hasFormSelectSourceRelations"
            @change="updateFormFieldSelectSourceRelation(field.id, $event.target.value)"
          >
            <option value="">Select relation...</option>
            <option v-for="option in formSelectSourceRelations" :key="option.id" :value="option.id">
              {{ option.name }}
            </option>
          </select>
        </div>
        <div v-if="field.type === 'SELECT' && field.selectSourceType === 'relation'" class="db-form-field-controls">
          <label class="db-form-field-label">Related field</label>
          <select
            class="db-form-field-select"
            :value="field.selectSourceTargetFieldId"
            :disabled="field.missing || field.locked || isReadonly || !field.selectSourceRelationFieldId"
            @change="updateFormFieldSelectSourceTarget(field.id, $event.target.value)"
          >
            <option value="">{{ field.selectSourcePlaceholder }}</option>
            <option v-for="option in field.selectSourceTargetOptions" :key="option.id" :value="option.id">
              {{ option.name }} ({{ formatFieldType(option.type) }})
            </option>
          </select>
        </div>
        <div
          v-if="field.type === 'SELECT' && field.selectSourceType === 'relation' && field.selectSourceWarning"
          class="db-form-field-hint"
        >
          {{ field.selectSourceWarning }}
        </div>
        <div class="db-form-field-controls">
          <label class="db-form-field-label">Autofill</label>
          <select
            class="db-form-field-select"
            :value="field.autoType"
            :disabled="field.missing || field.locked || isReadonly"
            @change="updateFormFieldAutoType(field.id, $event.target.value)"
          >
            <option value="">None</option>
            <option value="currentUser">Current user</option>
            <option value="template">Template</option>
            <option value="today" :disabled="field.type !== 'DATE'">Today</option>
            <option
              value="fixed"
              :disabled="(field.type !== 'SELECT' && field.type !== 'RELATION') || !field.autoFixedChoices.length"
            >
              Fixed value
            </option>
          </select>
        </div>
        <div v-if="field.autoType === 'fixed'" class="db-form-field-controls">
          <label class="db-form-field-label">Fixed value</label>
          <select
            class="db-form-field-select"
            :value="field.autoFixedValue"
            :disabled="
              field.missing ||
              field.locked ||
              isReadonly ||
              !field.autoFixedChoices.length
            "
            @change="updateFormFieldAutoFixedValue(field.id, $event.target.value)"
          >
            <option value="">{{ field.autoFixedPlaceholder }}</option>
            <option v-for="choice in field.autoFixedChoices" :key="choice.value" :value="choice.value">
              {{ choice.label || choice.value }}
            </option>
          </select>
        </div>
        <div v-if="field.autoType === 'fixed' && field.autoFixedHint" class="db-form-field-hint">
          {{ field.autoFixedHint }}
        </div>
        <div v-if="field.autoType === 'currentUser' && field.type !== 'PERSON'" class="db-form-field-controls">
          <label class="db-form-field-label">User value</label>
          <select
            class="db-form-field-select"
            :value="field.autoMode"
            :disabled="field.missing || field.locked || isReadonly"
            @change="updateFormFieldAutoMode(field.id, $event.target.value)"
          >
            <option value="name">Name</option>
            <option value="id">User ID</option>
          </select>
        </div>
        <div v-if="field.autoType === 'template'" class="db-form-field-controls">
          <label class="db-form-field-label">Template</label>
          <input
            class="db-form-field-input"
            type="text"
            :value="field.autoTemplate"
            :disabled="field.missing || field.locked || isReadonly"
            placeholder="Incident Report #{{counter}}"
            v-keep-typing
            @change="updateFormFieldAutoTemplate(field.id, $event.target.value)"
          />
          <div class="db-form-field-hint" v-pre>Use {{counter}}, {{user}}, {{userId}}, {{date}}, {{datetime}}</div>
        </div>
      </div>
    </div>
    <div class="db-form-add">
      <select
        v-model="formFieldSelectId"
        class="db-form-select"
        :disabled="!formFieldOptions.length"
      >
        <option value="">Add field...</option>
        <option v-for="option in formFieldOptions" :key="option.id" :value="option.id">
          {{ option.name }} ({{ formatFieldType(option.type) }})
        </option>
      </select>
      <button class="db-form-add-btn" type="button" :disabled="!formFieldSelectId" @click="addFieldToActiveForm">
        Add
      </button>
    </div>
  </template>
  <div v-else-if="formBuilderTab === 'rules'" class="db-form-rules">
    <div class="db-form-rules__header">
      <div>
        <div class="db-form-rules__title">Rules</div>
        <div class="db-form-rules__meta muted">Set required fields, autofill values, and conditional rules.</div>
      </div>
    </div>
    <div v-if="!resolvedActiveFormFields.length" class="db-form-empty muted">
      Add fields to build rules.
    </div>
    <div v-else class="db-form-rules__content">
      <div class="db-form-rules__section">
        <div class="db-form-rules__section-title">Required fields</div>
        <div class="db-form-rules__required-grid">
          <label
            v-for="field in resolvedActiveFormFields"
            :key="field.id"
            class="db-form-rules__required-item"
            :class="{ 'db-form-rules__required-item--disabled': field.missing || field.locked }"
          >
            <input
              class="db-form-field-checkbox"
              type="checkbox"
              :checked="field.required"
              :disabled="field.missing || field.locked || isReadonly"
              @change="updateFormFieldRequired(field.id, $event.target.checked)"
            />
            <span class="db-form-rules__required-name">{{ field.name }}</span>
            <span class="db-form-rules__required-meta">
              {{ field.missing ? 'Missing field' : formatFieldType(field.type) }}
            </span>
          </label>
        </div>
      </div>
      <div class="db-form-rules__section">
        <div class="db-form-rules__section-title">Autofill</div>
        <div class="db-form-rules__blocks">
          <div v-for="field in resolvedActiveFormFields" :key="`autofill-${field.id}`" class="db-form-rule-block">
            <div class="db-form-rule-block__row">
              <span class="db-form-rule-block__pill">Field</span>
              <span class="db-form-rule-block__target">{{ field.name }}</span>
              <span class="db-form-rule-block__pill">Autofill</span>
              <select
                class="db-form-rule-block__select"
                :value="field.autoType"
                :disabled="field.missing || field.locked || isReadonly"
                @change="updateFormFieldAutoType(field.id, $event.target.value)"
              >
                <option value="">None</option>
                <option value="currentUser">Current user</option>
                <option value="template">Template</option>
                <option value="today" :disabled="field.type !== 'DATE'">Today</option>
                <option
                  value="fixed"
                  :disabled="(field.type !== 'SELECT' && field.type !== 'RELATION') || !field.autoFixedChoices.length"
                >
                  Fixed value
                </option>
              </select>
            </div>
            <div v-if="field.autoType === 'fixed'" class="db-form-rule-block__row">
              <span class="db-form-rule-block__pill">Value</span>
              <select
                class="db-form-rule-block__select"
                :value="field.autoFixedValue"
                :disabled="field.missing || field.locked || isReadonly || !field.autoFixedChoices.length"
                @change="updateFormFieldAutoFixedValue(field.id, $event.target.value)"
              >
                <option value="">{{ field.autoFixedPlaceholder }}</option>
                <option v-for="choice in field.autoFixedChoices" :key="choice.value" :value="choice.value">
                  {{ choice.label || choice.value }}
                </option>
              </select>
            </div>
            <div v-if="field.autoType === 'fixed' && field.autoFixedHint" class="db-form-rule-block__hint muted">
              {{ field.autoFixedHint }}
            </div>
            <div v-if="field.autoType === 'currentUser' && field.type !== 'PERSON'" class="db-form-rule-block__row">
              <span class="db-form-rule-block__pill">User value</span>
              <select
                class="db-form-rule-block__select"
                :value="field.autoMode"
                :disabled="field.missing || field.locked || isReadonly"
                @change="updateFormFieldAutoMode(field.id, $event.target.value)"
              >
                <option value="name">Name</option>
                <option value="id">User ID</option>
              </select>
            </div>
            <div v-if="field.autoType === 'template'" class="db-form-rule-block__row">
              <span class="db-form-rule-block__pill">Template</span>
              <input
                class="db-form-rule-block__input"
                type="text"
                :value="field.autoTemplate"
                :disabled="field.missing || field.locked || isReadonly"
                placeholder="Incident Report #{{counter}}"
                v-keep-typing
                @change="updateFormFieldAutoTemplate(field.id, $event.target.value)"
              />
            </div>
            <div v-if="field.autoType === 'template'" class="db-form-rule-block__hint muted" v-pre>
              Use {{counter}}, {{user}}, {{userId}}, {{date}}, {{datetime}}
            </div>
          </div>
        </div>
      </div>
      <div class="db-form-rules__section">
        <div class="db-form-rules__section-title">Conditional requirements</div>
        <div v-if="!ruleBlocks.length" class="db-form-empty muted">
          No conditional rules yet.
        </div>
        <div v-else class="db-form-rules__blocks">
          <div v-for="field in ruleBlocks" :key="field.id" class="db-form-rule-block">
            <div class="db-form-rule-block__row">
              <span class="db-form-rule-block__pill">If</span>
              <select
                class="db-form-rule-block__select"
                :value="field.requiredWhenFieldId"
                :disabled="field.missing || field.locked || isReadonly"
                @change="updateFormFieldRequiredWhenField(field.id, $event.target.value)"
              >
                <option value="">Select field...</option>
                <option v-for="option in formConditionFieldOptions" :key="option.id" :value="option.id">
                  {{ option.name }} ({{ formatFieldType(option.type) }})
                </option>
              </select>
              <select
                class="db-form-rule-block__select"
                :value="field.requiredWhenOp"
                :disabled="field.missing || field.locked || isReadonly"
                @change="updateFormFieldRequiredWhenOp(field.id, $event.target.value)"
              >
                <option
                  v-for="option in getConditionOpOptions(field.requiredWhenFieldType, field.requiredWhenChoices.length)"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
              <select
                v-if="field.requiredWhenOp === 'equals'"
                class="db-form-rule-block__select"
                :value="field.requiredWhenValue"
                :disabled="field.missing || field.locked || isReadonly"
                @change="updateFormFieldRequiredWhenValue(field.id, $event.target.value)"
              >
                <option value="">Select value</option>
                <option v-for="choice in field.requiredWhenChoices" :key="choice.value" :value="choice.value">
                  {{ choice.label || choice.value }}
                </option>
              </select>
              <div v-if="field.requiredWhenOp === 'isAnyOf'" class="db-form-condition-values">
                <label v-for="choice in field.requiredWhenChoices" :key="choice.value" class="db-form-condition-value">
                  <input
                    type="checkbox"
                    :checked="field.requiredWhenValues.includes(choice.value)"
                    :disabled="
                      field.missing ||
                      field.locked ||
                      isReadonly ||
                      (field.requiredWhenValues.length === 1 && field.requiredWhenValues.includes(choice.value))
                    "
                    @change="toggleFormFieldConditionValue(field.id, 'requiredWhen', choice.value, $event.target.checked)"
                  />
                  {{ choice.label || choice.value }}
                </label>
              </div>
              <span class="db-form-rule-block__pill">Then require</span>
              <span class="db-form-rule-block__target">{{ field.name }}</span>
              <button
                class="db-form-rule-block__remove"
                type="button"
                :disabled="field.missing || field.locked || isReadonly"
                @click="clearFormFieldRequiredWhen(field.id)"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
        <div class="db-form-rule-block db-form-rule-block--new">
          <div class="db-form-rule-block__row">
            <span class="db-form-rule-block__pill">If</span>
            <select
              v-model="newRuleConditionFieldId"
              class="db-form-rule-block__select"
              :disabled="!canCreateForms || isReadonly || !formConditionFieldOptions.length"
            >
              <option value="">Select field...</option>
              <option v-for="option in formConditionFieldOptions" :key="option.id" :value="option.id">
                {{ option.name }} ({{ formatFieldType(option.type) }})
              </option>
            </select>
            <span class="db-form-rule-block__pill">Then require</span>
            <select
              v-model="newRuleTargetFieldId"
              class="db-form-rule-block__select"
              :disabled="!canCreateForms || isReadonly || !availableRuleTargets.length"
            >
              <option value="">Select field...</option>
              <option v-for="option in availableRuleTargets" :key="option.id" :value="option.id">
                {{ option.name }} ({{ formatFieldType(option.type) }})
              </option>
            </select>
            <button
              class="db-form-rule-block__add"
              type="button"
              :disabled="!canCreateForms || isReadonly || !newRuleConditionFieldId || !newRuleTargetFieldId"
              @click="addRequiredWhenRule"
            >
              Add rule
            </button>
          </div>
          <div v-if="!availableRuleTargets.length" class="db-form-rule-block__hint muted">
            All fields already have a conditional rule.
          </div>
        </div>
      </div>
      <div class="db-form-rules__section">
        <div class="db-form-rules__section-title">Visibility rules</div>
        <div v-if="!visibilityBlocks.length" class="db-form-empty muted">
          No visibility rules yet.
        </div>
        <div v-else class="db-form-rules__blocks">
          <div v-for="field in visibilityBlocks" :key="field.id" class="db-form-rule-block">
            <div class="db-form-rule-block__row">
              <span class="db-form-rule-block__pill">If</span>
              <select
                class="db-form-rule-block__select"
                :value="field.visibleWhenFieldId"
                :disabled="field.missing || field.locked || isReadonly"
                @change="updateFormFieldVisibleWhenField(field.id, $event.target.value)"
              >
                <option value="">Select field...</option>
                <option v-for="option in formConditionFieldOptions" :key="option.id" :value="option.id">
                  {{ option.name }} ({{ formatFieldType(option.type) }})
                </option>
              </select>
              <select
                class="db-form-rule-block__select"
                :value="field.visibleWhenOp"
                :disabled="field.missing || field.locked || isReadonly"
                @change="updateFormFieldVisibleWhenOp(field.id, $event.target.value)"
              >
                <option
                  v-for="option in getConditionOpOptions(field.visibleWhenFieldType, field.visibleWhenChoices.length)"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
              <select
                v-if="field.visibleWhenOp === 'equals'"
                class="db-form-rule-block__select"
                :value="field.visibleWhenValue"
                :disabled="field.missing || field.locked || isReadonly"
                @change="updateFormFieldVisibleWhenValue(field.id, $event.target.value)"
              >
                <option value="">Select value</option>
                <option v-for="choice in field.visibleWhenChoices" :key="choice.value" :value="choice.value">
                  {{ choice.label || choice.value }}
                </option>
              </select>
              <div v-if="field.visibleWhenOp === 'isAnyOf'" class="db-form-condition-values">
                <label v-for="choice in field.visibleWhenChoices" :key="choice.value" class="db-form-condition-value">
                  <input
                    type="checkbox"
                    :checked="field.visibleWhenValues.includes(choice.value)"
                    :disabled="
                      field.missing ||
                      field.locked ||
                      isReadonly ||
                      (field.visibleWhenValues.length === 1 && field.visibleWhenValues.includes(choice.value))
                    "
                    @change="toggleFormFieldConditionValue(field.id, 'visibleWhen', choice.value, $event.target.checked)"
                  />
                  {{ choice.label || choice.value }}
                </label>
              </div>
              <span class="db-form-rule-block__pill">Then show</span>
              <span class="db-form-rule-block__target">{{ field.name }}</span>
              <button
                class="db-form-rule-block__remove"
                type="button"
                :disabled="field.missing || field.locked || isReadonly"
                @click="clearFormFieldVisibleWhen(field.id)"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
        <div class="db-form-rule-block db-form-rule-block--new">
          <div class="db-form-rule-block__row">
            <span class="db-form-rule-block__pill">If</span>
            <select
              v-model="newVisibilityConditionFieldId"
              class="db-form-rule-block__select"
              :disabled="!canCreateForms || isReadonly || !formConditionFieldOptions.length"
            >
              <option value="">Select field...</option>
              <option v-for="option in formConditionFieldOptions" :key="option.id" :value="option.id">
                {{ option.name }} ({{ formatFieldType(option.type) }})
              </option>
            </select>
            <span class="db-form-rule-block__pill">Then show</span>
            <select
              v-model="newVisibilityTargetFieldId"
              class="db-form-rule-block__select"
              :disabled="!canCreateForms || isReadonly || !availableVisibilityTargets.length"
            >
              <option value="">Select field...</option>
              <option v-for="option in availableVisibilityTargets" :key="option.id" :value="option.id">
                {{ option.name }} ({{ formatFieldType(option.type) }})
              </option>
            </select>
            <button
              class="db-form-rule-block__add"
              type="button"
              :disabled="
                !canCreateForms ||
                isReadonly ||
                !newVisibilityConditionFieldId ||
                !newVisibilityTargetFieldId
              "
              @click="addVisibleWhenRule"
            >
              Add rule
            </button>
          </div>
          <div v-if="!availableVisibilityTargets.length" class="db-form-rule-block__hint muted">
            All fields already have a visibility rule.
          </div>
        </div>
      </div>
    </div>
  </div>
  <div v-else-if="formBuilderTab === 'layout'" class="db-form-layout">
    <DatabaseFormPage v-if="activeForm?.id" :form-id="activeForm.id" embedded preview />
  </div>
</template>
</template>
