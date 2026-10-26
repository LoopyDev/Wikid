<script>
import { ref } from 'vue';

// PDF settings are remembered between exports.
const exportTheme = ref('light');
const exportScale = ref(1);
</script>

<script setup>
import { computed, nextTick, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useWorkspaceStore } from '../stores/workspace';
import { api } from '../api/client';
import { editorDocToMarkdownAsync } from '../utils/editorDoc';
import PageIcon from './PageIcon.vue';

// Exports pages as HTML (a chosen part of the page tree), or the open page as PDF or Markdown.
const props = defineProps({
  format: { type: String, default: 'html' },
  rootPageId: { type: String, default: null },
});
const emit = defineEmits(['close']);

const workspace = useWorkspaceStore();
const { pages, activeUser } = storeToRefs(workspace);
const exportFormat = ref(props.format);
const close = () => emit('close');

const exportHtmlMode = ref('scroll');
const exportHtmlRootIds = ref(new Set()); // empty = whole workspace
const exportHtmlChecked = ref(new Set());
const exportHtmlExporting = ref(false);

const exportHtmlFullTree = computed(() => {
  const allPages = pages.value.filter((p) => !p.isDeleted && !p.isHidden);
  const childrenOf = (parentId) => allPages.filter((p) => p.parentId === parentId);
  const result = [];
  const walk = (page, depth) => {
    result.push({ ...page, _depth: depth });
    childrenOf(page.id).forEach((child) => walk(child, depth + 1));
  };
  allPages.filter((p) => !p.parentId).forEach((root) => walk(root, 0));
  return result;
});

const exportHtmlSubtreeIds = computed(() => {
  const roots = exportHtmlRootIds.value;
  if (!roots.size) return new Set(exportHtmlFullTree.value.map((p) => p.id));
  const allPages = pages.value.filter((p) => !p.isDeleted && !p.isHidden);
  const childrenOf = (parentId) => allPages.filter((p) => p.parentId === parentId);
  const ids = new Set();
  const walk = (id) => {
    ids.add(id);
    childrenOf(id).forEach((child) => walk(child.id));
  };
  for (const rootId of roots) walk(rootId);
  return ids;
});

const exportHtmlCheckedCount = computed(() => {
  let count = 0;
  for (const entry of exportHtmlFullTree.value) {
    if (exportHtmlChecked.value.has(entry.id)) count++;
  }
  return count;
});

const getSubtreeIds = (pageId) => {
  const allPages = pages.value.filter((p) => !p.isDeleted && !p.isHidden);
  const childrenOf = (parentId) => allPages.filter((p) => p.parentId === parentId);
  const ids = new Set();
  const walk = (id) => { ids.add(id); childrenOf(id).forEach((c) => walk(c.id)); };
  walk(pageId);
  return ids;
};

const exportHtmlSelectRoot = (pageId) => {
  if (pageId) {
    exportHtmlRootIds.value = new Set([pageId]);
    exportHtmlChecked.value = getSubtreeIds(pageId);
  } else {
    exportHtmlRootIds.value = new Set();
    const allPages = pages.value.filter((p) => !p.isDeleted && !p.isHidden);
    exportHtmlChecked.value = new Set(allPages.map((p) => p.id));
  }
};

const exportHtmlToggleCheck = (pageId) => {
  if (!exportHtmlSubtreeIds.value.has(pageId)) return;
  const allPages = pages.value.filter((p) => !p.isDeleted && !p.isHidden);
  const childrenOf = (parentId) => allPages.filter((p) => p.parentId === parentId);
  const descendants = [];
  const walk = (id) => { descendants.push(id); childrenOf(id).forEach((c) => walk(c.id)); };
  walk(pageId);
  const next = new Set(exportHtmlChecked.value);
  const excluding = next.has(pageId);
  for (const id of descendants) {
    if (excluding) next.delete(id); else next.add(id);
  }
  exportHtmlChecked.value = next;
};

const exportHtmlRowClick = (pageId, event) => {
  if (event.shiftKey) {
    if (exportHtmlSubtreeIds.value.has(pageId)) {
      exportHtmlToggleCheck(pageId);
    } else {
      // Add this tree to the selection
      const nextRoots = new Set(exportHtmlRootIds.value);
      nextRoots.add(pageId);
      exportHtmlRootIds.value = nextRoots;
      const nextChecked = new Set(exportHtmlChecked.value);
      for (const id of getSubtreeIds(pageId)) nextChecked.add(id);
      exportHtmlChecked.value = nextChecked;
    }
  } else {
    exportHtmlSelectRoot(pageId);
  }
};

const exportHtmlTreeRef = ref(null);
const scrollExportTreeToRoot = (pageId) => {
  if (!pageId) return;
  nextTick(() => {
    const container = exportHtmlTreeRef.value;
    if (!container) return;
    const row = container.querySelector(`[data-page-id="${pageId}"]`);
    if (row) row.scrollIntoView({ block: 'center', behavior: 'instant' });
  });
};
const confirmExportHtml = async () => {
  exportHtmlExporting.value = true;
  try {
    // Brief delay to let any in-flight WebSocket syncs (cell edits, typing) reach the collab server
    await new Promise((resolve) => setTimeout(resolve, 500));
    const roots = exportHtmlRootIds.value;
    const allIds = new Set(exportHtmlFullTree.value.map((p) => p.id));
    const excludeIds = [];
    for (const id of allIds) {
      if (!exportHtmlChecked.value.has(id)) excludeIds.push(id);
    }
    const params = {
      mode: exportHtmlMode.value,
      excludeIds: excludeIds.length ? excludeIds : undefined,
    };
    if (roots.size === 1) {
      params.rootPageId = [...roots][0];
    } else {
      params.workspaceId = workspace.activeWorkspaceId;
    }
    const { blob, filename } = await api.exportHtml(params);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    close();
  } catch (err) {
    console.warn('Export failed', err);
    exportHtmlExporting.value = false;
  }
};
const exportPdf = () => {
  if (!workspace.currentPage?.id || !activeUser.value) return;
  const url = api.exportPagePdfUrl(workspace.currentPage.id, {
    userId: activeUser.value.id,
    userName: activeUser.value.name,
    theme: exportTheme.value,
    scale: exportScale.value,
  });
  window.open(url, '_blank');
  close();
};

const exportMarkdown = async () => {
  const title = workspace.currentPage?.title?.trim() || 'page';
  const user = activeUser.value;
  const markdown = await editorDocToMarkdownAsync(workspace.doc, (pageId) =>
    api.getDatabase(pageId, { userId: user?.id, userName: user?.name }),
  );
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title}.md`;
  link.click();
  URL.revokeObjectURL(url);
};

onMounted(() => {
  exportHtmlSelectRoot(props.rootPageId);
  scrollExportTreeToRoot(props.rootPageId);
});
</script>

<template>
  <div class="modal-backdrop" @click.self="close">
    <div class="modal-card export-html-modal">
      <h3>Export</h3>
      <div class="export-format-bar">
        <button type="button" :class="['export-format-btn', { active: exportFormat === 'html' }]" @click="exportFormat = 'html'">HTML</button>
        <button type="button" :class="['export-format-btn', { active: exportFormat === 'pdf' }]" @click="exportFormat = 'pdf'">PDF</button>
        <button type="button" :class="['export-format-btn', { active: exportFormat === 'markdown' }]" @click="exportFormat = 'markdown'">Markdown</button>
      </div>

      <template v-if="exportFormat === 'html'">
        <p class="muted">Click to select root. Shift+click to exclude pages.</p>
        <div ref="exportHtmlTreeRef" class="export-html-modal__tree">
          <div
            class="export-html-modal__row export-html-modal__row--root"
            :class="{ 'export-html-modal__row--selected': exportHtmlRootIds.size === 0 }"
            @click="exportHtmlSelectRoot(null)"
          >
            <span class="export-html-modal__icon" aria-hidden="true">🗂️</span>
            <span class="export-html-modal__title">Entire workspace</span>
          </div>
          <div
            v-for="entry in exportHtmlFullTree"
            :key="entry.id"
            :data-page-id="entry.id"
            class="export-html-modal__row"
            :class="{
              'export-html-modal__row--selected': exportHtmlRootIds.has(entry.id),
              'export-html-modal__row--outside': !exportHtmlSubtreeIds.has(entry.id),
              'export-html-modal__row--excluded': exportHtmlSubtreeIds.has(entry.id) && !exportHtmlChecked.has(entry.id),
            }"
            :style="{ paddingLeft: `${entry._depth * 16 + 28}px` }"
            @click="exportHtmlRowClick(entry.id, $event)"
          >
            <span class="export-html-modal__icon" aria-hidden="true">
              <PageIcon :icon="entry.icon" :fallback="entry.kind === 'DATABASE' ? '🗂️' : '📄'" />
            </span>
            <span class="export-html-modal__title">{{ entry.title || 'Untitled page' }}</span>
            <span v-if="entry.kind === 'DATABASE'" class="export-html-modal__badge">Database</span>
          </div>
        </div>
        <div class="export-html-modal__options">
          <span class="export-html-modal__label">Layout</span>
          <div class="export-theme-toggle">
            <button type="button" :class="['export-theme-btn', { active: exportHtmlMode === 'scroll' }]" @click="exportHtmlMode = 'scroll'">Single page</button>
            <button type="button" :class="['export-theme-btn', { active: exportHtmlMode === 'pages' }]" @click="exportHtmlMode = 'pages'">Multi-page</button>
          </div>
        </div>
        <p class="muted export-html-modal__hint">{{ exportHtmlMode === 'scroll' ? 'All pages combined into one scrollable document.' : 'Navigate between pages like a website.' }}</p>
        <div class="modal-actions">
          <button
            class="ghost-btn ghost-btn-background"
            type="button"
            :disabled="exportHtmlExporting || exportHtmlCheckedCount === 0"
            @click="confirmExportHtml"
          >
            {{ exportHtmlExporting ? 'Exporting...' : `Export ${exportHtmlCheckedCount} page${exportHtmlCheckedCount !== 1 ? 's' : ''}` }}
          </button>
          <button class="ghost-btn" type="button" @click="close">Cancel</button>
        </div>
      </template>

      <template v-if="exportFormat === 'pdf'">
        <p class="muted">Export the current page as a PDF document.</p>
        <div class="export-option-row">
          <span class="export-option-label">Theme</span>
          <div class="export-theme-toggle">
            <button type="button" :class="['export-theme-btn', { active: exportTheme === 'light' }]" @click="exportTheme = 'light'">Light</button>
            <button type="button" :class="['export-theme-btn', { active: exportTheme === 'dark' }]" @click="exportTheme = 'dark'">Dark</button>
          </div>
        </div>
        <div class="export-option-row">
          <span class="export-option-label">Scale <span class="export-scale-value">{{ Math.round(exportScale * 100) }}%</span></span>
          <input type="range" class="export-scale-slider" min="0.5" max="2" step="0.05" v-model.number="exportScale" />
        </div>
        <div class="modal-actions">
          <button class="ghost-btn ghost-btn-background" type="button" @click="exportPdf">Download PDF</button>
          <button class="ghost-btn" type="button" @click="close">Cancel</button>
        </div>
      </template>

      <template v-if="exportFormat === 'markdown'">
        <p class="muted">Export the current page as a Markdown file.</p>
        <div class="modal-actions">
          <button class="ghost-btn ghost-btn-background" type="button" @click="exportMarkdown">Download Markdown</button>
          <button class="ghost-btn" type="button" @click="close">Cancel</button>
        </div>
      </template>
    </div>
  </div>
</template>
