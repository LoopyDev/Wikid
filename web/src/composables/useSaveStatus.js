import { ref } from 'vue';
import { logSetup } from '../utils/editorDebug';
import { providerStatus } from '../services/collabSocket';

// The "Saving…/Saved/Offline" status shown in the page header: follows the live-editing
// connection and whether it still has changes to send, and reports it with the `status` event.
export function useSaveStatus({ emit, isCollabEnabled, collabProvider, currentDocName }) {
  const unsyncedWatcher = ref(null);
  const savingShownAt = ref(0);
  const savedDelayTimer = ref(null);
  const emitStatus = (text, state) => emit('status', { text, state });
  const clearSavedDelay = () => {
    if (savedDelayTimer.value) {
      clearTimeout(savedDelayTimer.value);
      savedDelayTimer.value = null;
    }
  };
  const emitSaving = () => {
    savingShownAt.value = Date.now();
    clearSavedDelay();
    emitStatus('Saving...', 'saving');
  };
  const emitSavedWithDelay = () => {
    const elapsed = savingShownAt.value ? Date.now() - savingShownAt.value : Infinity;
    const delay = Math.max(0, 1000 - elapsed);
    clearSavedDelay();
    savedDelayTimer.value = setTimeout(() => {
      emitStatus('Saved', 'saved');
      savedDelayTimer.value = null;
      savingShownAt.value = 0;
    }, delay);
  };
  const refreshSaveStatus = () => {
    if (!isCollabEnabled.value) return;
    if (!collabProvider.value) {
      emitStatus('Offline', 'offline');
      return;
    }
    const status = providerStatus(collabProvider.value);
    if (status === 'disconnected') {
      emitStatus('Offline', 'offline');
      return;
    }
    if (status === 'connecting') {
      emitStatus('Connecting...', 'connecting');
      return;
    }
    const unsynced = !!collabProvider.value.hasUnsyncedChanges;
    if (unsynced) {
      emitSaving();
    } else {
      emitSavedWithDelay();
    }
  };
  const stopUnsyncedWatcher = () => {
    if (unsyncedWatcher.value) {
      cancelAnimationFrame(unsyncedWatcher.value);
      unsyncedWatcher.value = null;
    }
  };
  const handleUnsyncedChanges = (count) => {
    if (!collabProvider.value || providerStatus(collabProvider.value) !== 'connected') {
      refreshSaveStatus();
      stopUnsyncedWatcher();
      return;
    }
    if (count > 0) {
      emitSaving();
      startUnsyncedWatcher();
    } else {
      emitSavedWithDelay();
      stopUnsyncedWatcher();
    }
  };
  const startUnsyncedWatcher = () => {
    stopUnsyncedWatcher();
    const tick = () => {
      if (!collabProvider.value) {
        stopUnsyncedWatcher();
        return;
      }
      refreshSaveStatus();
      if (providerStatus(collabProvider.value) === 'connected' && collabProvider.value.hasUnsyncedChanges) {
        unsyncedWatcher.value = requestAnimationFrame(tick);
      } else {
        stopUnsyncedWatcher();
      }
    };
    unsyncedWatcher.value = requestAnimationFrame(tick);
  };
  const handleProviderStatus = ({ status }) => {
    logSetup('status', { status, docName: currentDocName.value });
    if (status === 'connecting') {
      emitStatus('Connecting...', 'connecting');
    } else if (status === 'connected') {
      startUnsyncedWatcher();
    } else if (status === 'disconnected') {
      emitStatus('Offline', 'offline');
      stopUnsyncedWatcher();
      clearSavedDelay();
    }
  };

  return { emitStatus, clearSavedDelay, emitSaving, emitSavedWithDelay, refreshSaveStatus, stopUnsyncedWatcher, handleUnsyncedChanges, startUnsyncedWatcher, handleProviderStatus };
}
