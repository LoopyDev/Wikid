<script setup>
import { ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useWorkspaceStore } from '../stores/workspace';
import PageIcon from './PageIcon.vue';

// Moves a page, with its sub-pages, to another workspace.
const props = defineProps({
  page: { type: Object, required: true },
  // The workspaces it can go to: membership entries ({ workspace, role }).
  workspaces: { type: Array, default: () => [] },
});
const emit = defineEmits(['close']);

const workspace = useWorkspaceStore();
const { pages } = storeToRefs(workspace);

// The page and its sub-pages, depth-first, each with its depth (_depth).
const buildMoveSubtree = (rootPage) => {
  const childrenOf = (parentId) => pages.value.filter((p) => p.parentId === parentId && !p.isDeleted && !p.isHidden);
  const result = [];
  const walk = (page, depth) => {
    result.push({ ...page, _depth: depth });
    childrenOf(page.id).forEach((child) => walk(child, depth + 1));
  };
  walk(rootPage, 0);
  return result;
};
const moveWorkspaceSubtree = buildMoveSubtree(props.page);
const moveWorkspaceTargetId = ref(null);
const moveWorkspaceLoading = ref(false);
const moveWorkspaceError = ref('');

const confirmMoveToWorkspace = async () => {
  if (!moveWorkspaceTargetId.value) return;
  moveWorkspaceLoading.value = true;
  moveWorkspaceError.value = '';
  try {
    await workspace.movePageToWorkspace(props.page.id, moveWorkspaceTargetId.value);
    emit('close');
  } catch (err) {
    moveWorkspaceError.value = err?.message || 'Failed to move pages';
  } finally {
    moveWorkspaceLoading.value = false;
  }
};
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal-card move-workspace-modal">
      <h3>Move to workspace</h3>
      <p class="muted">The following pages will be moved out of this workspace.</p>
      <div class="move-workspace-modal__body">
        <div class="move-workspace-modal__col move-workspace-modal__col--pages">
          <div class="move-workspace-modal__col-label">Moving</div>
          <div class="move-workspace-modal__page-list">
            <div
              v-for="entry in moveWorkspaceSubtree"
              :key="entry.id"
              class="move-workspace-modal__page-row"
              :style="{ paddingLeft: `${entry._depth * 16 + 8}px` }"
            >
              <span class="move-workspace-modal__page-icon" aria-hidden="true">
                <PageIcon :icon="entry.icon" fallback="📄" />
              </span>
              <span class="move-workspace-modal__page-title">{{ entry.title || 'Untitled page' }}</span>
            </div>
          </div>
        </div>
        <div class="move-workspace-modal__arrow" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </div>
        <div class="move-workspace-modal__col move-workspace-modal__col--target">
          <div class="move-workspace-modal__col-label">Destination</div>
          <div class="move-workspace-modal__workspace-list">
            <button
              v-for="entry in workspaces"
              :key="entry.workspace?.id"
              type="button"
              class="move-workspace-modal__workspace-btn"
              :class="{ 'move-workspace-modal__workspace-btn--selected': moveWorkspaceTargetId === entry.workspace?.id }"
              @click="moveWorkspaceTargetId = entry.workspace?.id"
            >
              <span class="move-workspace-modal__ws-icon" aria-hidden="true">🗂️</span>
              <span class="move-workspace-modal__ws-name">{{ entry.workspace?.name || 'Workspace' }}</span>
              <span v-if="moveWorkspaceTargetId === entry.workspace?.id" class="move-workspace-modal__ws-check" aria-hidden="true">✓</span>
            </button>
            <div v-if="!workspaces.length" class="muted" style="padding: 8px;">No other workspaces available.</div>
          </div>
        </div>
      </div>
      <p v-if="moveWorkspaceError" class="modal-error">{{ moveWorkspaceError }}</p>
      <div class="modal-actions">
        <button
          class="ghost-btn ghost-btn-background"
          type="button"
          :disabled="!moveWorkspaceTargetId || moveWorkspaceLoading"
          @click="confirmMoveToWorkspace"
        >
          {{ moveWorkspaceLoading ? 'Moving…' : `Move ${moveWorkspaceSubtree.length} page${moveWorkspaceSubtree.length !== 1 ? 's' : ''}` }}
        </button>
        <button class="ghost-btn" type="button" @click="emit('close')">Cancel</button>
      </div>
    </div>
  </div>
</template>
