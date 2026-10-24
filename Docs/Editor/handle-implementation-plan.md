## Goal
Implement a stable, always-available block handle + menu for the TipTap editor without hover fragility or manual DOM mutation.

## Approach (simple, Vue-only overlay)
1) **Gutter padding**: Keep `--editor-gutter` on `.tiptap-editor` and pad `.ProseMirror` left so there is a gutter. The handle/menu X will be a fixed gutter value (e.g., `gutter * 0.25`), not derived from content width.
2) **Reactive handles array**: On editor events, read the ProseMirror children (block selector: `p, h1-6, li, blockquote, pre, div[data-type="page-link"], img`). Map to `{ id, top, left }` using DOM rects; `left` is constant (gutter-based), `top` is block center within editorRoot.
3) **Render via Vue**: In the template, render an overlay with `v-for="handle in handles"` for the two-button control. No manual `document.createElement`. Pointer events enabled on the handles; the overlay is absolutely positioned over the editor.
4) **Menu anchoring**: Menu uses the same gutter X (e.g., `gutter * 0.9`) and the selected handle’s Y. Clicking +/⋯ sets `handlePos` from that handle and opens the menu.
5) **Visibility rules**: Handles always rendered (or at least when doc is non-empty). Hide menu on blur; handle overlay can remain visible or fade on blur if desired. No hover-based hiding.
6) **Cleanup**: On unmount, remove scroll/resize listeners and call only functional editor unsubs. No manual DOM cleanup needed because handles are Vue-rendered.

## Steps to implement
1) **Simplify state**: Remove `handleBlocks`, `handleEl`, hover handlers; keep `handles`, `handlePos`, `gutterSize`, `blockMenuOpen/type`, `hoveredBlock` (optional).
2) **Handlers**:
   - `computeHandles()`: compute gutter from `--editor-gutter`, find blocks, set `handles = [...]`, set `showHandle = true` if blocks exist.
   - `openMenu(handle, type)`: set `handlePos` from handle, set menu type/open.
   - `onScrollOrResize`: recompute handles.
   - `onBlur`: close menu (and optionally hide handles).
3) **Lifecycle**: On mount, attach scroll/resize listeners; subscribe to tiptap events (`selectionUpdate`, `transaction`, `update`, `focus`, `blur`) → call `computeHandles()` (and `onBlur` for blur). On unmount, remove listeners and call unsubs safely.
4) **Template**:
   ```vue
   <div class="tiptap-editor" ref="editorRoot">
     <EditorContent ... />
     <div class="handles-overlay">
       <div v-for="h in handles" :key="h.id" class="tiptap-handle" :style="{ top: `${h.top}px`, left: `${h.left}px` }">
         <div class="block-handle">
           <button class="block-handle__btn" @click.stop="openMenu(h,'insert')">+</button>
           <button class="block-handle__btn" @click.stop="openMenu(h,'tune')">⋯</button>
         </div>
       </div>
     </div>
     <div v-if="blockMenuOpen" class="block-menu" :style="{ top: `${handlePos.top}px`, left: `${gutterSize * 0.9}px` }">...</div>
   </div>
   ```
5) **CSS**: `.handles-overlay { position:absolute; inset:0; pointer-events:none; } .handles-overlay .tiptap-handle { pointer-events:auto; }` Keep gutter padding already in place.

## Notes
- No paid TipTap features needed.
- Keeping handles always rendered avoids hover disappearance and simplifies state.
