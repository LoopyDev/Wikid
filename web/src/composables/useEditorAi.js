import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Slice } from 'prosemirror-model';
import { AI_SERIALIZABLE_TYPES, detectTargetSection, SMALL_PAGE_THRESHOLD } from '../utils/aiContext';
import { aiSuggestionKey } from '../tiptap/aiSuggestions';
import { api } from '../api/client';
import { blockSummaryCache } from '../services/blockSummaryCache';
import { markdownToBlockNode, markdownToInlineFragment, nodeToInlineMarkdown } from '../utils/aiMarkdown';
import { renderDatabaseAsMarkdownTable } from '../utils/editorDoc';

// AI in the editor: the page's blocks as context for the AI panel, its suggested changes
// (shown inline to accept or revert), the inline AI prompt, and the bubble menu's AI actions.
export function useEditorAi({ workspace, getEditor }) {
  // Track last known cursor position so serializeBlocksForAi can detect the
  // target section even after the editor loses focus (e.g. user clicked AI panel)
  const lastKnownCursorPos = ref(null);

  const serializeBlocksForAi = async () => {
    if (!getEditor()) return [];
    const doc = getEditor().state.doc;
    const blocks = [];

    let serializableCount = 0;
    doc.forEach((node) => { if (AI_SERIALIZABLE_TYPES.has(node.type.name)) serializableCount++; });

    const cursorPos = lastKnownCursorPos.value;
    // For small pages or when no cursor position is known, send everything as full text
    const targetIndices =
      cursorPos != null && serializableCount > SMALL_PAGE_THRESHOLD
        ? detectTargetSection(cursorPos, doc)
        : null;

    // Pre-fetch database data for any inline databaseView nodes in parallel
    const dbViewNodes = [];
    doc.forEach((node, _offset, index) => {
      if (node.type.name === 'databaseView' && node.attrs.pageId) {
        dbViewNodes.push({ pageId: node.attrs.pageId, title: node.attrs.title, index });
      }
    });
    const dbData = {};
    if (dbViewNodes.length) {
      const user = workspace.activeUser;
      await Promise.all(dbViewNodes.map(async ({ pageId }) => {
        try {
          dbData[pageId] = await api.getDatabase(pageId, { userId: user?.id, userName: user?.name });
        } catch {
          // falls back to stub below
        }
      }));
    }

    doc.forEach((node, _offset, index) => {
      if (node.type.name === 'databaseView') {
        const db = dbData[node.attrs.pageId];
        const text = db
          ? renderDatabaseAsMarkdownTable(db, node.attrs.title)
          : `[Database: ${node.attrs.title || 'Untitled'}]`;
        blocks.push({ index, type: 'databaseView', text });
        return;
      }

      if (!AI_SERIALIZABLE_TYPES.has(node.type.name)) return;
      const plainText = node.textContent;
      if (!plainText) return; // skip empty blocks

      if (targetIndices === null || targetIndices.has(index)) {
        // Full fidelity: inline markdown preserves bold, italic, code, links, etc.
        const text = nodeToInlineMarkdown(node);
        blocks.push({ index, type: node.type.name, text: text || plainText });
      } else {
        // Use cached LLM summary; fall back to first 80 chars if not yet cached
        const hash = blockSummaryCache.hash(plainText);
        const entry = blockSummaryCache.get(hash);
        const summary = entry
          ? entry.summary
          : `${plainText.slice(0, 80)}${plainText.length > 80 ? '…' : ''}`;
        blocks.push({ index, type: node.type.name, text: `[CONTEXT: ${summary}]` });
      }
    });

    return blocks;
  };

  const applyAiSuggestions = (changes) => {
    if (!getEditor() || !changes?.length) return;
    const { state } = getEditor().view;

    // Collect top-level block positions before any changes
    const blockPositions = [];
    state.doc.forEach((node, offset) => {
      blockPositions.push({ node, offset });
    });

    // Apply bottom-up (highest index first) to avoid position drift
    const sorted = [...changes].sort((a, b) => b.index - a.index);

    // Build a single chained transaction
    let tr = state.tr;
    const suggestions = [];

    for (const change of sorted) {
      const block = blockPositions[change.index];
      if (!block) continue;
      const { node, offset } = block;

      // Only apply to serializable block types
      if (!AI_SERIALIZABLE_TYPES.has(node.type.name)) continue;

      const from = offset;
      const to   = offset + node.nodeSize;
      const textFrom = offset + 1;        // inside opening token
      const textTo   = offset + node.nodeSize - 1; // before closing token

      // Store original node for revert — the full ProseMirror Node with all marks preserved
      suggestions.push({
        nodeIndex: change.index,
        from,
        to,
        originalNode: node,
        newText: change.newText,
      });

      // For structured block types (lists, callouts), replace the entire node
      const AI_STRUCTURED_TYPES = new Set(['bulletList', 'orderedList', 'taskList', 'callout']);
      if (AI_STRUCTURED_TYPES.has(node.type.name)) {
        const newNode = markdownToBlockNode(change.newText, state.schema, node.type.name);
        if (newNode) {
          tr = tr.replaceWith(from, to, newNode);
          continue;
        }
        // Fall through to inline replacement if block parse fails
      }

      // Parse markdown from AI back into rich inline content and replace
      const fragment = markdownToInlineFragment(change.newText, state.schema);
      tr = tr.replace(textFrom, textTo, new Slice(fragment, 0, 0));
    }

    // Dispatch the content changes
    tr.setMeta('addToHistory', true);
    getEditor().view.dispatch(tr);

    // In a separate transaction, set the suggestion decorations
    // (positions will have shifted; recalculate from the updated doc)
    const newState = getEditor().view.state;
    const decorTr = newState.tr;
    const updatedSuggestions = [];

    const changedIndices = new Set(suggestions.map((s) => s.nodeIndex));
    newState.doc.forEach((node, offset, index) => {
      if (!changedIndices.has(index)) return;
      const original = suggestions.find((s) => s.nodeIndex === index);
      if (!original) return;
      updatedSuggestions.push({
        nodeIndex: index,
        from: offset,
        to: offset + node.nodeSize,
        originalNode: original.originalNode,
        newText: original.newText,
      });
    });

    decorTr.setMeta(aiSuggestionKey, { type: 'set', suggestions: updatedSuggestions });
    decorTr.setMeta('addToHistory', false);
    getEditor().view.dispatch(decorTr);
  };

  const revertSuggestion = (nodeIndex) => {
    if (!getEditor()) return;
    const pluginState = aiSuggestionKey.getState(getEditor().state);
    const suggestion = pluginState?.suggestions?.find((s) => s.nodeIndex === nodeIndex);
    if (!suggestion) return;

    const { state } = getEditor().view;
    const currentNode = state.doc.nodeAt(suggestion.from);
    if (!currentNode) return;

    // Replace the entire block node with the original (all marks preserved)
    const tr = state.tr.replaceWith(
      suggestion.from,
      suggestion.from + currentNode.nodeSize,
      suggestion.originalNode,
    );
    tr.setMeta('addToHistory', true);
    tr.setMeta(aiSuggestionKey, { type: 'remove', nodeIndex });
    getEditor().view.dispatch(tr);
  };

  const acceptSuggestion = (nodeIndex) => {
    if (!getEditor()) return;
    const tr = getEditor().state.tr;
    tr.setMeta(aiSuggestionKey, { type: 'remove', nodeIndex });
    tr.setMeta('addToHistory', false);
    getEditor().view.dispatch(tr);
  };

  const revertAllSuggestions = () => {
    if (!getEditor()) return;
    const pluginState = aiSuggestionKey.getState(getEditor().state);
    const suggestions = pluginState?.suggestions ?? [];
    if (!suggestions.length) return;

    // Revert bottom-up to preserve positions
    const sorted = [...suggestions].sort((a, b) => b.nodeIndex - a.nodeIndex);
    const { state } = getEditor().view;
    let tr = state.tr;

    for (const s of sorted) {
      const currentNode = state.doc.nodeAt(s.from);
      if (!currentNode) continue;
      tr = tr.replaceWith(s.from, s.from + currentNode.nodeSize, s.originalNode);
    }

    tr.setMeta('addToHistory', true);
    tr.setMeta(aiSuggestionKey, { type: 'clear' });
    getEditor().view.dispatch(tr);
  };

  const acceptAllSuggestions = () => {
    if (!getEditor()) return;
    const tr = getEditor().state.tr;
    tr.setMeta(aiSuggestionKey, { type: 'clear' });
    tr.setMeta('addToHistory', false);
    getEditor().view.dispatch(tr);
  };

  const activeSuggestions = computed(() => {
    if (!getEditor()) return [];
    return aiSuggestionKey.getState(getEditor().state)?.suggestions ?? [];
  });

  // Hover widget for per-block accept/revert
  const hoveredSuggestionIndex = ref(null);
  const suggestionWidgetPos = ref({ top: 0, left: 0 });

  let _suggestionHideTimer = null;

  const handleSuggestionMousemove = (e) => {
    // If mouse is over the widget itself, keep it visible
    if (e.target?.closest?.('.ai-suggestion-widget')) {
      clearTimeout(_suggestionHideTimer);
      _suggestionHideTimer = null;
      return;
    }

    const el = e.target?.closest?.('.ai-suggestion-block');
    if (!el) {
      // Delay hide so the mouse can travel from block edge to widget
      if (_suggestionHideTimer == null) {
        _suggestionHideTimer = setTimeout(() => {
          hoveredSuggestionIndex.value = null;
          _suggestionHideTimer = null;
        }, 300);
      }
      return;
    }

    clearTimeout(_suggestionHideTimer);
    _suggestionHideTimer = null;

    const idx = Number(el.dataset.suggestionIndex);
    if (isNaN(idx)) return;
    hoveredSuggestionIndex.value = idx;
    const rect = el.getBoundingClientRect();
    suggestionWidgetPos.value = {
      top:  rect.top,
      left: rect.right + 8,
    };
  };
  // ─────────────────────────────────────────────────────────────────────────────

  // ── AI integration ──────────────────────────────────────────────────────────
  const aiPromptVisible = ref(false);
  const aiPromptPos = ref({ top: 0, left: 0 });
  const aiPromptRange = ref(null);
  const aiPromptText = ref('');
  const aiPromptInputRef = ref(null);
  const aiStreaming = ref(false);

  const showAiPrompt = (range, editorInstance) => {
    const { view } = editorInstance;
    const coords = view.coordsAtPos(range.from);
    // Position below the cursor line
    aiPromptPos.value = { top: coords.bottom + 6, left: Math.max(coords.left, 16) };
    aiPromptRange.value = range;
    aiPromptText.value = '';
    aiPromptVisible.value = true;
  };

  const closeAiPrompt = () => {
    aiPromptVisible.value = false;
    aiPromptRange.value = null;
    aiPromptText.value = '';
  };

  const runAiInsertion = async (prompt, range) => {
    if (!getEditor()) return;
    closeAiPrompt();
    getEditor().chain().focus().deleteRange(range).run();
    aiStreaming.value = true;
    try {
      for await (const chunk of api.streamAiGenerate({ prompt, mode: 'write' })) {
        getEditor()?.commands.insertContent(chunk);
      }
    } catch (err) {
      console.error('[AI] generation failed:', err);
    } finally {
      aiStreaming.value = false;
    }
  };

  const submitAiPrompt = () => {
    const val = aiPromptText.value.trim();
    if (!val || !aiPromptRange.value) return;
    runAiInsertion(val, aiPromptRange.value);
  };

  const runAiBubbleAction = async (mode) => {
    if (!getEditor() || aiStreaming.value) return;
    const { from, to } = getEditor().state.selection;
    if (from === to) return;
    const selectedText = getEditor().state.doc.textBetween(from, to, '\n');
    if (!selectedText.trim()) return;
    getEditor().chain().focus().deleteRange({ from, to }).run();
    aiStreaming.value = true;
    try {
      for await (const chunk of api.streamAiGenerate({ prompt: selectedText, mode })) {
        getEditor()?.commands.insertContent(chunk);
      }
    } catch (err) {
      console.error('[AI] bubble action failed:', err);
    } finally {
      aiStreaming.value = false;
    }
  };

  watch(aiPromptVisible, async (val) => {
    if (val) {
      await nextTick();
      aiPromptInputRef.value?.focus();
    }
  });
  // ─────────────────────────────────────────────────────────────────────────────

  onBeforeUnmount(() => clearTimeout(_suggestionHideTimer));

  return { lastKnownCursorPos, serializeBlocksForAi, applyAiSuggestions, revertSuggestion, acceptSuggestion, revertAllSuggestions, acceptAllSuggestions, activeSuggestions, hoveredSuggestionIndex, suggestionWidgetPos, handleSuggestionMousemove, aiPromptVisible, aiPromptPos, aiPromptText, aiPromptInputRef, aiStreaming, showAiPrompt, closeAiPrompt, submitAiPrompt, runAiBubbleAction };
}
