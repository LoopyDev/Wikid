<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api/client';
import { useWorkspaceStore } from '../stores/workspace';

// System-wide settings for the admin. For now: AI features on or off for everyone.
const workspace = useWorkspaceStore();
const settings = ref(null);
const error = ref('');
const saving = ref(false);

const load = async () => {
  error.value = '';
  try {
    settings.value = await api.getAdminSettings();
  } catch (err) {
    error.value = err?.message || 'Failed to load settings';
  }
};

const setAiEnabled = async (enabled) => {
  saving.value = true;
  error.value = '';
  try {
    settings.value = await api.updateAdminSettings({ aiEnabled: enabled });
    await workspace.loadServerConfig();
  } catch (err) {
    error.value = err?.message || 'Failed to save settings';
  } finally {
    saving.value = false;
  }
};

onMounted(load);
</script>

<template>
  <section class="admin-settings">
    <p v-if="error" class="alert">{{ error }}</p>
    <div v-if="settings" class="admin-settings__section">
      <h2>AI features</h2>
      <template v-if="settings.ai.configured">
        <label class="admin-settings__toggle">
          <input
            type="checkbox"
            :checked="settings.ai.enabled"
            :disabled="saving"
            @change="setAiEnabled($event.target.checked)"
          />
          Turn on AI features for everyone
        </label>
        <p class="muted">
          The AI panel, the AI Writer in the slash menu, and Improve, Summarise, Shorten and Expand on selected text.
          People can still hide them for themselves in Settings.
        </p>
      </template>
      <p v-else class="muted">
        AI isn't set up on this server, so AI features are hidden. To set it up, add
        <code>ANTHROPIC_API_KEY</code> to the server's <code>.env</code> and restart the API.
      </p>
    </div>
  </section>
</template>

<style scoped>
.admin-settings__section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--surface-border);
  border-radius: 10px;
  background: var(--modal-card-bg);
  max-width: 640px;
}

.admin-settings__section h2 {
  margin: 0;
  font-size: 1.05rem;
}

.admin-settings__section p {
  margin: 0;
}

.admin-settings__toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
}
</style>
