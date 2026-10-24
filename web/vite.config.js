import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// npm workspaces may hoist bootstrap-icons to the repo root, so resolve where it actually is
const bootstrapIconsDir = dirname(createRequire(import.meta.url).resolve('bootstrap-icons/package.json'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
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
    exclude: ['@editorjs/editorjs'],
  },
})
