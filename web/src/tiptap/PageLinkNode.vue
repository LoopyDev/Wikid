<script setup>
import { NodeViewWrapper } from '@tiptap/vue-3';
import { computed, ref, watch } from 'vue';
import PageIcon from '../components/PageIcon.vue';
import { formatDateTime } from '../utils/date-format';

const props = defineProps({
  editor: { type: Object, required: true },
  node: { type: Object, required: true },
  extension: { type: Object, required: true },
  updateAttributes: { type: Function, required: true },
  getPos: { type: Function, required: false },
  selected: { type: Boolean, default: false },
});

const pageSearch = ref('');

const attrs = computed(() => props.node.attrs || {});

const parseAttribute = (value) => {
  if (typeof value !== 'string') return { kind: '', key: '' };
  const trimmed = value.trim();
  if (!trimmed) return { kind: '', key: '' };
  if (trimmed.startsWith('builtin:')) return { kind: 'builtin', key: trimmed.slice(8) };
  if (trimmed.startsWith('field:')) return { kind: 'field', key: trimmed.slice(6) };
  return { kind: '', key: '' };
};

const resolvedPage = computed(() => {
  const resolver = props.extension.options?.resolvePage;
  if (typeof resolver === 'function' && attrs.value.pageId) {
    return resolver(attrs.value.pageId);
  }
  return null;
});

const isMissing = computed(() => !!attrs.value.pageId && !resolvedPage.value);
const isDeleted = computed(() => !!resolvedPage.value?.isDeleted);
const showPicker = computed(() => !attrs.value.pageId || isMissing.value || isDeleted.value);
const isCardStyle = computed(() => showPicker.value || attrs.value.style !== 'small');

const listPages = computed(() => {
  const list = props.extension.options?.listWorkspacePages;
  if (typeof list === 'function') return list();
  return [];
});
const filteredPages = computed(() => {
  const query = pageSearch.value.trim().toLowerCase();
  const pages = listPages.value.filter((page) => page && !page.isDeleted);
  if (!query) {
    return [...pages].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  }
  return pages
    .filter((page) => (page.title || 'Untitled page').toLowerCase().includes(query))
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
});

const displayTitle = computed(() => {
  if (resolvedPage.value?.title) return resolvedPage.value.title;
  if (attrs.value.title) return attrs.value.title;
  if (isMissing.value) return 'Page deleted';
  return 'Untitled page';
});

const displayIcon = computed(() => resolvedPage.value?.icon || attrs.value.icon || '');

const attributeSelection = computed(() => parseAttribute(attrs.value.attribute));
const attributeContext = computed(() => {
  const resolver = props.extension.options?.getPageLinkAttributeData;
  if (typeof resolver === 'function' && attrs.value.pageId) {
    return resolver(attrs.value.pageId);
  }
  return null;
});

const normalizeFieldOptions = (field) => {
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

const getFieldSource = (field) => normalizeFieldOptions(field).source || null;

const getFieldChoices = (field) => normalizeFieldOptions(field).choices || [];

const getChoiceLabel = (field, value) => {
  if (!value) return '';
  const choices = getFieldChoices(field);
  const match = choices.find((choice) => choice.value === value);
  if (match?.label) return match.label;
  if (match?.value) return match.value;
  return String(value);
};

const getMultiSelectValues = (dataValue) => {
  if (Array.isArray(dataValue)) {
    return dataValue.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof dataValue === 'string') {
    return dataValue
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};


const resolveRowLastEdited = (row) => {
  const rowUpdated = row?.updatedAt ? new Date(row.updatedAt) : null;
  const pageUpdated = resolvedPage.value?.updatedAt ? new Date(resolvedPage.value.updatedAt) : null;
  const rowValid = rowUpdated && !Number.isNaN(rowUpdated.getTime()) ? rowUpdated : null;
  const pageValid = pageUpdated && !Number.isNaN(pageUpdated.getTime()) ? pageUpdated : null;
  if (rowValid && pageValid) {
    return pageValid > rowValid ? pageValid : rowValid;
  }
  return rowValid || pageValid || null;
};

const formatBuiltinValue = (key) => {
  const page = resolvedPage.value;
  if (!page) return '';
  switch (key) {
    case 'createdAt':
      return formatDateTime(page.createdAt);
    case 'updatedAt':
      return formatDateTime(page.updatedAt);
    case 'kind':
      return page.kind === 'DATABASE' ? 'Database' : 'Page';
    case 'visibility':
      return page.visibility === 'PRIVATE' ? 'Private' : 'Public';
    default:
      return '';
  }
};

const formatFieldValue = (field, row) => {
  if (!field) return '';
  if (getFieldSource(field) === 'lastEdited') {
    return formatDateTime(resolveRowLastEdited(row));
  }
  const value = row?.data?.[field.id];
  if (value === null || value === undefined || value === '') return '';
  switch (field.type) {
    case 'MULTI_SELECT': {
      const values = getMultiSelectValues(value);
      if (!values.length) return '';
      return values.map((entry) => getChoiceLabel(field, entry)).filter(Boolean).join(', ');
    }
    case 'SELECT':
      return getChoiceLabel(field, value);
    case 'RELATION': {
      if (Array.isArray(value)) {
        return value
          .map((entry) => {
            if (!entry) return '';
            if (typeof entry === 'string') return entry;
            if (typeof entry === 'object') return entry.label || entry.id || '';
            return '';
          })
          .filter(Boolean)
          .join(', ');
      }
      if (value && typeof value === 'object') {
        return value.label || value.id || '';
      }
      return value ? String(value) : '';
    }
    case 'CHECKBOX':
      return value ? 'Yes' : 'No';
    case 'DATE':
      return formatDateTime(value);
    default:
      return Array.isArray(value) ? value.join(', ') : String(value);
  }
};

const cardHint = computed(() => {
  const selection = attributeSelection.value;
  if (!selection.kind) return 'Page link';
  if (selection.kind === 'builtin') {
    const value = formatBuiltinValue(selection.key);
    return value || '-';
  }
  if (selection.kind === 'field') {
    const context = attributeContext.value;
    const field = context?.database?.fields?.find((item) => item?.id === selection.key) || null;
    const value = formatFieldValue(field, context?.row);
    return value || '-';
  }
  return 'Page link';
});

const handleOpen = () => {
  const open = props.extension.options?.openPage;
  if (typeof open === 'function' && attrs.value.pageId) {
    open(attrs.value.pageId);
  }
};
const handleActivate = () => {
  if (showPicker.value) return;
  handleOpen();
};
const handleKeyActivate = (event) => {
  if (showPicker.value) return;
  event.preventDefault();
  handleOpen();
};

const handleRestore = async () => {
  const restore = props.extension.options?.restorePage;
  if (typeof restore === 'function' && attrs.value.pageId) {
    await Promise.resolve(restore(attrs.value.pageId));
  }
};
const handleSelectPage = (page) => {
  if (!page?.id) return;
  props.updateAttributes({
    pageId: page.id,
    title: page.title || '',
    icon: page.icon || '',
  });
  pageSearch.value = '';
};

const maybeLoadAttributes = () => {
  const loader = props.extension.options?.loadPageLinkAttributes;
  if (typeof loader !== 'function') return;
  if (!attrs.value.pageId) return;
  if (parseAttribute(attrs.value.attribute).kind !== 'field') return;
  loader(attrs.value.pageId);
};

watch(
  () => [attrs.value.pageId, attrs.value.attribute],
  () => {
    maybeLoadAttributes();
  },
  { immediate: true }
);
</script>

<template>
  <NodeViewWrapper
    class="ce-page-link"
    :class="{
      'ce-page-link--missing': isMissing || isDeleted,
      'ce-page-link--card': isCardStyle,
      'ce-page-link--small': !isCardStyle,
      'ce-page-link--empty': showPicker,
      'ce-page-link--selected': selected,
    }"
    data-type="page-link"
    :role="showPicker ? 'group' : 'button'"
    :tabindex="showPicker ? -1 : 0"
    @click="handleActivate"
    @keydown.enter="handleKeyActivate"
    @keydown.space="handleKeyActivate"
  >
    <template v-if="showPicker">
      <div class="ce-page-link__picker">
        <label class="ce-page-link__label">Link to page</label>
        <div v-if="isDeleted" class="ce-page-link__notice">
          <span class="ce-page-link__notice-text">Page is in the bin.</span>
          <button class="ghost-btn ghost-btn-background" type="button" @click.stop="handleRestore">Restore</button>
        </div>
        <div v-else-if="isMissing" class="ce-page-link__notice">
          <span class="ce-page-link__notice-text">Link not available.</span>
        </div>
        <input
          v-model="pageSearch"
          class="ce-page-link__input"
          type="search"
          placeholder="Search pages"
          aria-label="Search pages"
        />
        <div class="ce-page-link__list">
          <button
            v-for="page in filteredPages"
            :key="page.id"
            class="ce-page-link__option"
            type="button"
            @click.stop="handleSelectPage(page)"
          >
            <PageIcon class="ce-page-link__option-icon" :icon="page.icon" fallback="📄" aria-hidden="true" />
            <span class="ce-page-link__option-title">{{ page.title || 'Untitled page' }}</span>
          </button>
          <div v-if="!filteredPages.length" class="ce-page-link__empty-state">No pages found.</div>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="ce-page-link__main">
        <PageIcon class="ce-page-link__icon" :icon="displayIcon" fallback="📄" aria-hidden="true" />
        <div class="ce-page-link__text">
          <span class="ce-page-link__title">{{ displayTitle }}</span>
          <span v-if="isCardStyle" class="ce-page-link__hint">{{ cardHint }}</span>
        </div>
      </div>
    </template>
  </NodeViewWrapper>
</template>
