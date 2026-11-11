import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// npm workspaces may hoist bootstrap-icons to the repo root, so resolve where it actually is
const bootstrapIconsDir = dirname(createRequire(import.meta.url).resolve('bootstrap-icons/package.json'))

// Fix from y-tiptap PR #59 (ueberdosis/y-tiptap#58, tiptap#8594): without it, your cursor jumps to
// the wrong place when someone else types in the same line. Remove once a y-tiptap release
// includes the fix; the build fails if the code it replaces changes, so an upgrade can't skip it.
//
// And: y-tiptap's position tracking expects every text in a block to have its own text item in the
// live document. An empty block made by replacing everything at once (select all and delete, deleting
// the only block) has none, so the first letter typed into it threw ("Position tracking requires
// synchronized editor text") and nothing typed there went in, for anyone, even after a reload. Text
// with no text item yet is new (nothing to track), so it's counted and stepped over. Remove once
// a y-tiptap release handles it; the build fails if the code it replaces changes.
//
// And: after a change that moves blocks (Enter, which puts a new line above the rest), y-tiptap's
// position migration deleted every moved block from the live document and made it again. Someone
// pressing Enter at the start of your line made your line theirs, so your Ctrl+Z couldn't undo it.
// Each block's id is now noted with the plan (before the change is written, which copies the new
// block's attributes onto the element); an element still holding the same block, by id, has only
// moved and stays as it is. One reused for a different block is made again, as before. Remove once
// a y-tiptap release handles it; the build fails if the code it replaces changes.
let yTiptapFixApplied = false
let yTiptapEmptyBlockFixApplied = false
let yTiptapMovedBlockFixApplied = false
const yTiptapSelectionFix = {
  name: 'y-tiptap-selection-fix',
  enforce: 'pre',
  transform(code, id) {
    if (!/@tiptap[\\/]y-tiptap[\\/]dist[\\/]index\.js(\?|$)/.test(id)) return null
    const before = 'restoreRelativeSelection(tr, this.beforeTransactionSelection, this, oldDoc);'
    if (!code.includes(before)) {
      throw new Error('y-tiptap changed: check whether the selection fix (y-tiptap PR #59) is still needed')
    }
    const after =
      'const textOnlyChange = events.every((event) => event.target instanceof Y.XmlText);\n' +
      'restoreRelativeSelection(tr, this.beforeTransactionSelection, this, textOnlyChange ? undefined : oldDoc);'
    // In getPositionContent: text with no text item is stepped over (its length counted), and the
    // block's later children are still matched to their own items (one fewer to skip past)
    const loopBefore =
      'content.forEach((child, index) => {\n\t\t\tconst shared = children[index];\n\t\t\tif (!Array.isArray(child)) {\n\t\t\t\tif (!(shared instanceof Y.XmlElement) || !shared._item) throw new Error("Position tracking requires synchronized editor content");'
    const loopAfter =
      'let untracked = 0;\n\t\tcontent.forEach((child, index) => {\n\t\t\tconst shared = children[index - untracked];\n\t\t\tif (!Array.isArray(child)) {\n\t\t\t\tif (!(shared instanceof Y.XmlElement) || !shared._item) throw new Error("Position tracking requires synchronized editor content");'
    const emptyBlockBefore = 'if (!(shared instanceof Y.XmlText)) throw new Error("Position tracking requires synchronized editor text");'
    if (!code.includes(loopBefore) || !code.includes(emptyBlockBefore)) {
      throw new Error('y-tiptap changed: check whether the empty block fix is still needed')
    }
    const emptyBlockAfter =
      'if (!(shared instanceof Y.XmlText)) { untracked += 1; offset += child.reduce((size, node) => size + node.nodeSize, 0); return; }'
    const movedBefore = 'if (source && source.position !== position) {\n\t\tdeleteMapping(metadata.mapping, element);'
    if (!code.includes(movedBefore)) {
      throw new Error('y-tiptap changed: check whether the moved block fix is still needed')
    }
    const movedAfter =
      'const sameBlock = !!source && source.blockId != null && source.blockId === (node.attrs && node.attrs.id);\n' +
      '\tif (source && source.position !== position && !sameBlock) {\n\t\tdeleteMapping(metadata.mapping, element);'
    // In getPositionContent: each element's block id, as it is before the change
    const planBefore = 'nodes.push({\n\t\t\t\t\tid: shared._item.id,'
    const planAfter = 'nodes.push({\n\t\t\t\t\tid: shared._item.id,\n\t\t\t\t\tblockId: shared.getAttribute("id"),'
    if (!code.includes(planBefore)) {
      throw new Error('y-tiptap changed: check whether the moved block fix is still needed')
    }
    yTiptapFixApplied = true
    yTiptapEmptyBlockFixApplied = true
    yTiptapMovedBlockFixApplied = true
    return {
      code: code
        .replace(before, after)
        .replace(loopBefore, loopAfter)
        .replace(emptyBlockBefore, emptyBlockAfter)
        .replace(movedBefore, movedAfter)
        .replace(planBefore, planAfter),
      map: null,
    }
  },
  generateBundle() {
    if (!yTiptapFixApplied) throw new Error('The y-tiptap selection fix was not applied: was y-tiptap moved or renamed?')
    if (!yTiptapEmptyBlockFixApplied) throw new Error('The y-tiptap empty block fix was not applied: was y-tiptap moved or renamed?')
    if (!yTiptapMovedBlockFixApplied) throw new Error('The y-tiptap moved block fix was not applied: was y-tiptap moved or renamed?')
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    yTiptapSelectionFix,
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
    // Not pre-bundled, so the fix above applies in development too
    exclude: ['@editorjs/editorjs', '@tiptap/y-tiptap'],
  },
})
