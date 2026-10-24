<script setup>
import { ref, computed, watch, onBeforeUnmount, provide } from 'vue';
import { useWorkspaceStore } from '../stores/workspace';
import { api } from '../api/client';
import TiptapEditor from './TiptapEditor.vue';
import DatabaseTable from './DatabaseTable.vue';
import PageIcon from './PageIcon.vue';
import { normalizeEditorDoc, fallbackDoc } from '../utils/editorDoc';

const props = defineProps({
  pageId: { type: String, required: true },
});

const emit = defineEmits(['close', 'navigate']);

const workspace = useWorkspaceStore();

const page = ref(null);
const doc = ref(fallbackDoc);
const titleDraft = ref('');
const loading = ref(true);
const loadError = ref('');
const saving = ref(false);
const editorRef = ref(null);

const isDatabasePage = computed(() => page.value?.kind === 'DATABASE');
const canEdit = computed(() => workspace.canEditActiveWorkspace);

const collab = computed(() => {
  if (!workspace.collabToken || !workspace.collabUrl || !page.value) return null;
  const workspaceId = page.value.workspaceId;
  if (!workspaceId) return null;
  const docName = page.value.kind === 'DATABASE'
    ? `ws:${workspaceId}:db:${page.value.id}`
    : `ws:${workspaceId}:${page.value.id}`;
  return { docName, token: workspace.collabToken, url: workspace.collabUrl };
});

let saveTimer = null;

const flushSave = async (pageId, nextDoc) => {
  if (!canEdit.value) return;
  try {
    saving.value = true;
    await api.updatePageContent(pageId, nextDoc, {
      userId: workspace.activeUser?.id,
      userName: workspace.activeUser?.name,
    });
  } catch (e) {
    console.warn('SecondaryPane save failed', e);
  } finally {
    saving.value = false;
  }
};

const debouncedSave = (nextDoc) => {
  if (saveTimer) clearTimeout(saveTimer);
  const pageId = page.value?.id;
  if (!pageId) return;
  saveTimer = setTimeout(() => flushSave(pageId, nextDoc), 1500);
};

const loadPage = async (pageId) => {
  if (!pageId) return;
  loading.value = true;
  loadError.value = '';
  page.value = null;
  try {
    const data = await api.getPage(pageId, {
      userId: workspace.activeUser?.id,
      userName: workspace.activeUser?.name,
    });
    page.value = data;
    doc.value = normalizeEditorDoc(data.content);
    titleDraft.value = data.title || 'Untitled page';
  } catch (e) {
    loadError.value = e?.message || 'Failed to load page';
  } finally {
    loading.value = false;
  }
};

watch(() => props.pageId, (id) => loadPage(id), { immediate: true });

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer);
});

const handleDocUpdate = (nextDoc) => {
  doc.value = nextDoc;
  debouncedSave(nextDoc);
};

const titleResizeRef = ref(null);
const resizeTitle = () => {
  const el = titleResizeRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
};

let titleSaveTimer = null;
const handleTitleInput = (e) => {
  titleDraft.value = e.target.value;
  resizeTitle();
  if (titleSaveTimer) clearTimeout(titleSaveTimer);
  titleSaveTimer = setTimeout(async () => {
    if (!page.value) return;
    try {
      await api.updatePageTitle(page.value.id, titleDraft.value, {
        userId: workspace.activeUser?.id,
        userName: workspace.activeUser?.name,
      });
    } catch {}
  }, 1000);
};

// Allow page-link clicks inside this pane to navigate the pane itself
const handleNavigate = (pageId) => {
  emit('navigate', pageId);
};

provide('openRowPageOverlay', (pageOrId) => {
  const id = typeof pageOrId === 'string' ? pageOrId : pageOrId?.id;
  if (id) emit('navigate', id);
});

const requestDeleteConfirmation = () => null;
</script>

<template>
  <div class="split-pane">
    <header class="topbar split-pane__topbar">
      <div class="topbar-left">
        <div class="crumbs">
          <span class="crumb current">{{ titleDraft || 'Untitled page' }}</span>
        </div>
      </div>
      <div class="topbar-actions">
        <span class="status-text">
          <span v-if="saving" class="spinner" aria-hidden="true"></span>
          {{ saving ? 'Saving…' : 'Saved' }}
        </span>
        <button
          class="ghost-btn split-pane__close-btn"
          type="button"
          title="Close pane"
          aria-label="Close split pane"
          @click="emit('close')"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
            <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/>
          </svg>
        </button>
      </div>
    </header>

    <div v-if="loading" class="split-pane__state muted">Loading…</div>
    <div v-else-if="loadError" class="split-pane__state split-pane__state--error">{{ loadError }}</div>
    <template v-else-if="page">
      <div class="split-pane__scroll">
        <div class="split-pane__heading">
          <div class="page-icon-wrap">
            <span class="page-icon-main" aria-hidden="true">
              <PageIcon class="page-icon-main__icon" :icon="page.icon" fallback="📄" />
            </span>
          </div>
          <textarea
            ref="titleResizeRef"
            class="page-title"
            rows="1"
            :value="titleDraft"
            :readonly="!canEdit"
            placeholder="Untitled page"
            @input="handleTitleInput"
          />
        </div>
        <div class="split-pane__body">
          <DatabaseTable
            v-if="isDatabasePage"
            :page-id="pageId"
            :readonly="!canEdit"
          />
          <TiptapEditor
            v-else
            ref="editorRef"
            :doc="doc"
            :collab="collab"
            :page-id="pageId"
            :readonly="!canEdit"
            :request-delete-confirmation="requestDeleteConfirmation"
            @update:doc="handleDocUpdate"
            @status="() => {}"
          />
        </div>
      </div>
    </template>
  </div>
</template>
