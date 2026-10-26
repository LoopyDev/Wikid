<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useWorkspaceStore } from '../stores/workspace';
import { api } from '../api/client';

// The settings popup: account (colour mode, password) and, for the open workspace, its name,
// members and export. Colour mode and the exports belong to the app shell, so it asks for those.
defineProps({
  themeModeLabel: { type: String, default: '' },
});
const emit = defineEmits(['close', 'toggle-theme', 'export-json', 'export-markdown']);

const workspace = useWorkspaceStore();
const { activeWorkspaceId, activeWorkspaceRole, activeUser } = storeToRefs(workspace);
const activeWorkspaceName = computed(() => workspace.currentWorkspace?.workspace?.name || 'Workspace');
const isWorkspaceOwner = computed(() => activeWorkspaceRole.value === 'OWNER');

const settingsTab = ref('General');

// Your account details (name, email, username), shown on the General tab.
const profile = ref(null);
onMounted(async () => {
  if (!activeUser.value) return;
  try {
    profile.value = await api.getUser(activeUser.value.id, { userId: activeUser.value.id });
  } catch {
    profile.value = null;
  }
});

const cpCurrent = ref('');
const cpNew = ref('');
const cpConfirm = ref('');
const cpError = ref('');
const cpSuccess = ref(false);
const cpLoading = ref(false);
const handleChangePassword = async () => {
  cpError.value = '';
  cpSuccess.value = false;
  if (!cpNew.value) { cpError.value = 'New password is required'; return; }
  if (cpNew.value !== cpConfirm.value) { cpError.value = 'Passwords do not match'; return; }
  cpLoading.value = true;
  try {
    await workspace.changePassword(cpCurrent.value, cpNew.value);
    cpSuccess.value = true;
    cpCurrent.value = '';
    cpNew.value = '';
    cpConfirm.value = '';
  } catch (err) {
    cpError.value = err?.message || 'Failed to change password';
  } finally {
    cpLoading.value = false;
  }
};

const showDeleteWorkspaceConfirm = ref(false);
const deletingWorkspace = ref(false);
const renameWorkspaceDraft = ref('');
const renamingWorkspace = ref(false);
const renameWorkspaceError = ref('');
const handleRenameWorkspace = async () => {
  const name = renameWorkspaceDraft.value.trim();
  if (!name || name === activeWorkspaceName.value) return;
  renamingWorkspace.value = true;
  renameWorkspaceError.value = '';
  try {
    await workspace.renameWorkspace(activeWorkspaceId.value, name);
  } catch (err) {
    renameWorkspaceError.value = err?.message || 'Failed to rename workspace';
  } finally {
    renamingWorkspace.value = false;
  }
};
const handleDeleteWorkspace = async () => {
  if (!activeWorkspaceId.value) return;
  deletingWorkspace.value = true;
  try {
    await workspace.deleteWorkspace(activeWorkspaceId.value);
    showDeleteWorkspaceConfirm.value = false;
    emit('close');
  } catch (err) {
    membersError.value = err?.message || 'Failed to delete workspace';
  } finally {
    deletingWorkspace.value = false;
  }
};

const members = ref([]);
const membersLoading = ref(false);
const membersError = ref('');
const inviteEmail = ref('');
const inviteRole = ref('EDITOR');
const memberActionLoading = ref({});
const loadMembers = async () => {
  if (!activeWorkspaceId.value || !activeUser.value) return;
  membersLoading.value = true;
  membersError.value = '';
  try {
    const data = await api.listWorkspaceMembers(activeWorkspaceId.value, { userId: activeUser.value.id });
    members.value = Array.isArray(data) ? data : [];
  } catch (err) {
    membersError.value = err?.message || 'Failed to load members';
  } finally {
    membersLoading.value = false;
  }
};
// Runs a member change, marking `key` as busy meanwhile, then reloads the list.
const withMemberAction = async (key, failure, action) => {
  memberActionLoading.value = { ...memberActionLoading.value, [key]: true };
  membersError.value = '';
  try {
    await action();
  } catch (err) {
    membersError.value = err?.message || failure;
  } finally {
    const next = { ...memberActionLoading.value };
    delete next[key];
    memberActionLoading.value = next;
  }
};
const inviteMember = async () => {
  if (!activeWorkspaceId.value || !activeUser.value || !isWorkspaceOwner.value) return;
  const login = inviteEmail.value.trim();
  if (!login) {
    membersError.value = 'Enter the email address or username of the person to add.';
    return;
  }
  await withMemberAction('invite', 'Failed to invite member', async () => {
    await api.addWorkspaceMember(activeWorkspaceId.value, { login, role: inviteRole.value }, { userId: activeUser.value.id });
    inviteEmail.value = '';
    await loadMembers();
  });
};
const updateMemberRole = async (memberId, role) => {
  if (!activeWorkspaceId.value || !activeUser.value || !isWorkspaceOwner.value) return;
  await withMemberAction(memberId, 'Failed to update role', async () => {
    await api.updateWorkspaceMember(activeWorkspaceId.value, memberId, { role }, { userId: activeUser.value.id });
    await loadMembers();
  });
};
const removeMember = async (memberId) => {
  if (!activeWorkspaceId.value || !activeUser.value || !isWorkspaceOwner.value) return;
  if (!window.confirm('Remove this member from the workspace?')) return;
  await withMemberAction(memberId, 'Failed to remove member', async () => {
    await api.removeWorkspaceMember(activeWorkspaceId.value, memberId, { userId: activeUser.value.id });
    await loadMembers();
  });
};

watch(settingsTab, (tab) => {
  if (tab === 'Members' && activeWorkspaceId.value) {
    loadMembers();
  }
  if (tab === 'Workspace') {
    renameWorkspaceDraft.value = activeWorkspaceName.value;
    renameWorkspaceError.value = '';
  }
});
</script>

<template>
  <div class="settings-popup-backdrop" @click.self="emit('close')">
    <div class="settings-popup-card">
      <button class="settings-close-btn" type="button" aria-label="Close settings" @click="emit('close')">×</button>
      <div class="settings-popup-nav">
        <span class="settings-nav-section-label">Account</span>
        <button
          class="settings-tab"
          :class="{ 'settings-tab--active': settingsTab === 'General' }"
          type="button"
          @click="settingsTab = ('General')"
        >
          General
        </button>
        <button
          class="settings-tab"
          :class="{ 'settings-tab--active': settingsTab === 'Password' }"
          type="button"
          @click="settingsTab = ('Password')"
        >
          Password
        </button>
        <template v-if="activeWorkspaceId">
          <span class="settings-nav-section-label settings-nav-section-label--workspace">{{ activeWorkspaceName }}</span>
          <button
            class="settings-tab"
            :class="{ 'settings-tab--active': settingsTab === 'Workspace' }"
            type="button"
            @click="settingsTab = ('Workspace')"
          >
            Workspace
          </button>
          <button
            class="settings-tab"
            :class="{ 'settings-tab--active': settingsTab === 'Members' }"
            type="button"
            @click="settingsTab = ('Members')"
          >
            Members
          </button>
          <button
            class="settings-tab"
            :class="{ 'settings-tab--active': settingsTab === 'Export' }"
            type="button"
            @click="settingsTab = ('Export')"
          >
            Export
          </button>
        </template>
      </div>
      <div class="settings-popup-content">
        <div v-if="settingsTab === 'General'">
          <h3>General</h3>
          <dl v-if="profile" class="settings-account">
            <dt>Name</dt>
            <dd>{{ profile.displayName }}</dd>
            <dt>Email</dt>
            <dd>{{ profile.email }}</dd>
            <dt>Username</dt>
            <dd>{{ profile.username || 'None. Ask your admin to set one.' }}</dd>
          </dl>
          <div class="settings-theme-row">
            <span>Color mode</span>
            <button class="ghost-btn ghost-btn-background" type="button" @click="emit('toggle-theme')">{{ themeModeLabel }}</button>
          </div>
        </div>
        <div v-else-if="settingsTab === 'Password'">
          <h3>Change password</h3>
          <div class="change-password-fields">
            <input v-model="cpCurrent" class="login-input" type="password" placeholder="Current password" autocomplete="current-password" />
            <input v-model="cpNew" class="login-input" type="password" placeholder="New password" autocomplete="new-password" />
            <input v-model="cpConfirm" class="login-input" type="password" placeholder="Confirm new password" autocomplete="new-password" />
          </div>
          <p v-if="cpError" class="login-error">{{ cpError }}</p>
          <p v-if="cpSuccess" class="login-success">Password changed successfully.</p>
          <div class="modal-actions">
            <button class="ghost-btn ghost-btn-background" type="button" :disabled="cpLoading" @click="handleChangePassword">
              {{ cpLoading ? 'Saving…' : 'Change password' }}
            </button>
          </div>
        </div>
        <div v-else-if="settingsTab === 'Workspace'">
          <h3>Workspace</h3>
          <div class="settings-workspace-info">
            <div class="settings-workspace-row">
              <span class="muted">Name</span>
              <div class="settings-rename-row">
                <input
                  v-model="renameWorkspaceDraft"
                  class="login-input settings-rename-input"
                  type="text"
                  placeholder="Workspace name"
                  @keydown.enter="handleRenameWorkspace"
                />
                <button
                  class="ghost-btn ghost-btn-background"
                  type="button"
                  :disabled="renamingWorkspace || !renameWorkspaceDraft.trim() || renameWorkspaceDraft.trim() === activeWorkspaceName"
                  @click="handleRenameWorkspace"
                >
                  {{ renamingWorkspace ? 'Saving…' : 'Rename' }}
                </button>
              </div>
            </div>
            <p v-if="renameWorkspaceError" class="login-error">{{ renameWorkspaceError }}</p>
            <div class="settings-workspace-row">
              <span class="muted">Pages</span>
              <span>{{ workspace.pages.length }}</span>
            </div>
          </div>
          <div v-if="isWorkspaceOwner" class="settings-danger-zone">
            <p class="settings-danger-zone__title">Danger zone</p>
            <div v-if="!showDeleteWorkspaceConfirm">
              <p class="muted">Permanently delete this workspace and all of its pages. This cannot be undone.</p>
              <button class="ghost-btn ghost-btn-danger" type="button" @click="showDeleteWorkspaceConfirm = true">Delete workspace</button>
            </div>
            <div v-else>
              <p>This will permanently delete <strong>{{ activeWorkspaceName }}</strong> and all its pages.</p>
              <div class="modal-actions">
                <button class="ghost-btn ghost-btn-danger" type="button" :disabled="deletingWorkspace" @click="handleDeleteWorkspace">
                  {{ deletingWorkspace ? 'Deleting…' : 'Yes, delete workspace' }}
                </button>
                <button class="ghost-btn ghost-btn-background" type="button" @click="showDeleteWorkspaceConfirm = false">Cancel</button>
              </div>
            </div>
          </div>
        </div>
        <div v-else-if="settingsTab === 'Members'">
          <h3>Members</h3>
          <span v-if="membersError" class="alert">{{ membersError }}</span>
          <div v-if="membersLoading" class="muted">Loading members...</div>
          <div v-else-if="members.length" class="members-list">
            <div v-for="member in members" :key="member.id" class="members-row">
              <div class="members-info">
                <span class="members-name">{{ member.user?.displayName || member.user?.id || 'User' }}</span>
                <span class="muted">{{ member.user?.email || member.user?.id }}</span>
              </div>
              <div class="members-role">
                <span v-if="!isWorkspaceOwner">{{ member.role }}</span>
                <template v-else>
                  <select
                    class="members-role-select"
                    :value="member.role"
                    :disabled="memberActionLoading[member.userId]"
                    @change="updateMemberRole(member.userId, $event.target.value)"
                  >
                    <option value="OWNER">Owner</option>
                    <option value="EDITOR">Editor</option>
                    <option value="VIEWER">Viewer</option>
                  </select>
                  <button
                    class="ghost-btn ghost-btn-background"
                    type="button"
                    :disabled="memberActionLoading[member.userId]"
                    @click="removeMember(member.userId)"
                  >
                    Remove
                  </button>
                </template>
              </div>
            </div>
          </div>
          <div v-else-if="!membersLoading" class="muted">No members yet.</div>
          <div v-if="isWorkspaceOwner" class="members-invite">
            <h4>Invite member</h4>
            <div class="members-invite-row">
              <input v-model="inviteEmail" class="members-input" type="text" placeholder="Email or username" autocomplete="off" autocapitalize="none" @keydown.enter="inviteMember" />
              <select v-model="inviteRole" class="members-role-select">
                <option value="OWNER">Owner</option>
                <option value="EDITOR">Editor</option>
                <option value="VIEWER">Viewer</option>
              </select>
              <button
                class="ghost-btn ghost-btn-background"
                type="button"
                :disabled="memberActionLoading.invite"
                @click="inviteMember"
              >
                {{ memberActionLoading.invite ? 'Inviting...' : 'Invite' }}
              </button>
            </div>
          </div>
        </div>
        <div v-else-if="settingsTab === 'Export'">
          <h3>Export workspace</h3>
          <p class="muted">Download a snapshot of every page you can access.</p>
          <div class="settings-export-panel">
            <button class="ghost-btn ghost-btn-background export-btn" type="button" @click="emit('export-json')">Download workspace (JSON)</button>
            <button class="ghost-btn ghost-btn-background export-btn" type="button" @click="emit('export-markdown')">Download markdown ZIP</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
