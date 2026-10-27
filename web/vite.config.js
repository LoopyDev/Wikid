import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// npm workspaces may hoist bootstrap-icons to the repo root, so resolve where it actually is
const bootstrapIconsDir = dirname(createRequire(import.meta.url).resolve('bootstrap-icons/package.json'))

// Fix from y-tiptap PR #59 (ueberdosis/y-tiptap#58, tiptap#8594): without it, your cursor jumps to
// the wrong place when someone else types in the same line. Remove once a y-tiptap release
// includes the fix; the build fails if the code it replaces changes, so an upgrade can't skip it.
let yTiptapFixApplied = false
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
    yTiptapFixApplied = true
    return { code: code.replace(before, after), map: null }
  },
  generateBundle() {
    if (!yTiptapFixApplied) throw new Error('The y-tiptap selection fix was not applied: was y-tiptap moved or renamed?')
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
