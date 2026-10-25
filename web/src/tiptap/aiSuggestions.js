import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

// Highlights the changes an AI suggestion would make, until they are accepted or reverted.

export const aiSuggestionKey = new PluginKey('ai-suggestion');

// ── AI Suggestion Extension ───────────────────────────────────────────────────
// Tracks blocks modified by AI suggestions, renders decorations, and manages
// per-block revert/accept. State: Map<blockIndex, {from, to, originalText}>.
export const AiSuggestionExtension = Extension.create({
  name: 'ai-suggestion',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: aiSuggestionKey,
        state: {
          init: () => ({ suggestions: [] }),
          apply(tr, pluginState) {
            const meta = tr.getMeta(aiSuggestionKey);
            if (meta?.type === 'set') {
              return { suggestions: meta.suggestions };
            }
            if (meta?.type === 'remove') {
              return { suggestions: pluginState.suggestions.filter((s) => s.nodeIndex !== meta.nodeIndex) };
            }
            if (meta?.type === 'clear') {
              return { suggestions: [] };
            }
            // Map positions through any doc-changing transaction
            if (!tr.docChanged || !pluginState.suggestions.length) return pluginState;
            return {
              suggestions: pluginState.suggestions.map((s) => ({
                ...s,
                from: tr.mapping.map(s.from),
                to:   tr.mapping.map(s.to, -1),
              })),
            };
          },
        },
        props: {
          decorations(state) {
            const { suggestions } = aiSuggestionKey.getState(state) || {};
            if (!suggestions?.length) return DecorationSet.empty;
            const decos = [];
            for (const s of suggestions) {
              if (s.from >= 0 && s.to > s.from && s.to <= state.doc.content.size) {
                decos.push(
                  Decoration.node(s.from, s.to, {
                    class: 'ai-suggestion-block',
                    'data-suggestion-index': String(s.nodeIndex),
                  })
                );
              }
            }
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
