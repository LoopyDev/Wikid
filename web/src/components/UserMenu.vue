<script setup>
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useWorkspaceStore } from '../stores/workspace';

// The menu under the workspace name: who's signed in, settings, log out, invitations to answer,
// and the workspaces.
const emit = defineEmits(['dismiss', 'settings', 'logout', 'create-workspace', 'select-workspace']);
const store = useWorkspaceStore();
const { activeUser, workspaces, activeWorkspaceId, loadingPages, invitations } = storeToRefs(store);
// Any sent since the page was opened
store.loadInvitations();

const ROLE_NAMES = { OWNER: 'an owner', EDITOR: 'an editor', VIEWER: 'a viewer' };
const answering = ref(null);
const answerError = ref('');
// Accepted, the workspace opens
const answer = async (invitation, accept) => {
  answering.value = invitation.id;
  answerError.value = '';
  try {
    const joined = await store.answerInvitation(invitation.id, accept);
    if (joined) emit('select-workspace', joined);
  } catch (err) {
    answerError.value =
      err?.status === 404 ? err?.message || 'That invitation is no longer there' : err?.message || "Couldn't answer the invitation; try again";
  } finally {
    answering.value = null;
  }
};

// Wikid is AGPL: people using a server can get its source. Builds of a modified Wikid set VITE_SOURCE_URL to their fork.
const sourceUrl = import.meta.env.VITE_SOURCE_URL || 'https://github.com/LoopyDev/Wikid';

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
      <a class="user-menu__item context-menu__item user-menu__link" :href="sourceUrl" target="_blank" rel="noopener noreferrer">
        Source code <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
      </a>
      <button class="user-menu__item context-menu__item" type="button" @click="emit('logout')">Log out</button>
      <div class="user-menu-separator" role="separator"></div>
      <div v-if="invitations.length" class="user-menu-section user-menu-invitations" aria-label="Invitations">
        <div class="user-menu-section-title"><span>Invitations</span></div>
        <div v-for="invitation in invitations" :key="invitation.id" class="user-menu-invitation">
          <p class="user-menu-invitation-text">
            <strong>{{ invitation.workspace?.name || 'A workspace' }}</strong>
            <span>
              {{ invitation.invitedBy?.displayName ? `${invitation.invitedBy.displayName} invited you` : "You're invited" }},
              as {{ ROLE_NAMES[invitation.role] || 'a member' }}
            </span>
          </p>
          <div class="user-menu-invitation-actions">
            <button class="user-menu-invitation-accept" type="button" :disabled="answering === invitation.id" @click="answer(invitation, true)">
              Accept
            </button>
            <button class="user-menu-invitation-decline" type="button" :disabled="answering === invitation.id" @click="answer(invitation, false)">
              Decline
            </button>
          </div>
        </div>
        <p v-if="answerError" class="user-menu-invitation-error" role="alert">{{ answerError }}</p>
        <div class="user-menu-separator" role="separator"></div>
      </div>
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
