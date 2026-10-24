## Tiptap v3 upgrade notes

- Upgraded all Tiptap packages to `3.11.1` in both root and `web/package.json`, with overrides pinning transitive packages (`bubble-menu`, `floating-menu`, `node-range`, `extensions`, `list`) to the same version.
- Collaboration stack now expects Tiptap v3: added `@tiptap/extension-collaboration@3.11.1`, `@tiptap/y-tiptap@3.0.1`, and `yjs`. (No 3.11.1 release exists for the collaboration cursor; add when available.)
- Editor doc version constants bumped to `3.11.1` in `src/pages/editor-doc.util.ts` and `web/src/utils/editorDoc.js` to keep client/server metadata aligned.
- Lockfiles regenerated after installs; npm reports peer override warnings because overrides force 3.11.1 across nested deps.
- If you add new Tiptap extensions, pin them to `3.11.1` (or update all pins/overrides together) to avoid peer resolution conflicts.

### Post-upgrade tests to run
- Clean installs: delete `node_modules` in both the repo root and `web/`, then `npm install` in each; confirm `npm ls @tiptap/vue-3` shows a single `3.11.1`.
- Dev server sanity check: `npm run dev` in `web/` should boot without `BubbleMenu` export errors; the editor renders and accepts input.
- Floating menus: `BubbleMenu` renders and toggles bold/italic/link/color; rename `:tippy-options` to `:options` in `TiptapEditor.vue` (and DragHandle’s prop) to match the new Floating UI API.
- Drag handle: drag/insert buttons still appear on hover, open the tune menu, and allow block deletion/turn-into actions.
- Slash menu: typing `/` opens the command palette; commands for headings, lists, divider, link, image, and page link execute.
