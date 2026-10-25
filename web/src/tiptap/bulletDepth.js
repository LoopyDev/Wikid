import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

// Marks nested bullet lists with their depth so each level can get its own bullet style.

export const bulletDepthKey = new PluginKey('bullet-depth');

export const createBulletDepthPlugin = () => new Plugin({
  key: bulletDepthKey,
  props: {
    decorations(state) {
      const decorations = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name !== 'bulletList') return;
        const $pos = state.doc.resolve(pos);
        let ancestorCount = 0;
        for (let i = 1; i <= $pos.depth; i++) {
          if ($pos.node(i).type.name === 'bulletList') ancestorCount++;
        }
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            'data-bullet-depth': String(ancestorCount % 3),
          }),
        );
      });
      return DecorationSet.create(state.doc, decorations);
    },
  },
});
