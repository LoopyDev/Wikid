import { ref } from 'vue';

/**
 * Wraps an async function with loading/error state.
 * Returns { loading, error, execute } where execute() calls fn and manages state.
 * The error ref is reset at the start of each call and set on failure.
 * The return value of fn is forwarded from execute().
 */
export function useApiMutation(fn) {
  const loading = ref(false);
  const error = ref('');

  async function execute(...args) {
    loading.value = true;
    error.value = '';
    try {
      return await fn(...args);
    } catch (err) {
      error.value = err?.message || 'An error occurred';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return { loading, error, execute };
}
