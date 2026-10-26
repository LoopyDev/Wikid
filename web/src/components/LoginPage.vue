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
    <main class="login-card">
      <header class="login-header">
        <div class="login-brand">
          <span class="login-brand__mark" aria-hidden="true"><i class="bi bi-journal-text"></i></span>
          Wikid
        </div>
        <h1 class="login-title">Sign in</h1>
        <p class="login-subtitle">Use your email address or username.</p>
      </header>
      <form class="login-form" @submit.prevent="handleLogin">
        <div class="login-field">
          <label class="login-label" for="login-name">Email or username</label>
          <input
            id="login-name"
            v-model="loginEmail"
            class="login-input"
            type="text"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
            required
          />
        </div>
        <div class="login-field">
          <label class="login-label" for="login-password">Password</label>
          <input
            id="login-password"
            v-model="loginPassword"
            class="login-input"
            type="password"
            autocomplete="current-password"
            required
          />
        </div>
        <p v-if="loginError" class="login-alert" role="alert">{{ loginError }}</p>
        <button class="login-primary-btn" type="submit" :disabled="loginLoading">
          {{ loginLoading ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
    </main>
  </div>
</template>
