import { ref, watch, onBeforeUnmount } from 'vue';
import { api } from '../api/client';
import { blockSummaryCache } from '../services/blockSummaryCache';

const BATCH_SIZE = 10;
const SUMMARIZABLE = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock']);

export function useBlockSummarizer(editorRef) {
  const pending = ref(false);
  const stats = ref({ total: 0, cached: 0 });

  let _inFlight = false;
  let _unsubscribe = null;

  // Cheap local check — just reads the cache, no API calls.
  // Runs on every editor update to keep the stats display current.
  function computeStats(doc) {
    let total = 0;
    let cached = 0;
    doc.forEach((node) => {
      if (!SUMMARIZABLE.has(node.type.name)) return;
      const text = node.textContent;
      if (!text) return;
      total++;
      if (blockSummaryCache.isShort(text) || blockSummaryCache.has(blockSummaryCache.hash(text))) {
        cached++;
      }
    });
    stats.value = { total, cached };
  }

  function collectStale(doc) {
    const stale = [];
    doc.forEach((node, _offset, index) => {
      if (!SUMMARIZABLE.has(node.type.name)) return;
      const text = node.textContent;
      if (!text || blockSummaryCache.isShort(text)) return;
      const hash = blockSummaryCache.hash(text);
      if (!blockSummaryCache.has(hash)) {
        stale.push({ index, type: node.type.name, text, hash });
      }
    });
    return stale;
  }

  // Called explicitly before an AI request. Summarizes all uncached blocks,
  // updates stats as batches complete, then resolves.
  async function summarize() {
    if (_inFlight) return;
    const ed = editorRef.value;
    if (!ed || ed.isDestroyed) return;

    const doc = ed.state.doc;
    const stale = collectStale(doc);
    if (!stale.length) return;

    _inFlight = true;
    pending.value = true;

    try {
      for (let i = 0; i < stale.length; i += BATCH_SIZE) {
        const batch = stale.slice(i, i + BATCH_SIZE);
        try {
          const results = await api.summarizeBlocks(
            batch.map(({ index, type, text }) => ({ index, type, text })),
          );
          for (const r of results) {
            const block = batch.find((b) => b.index === r.index);
            if (block && r.summary) blockSummaryCache.set(block.hash, r.summary);
          }
          computeStats(doc);
        } catch (err) {
          console.debug('[useBlockSummarizer] batch failed:', err?.message);
        }
      }
    } finally {
      _inFlight = false;
      pending.value = false;
    }
  }

  function attachEditor(ed) {
    if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
    if (!ed) return;

    const handler = ({ editor: e }) => { if (!e.isDestroyed) computeStats(e.state.doc); };
    ed.on('update', handler);
    _unsubscribe = () => ed.off('update', handler);

    // Compute initial stats on mount
    if (!ed.isDestroyed) computeStats(ed.state.doc);
  }

  const stopWatch = watch(editorRef, (newEd) => attachEditor(newEd ?? null), { immediate: true });

  function stop() {
    if (_unsubscribe) _unsubscribe();
    stopWatch();
    pending.value = false;
  }

  onBeforeUnmount(stop);

  return { pending, stats, summarize };
}
