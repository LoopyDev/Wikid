<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api/client';
import { useApiMutation } from '../composables/useApiMutation';

const props = defineProps({
  adminId: { type: String, required: true },
});

const users = ref([]);
const showCreateForm = ref(false);
const createDraft = ref({ displayName: '', email: '', password: '', mustChangePassword: true });
const editingId = ref(null);
const editDraft = ref({ displayName: '', email: '' });
const resetId = ref(null);
const resetPassword = ref('');
const resetMustChange = ref(true);
const deleteId = ref(null);

const { loading, error, execute: loadUsers } = useApiMutation(async () => {
  users.value = await api.listUsers(props.adminId);
});

const { loading: createLoading, error: createError, execute: createUser } = useApiMutation(async () => {
  await api.createUser(props.adminId, createDraft.value);
  createDraft.value = { displayName: '', email: '', password: '', mustChangePassword: true };
  showCreateForm.value = false;
  await loadUsers();
});

const { loading: editLoading, error: editError, execute: saveEdit } = useApiMutation(async (userId) => {
  await api.updateUser(props.adminId, userId, editDraft.value);
  editingId.value = null;
  await loadUsers();
});

const { loading: resetLoading, error: resetError, execute: submitReset } = useApiMutation(async (userId) => {
  await api.resetUserPassword(props.adminId, userId, resetPassword.value, { mustChangePassword: resetMustChange.value });
  resetId.value = null;
  resetPassword.value = '';
  await loadUsers();
});

const { loading: deleteLoading, error: deleteError, execute: confirmDelete } = useApiMutation(async (userId) => {
  await api.deleteUser(props.adminId, userId);
  deleteId.value = null;
  await loadUsers();
});

function startEdit(user) {
  editingId.value = user.id;
  editDraft.value = { displayName: user.displayName, email: user.email };
  editError.value = '';
}

function startReset(userId) {
  resetId.value = userId;
  resetPassword.value = '';
  resetMustChange.value = true;
  resetError.value = '';
}

onMounted(loadUsers);
</script>

<template>
  <section class="admin-panel">
    <div class="admin-panel__header">
      <h2 class="admin-panel__title">Users</h2>
      <div class="admin-panel__actions">
        <button class="ghost-btn ghost-btn-background" type="button" @click="loadUsers">Refresh</button>
        <button class="ghost-btn ghost-btn-background" type="button" @click="showCreateForm = !showCreateForm">
          {{ showCreateForm ? 'Cancel' : '+ New user' }}
        </button>
      </div>
    </div>

    <div v-if="showCreateForm" class="admin-users-form">
      <h3>Create user</h3>
      <div class="admin-users-form-fields">
        <input v-model="createDraft.displayName" class="login-input" type="text" placeholder="Display name" />
        <input v-model="createDraft.email" class="login-input" type="email" placeholder="Email" />
        <input v-model="createDraft.password" class="login-input" type="password" placeholder="Password" />
      </div>
      <label class="admin-users-check">
        <input v-model="createDraft.mustChangePassword" type="checkbox" />
        Ask them to choose their own password when they first log in
      </label>
      <p v-if="createError" class="login-error">{{ createError }}</p>
      <div class="admin-users-form-actions">
        <button class="ghost-btn ghost-btn-background" type="button" :disabled="createLoading" @click="createUser">
          {{ createLoading ? 'Creating…' : 'Create' }}
        </button>
      </div>
    </div>

    <p v-if="error" class="alert">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <div v-else-if="users.length" class="admin-users-list">
      <div v-for="user in users" :key="user.id" class="admin-user-row">
        <template v-if="editingId === user.id">
          <div class="admin-user-edit">
            <input v-model="editDraft.displayName" class="login-input" type="text" placeholder="Display name" />
            <input v-model="editDraft.email" class="login-input" type="email" placeholder="Email" />
            <p v-if="editError" class="login-error">{{ editError }}</p>
            <div class="admin-user-edit-actions">
              <button class="ghost-btn ghost-btn-background" type="button" :disabled="editLoading" @click="saveEdit(user.id)">
                {{ editLoading ? 'Saving…' : 'Save' }}
              </button>
              <button class="ghost-btn ghost-btn-background" type="button" @click="editingId = null">Cancel</button>
            </div>
          </div>
        </template>
        <template v-else-if="resetId === user.id">
          <div class="admin-user-reset">
            <span class="admin-user-name">{{ user.displayName }}</span>
            <input v-model="resetPassword" class="login-input" type="password" placeholder="New password" />
            <label class="admin-users-check">
              <input v-model="resetMustChange" type="checkbox" />
              Ask them to choose their own password when they next log in
            </label>
            <p v-if="resetError" class="login-error">{{ resetError }}</p>
            <div class="admin-user-edit-actions">
              <button class="ghost-btn ghost-btn-background" type="button" :disabled="resetLoading" @click="submitReset(user.id)">
                {{ resetLoading ? 'Resetting…' : 'Set password' }}
              </button>
              <button class="ghost-btn ghost-btn-background" type="button" @click="resetId = null">Cancel</button>
            </div>
          </div>
        </template>
        <template v-else-if="deleteId === user.id">
          <div class="admin-user-delete-confirm">
            <span class="admin-user-name">Delete <strong>{{ user.displayName }}</strong>?</span>
            <p v-if="deleteError" class="login-error">{{ deleteError }}</p>
            <div class="admin-user-edit-actions">
              <button class="ghost-btn ghost-btn-background" type="button" :disabled="deleteLoading" @click="confirmDelete(user.id)">
                {{ deleteLoading ? 'Deleting…' : 'Confirm delete' }}
              </button>
              <button class="ghost-btn ghost-btn-background" type="button" @click="deleteId = null">Cancel</button>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="admin-user-info">
            <span class="admin-user-name">{{ user.displayName }}</span>
            <span class="admin-user-email muted">{{ user.email }}</span>
            <span v-if="user.mustChangePassword" class="admin-user-badge">Must choose a new password</span>
          </div>
          <div class="admin-user-row-actions">
            <button class="ghost-btn ghost-btn-background" type="button" @click="startEdit(user)">Edit</button>
            <button class="ghost-btn ghost-btn-background" type="button" @click="startReset(user.id)">Reset password</button>
            <button class="ghost-btn ghost-btn-background" type="button" @click="deleteId = user.id">Delete</button>
          </div>
        </template>
      </div>
    </div>
    <p v-else-if="!loading" class="muted">No users found.</p>
  </section>
</template>

<style scoped>
.admin-users-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
}

.admin-user-badge {
  align-self: flex-start;
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--text-color-orange);
  color: var(--text-primary);
}

.admin-users-form {
  background: var(--surface-raised, #f8fafc);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.admin-users-form h3 {
  margin: 0 0 4px;
  font-size: 0.95rem;
}
.admin-users-form-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.admin-users-form-actions {
  display: flex;
  gap: 8px;
}
.admin-users-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.admin-user-row {
  border-radius: 8px;
  padding: 10px 12px;
  border: 1px solid transparent;
}
.admin-user-row:hover {
  border-color: var(--border, #e2e8f0);
  background: var(--surface-raised, #f8fafc);
}
.admin-user-info {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex: 1;
}
.admin-user-row:not(:has(.admin-user-edit)):not(:has(.admin-user-reset)):not(:has(.admin-user-delete-confirm)) {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.admin-user-name {
  font-weight: 600;
  font-size: 0.9rem;
}
.admin-user-email {
  font-size: 0.825rem;
}
.admin-user-row-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.admin-user-edit,
.admin-user-reset,
.admin-user-delete-confirm {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.admin-user-edit-actions {
  display: flex;
  gap: 8px;
}
</style>
