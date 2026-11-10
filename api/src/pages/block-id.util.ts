import { randomBytes } from 'crypto';

// Block ids: links to a block (#block-…), synced copies and the Markdown API point at them, so a
// block keeps its id. New ones are random ("block-4k3x9q2m1a"), never counted on from the highest, so
// two people adding blocks at once never pick the same one, and a deleted block's id never comes back.
// Any id already there is kept (the older "block-12" ones too). The browser makes them the same way
// (web/src/tiptap/blockIds.js): keep the two in step.

// The first character is a digit, so a browser tab still running the older code (which reads
// "block-" and a number) takes these ids as valid, rather than renumbering them for everyone.
const FIRST = '23456789';
const REST = '0123456789abcdefghjkmnpqrstvwxyz';

export const newBlockId = () => {
  const bytes = randomBytes(10);
  let id = `block-${FIRST[bytes[0] & 7]}`;
  for (const byte of bytes.subarray(1)) id += REST[byte & 31];
  return id;
};

// Content with its block ids taken off, for a copy: it gets ids of its own when it's saved, so links
// and synced blocks pointing at the original still go there. Synced copies stay synced.
export const withoutBlockIds = <T>(nodes: T[]): T[] =>
  nodes.map((node: any) => {
    if (!node || typeof node !== 'object') return node;
    const { id: _id, ...attrs } = node.attrs ?? {};
    return {
      ...node,
      ...(node.attrs ? { attrs } : {}),
      ...(Array.isArray(node.content) ? { content: withoutBlockIds(node.content) } : {}),
    };
  });

// An id a link can point at: "block-" and then letters, digits, "_" or "-".
export const isBlockId = (id: unknown): id is string => typeof id === 'string' && /^block-[A-Za-z0-9_-]{1,64}$/.test(id);
