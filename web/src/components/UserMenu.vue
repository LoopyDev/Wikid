<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useWorkspaceStore } from '../stores/workspace';

// The menu under the workspace name: who's signed in, settings, log out, and the workspaces.
const emit = defineEmits(['dismiss', 'settings', 'logout', 'create-workspace', 'select-workspace']);
const { activeUser, workspaces, activeWorkspaceId, loadingPages } = storeToRefs(useWorkspaceStore());

const userInitials = computed(() => {
  const name = activeUser.value?.name?.trim() || '';
  if (!name) return '?';
  const parts = name.split(/\s+/);
  const initials = parts.map((part) => part?.[0]?.toUpperCase()).filter(Boolean).join('');
  return initials.slice(0, 2) || name.charAt(0).toUpperCase();
});
</script>

<template>
  <div class="popover-backdrop left" @click.self="emit('dismiss', $event)">
    <div class="popover-card context-menu">
      <div class="user-menu-header">
        <div class="user-menu-avatar">{{ userInitials }}</div>
        <div class="user-menu-info">
          <p class="user-menu-name">{{ activeUser?.name }}</p>
          <p class="user-menu-hint">Signed in</p>
        </div>
      </div>
      <button class="user-menu__item context-menu__item" type="button" @click="emit('settings')">Settings</button>
      <button class="user-menu__item context-menu__item" type="button" @click="emit('logout')">Log out</button>
      <div class="user-menu-separator" role="separator"></div>
      <div v-if="!loadingPages" class="user-menu-section">
        <div class="user-menu-section-title">
          <span>Workspaces</span>
          <button
            class="user-menu-action"
            type="button"
            title="Create workspace"
            aria-label="Create workspace"
            @click="emit('create-workspace')"
          >
            +
          </button>
        </div>
        <button
          v-for="entry in workspaces"
          :key="entry.workspace?.id"
          class="user-menu__item context-menu__item user-menu__workspace"
          :class="{ active: entry.workspace?.id === activeWorkspaceId }"
          type="button"
          @click="emit('select-workspace', entry.workspace?.id)"
        >
          <span class="user-menu-workspace-left">
            <span class="user-menu-workspace-icon" aria-hidden="true">🗂️</span>
            <span class="user-menu-workspace-name">{{ entry.workspace?.name || 'Workspace' }}</span>
          </span>
          <span class="user-menu-workspace-badges">
            <span class="workspace-doc-count">{{ entry.workspace?._count?.pages ?? 0 }}</span>
            <span class="workspace-role-pill workspace-role-pill--menu">{{ entry.role }}</span>
          </span>
        </button>
        <div v-if="!workspaces.length" class="user-menu-empty">No workspaces yet.</div>
      </div>
    </div>
  </div>
</template>
