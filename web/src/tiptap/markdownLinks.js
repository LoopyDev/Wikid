import { Extension, InputRule } from '@tiptap/core';
import { PluginKey } from 'prosemirror-state';
import Suggestion from '@tiptap/suggestion';
import MarkdownLinkHint from './MarkdownLinkHint.vue';
import { matchingPages, suggestionPopup, withPrivateFlag } from './pageSuggestions';
import { LINK_ADDRESS, OPEN_LINK, inUnclosedCode, textBefore } from './typingContext';
import { isSafeLinkHref, normalizeLinkHref, pageLinkTarget } from '../utils/editorLinks';

// Links typed the Markdown way: "[words](address)" becomes the words, linked, as the ")" is typed
// (Backspace straight after gives back what was typed). After "[words](" a hint under the cursor
// says so; after "[words](/" pages are suggested, and one chosen links the words to it. An address
// that would run code (javascript:...) is left as typed, and so is anything in code, an image
// ("![...](...)") or an escaped bracket ("\[").
//
// The words stay as they are (their bold, a page mention in them): the link is added over them,
// and the "[" and "](address)" around them go.
//
// Options: listPages() gives the pages that can be linked to.

// "[words](address)" with the ")" just typed (a title after the address, "[x](a.com "Title")", is
// allowed and left out)
const TYPED_LINK = new RegExp(String.raw`(?<![[!\\])\[([^[\]\n]+)\]\((${LINK_ADDRESS})(?:\s+"[^"\n]*")?\)$`);

const inCode = ($pos) => !!$pos.parent.type.spec.code || $pos.marks().some((mark) => mark.type.name === 'code');

// Where the words end: the first "](" between `from` and `to` (the words can't have a "]" in them;
// the address or a title after it can)
const wordsEnd = (doc, from, to) => {
  const at = doc.textBetween(from, to, undefined, '\ufffc').indexOf('](');
  return at > 0 ? from + at : null;
};

// Links the words between wordsFrom and wordsTo, and takes away what's around them: the "[" before
// and the "](address" after, up to `to`
const linkWords = (tr, schema, { from, wordsTo, to }, href) => {
  tr.addMark(from + 1, wordsTo, schema.marks.link.create({ href, target: pageLinkTarget(href) ? null : '_blank' }));
  tr.delete(wordsTo, to);
  tr.delete(from, from + 1);
  // (Typing on isn't part of the link)
  tr.removeStoredMark(schema.marks.link);
  return tr;
};

export const MarkdownLinks = Extension.create({
  name: 'markdownLinks',
  addOptions() {
    return { listPages: null, othersCanRead: null };
  },
  addInputRules() {
    return [
      new InputRule({
        find: TYPED_LINK,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from);
          if (!state.schema.marks.link || inCode($from) || inUnclosedCode(textBefore($from))) return null;
          // (Where Tiptap's match starts: the "[", or it's not one this can place)
          if (state.doc.textBetween(range.from, range.from + 1) !== '[') return null;
          const href = normalizeLinkHref(match[2]);
          if (!href || !isSafeLinkHref(href)) return null;
          const wordsTo = wordsEnd(state.doc, range.from, range.to);
          if (wordsTo == null) return null;
          linkWords(state.tr, state.schema, { from: range.from, wordsTo, to: range.to }, href);
        },
      }),
    ];
  },
  addProseMirrorPlugins() {
    const extension = this;
    const pagesFor = (query) =>
      query.startsWith('/') ? withPrivateFlag(matchingPages(extension.options.listPages, query.slice(1)), extension.options.othersCanRead) : [];
    return [
      Suggestion({
        editor: this.editor,
        char: '](',
        pluginKey: new PluginKey('markdown-link-hint'),
        // "[words](" found by its own pattern (the words come before the "](")
        findSuggestionMatch: ({ $position }) => {
          if (inCode($position)) return null;
          const before = textBefore($position);
          if (!before.includes('](')) return null;
          let match = OPEN_LINK.exec(before);
          let query = match?.[2] ?? '';
          // A page search can have spaces ("/Onboarding g"), while it still matches a page
          if (!match) {
            const search = /(?<![[!\\])\[([^[\]\n]+)\]\((\/[^()\n]*)$/.exec(before);
            if (!search || !/\s/.test(search[2]) || !pagesFor(search[2]).length) return null;
            match = search;
            query = search[2];
          }
          if (inUnclosedCode(before.slice(0, match.index))) return null;
          return { range: { from: $position.pos - match[0].length, to: $position.pos }, query, text: match[0] };
        },
        items: ({ query }) => pagesFor(query),
        command: ({ editor, range, props: page }) => {
          const { state, view } = editor;
          const wordsTo = wordsEnd(state.doc, range.from, range.to);
          if (wordsTo == null) return;
          view.dispatch(linkWords(state.tr, state.schema, { from: range.from, wordsTo, to: range.to }, `/doc/${page.id}`));
          view.focus();
        },
        render: suggestionPopup(MarkdownLinkHint),
      }),
    ];
  },
});
