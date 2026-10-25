<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api/client';
import { useApiMutation } from '../composables/useApiMutation';
import { formatDate } from '../utils/date-format';

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

const ROLE_OPTIONS = [
  { value: 'OWNER', label: 'Owner' },
  { value: 'EDITOR', label: 'Editor' },
  { value: 'VIEWER', label: 'Viewer' },
];

const normalizeWorkspaceEntry = (entry) => {
  const workspace = entry?.workspace || entry || {};
  const id = workspace.id || entry?.workspaceId || '';
  if (!id) return null;
  return {
    id,
    name: workspace.name || 'Workspace',
    createdAt: workspace.createdAt || entry?.createdAt || null,
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
  assignDrafts.value[workspaceId] || { email: '', role: 'EDITOR', saving: false, error: '' };

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
    const data = await api.listWorkspaceMembers(workspaceId, { adminId: props.adminId });
    const list = Array.isArray(data) ? data : [];
    setMembers(workspaceId, list);
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

const assignMember = async (workspaceId) => {
  const draft = draftFor(workspaceId);
  const email = (draft.email || '').trim();
  if (!email) {
    updateDraft(workspaceId, { error: 'Enter the email address of the person to add.' });
    return;
  }
  updateDraft(workspaceId, { saving: true, error: '' });
  try {
    await api.addWorkspaceMember(
      workspaceId,
      { email, role: draft.role || 'EDITOR' },
      { adminId: props.adminId }
    );
    updateDraft(workspaceId, { email: '', saving: false, error: '' });
    await loadMembers(workspaceId, { force: true });
  } catch (err) {
    updateDraft(workspaceId, { saving: false, error: err?.message || 'Failed to assign user.' });
  }
};

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
        <h3>Workspaces management</h3>
        <p class="muted">Browse all workspaces and assign users to them.</p>
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
            </li>
          </ul>

          <div class="workspace-admin__assign">
            <h4>Assign user</h4>
            <div class="workspace-admin__assign-row">
              <input
                class="workspace-admin__input"
                type="email"
                placeholder="Email address"
                autocomplete="off"
                :value="draftFor(workspace.id).email"
                @input="updateDraft(workspace.id, { email: $event.target.value })"
                @keydown.enter="assignMember(workspace.id)"
              />
              <select
                class="workspace-admin__input workspace-admin__select"
                :value="draftFor(workspace.id).role"
                @change="updateDraft(workspace.id, { role: $event.target.value })"
              >
                <option v-for="role in ROLE_OPTIONS" :key="role.value" :value="role.value">
                  {{ role.label }}
                </option>
              </select>
              <button
                class="ghost-btn ghost-btn-background workspace-admin__assign-btn"
                type="button"
                :disabled="draftFor(workspace.id).saving"
                @click="assignMember(workspace.id)"
              >
                {{ draftFor(workspace.id).saving ? 'Assigning...' : 'Assign' }}
              </button>
            </div>
            <div v-if="draftFor(workspace.id).error" class="alert">{{ draftFor(workspace.id).error }}</div>
            <p class="muted workspace-admin__hint">
              Use a UUID to attach an existing user. Providing a name will create a new user if no match exists.
            </p>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>
