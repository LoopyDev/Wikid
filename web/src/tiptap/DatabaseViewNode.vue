<script setup>
import { NodeViewWrapper } from '@tiptap/vue-3';
import { computed, ref, watch } from 'vue';
import DatabaseTable from '../components/DatabaseTable.vue';
import PageIcon from '../components/PageIcon.vue';
import { useWorkspaceStore } from '../stores/workspace';
import { api } from '../api/client';

const props = defineProps({
  editor: { type: Object, required: true },
  node: { type: Object, required: true },
  extension: { type: Object, required: true },
  updateAttributes: { type: Function, required: true },
  getPos: { type: Function, required: false },
  selected: { type: Boolean, default: false },
});

const workspace = useWorkspaceStore();
const toolbarTarget = ref(null);

const attrs = computed(() => props.node?.attrs || {});
const canEdit = computed(() => props.editor?.isEditable ?? true);
const canCreate = computed(() => typeof props.extension.options?.createDatabasePage === 'function');

const resolvePage = (pageId) => {
  const resolver = props.extension.options?.resolvePage;
  if (typeof resolver === 'function' && pageId) {
    return resolver(pageId);
  }
  return null;
};

const resolvedPage = computed(() => resolvePage(attrs.value.pageId));
const isDeleted = computed(() => !!resolvedPage.value?.isDeleted);
const isDatabase = computed(() => resolvedPage.value?.kind === 'DATABASE');
const hasPage = computed(() => !!attrs.value.pageId && !!resolvedPage.value && isDatabase.value && !isDeleted.value);
const isMissing = computed(() => !!attrs.value.pageId && (!resolvedPage.value || !isDatabase.value || isDeleted.value));
const showPicker = computed(() => !hasPage.value);
const viewState = computed(() =>
  attrs.value.view && typeof attrs.value.view === 'object' ? attrs.value.view : {}
);
const hiddenFieldIds = computed(() =>
  Array.isArray(viewState.value.hiddenFields) ? viewState.value.hiddenFields : []
);

// Saved views (DatabaseView records) belonging to the embedded database, so the
// block can render a specific one instead of the default all-rows table.
const savedViews = ref([]);
const savedViewsLoadedFor = ref(null);
const activeViewId = computed(() => attrs.value.viewId || '');

const loadSavedViews = async (pageId) => {
  if (!pageId || !workspace.hasApi || !workspace.activeUser) {
    savedViews.value = [];
    return;
  }
  if (savedViewsLoadedFor.value === pageId) return;
  savedViewsLoadedFor.value = pageId;
  try {
    const res = await api.getDatabase(pageId, {
      userId: workspace.activeUser.id,
      userName: workspace.activeUser.name,
    });
    savedViews.value = Array.isArray(res?.views)
      ? res.views
          .filter((view) => view && view.id)
          .map((view) => ({
            id: view.id,
            name: typeof view.name === 'string' && view.name.trim() ? view.name.trim() : 'View',
            type: typeof view.type === 'string' ? view.type.toUpperCase() : 'TABLE',
            icon: view.icon || '',
          }))
      : [];
  } catch (err) {
    console.warn('Load database views failed', err);
    savedViews.value = [];
  }
};

watch(
  () => (hasPage.value ? attrs.value.pageId : null),
  (pageId) => {
    savedViewsLoadedFor.value = null;
    if (pageId) loadSavedViews(pageId);
    else savedViews.value = [];
  },
  { immediate: true }
);

const handleViewSelect = (event) => {
  if (!canEdit.value) return;
  const nextId = event?.target?.value || '';
  props.updateAttributes({ viewId: nextId || null });
};

const listDatabasePages = () => {
  const list = props.extension.options?.listDatabasePages;
  if (typeof list !== 'function') return [];
  const pages = list();
  if (!Array.isArray(pages)) return [];
  return pages
    .filter((page) => page && page.kind === 'DATABASE' && !page.isDeleted)
    .slice()
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
};

const databasePages = computed(() => listDatabasePages());

const displayTitle = computed(() => {
  if (resolvedPage.value?.title) return resolvedPage.value.title;
  if (attrs.value.title) return attrs.value.title;
  if (isMissing.value) return 'Database not found';
  return 'Select a database';
});

const displayIcon = computed(() => resolvedPage.value?.icon || attrs.value.icon || '');
const collabOverride = computed(() => {
  const pageId = attrs.value.pageId;
  if (!pageId) return null;
  const pageWorkspaceId = resolvedPage.value?.workspaceId || workspace.activeWorkspaceId;
  if (!pageWorkspaceId || !workspace.collabToken || !workspace.collabUrl) return null;
  return {
    docName: `ws:${pageWorkspaceId}:db:${pageId}`,
    token: workspace.collabToken,
    url: workspace.collabUrl,
  };
});

const statusMessage = computed(() => {
  if (!attrs.value.pageId) {
    if (!databasePages.value.length) return 'No database pages yet.';
    return 'Choose a database to embed.';
  }
  if (isDeleted.value) return 'Database is in the bin.';
  if (!resolvedPage.value) return 'Database not found.';
  if (!isDatabase.value) return 'Selected page is not a database.';
  return 'Change database view.';
});


const handleSelect = (event) => {
  if (!canEdit.value) return;
  const nextId = event?.target?.value || '';
  if (!nextId) return;
  const page = databasePages.value.find((item) => item.id === nextId);
  if (!page) return;
  props.updateAttributes({
    pageId: page.id,
    title: page.title || '',
    icon: page.icon || '',
    view: null,
    viewId: null,
  });
};

const handleRestore = async () => {
  const restore = props.extension.options?.restorePage;
  if (typeof restore === 'function' && attrs.value.pageId) {
    await Promise.resolve(restore(attrs.value.pageId));
  }
};

const handleCreate = async () => {
  if (!canEdit.value) return;
  const create = props.extension.options?.createDatabasePage;
  if (typeof create !== 'function') return;
  const created = await Promise.resolve(create());
  if (created?.id) {
    props.updateAttributes({
      pageId: created.id,
      title: created.title || '',
      icon: created.icon || '',
      view: null,
      viewId: null,
    });
  }
};

const handleCreateCompliance = async () => {
  if (!canEdit.value) return;
  const create = props.extension.options?.createDatabasePage;
  if (typeof create !== 'function') return;
  const created = await Promise.resolve(create({ complianceMode: true, template: 'inventory' }));
  if (created?.id) {
    props.updateAttributes({
      pageId: created.id,
      title: created.title || '',
      icon: created.icon || '',
      view: null,
      viewId: null,
    });
  }
};

const handleHiddenFieldIdsUpdate = (next) => {
  if (!canEdit.value) return;
  const hiddenFields = Array.isArray(next) ? next : [];
  props.updateAttributes({
    view: {
      ...viewState.value,
      hiddenFields,
    },
  });
};
</script>

<template>
  <NodeViewWrapper
    class="ce-database-view"
    :class="{ 'ce-database-view--selected': selected }"
    contenteditable="false"
    data-type="database-view"
  >
    <div class="ce-database-view__header">
      <div class="ce-database-view__title">
        <PageIcon class="ce-database-view__icon" :icon="displayIcon" fallback="DB" aria-hidden="true" />
        <div class="ce-database-view__text">
          <span class="ce-database-view__name">{{ displayTitle }}</span>
        </div>
      </div>
      <div v-if="hasPage" class="ce-database-view__header-controls">
        <div v-if="savedViews.length" class="ce-database-view__view-picker">
          <label class="ce-database-view__view-label">View</label>
          <select
            class="ce-database-view__view-select"
            :value="activeViewId"
            :disabled="!canEdit"
            @change="handleViewSelect"
          >
            <option value="">Default (all rows)</option>
            <option v-for="view in savedViews" :key="view.id" :value="view.id">{{ view.name }}</option>
          </select>
        </div>
        <div ref="toolbarTarget" class="ce-database-view__toolbar-target"></div>
      </div>
    </div>

    <div v-if="showPicker" class="ce-database-view__picker">
      <div class="ce-database-view__empty">{{ statusMessage }}</div>
      <div class="ce-database-view__controls">
        <label class="ce-database-view__label">Database</label>
        <select
          class="ce-database-view__select"
          :value="attrs.pageId"
          :disabled="!canEdit"
          @change="handleSelect"
        >
          <option value="">Select a database</option>
          <option v-for="page in databasePages" :key="page.id" :value="page.id">
            {{ page.title || 'Untitled database' }}
          </option>
        </select>
        <button
          v-if="canEdit && canCreate"
          class="ghost-btn ghost-btn-background"
          type="button"
          @click.stop="handleCreate"
        >
          New database
        </button>
        <button
          v-if="canEdit && canCreate"
          class="ghost-btn ghost-btn-background"
          type="button"
          @click.stop="handleCreateCompliance"
        >
          New compliant database
        </button>
        <button v-if="isDeleted && canEdit" class="ghost-btn ghost-btn-background" type="button" @click.stop="handleRestore">
          Restore
        </button>
      </div>
    </div>

    <div v-if="hasPage" class="ce-database-view__table">
      <DatabaseTable
        :page-id="attrs.pageId"
        :readonly="!canEdit"
        :collab="collabOverride"
        :hidden-field-ids="hiddenFieldIds"
        :view-id="attrs.viewId || null"
        :toolbar-teleport-to="toolbarTarget"
        embedded
        @update:hidden-field-ids="handleHiddenFieldIdsUpdate"
      />
    </div>
  </NodeViewWrapper>
</template>
