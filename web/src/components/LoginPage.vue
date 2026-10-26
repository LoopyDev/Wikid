<script setup>
import { ref } from 'vue';
import { useWorkspaceStore } from '../stores/workspace';

// The sign-in screen, shown while nobody is logged in.
const workspace = useWorkspaceStore();

const loginEmail = ref('');
const loginPassword = ref('');
const loginError = ref('');
const loginLoading = ref(false);
const handleLogin = async () => {
  loginError.value = '';
  loginLoading.value = true;
  try {
    await workspace.login(loginEmail.value, loginPassword.value);
    loginEmail.value = '';
    loginPassword.value = '';
  } catch (err) {
    loginError.value = err?.message || 'Invalid email or password';
  } finally {
    loginLoading.value = false;
  }
};
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <h1>Wikid</h1>
      <form class="login-form" @submit.prevent="handleLogin">
        <input
          v-model="loginEmail"
          class="login-input"
          type="text"
          placeholder="Email or username"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          required
        />
        <input
          v-model="loginPassword"
          class="login-input"
          type="password"
          placeholder="Password"
          autocomplete="current-password"
          required
        />
        <p v-if="loginError" class="login-error">{{ loginError }}</p>
        <button class="ghost-btn login-submit-btn" type="submit" :disabled="loginLoading">
          {{ loginLoading ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
    </div>
  </div>
</template>
