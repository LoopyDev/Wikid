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
    <main class="login-card">
      <header class="login-header">
        <div class="login-brand">
          <span class="login-brand__mark" aria-hidden="true"><i class="bi bi-journal-text"></i></span>
          Wikid
        </div>
        <h1 class="login-title">Choose a new password</h1>
        <p class="login-subtitle">Your password was set for you. Choose your own to continue.</p>
      </header>
      <form class="login-form" @submit.prevent="submit">
        <div class="login-field">
          <label class="login-label" for="given-password">Password you were given</label>
          <input
            id="given-password"
            v-model="currentPassword"
            class="login-input"
            type="password"
            autocomplete="current-password"
            required
          />
        </div>
        <div class="login-field">
          <label class="login-label" for="new-password">New password</label>
          <input id="new-password" v-model="newPassword" class="login-input" type="password" autocomplete="new-password" required />
        </div>
        <div class="login-field">
          <label class="login-label" for="confirm-password">Confirm new password</label>
          <input
            id="confirm-password"
            v-model="confirmPassword"
            class="login-input"
            type="password"
            autocomplete="new-password"
            required
          />
        </div>
        <p v-if="error" class="login-alert" role="alert">{{ error }}</p>
        <button class="login-primary-btn" type="submit" :disabled="saving">
          {{ saving ? 'Saving…' : 'Save and continue' }}
        </button>
        <button class="login-secondary-btn" type="button" @click="workspace.logout()">Log out</button>
      </form>
    </main>
  </div>
</template>
