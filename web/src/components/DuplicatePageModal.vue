<script setup>
import { ref } from 'vue';

// Asks, when the pages being duplicated have a database in them, whether its copy has the
// original's rows or only its columns, views and forms. (A compliance database's copy never has
// its records: they and their audit trail stay with the original.)
defineProps({
  page: { type: Object, default: null },
  // Which kinds of database are in them
  hasPlain: { type: Boolean, default: true },
  hasCompliance: { type: Boolean, default: false },
  // Compliance databases are switched off: the copy can't be made
  complianceOff: { type: Boolean, default: false },
});
const emit = defineEmits(['cancel', 'confirm']);
const rows = ref(true);
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('cancel')">
    <div v-dialog="() => emit('cancel')" class="modal-card duplicate-modal" role="dialog" aria-labelledby="duplicate-title">
      <h3 id="duplicate-title">Duplicate page</h3>
      <template v-if="complianceOff">
        <p class="muted">
          "{{ page?.title || 'Untitled page' }}" has a compliance database in it, and compliance databases are
          turned off in this instance, so it can't be duplicated. An admin can turn them on in the admin settings.
        </p>
        <div class="modal-actions">
          <button class="ghost-btn ghost-btn-background" type="button" @click="emit('cancel')">OK</button>
        </div>
      </template>
      <template v-else>
        <p v-if="hasPlain" class="muted">"{{ page?.title || 'Untitled page' }}" has a database in it. What should its copy have?</p>
        <fieldset v-if="hasPlain" class="duplicate-modal__choice" aria-label="What the database's copy has">
          <label>
            <input v-model="rows" type="radio" :value="true" />
            <span><strong>Copy databases with their rows</strong> <span class="muted">— and each row's page</span></span>
          </label>
          <label>
            <input v-model="rows" type="radio" :value="false" />
            <span><strong>Columns and views only, no rows</strong> <span class="muted">— an empty database to fill</span></span>
          </label>
        </fieldset>
        <p v-if="hasCompliance" class="muted duplicate-modal__note">Compliance databases are copied without their records.</p>
        <div class="modal-actions">
          <button class="ghost-btn" type="button" @click="emit('cancel')">Cancel</button>
          <button class="ghost-btn ghost-btn-background" type="button" @click="emit('confirm', { rows })">Duplicate</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.duplicate-modal {
  width: min(480px, calc(100vw - 32px));
}
.duplicate-modal__choice {
  border: 0;
  margin: 12px 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.duplicate-modal__choice label {
  display: flex;
  gap: 8px;
  align-items: baseline;
  cursor: pointer;
}
.duplicate-modal__note {
  margin: 0 0 8px;
}
</style>
