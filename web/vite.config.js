import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// npm workspaces may hoist bootstrap-icons to the repo root, so resolve where it actually is
const bootstrapIconsDir = dirname(createRequire(import.meta.url).resolve('bootstrap-icons/package.json'))

// The fix from Tiptap PR #8617 (issue tiptap#8594, y-tiptap#58), not yet released: without it, your
// cursor jumps to the wrong place when someone else types in the same line. When a change from
// someone else is to text only (no block added, removed or moved), the cursor is put back by its
// place in the text, not worked out again against the document as it was. Remove once a y-tiptap
// release has it; the build fails if the code it replaces changes, so an upgrade can't skip it.
//
// And: undo back to an empty page, then redo, and the page came back with an empty line above it.
// A page can't be empty, so the editor shows one empty line, and y-tiptap wrote that into the live
// document like any other change; the redo then put the lines back beside it. While the live
// document is empty and the editor holds only that empty line, there's nothing to write: it goes
// in once something is typed into it. Still so in y-tiptap 3.3.1; the same check applies.
//
// And (new in y-tiptap 3.3): with content checking on (onInvalidContent, see editorExtensions), a
// live document emptied by undoing everything counted as content that doesn't fit the page (a page
// needs a block): editing paused, redo did nothing and the page said it was from a newer Wikid. An
// empty document is a blank page, as a new one is, whatever it held before; one whose blocks can't be
// read isn't empty, and is still caught. Remove once y-tiptap handles it; the same check applies.
//
// (Two more patches from y-tiptap 3.0.10 aren't needed on 3.3: a block emptied by select-all threw
// when typed into, and a block moved by Enter above it was deleted and made again, so it became the
// other person's. 3.3 rewrote the position tracking both were in; collaboration.spec.ts and
// editor-basics.spec.ts keep checking both.)
let yTiptapSelectionFixApplied = false
let yTiptapEmptyPageFixApplied = false
let yTiptapEmptyDocFixApplied = false
const yTiptapSelectionFix = {
  name: 'y-tiptap-selection-fix',
  enforce: 'pre',
  transform(code, id) {
    if (!/@tiptap[\\/]y-tiptap[\\/]dist[\\/]index\.js(\?|$)/.test(id)) return null
    const before = 'const oldDoc = undoSelection ? void 0 : this.view.state.doc;'
    if (!code.includes(before)) {
      throw new Error('y-tiptap changed: check whether the selection fix (Tiptap PR #8617) is still needed')
    }
    const after =
      'const textOnlyChange = events.every((event) => event.target instanceof Y.XmlText);\n' +
      '\t\tconst oldDoc = undoSelection || textOnlyChange ? void 0 : this.view.state.doc;'
    const emptyPageBefore = 'if (syncState.snapshot != null || syncState.prevSnapshot != null) return;\n\t\tthis.doc.transact(() => {\n\t\t\tupdateYFragment('
    if (!code.includes(emptyPageBefore)) {
      throw new Error('y-tiptap changed: check whether the empty page fix is still needed')
    }
    const emptyPageAfter =
      'if (syncState.snapshot != null || syncState.prevSnapshot != null) return;\n' +
      '\t\tif (this.type.length === 0 && doc.childCount === 1 && doc.firstChild.type.name === "paragraph" && doc.firstChild.content.size === 0) { this.beforeTransactionSelection = getRelativeSelection(this, this.view.state); return; }\n' +
      '\t\tthis.doc.transact(() => {\n\t\t\tupdateYFragment('
    const emptyDocBefore = 'const isPlaceholder = content.childCount === 0 && !this.hasSharedContent;'
    if (!code.includes(emptyDocBefore)) {
      throw new Error('y-tiptap changed: check whether the empty document fix is still needed')
    }
    const emptyDocAfter = 'const isPlaceholder = this.type.length === 0;'
    yTiptapSelectionFixApplied = true
    yTiptapEmptyPageFixApplied = true
    yTiptapEmptyDocFixApplied = true
    return {
      code: code.replace(before, after).replace(emptyPageBefore, emptyPageAfter).replace(emptyDocBefore, emptyDocAfter),
      map: null,
    }
  },
  generateBundle() {
    if (!yTiptapSelectionFixApplied) throw new Error('The y-tiptap selection fix was not applied: was y-tiptap moved or renamed?')
    if (!yTiptapEmptyPageFixApplied) throw new Error('The y-tiptap empty page fix was not applied: was y-tiptap moved or renamed?')
    if (!yTiptapEmptyDocFixApplied) throw new Error('The y-tiptap empty document fix was not applied: was y-tiptap moved or renamed?')
  },
}

// ProseMirror, drawing each block, looked through every decoration of the blocks around it for any
// running into it (only inline ones can). A page's blocks each have one (their data-block marker,
// see tiptap/blockIds.js), so each keystroke went through the page's blocks times its blocks: a
// million checks on a 1,000-block page. A set of decorations never changes once made, so whether it
// has any inline ones is worked out once, and the search skipped when it has none. Still so in
// prosemirror-view 1.44 (worth offering upstream); the build fails if the code it replaces changes.
// Applied when building, and to the pre-bundled copy in development (optimizeDeps below).
let decorationLookupFixApplied = false
const decorationLookupFix = {
  name: 'prosemirror-view-decoration-lookup',
  transform(code, id) {
    if (!/[\\/]prosemirror-view[\\/]dist[\\/]index\.js(\?|$)/.test(id)) return null
    const before =
      '        let start = offset + 1, end = start + node.content.size;\n' +
      '        for (let i = 0; i < this.local.length; i++) {'
    if (!code.includes(before)) {
      throw new Error('prosemirror-view changed: check whether the decoration lookup fix is still needed')
    }
    const after =
      '        let start = offset + 1, end = start + node.content.size;\n' +
      '        if (this.hasInlineLocal === undefined) this.hasInlineLocal = this.local.some(InlineType.is);\n' +
      '        for (let i = 0; this.hasInlineLocal && i < this.local.length; i++) {'
    decorationLookupFixApplied = true
    return { code: code.replace(before, after), map: null }
  },
  generateBundle() {
    if (!decorationLookupFixApplied) throw new Error('The prosemirror-view decoration lookup fix was not applied: was prosemirror-view moved or renamed?')
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    yTiptapSelectionFix,
    decorationLookupFix,
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'emoji-picker',
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@bootstrap-icons': bootstrapIconsDir,
    },
  },
  optimizeDeps: {
    // (y-tiptap not pre-bundled, so the fix above applies in development too)
    exclude: ['@editorjs/editorjs', '@tiptap/y-tiptap'],
    // (prosemirror-view is pre-bundled: the fix above is applied to it there)
    rolldownOptions: { plugins: [{ name: decorationLookupFix.name, transform: decorationLookupFix.transform }] },
  },
})
