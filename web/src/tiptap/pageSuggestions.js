import { VueRenderer } from '@tiptap/vue-3';
import tippy from 'tippy.js';

// What the page searches under the cursor share: "@" and "[[" mentions (pageMention.js), and
// "[words](/" links (markdownLinks.js).

const MAX_RESULTS = 8;

// The pages whose titles have the search in them, the first few
export const matchingPages = (listPages, query) => {
  const q = query.trim().toLowerCase();
  return (listPages?.() || []).filter((page) => !q || (page.title || 'Untitled page').toLowerCase().includes(q)).slice(0, MAX_RESULTS);
};

// A suggestion's pop-up, under the text being typed: `component` shows it (and takes the arrow keys
// and Enter through its onKeyDown). Escape closes it (the suggestion ends, the text stays).
export const suggestionPopup = (component) => () => {
  let rendered;
  let popup;
  // After Escape the keys are the page's again (Enter a new line, not a hidden choice), should the
  // suggestion carry on
  let dismissed = false;
  return {
    onStart: (props) => {
      dismissed = false;
      rendered = new VueRenderer(component, { editor: props.editor, props });
      if (!props.clientRect) return;
      popup = tippy('body', {
        getReferenceClientRect: props.clientRect,
        appendTo: () => document.body,
        content: rendered.element,
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: 'bottom-start',
      });
    },
    onUpdate: (props) => {
      rendered?.updateProps(props);
      if (props.clientRect) popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect });
    },
    onKeyDown: (props) => {
      if (dismissed) return false;
      if (props.event.key === 'Escape') {
        dismissed = true;
        popup?.[0]?.hide();
        return true;
      }
      return rendered?.ref?.onKeyDown(props) ?? false;
    },
    onExit: () => {
      popup?.[0]?.destroy();
      rendered?.destroy();
      popup = null;
      rendered = null;
    },
  };
};
