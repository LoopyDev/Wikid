<script setup>
import { ref } from 'vue';
import { useWorkspaceStore } from '../stores/workspace';

// Shown instead of the app when an admin set this user's password (a new account or a reset):
// they choose their own before going on.
const workspace = useWorkspaceStore();

const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const error = ref('');
const saving = ref(false);

const submit = async () => {
  error.value = '';
  if (!newPassword.value) {
    error.value = 'Choose a new password';
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = 'The new passwords do not match';
    return;
  }
  saving.value = true;
  try {
    await workspace.changePassword(currentPassword.value, newPassword.value);
  } catch (err) {
    error.value = err?.message || 'Failed to change password';
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <h1>Choose a new password</h1>
      <p class="muted">Your password was set for you. Choose your own to continue.</p>
      <form class="login-form" @submit.prevent="submit">
        <input
          v-model="currentPassword"
          class="login-input"
          type="password"
          placeholder="Password you were given"
          autocomplete="current-password"
          required
        />
        <input
          v-model="newPassword"
          class="login-input"
          type="password"
          placeholder="New password"
          autocomplete="new-password"
          required
        />
        <input
          v-model="confirmPassword"
          class="login-input"
          type="password"
          placeholder="Confirm new password"
          autocomplete="new-password"
          required
        />
        <p v-if="error" class="login-error">{{ error }}</p>
        <button class="ghost-btn login-submit-btn" type="submit" :disabled="saving">
          {{ saving ? 'Saving…' : 'Save and continue' }}
        </button>
        <button class="ghost-btn" type="button" @click="workspace.logout()">Log out</button>
      </form>
    </div>
  </div>
</template>
