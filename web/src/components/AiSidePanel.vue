<script setup>
import { nextTick, ref, watch } from 'vue';
import { api } from '../api/client';
import { renderMarkdownSafely } from '../utils/safeMarkdown';


const props = defineProps({
  workspaceId: {
    type: String,
    default: '',
  },
  pageContext: {
    type: String,
    default: '',
  },
  pageTitle: {
    type: String,
    default: '',
  },
  onSuggest: {
    type: Function,
    default: null,
  },
  getSerializedBlocks: {
    type: Function,
    default: null,
  },
  summarizationPending: {
    type: Boolean,
    default: false,
  },
  summarizationStats: {
    type: Object,
    default: () => ({ total: 0, cached: 0 }),
  },
  summarizeForAi: {
    type: Function,
    default: null,
  },
});

const emit = defineEmits(['close']);

// ── Shared state ──────────────────────────────────────────────────────────────
const mode = ref('chat'); // 'chat' | 'edit'

// ── Chat mode ─────────────────────────────────────────────────────────────────
const messages = ref([]);
const inputText = ref('');
const streaming = ref(false);
const usePageContext = ref(true);
const currentPageOnly = ref(false);
const lastSentBlocks = ref(null); // [{ index, type, text }]
const chatEndRef = ref(null);
const inputRef = ref(null);

function blocksToContext(blocks) {
  return blocks.map((b) => b.text).join('\n');
}

function buildBlocksDiff(oldBlocks, newBlocks) {
  if (!oldBlocks || !newBlocks) return null;
  const oldMap = new Map(oldBlocks.map((b) => [b.index, b.text]));
  const newMap = new Map(newBlocks.map((b) => [b.index, b.text]));
  const added = [];
  const changed = [];
  const removed = [];
  for (const [idx, text] of newMap) {
    if (!oldMap.has(idx)) {
      added.push(text);
    } else if (oldMap.get(idx) !== text) {
      changed.push({ from: oldMap.get(idx), to: text });
    }
  }
  for (const [idx, text] of oldMap) {
    if (!newMap.has(idx)) removed.push(text);
  }
  if (!added.length && !changed.length && !removed.length) return null;
  let note = '[Page content has been updated since your last response. Prioritise the latest page context over your previous answers.]';
  if (added.length) note += '\nAdded:\n' + added.map((t) => `- ${t}`).join('\n');
  if (changed.length) note += '\nChanged:\n' + changed.map((c) => `- "${c.from.slice(0, 60)}" → "${c.to.slice(0, 60)}"`).join('\n');
  if (removed.length) note += '\nRemoved:\n' + removed.map((t) => `- ${t}`).join('\n');
  return note;
}

const scrollToBottom = async () => {
  await nextTick();
  chatEndRef.value?.scrollIntoView({ behavior: 'smooth' });
};

const sendMessage = async () => {
  const text = inputText.value.trim();
  if (!text || streaming.value) return;

  messages.value.push({ role: 'user', text });
  inputText.value = '';
  await scrollToBottom();

  const assistantMsg = { role: 'assistant', text: '', toolCalls: [], pending: true };
  messages.value.push(assistantMsg);
  streaming.value = true;
  await scrollToBottom();

  try {
    // Build page context from summarized blocks
    let pageContext;
    let currentBlocks = null;
    if (usePageContext.value) {
      await props.summarizeForAi?.();
      const blocks = await props.getSerializedBlocks?.() ?? [];
      if (blocks.length) {
        currentBlocks = blocks;
        pageContext = blocksToContext(blocks);
      }
    }

    // Build conversation history (exclude the pending assistant message)
    const history = messages.value
      .slice(0, -1)
      .map((m) => ({ role: m.role, content: m.text }));

    // Inject invisible diff note if page content changed since last message
    if (currentBlocks && lastSentBlocks.value) {
      const diffNote = buildBlocksDiff(lastSentBlocks.value, currentBlocks);
      if (diffNote) {
        history.push({ role: 'user', content: diffNote });
      }
    }
    lastSentBlocks.value = currentBlocks;

    for await (const event of api.streamAiChat({
      messages: history,
      workspaceId: props.workspaceId,
      pageContext,
      currentPageOnly: currentPageOnly.value,
    })) {
      if (event.type === 'text') {
        assistantMsg.text += event.text;
        assistantMsg.pending = false;
      } else if (event.type === 'tool_start') {
        assistantMsg.toolCalls.push({ tool: event.tool, label: event.label, status: 'running' });
      } else if (event.type === 'tool_done') {
        const tc = [...assistantMsg.toolCalls].reverse().find((t) => t.tool === event.tool && t.status === 'running');
        if (tc) { tc.status = 'done'; tc.doneLabel = event.label; }
      }
      await scrollToBottom();
    }
  } catch (err) {
    assistantMsg.text = `Error: ${err.message || 'AI request failed'}`;
  } finally {
    assistantMsg.pending = false;
    streaming.value = false;
  }
};

const clearChat = () => {
  messages.value = [];
};

// ── Edit mode ─────────────────────────────────────────────────────────────────
const editPrompt = ref('');
const editError = ref('');
const editSummary = ref('');
const editLoading = ref(false);
const indexingStarted = ref(false);
const editPromptRef = ref(null);

const sendEditSuggestion = async () => {
  const text = editPrompt.value.trim();
  if (!text || editLoading.value) return;

  editError.value = '';
  editSummary.value = '';
  editLoading.value = true;

  try {
    // Summarize any uncached blocks first so context is warm before the main request
    indexingStarted.value = true;
    await props.summarizeForAi?.();

    const blocks = await props.getSerializedBlocks?.() ?? [];
    if (!blocks.length) {
      editError.value = 'No editable blocks found on this page.';
      return;
    }
    const result = await api.suggestAiEdits({ prompt: text, blocks });
    if (!result.changes?.length) {
      editSummary.value = result.summary || 'No changes suggested.';
      return;
    }
    props.onSuggest?.(result.changes, result.summary);
    editSummary.value = result.summary || `${result.changes.length} block${result.changes.length !== 1 ? 's' : ''} updated.`;
    editPrompt.value = '';
  } catch (err) {
    editError.value = err.message || 'Suggestion failed. Is ANTHROPIC_API_KEY set?';
  } finally {
    editLoading.value = false;
  }
};

// ── Watchers & expose ─────────────────────────────────────────────────────────
watch(() => props.pageContext, () => {
  // Page changed — keep chat history, just in case user wants to refer back
});

watch(mode, async (val) => {
  await nextTick();
  if (val === 'chat') inputRef.value?.focus();
  if (val === 'edit') editPromptRef.value?.focus();
});

const focusInput = () => {
  nextTick(() => {
    if (mode.value === 'chat') inputRef.value?.focus();
    else editPromptRef.value?.focus();
  });
};

defineExpose({ focusInput });
</script>

<template>
  <aside class="ai-panel" role="complementary" aria-label="AI assistant">
    <!-- Header -->
    <div class="ai-panel__header">
      <span class="ai-panel__title">
        <span class="ai-panel__icon" aria-hidden="true">✦</span>
        AI Assistant
      </span>
      <div class="ai-panel__header-actions">
        <button
          v-if="mode === 'chat' && messages.length"
          class="ai-panel__action-btn"
          type="button"
          title="Clear chat"
          @click="clearChat"
        >
          Clear
        </button>
        <button
          class="ai-panel__close-btn"
          type="button"
          aria-label="Close AI panel"
          @click="emit('close')"
        >✕</button>
      </div>
    </div>

    <!-- Mode tabs -->
    <div class="ai-panel__tabs" role="tablist">
      <button
        class="ai-panel__tab"
        :class="{ 'ai-panel__tab--active': mode === 'chat' }"
        role="tab"
        :aria-selected="mode === 'chat'"
        type="button"
        @click="mode = 'chat'"
      >Chat</button>
      <button
        class="ai-panel__tab"
        :class="{ 'ai-panel__tab--active': mode === 'edit' }"
        role="tab"
        :aria-selected="mode === 'edit'"
        type="button"
        @click="mode = 'edit'"
      >Edit page</button>
    </div>

    <!-- ── Chat mode ──────────────────────────────────────── -->
    <template v-if="mode === 'chat'">
      <div class="ai-panel__context-row">
        <label class="ai-panel__context-label">
          <input
            v-model="usePageContext"
            type="checkbox"
            class="ai-panel__context-checkbox"
          />
          <span>Include page content</span>
        </label>
        <label class="ai-panel__context-label">
          <input
            v-model="currentPageOnly"
            type="checkbox"
            class="ai-panel__context-checkbox"
          />
          <span>Current page only</span>
        </label>
        <span v-if="pageTitle" class="ai-panel__context-page">{{ pageTitle }}</span>
      </div>

      <div class="ai-panel__messages" ref="messagesRef">
        <div v-if="!messages.length" class="ai-panel__empty">
          <p class="ai-panel__empty-text">Ask anything about this page or start writing.</p>
          <div class="ai-panel__suggestions">
            <button class="ai-panel__suggestion" type="button" @click="inputText = 'Summarise this page'; sendMessage()">Summarise this page</button>
            <button class="ai-panel__suggestion" type="button" @click="inputText = 'What are the key points?'; sendMessage()">What are the key points?</button>
            <button class="ai-panel__suggestion" type="button" @click="inputText = 'Write a follow-up section'; sendMessage()">Write a follow-up section</button>
          </div>
        </div>
        <div
          v-for="(msg, i) in messages"
          :key="i"
          class="ai-panel__message"
          :class="[`ai-panel__message--${msg.role}`, { 'ai-panel__message--pending': msg.pending }]"
        >
          <span v-if="msg.role === 'assistant'" class="ai-panel__message-icon" aria-hidden="true">✦</span>
          <div class="ai-panel__message-text">
            <div v-if="msg.toolCalls?.length" class="ai-panel__tool-calls">
              <div
                v-for="(tc, j) in msg.toolCalls"
                :key="j"
                class="ai-panel__tool-call"
                :class="tc.status === 'running' ? 'ai-panel__tool-call--running' : 'ai-panel__tool-call--done'"
              >
                <span class="ai-panel__tool-call-icon" aria-hidden="true">{{ tc.status === 'running' ? '○' : '✓' }}</span>
                <span class="ai-panel__tool-call-label">{{ tc.label }}</span>
                <span v-if="tc.doneLabel" class="ai-panel__tool-call-result">{{ tc.doneLabel }}</span>
              </div>
            </div>
            <span v-if="msg.pending && !msg.text && !msg.toolCalls?.length" class="ai-panel__typing" aria-label="AI is typing">
              <span></span><span></span><span></span>
            </span>
            <div v-else-if="msg.role === 'assistant'" class="ai-panel__markdown" v-html="renderMarkdownSafely(msg.text)"></div>
            <template v-else>{{ msg.text }}</template>
          </div>
        </div>
        <div ref="chatEndRef"></div>
      </div>

      <form class="ai-panel__input-row" @submit.prevent="sendMessage">
        <textarea
          ref="inputRef"
          v-model="inputText"
          class="ai-panel__input"
          placeholder="Ask anything…"
          rows="1"
          :disabled="streaming"
          @keydown.enter.exact.prevent="sendMessage"
          @keydown.enter.shift.exact="inputText += '\n'"
          @input="$event.target.style.height = 'auto'; $event.target.style.height = Math.min($event.target.scrollHeight, 120) + 'px'"
        ></textarea>
        <button
          class="ai-panel__send-btn"
          type="submit"
          :disabled="!inputText.trim() || streaming"
          aria-label="Send"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </form>
    </template>

    <!-- ── Edit page mode ─────────────────────────────────── -->
    <template v-else-if="mode === 'edit'">
      <div class="ai-panel__edit-area">
        <p class="ai-panel__edit-hint">
          Describe the changes you want. AI will update the page directly — you can accept or revert each change.
        </p>

        <div class="ai-panel__edit-examples">
          <button class="ai-panel__suggestion" type="button" @click="editPrompt = 'Make the writing more concise'">More concise</button>
          <button class="ai-panel__suggestion" type="button" @click="editPrompt = 'Rewrite in a more formal tone'">More formal</button>
          <button class="ai-panel__suggestion" type="button" @click="editPrompt = 'Fix grammar and spelling'">Fix grammar</button>
          <button class="ai-panel__suggestion" type="button" @click="editPrompt = 'Improve clarity and flow'">Improve clarity</button>
        </div>

        <textarea
          ref="editPromptRef"
          v-model="editPrompt"
          class="ai-panel__input ai-panel__edit-input"
          placeholder="e.g. Rewrite the introduction to be more formal and concise…"
          rows="3"
          :disabled="editLoading"
          @keydown.enter.exact.prevent="sendEditSuggestion"
          @keydown.enter.shift.exact="editPrompt += '\n'"
          @input="$event.target.style.height = 'auto'; $event.target.style.height = Math.min($event.target.scrollHeight, 160) + 'px'"
        ></textarea>

        <button
          class="ai-panel__edit-submit"
          type="button"
          :disabled="!editPrompt.trim() || editLoading"
          @click="sendEditSuggestion"
        >
          <span v-if="editLoading" class="ai-panel__edit-loading">
            <span class="ai-panel__typing"><span></span><span></span><span></span></span>
            Thinking…
          </span>
          <template v-else>✦ Suggest edits</template>
        </button>

        <div v-if="editSummary" class="ai-panel__edit-summary">
          <span class="ai-panel__edit-summary-icon">✦</span>
          {{ editSummary }}
        </div>
        <p v-if="editError" class="ai-panel__edit-error">{{ editError }}</p>

        <div v-if="summarizationStats.total > 0" class="ai-panel__context-stats">
          <span
            class="ai-panel__context-stats-dot"
            :class="{ 'ai-panel__context-stats-dot--ready': indexingStarted && !summarizationPending && summarizationStats.cached === summarizationStats.total }"
          ></span>
          <span v-if="!indexingStarted">
            {{ summarizationStats.total - summarizationStats.cached }} / {{ summarizationStats.total }} blocks to index
          </span>
          <span v-else-if="summarizationPending || summarizationStats.cached < summarizationStats.total">
            Indexing context… ({{ summarizationStats.cached }} / {{ summarizationStats.total }})
          </span>
          <span v-else>
            {{ summarizationStats.cached }} / {{ summarizationStats.total }} blocks indexed
          </span>
        </div>
      </div>
    </template>
  </aside>
</template>
