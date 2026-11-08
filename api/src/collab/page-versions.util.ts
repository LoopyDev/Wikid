// Page history's rules, kept free of Prisma so they can be unit tested on their own.

// Page history. Saves arrive every few seconds while people type, so a version is an editing
// session: each save updates the newest version until the page has gone this long unchanged,
// or the version has covered this long of steady editing; then the next save starts a new one.
export const VERSION_IDLE_MS = 5 * 60 * 1000;
export const VERSION_MAX_MS = 30 * 60 * 1000;

/** Whether a change at `now` belongs to the newest version, or starts a new one. */
export function continuesVersion(latest: { createdAt: Date; updatedAt: Date } | null, now: Date) {
  if (!latest) return false;
  return now.getTime() - latest.updatedAt.getTime() < VERSION_IDLE_MS && now.getTime() - latest.createdAt.getTime() < VERSION_MAX_MS;
}

// The same JSON, whatever order its keys are in (Postgres keeps jsonb keys in its own order)
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as object).sort().map((key) => [key, canonical((value as any)[key])]));
  }
  return value;
};
export const sameContent = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// A page nobody has written anything on yet: an empty paragraph or nothing
export const isBlankDoc = (content: any) => {
  const nodes = Array.isArray(content?.content) ? content.content : [];
  return nodes.every((node: any) => node?.type === 'paragraph' && !(Array.isArray(node.content) && node.content.length));
};

export type LatestVersion = { id: string; title: string; content: unknown; editorIds: string[]; createdAt: Date; updatedAt: Date };
export type VersionChange = { title: string; content: unknown; editorIds: string[] };

/**
 * What a save of the page does to its history: nothing (nothing new to note), update the newest
 * version (the same editing session), or start a new version.
 */
export function planVersion(latest: LatestVersion | null, change: VersionChange, now: Date) {
  if (!latest && isBlankDoc(change.content)) return { kind: 'skip' as const };
  // Saved again unchanged (a flush, or typing undone)
  if (latest && latest.title === change.title && sameContent(latest.content, change.content)) return { kind: 'skip' as const };
  if (latest && continuesVersion(latest, now)) {
    return {
      kind: 'update' as const,
      id: latest.id,
      data: { title: change.title, content: change.content, editorIds: [...new Set([...latest.editorIds, ...change.editorIds])], updatedAt: now },
    };
  }
  return { kind: 'create' as const, data: { title: change.title, content: change.content, editorIds: change.editorIds, createdAt: now, updatedAt: now } };
}
