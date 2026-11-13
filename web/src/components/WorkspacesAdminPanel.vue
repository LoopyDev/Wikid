<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api/client';
import { useApiMutation } from '../composables/useApiMutation';
import { formatDate } from '../utils/date-format';
import { adminActionText } from '../utils/adminActions';

const props = defineProps({
  adminId: {
    type: String,
    required: true,
  },
});

const workspaces = ref([]);
const expanded = ref({});
const membersByWorkspace = ref({});
const membersLoading = ref({});
const membersError = ref({});
const assignDrafts = ref({});
// What the admin has changed in each workspace (its members see these too)
const actionsByWorkspace = ref({});
// Confirmations waiting: a member's removal ("workspaceId:userId"), a workspace's deletion
const confirmingRemove = ref('');
const confirmingDelete = ref('');
const busy = ref('');
const actionError = ref({});

const normalizeWorkspaceEntry = (entry) => {
  const workspace = entry?.workspace || entry || {};
  const id = workspace.id || entry?.workspaceId || '';
  if (!id) return null;
  return {
    id,
    name: workspace.name || 'Workspace',
    createdAt: workspace.createdAt || entry?.createdAt || null,
    // When a page in it last changed (the workspace's own date moves only on a rename)
    lastChangeAt: workspace.lastPageChangeAt || workspace.updatedAt || null,
    personal: !!workspace.personalOwnerId,
    pageCount: workspace._count?.pages ?? null,
  };
};

const workspaceList = computed(() =>
  (workspaces.value || [])
    .map((entry) => normalizeWorkspaceEntry(entry))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))
);

const workspaceCount = computed(() => workspaceList.value.length);

const setExpanded = (workspaceId, value) => {
  expanded.value = { ...expanded.value, [workspaceId]: value };
};

const draftFor = (workspaceId) =>
  assignDrafts.value[workspaceId] || { email: '', saving: false, error: '' };

const updateDraft = (workspaceId, patch) => {
  const current = draftFor(workspaceId);
  assignDrafts.value = { ...assignDrafts.value, [workspaceId]: { ...current, ...patch } };
};

const setMembersLoading = (workspaceId, value) => {
  membersLoading.value = { ...membersLoading.value, [workspaceId]: value };
};

const setMembersError = (workspaceId, value) => {
  membersError.value = { ...membersError.value, [workspaceId]: value };
};

const setMembers = (workspaceId, value) => {
  membersByWorkspace.value = { ...membersByWorkspace.value, [workspaceId]: value };
};

const { loading, error, execute: loadWorkspaces } = useApiMutation(async () => {
  if (!props.adminId) return;
  const data = await api.listWorkspaces({ adminId: props.adminId });
  workspaces.value = Array.isArray(data) ? data : [];
});

const loadMembers = async (workspaceId, { force = false } = {}) => {
  if (!workspaceId || !props.adminId) return;
  if (!force && membersByWorkspace.value[workspaceId]) return;
  setMembersLoading(workspaceId, true);
  setMembersError(workspaceId, '');
  try {
    const [data, actions] = await Promise.all([
      api.listWorkspaceMembers(workspaceId, { adminId: props.adminId }),
      api.listWorkspaceAdminActions(workspaceId).catch(() => []),
    ]);
    const list = Array.isArray(data) ? data : [];
    setMembers(workspaceId, list);
    actionsByWorkspace.value = { ...actionsByWorkspace.value, [workspaceId]: Array.isArray(actions) ? actions : [] };
  } catch (err) {
    setMembers(workspaceId, []);
    setMembersError(workspaceId, err?.message || 'Failed to load members');
  } finally {
    setMembersLoading(workspaceId, false);
  }
};

const toggleWorkspace = (workspaceId) => {
  const next = !expanded.value[workspaceId];
  setExpanded(workspaceId, next);
  if (next) {
    loadMembers(workspaceId);
  }
};

// An owner for a workspace nobody can manage (its owner gone or locked out). Only that: adding other
// members is its owners' job.
const setOwner = async (workspaceId) => {
  const draft = draftFor(workspaceId);
  const login = (draft.email || '').trim();
  if (!login) {
    updateDraft(workspaceId, { error: 'Enter the email address or username of the new owner.' });
    return;
  }
  updateDraft(workspaceId, { saving: true, error: '' });
  try {
    await api.addWorkspaceMember(workspaceId, { login, role: 'OWNER' }, { adminId: props.adminId });
    updateDraft(workspaceId, { email: '', saving: false, error: '' });
    await loadMembers(workspaceId, { force: true });
  } catch (err) {
    updateDraft(workspaceId, { saving: false, error: err?.message || "Couldn't set the owner." });
  }
};
const setActionError = (workspaceId, message) => {
  actionError.value = { ...actionError.value, [workspaceId]: message };
};
const removeMember = async (workspaceId, member) => {
  const key = `${workspaceId}:${member.userId}`;
  if (confirmingRemove.value !== key) {
    confirmingRemove.value = key;
    // The "Remove?" waits a few seconds for the second click, then it's back to "Remove"
    setTimeout(() => {
      if (confirmingRemove.value === key) confirmingRemove.value = '';
    }, 4000);
    return;
  }
  confirmingRemove.value = '';
  busy.value = key;
  setActionError(workspaceId, '');
  try {
    await api.removeWorkspaceMember(workspaceId, member.userId, { adminId: props.adminId });
    await loadMembers(workspaceId, { force: true });
  } catch (err) {
    setActionError(workspaceId, err?.message || "Couldn't remove them.");
  } finally {
    busy.value = '';
  }
};
const deleteWorkspace = async (workspace) => {
  busy.value = `delete:${workspace.id}`;
  setActionError(workspace.id, '');
  try {
    await api.deleteWorkspace(workspace.id);
    confirmingDelete.value = '';
    await loadWorkspaces();
  } catch (err) {
    setActionError(workspace.id, err?.message || "Couldn't delete it.");
  } finally {
    busy.value = '';
  }
};
const actionText = (action) => adminActionText(action, { forAdmin: true });

const memberDisplayName = (member) => {
  return member?.user?.displayName || member?.user?.email || member?.userId || 'Member';
};

onMounted(loadWorkspaces);
watch(
  () => props.adminId,
  () => loadWorkspaces()
);
</script>

<template>
  <div class="workspace-admin">
    <div class="workspace-admin__header">
      <div>
        <h3>Workspaces</h3>
        <p class="muted">
          Every workspace on this server, with its members (not its pages). Set an owner for one nobody can
          manage, remove a member, or delete one. Each change is shown to the workspace's members.
        </p>
      </div>
      <div class="workspace-admin__actions">
        <button class="ghost-btn ghost-btn-background" type="button" @click="loadWorkspaces" :disabled="loading">
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </button>
      </div>
    </div>

    <div class="workspace-admin__summary">
      <span class="workspace-admin__pill">Total workspaces: {{ workspaceCount }}</span>
    </div>

    <span v-if="error" class="alert">{{ error }}</span>

    <div v-if="loading" class="muted">Loading workspaces...</div>
    <div v-else-if="!workspaceList.length" class="muted">No workspaces found.</div>
    <div v-else class="workspace-admin__list">
      <article v-for="workspace in workspaceList" :key="workspace.id" class="workspace-admin__card">
        <div class="workspace-admin__card-header">
          <div>
            <div class="workspace-admin__title">{{ workspace.name }}</div>
            <div class="workspace-admin__meta">
              <span>id: {{ workspace.id }}</span>
              <span v-if="workspace.createdAt">· created {{ formatDate(workspace.createdAt) }}</span>
              <span v-if="workspace.personal">· personal</span>
              <span v-if="workspace.lastChangeAt">· last changed {{ formatDate(workspace.lastChangeAt) }}</span>
              <span v-if="workspace.pageCount !== null">· {{ workspace.pageCount }} {{ workspace.pageCount === 1 ? 'page' : 'pages' }}</span>
            </div>
          </div>
          <button
            class="ghost-btn ghost-btn-background workspace-admin__toggle"
            type="button"
            @click="toggleWorkspace(workspace.id)"
          >
            {{ expanded[workspace.id] ? 'Hide members' : 'Manage members' }}
          </button>
        </div>
        <div v-if="confirmingDelete === workspace.id" class="workspace-admin__confirm" role="alertdialog" :aria-label="`Delete ${workspace.name}`">
          <span>Delete "{{ workspace.name }}" and all its pages for good? This can't be undone.</span>
          <button class="ghost-btn" type="button" @click="confirmingDelete = ''">Cancel</button>
          <button class="ghost-btn ghost-btn-background workspace-admin__danger" type="button" :disabled="busy === `delete:${workspace.id}`" @click="deleteWorkspace(workspace)">
            {{ busy === `delete:${workspace.id}` ? 'Deleting…' : 'Delete for good' }}
          </button>
        </div>
        <div v-if="actionError[workspace.id]" class="alert">{{ actionError[workspace.id] }}</div>

        <div v-if="expanded[workspace.id]" class="workspace-admin__members">
          <div class="workspace-admin__members-header">
            <h4>Members</h4>
            <button
              class="ghost-btn ghost-btn-background"
              type="button"
              :disabled="membersLoading[workspace.id]"
              @click="loadMembers(workspace.id, { force: true })"
            >
              Refresh
            </button>
          </div>
          <div v-if="membersLoading[workspace.id]" class="muted">Loading members...</div>
          <div v-else-if="membersError[workspace.id]" class="alert">{{ membersError[workspace.id] }}</div>
          <ul v-else class="workspace-admin__members-list">
            <li v-if="!(membersByWorkspace[workspace.id] || []).length" class="muted">No members yet.</li>
            <li
              v-for="member in membersByWorkspace[workspace.id] || []"
              :key="member.userId || member.user?.id"
              class="workspace-admin__member"
            >
              <div>
                <div class="workspace-admin__member-name">{{ memberDisplayName(member) }}</div>
                <div class="workspace-admin__member-meta">{{ member.user?.email || member.userId }}</div>
              </div>
              <span class="workspace-admin__member-role">{{ member.role }}</span>
              <button
                v-if="!workspace.personal"
                class="ghost-btn workspace-admin__remove"
                type="button"
                :disabled="busy === `${workspace.id}:${member.userId}`"
                @click="removeMember(workspace.id, member)"
              >
                {{ confirmingRemove === `${workspace.id}:${member.userId}` ? 'Remove?' : 'Remove' }}
              </button>
            </li>
          </ul>
          <ul v-if="(actionsByWorkspace[workspace.id] || []).length" class="workspace-admin__history" aria-label="Changes by the system admin">
            <li v-for="action in actionsByWorkspace[workspace.id]" :key="action.id" class="muted">
              {{ actionText(action) }} · {{ formatDate(action.createdAt) }}
            </li>
          </ul>

          <p v-if="workspace.personal" class="muted workspace-admin__hint">A personal workspace is its person's alone: nothing here to change.</p>
          <div v-else class="workspace-admin__assign">
            <h4>Set an owner</h4>
            <div class="workspace-admin__assign-row">
              <input
                class="workspace-admin__input"
                type="text"
                placeholder="Email address or username"
                autocomplete="off"
                autocapitalize="none"
                aria-label="New owner's email address or username"
                :value="draftFor(workspace.id).email"
                @input="updateDraft(workspace.id, { email: $event.target.value })"
                @keydown.enter="setOwner(workspace.id)"
              />
              <button
                class="ghost-btn ghost-btn-background workspace-admin__assign-btn"
                type="button"
                :disabled="draftFor(workspace.id).saving"
                @click="setOwner(workspace.id)"
              >
                {{ draftFor(workspace.id).saving ? 'Setting…' : 'Make owner' }}
              </button>
            </div>
            <div v-if="draftFor(workspace.id).error" class="alert">{{ draftFor(workspace.id).error }}</div>
            <p class="muted workspace-admin__hint">
              For a workspace nobody can manage. Its owners add other members. Private pages stay their authors' only.
            </p>
            <button class="ghost-btn workspace-admin__danger-link" type="button" @click="confirmingDelete = workspace.id">Delete workspace…</button>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>
