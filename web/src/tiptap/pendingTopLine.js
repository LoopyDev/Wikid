import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { ySyncPluginKey } from '@tiptap/y-tiptap';

// Enter in a page's title before its content has come from the server: the cursor goes into the
// page, but what's typed is held, not written. Written straight away, it went into the live document
// before the page's content did, and once the two met it could land after that content, not first.
// It's shown, faintly, at the top meanwhile; once the content's in, `flush` puts it in new first
// lines, with the cursor at its end.
//
// `editorProps(props)` wraps the editor's own handlers: they come before any plugin's (Enter,
// Backspace, a paste or a drop would otherwise reach the page), so held keys are caught there.
// Anything else that would change the page meanwhile (an input method's text, a shortcut) is
// refused by the plugin; what an input method finishes is held too.
export function createPendingTopLine() {
  const key = new PluginKey('pendingTopLine');
  // The lines typed so far (Enter starts another), while held; null otherwise
  let lines = null;
  // Redraws the held text shown at the top
  const redraw = (view) => view.dispatch(view.state.tr.setMeta(key, true));
  const add = (view, text) => {
    const parts = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    lines[lines.length - 1] += parts[0];
    lines.push(...parts.slice(1));
    redraw(view);
  };

  const handleKeyDown = (view, event) => {
    if (!lines || event.isComposing) return false;
    if (event.key === 'Enter') {
      lines.push('');
      redraw(view);
      return true;
    }
    if (event.key === 'Backspace') {
      const last = lines.length - 1;
      if (lines[last]) lines[last] = lines[last].slice(0, -1);
      else if (last > 0) lines.pop();
      redraw(view);
      return true;
    }
    return false;
  };
  const handleTextInput = (view, _from, _to, text) => {
    if (!lines) return false;
    add(view, text);
    return true;
  };
  const handlePaste = (view, event) => {
    if (!lines) return false;
    add(view, event.clipboardData?.getData('text/plain'));
    return true;
  };
  const handleDrop = () => !!lines;

  const plugin = new Plugin({
    key,
    // Nothing of the person's own changes the page while text is held: only the server's content
    // coming in (and what other plugins add to that)
    filterTransaction(tr) {
      if (!lines || !tr.docChanged) return true;
      return !!(tr.getMeta(ySyncPluginKey) || tr.getMeta('appendedTransaction'));
    },
    props: {
      handleDOMEvents: {
        // An input method's finished word: held with the rest
        compositionend(view, event) {
          if (!lines) return false;
          add(view, event.data);
          return false;
        },
      },
      decorations(state) {
        if (!lines || !lines.some(Boolean)) return null;
        const shown = lines;
        return DecorationSet.create(state.doc, [
          Decoration.widget(
            0,
            () => {
              const box = document.createElement('div');
              box.className = 'pending-top-line';
              box.setAttribute('aria-hidden', 'true');
              shown.forEach((text) => {
                const line = document.createElement('p');
                line.textContent = text || '​';
                box.appendChild(line);
              });
              return box;
            },
            { side: -1, key: `pending:${shown.join('\n')}` }
          ),
        ]);
      },
    },
  });

  return {
    plugin,
    editorProps(props) {
      const first = (own, theirs) => (...args) => own(...args) || (theirs ? theirs(...args) : false);
      return {
        ...props,
        handleKeyDown: first(handleKeyDown, props.handleKeyDown),
        handleTextInput: first(handleTextInput, props.handleTextInput),
        handlePaste: first(handlePaste, props.handlePaste),
        handleDrop: first(handleDrop, props.handleDrop),
      };
    },
    start() {
      lines = lines || [''];
    },
    clear() {
      lines = null;
    },
    flush(editor) {
      if (!lines || !editor || editor.isDestroyed) return;
      const held = lines;
      lines = null;
      const { state, view } = editor;
      const { paragraph } = state.schema.nodes;
      const nodes = held.map((text) => paragraph.create(null, text ? state.schema.text(text) : null));
      const tr = state.tr;
      // An empty first line is used, not left above (as Enter in the title does once the page is in)
      const first = state.doc.firstChild;
      if (first?.type === paragraph && first.content.size === 0) tr.delete(0, first.nodeSize);
      tr.insert(0, nodes);
      // The cursor at the end of it, if it's still in the page (not taken from where it's gone since)
      if (view.hasFocus()) {
        const end = nodes.reduce((size, node) => size + node.nodeSize, 0) - 1;
        tr.setSelection(TextSelection.create(tr.doc, end)).scrollIntoView();
      }
      view.dispatch(tr);
    },
  };
}
