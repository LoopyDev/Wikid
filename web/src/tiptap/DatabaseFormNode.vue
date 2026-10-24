<script setup>
import { NodeViewWrapper } from '@tiptap/vue-3';
import { computed, ref, watch } from 'vue';
import { api } from '../api/client';
import { useWorkspaceStore } from '../stores/workspace';
import DatabaseFormPage from '../components/DatabaseFormPage.vue';
import PageIcon from '../components/PageIcon.vue';

const props = defineProps({
  editor: { type: Object, required: true },
  node: { type: Object, required: true },
  extension: { type: Object, required: true },
  updateAttributes: { type: Function, required: true },
  selected: { type: Boolean, default: false },
});

const workspace = useWorkspaceStore();
const activeUser = computed(() => workspace.activeUser);
const attrs = computed(() => props.node?.attrs || {});
const canEdit = computed(() => props.editor?.isEditable ?? true);
const pickerOpen = ref(false);
const forms = ref([]);
const formsLoading = ref(false);
const formsError = ref('');
const loadedDatabaseId = ref('');
const DEFAULT_FORM_ICON = 'icon:pencil-square';

const listDatabasePages = () => {
  const list = props.extension.options?.listDatabasePages;
  if (typeof list === 'function') {
    const pages = list();
    if (Array.isArray(pages)) return pages;
  }
  return workspace.pages.filter((page) => page && page.kind === 'DATABASE' && !page.isDeleted && !page.isHidden);
};

const databasePages = computed(() =>
  listDatabasePages()
    .slice()
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
);

const selectedDatabaseId = computed(() => (typeof attrs.value.databasePageId === 'string' ? attrs.value.databasePageId : ''));
const hasForm = computed(() => typeof attrs.value.formId === 'string' && !!attrs.value.formId);
const showPicker = computed(() => pickerOpen.value || !hasForm.value);

const activeForm = computed(() => forms.value.find((form) => form.id === attrs.value.formId) || null);
const displayName = computed(() => activeForm.value?.name || attrs.value.name || 'Form');
const displayIcon = computed(() => activeForm.value?.icon || attrs.value.icon || DEFAULT_FORM_ICON);
const statusMessage = computed(() => {
  if (!selectedDatabaseId.value) {
    if (!databasePages.value.length) return 'No database pages yet.';
    return 'Choose a database to load forms.';
  }
  if (formsLoading.value) return 'Loading forms...';
  if (formsError.value) return 'Unable to load forms.';
  if (!forms.value.length) return 'No forms in this database yet.';
  return 'Select a form to embed.';
});

const loadForms = async (databasePageId) => {
  if (!databasePageId) {
    forms.value = [];
    formsError.value = '';
    loadedDatabaseId.value = '';
    return;
  }
  if (!workspace.hasApi || !activeUser.value) return;
  if (loadedDatabaseId.value === databasePageId) return;
  forms.value = [];
  formsLoading.value = true;
  formsError.value = '';
  try {
    const res = await api.getDatabase(databasePageId, {
      userId: activeUser.value.id,
      userName: activeUser.value.name,
    });
    const nextForms = Array.isArray(res?.forms)
      ? res.forms
          .map((form) => ({
            id: typeof form?.id === 'string' ? form.id : '',
            name: typeof form?.name === 'string' && form.name.trim() ? form.name.trim() : 'Form',
            icon: typeof form?.icon === 'string' && form.icon.trim() ? form.icon.trim() : DEFAULT_FORM_ICON,
          }))
          .filter((form) => form.id)
      : [];
    forms.value = nextForms;
    loadedDatabaseId.value = databasePageId;
  } catch (err) {
    console.warn('Load forms failed', err);
    formsError.value = err?.message || 'Failed to load forms';
    forms.value = [];
  } finally {
    formsLoading.value = false;
  }
};

const ensureFormMetadata = async (formId) => {
  if (!formId || selectedDatabaseId.value) return;
  if (!workspace.hasApi || !activeUser.value) return;
  try {
    const res = await api.getDatabaseForm(formId, {
      userId: activeUser.value.id,
      userName: activeUser.value.name,
    });
    const databasePageId = typeof res?.databasePageId === 'string' ? res.databasePageId : '';
    const name = typeof res?.name === 'string' ? res.name.trim() : '';
    const icon = typeof res?.icon === 'string' && res.icon.trim() ? res.icon.trim() : DEFAULT_FORM_ICON;
    if (!databasePageId) return;
    props.updateAttributes({
      databasePageId,
      name: name || attrs.value.name || '',
      icon,
    });
  } catch (err) {
    console.warn('Resolve form metadata failed', err);
  }
};

const handleDatabaseSelect = (event) => {
  if (!canEdit.value) return;
  const nextId = event?.target?.value || '';
  if (!nextId) return;
  props.updateAttributes({
    databasePageId: nextId,
    formId: '',
    name: '',
    icon: '',
  });
  pickerOpen.value = true;
};

const handleFormSelect = (event) => {
  if (!canEdit.value) return;
  const nextId = event?.target?.value || '';
  if (!nextId) return;
  const form = forms.value.find((entry) => entry.id === nextId);
  props.updateAttributes({
    formId: nextId,
    name: form?.name || '',
    icon: form?.icon || DEFAULT_FORM_ICON,
    databasePageId: selectedDatabaseId.value,
  });
  pickerOpen.value = false;
};

const handleChangeForm = () => {
  if (!canEdit.value) return;
  pickerOpen.value = true;
};

const handleCancelPicker = () => {
  if (!canEdit.value || !hasForm.value) return;
  pickerOpen.value = false;
};

watch(
  () => [selectedDatabaseId.value, workspace.hasApi, activeUser.value?.id],
  ([next, hasApi, userId]) => {
    if (!hasApi || !userId) return;
    loadForms(next);
  },
  { immediate: true }
);

watch(
  () => [attrs.value.formId, workspace.hasApi, activeUser.value?.id],
  ([formId, hasApi, userId]) => {
    if (!formId) {
      pickerOpen.value = true;
      return;
    }
    if (!hasApi || !userId) return;
    ensureFormMetadata(formId);
  },
  { immediate: true }
);
</script>

<template>
  <NodeViewWrapper
    class="ce-database-form"
    :class="{ 'ce-database-form--selected': selected }"
    contenteditable="false"
    data-type="database-form"
  >
    <div v-if="hasForm" class="ce-database-form__header">
      <div class="ce-database-form__title">
        <PageIcon class="ce-database-form__icon" :icon="displayIcon" fallback="Fm" aria-hidden="true" />
        <div class="ce-database-form__text">
          <span class="ce-database-form__name">{{ displayName }}</span>
          <span class="ce-database-form__meta">Embedded form</span>
        </div>
      </div>
      <div v-if="canEdit" class="ce-database-form__actions">
        <button class="ghost-btn ghost-btn-background" type="button" @click="handleChangeForm">
          Change form
        </button>
      </div>
    </div>

    <div v-if="showPicker" class="ce-database-form__picker">
      <div class="ce-database-form__empty">{{ statusMessage }}</div>
      <div class="ce-database-form__controls">
        <label class="ce-database-form__label">Database</label>
        <select
          class="ce-database-form__select"
          :value="selectedDatabaseId"
          :disabled="!canEdit"
          @change="handleDatabaseSelect"
        >
          <option value="">Select a database</option>
          <option v-for="page in databasePages" :key="page.id" :value="page.id">
            {{ page.title || 'Untitled database' }}
          </option>
        </select>
      </div>
      <div v-if="selectedDatabaseId" class="ce-database-form__controls">
        <label class="ce-database-form__label">Form</label>
        <select
          class="ce-database-form__select"
          :value="attrs.formId"
          :disabled="!canEdit || formsLoading || !forms.length"
          @change="handleFormSelect"
        >
          <option value="">Select a form</option>
          <option v-for="form in forms" :key="form.id" :value="form.id">
            {{ form.name }}
          </option>
        </select>
      </div>
      <div v-if="formsError" class="alert">{{ formsError }}</div>
      <div v-else-if="selectedDatabaseId && !formsLoading && !forms.length" class="ce-database-form__empty muted">
        No forms in this database yet.
      </div>
      <div v-if="hasForm && canEdit" class="ce-database-form__actions">
        <button class="ghost-btn ghost-btn-background" type="button" @click="handleCancelPicker">Cancel</button>
      </div>
    </div>

    <div v-else class="ce-database-form__body">
      <DatabaseFormPage :form-id="attrs.formId" embedded />
    </div>
  </NodeViewWrapper>
</template>
