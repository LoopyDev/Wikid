import { onBeforeUnmount, ref } from 'vue';
import { logSetup } from '../utils/editorDebug';
import { providerStatus } from '../services/collabSocket';

// Changes unsent this long with none of them confirmed by the server meanwhile: it's not there,
// though the connection hasn't closed (it said "Saving…" until Hocuspocus gave up on it, 30s on). A
// working server confirms each change within moments.
const NO_ANSWER_MS = 4000;
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// The "Saving…/Saved/Offline" status shown in the page header: follows the live-editing
// connection and whether it still has changes to send, and reports it with the `status` event.
export function useSaveStatus({ emit, isCollabEnabled, collabProvider, currentDocName }) {
  const unsyncedWatcher = ref(null);
  // Since when this page has had changes to send with none confirmed (0: none to send). Its own
  // confirmations, not anything heard on the connection: that's shared with other documents.
  let unsentSince = 0;
  let unsentCount = 0;
  let noAnswerTimer = null;
  const noAnswer = () => !!unsentSince && Date.now() - unsentSince >= NO_ANSWER_MS;
  // Checked again once it would be time (a timer, as the frame-by-frame watcher stops in a hidden tab)
  const armNoAnswerCheck = () => {
    clearTimeout(noAnswerTimer);
    noAnswerTimer = unsentSince ? setTimeout(() => refreshSaveStatus(), unsentSince + NO_ANSWER_MS - Date.now() + 20) : null;
  };
  const noteUnsent = (count) => {
    if (!count) unsentSince = 0;
    // None yet, or some confirmed since (it's answering): counted from now
    else if (!unsentSince || count < unsentCount) unsentSince = Date.now();
    unsentCount = count;
    armNoAnswerCheck();
  };
  const resetUnsent = () => {
    unsentSince = 0;
    unsentCount = 0;
    armNoAnswerCheck();
  };
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
    if (!collabProvider.value || isOffline()) {
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
      if (!unsentSince) noteUnsent(collabProvider.value.unsyncedChanges || 1);
      if (noAnswer()) {
        clearSavedDelay();
        emitStatus('Offline', 'offline');
        return;
      }
      emitSaving();
    } else {
      resetUnsent();
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
    noteUnsent(typeof count === 'number' ? count : count?.number || 0);
    if (!collabProvider.value || providerStatus(collabProvider.value) !== 'connected' || isOffline()) {
      refreshSaveStatus();
      stopUnsyncedWatcher();
      return;
    }
    if (unsentSince) {
      if (noAnswer()) refreshSaveStatus();
      else emitSaving();
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
    // Counted afresh on each change of connection (a reconnect, another page's document)
    resetUnsent();
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

  // The browser knows it's offline: said at once (the connection itself can take a while to close)
  const onOffline = () => {
    if (!isCollabEnabled.value) return;
    stopUnsyncedWatcher();
    clearSavedDelay();
    emitStatus('Offline', 'offline');
  };
  const onOnline = () => {
    refreshSaveStatus();
    if (collabProvider.value?.hasUnsyncedChanges) startUnsyncedWatcher();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    onBeforeUnmount(() => {
      clearTimeout(noAnswerTimer);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    });
  }

  return { emitStatus, clearSavedDelay, emitSaving, emitSavedWithDelay, refreshSaveStatus, stopUnsyncedWatcher, handleUnsyncedChanges, startUnsyncedWatcher, handleProviderStatus };
}
