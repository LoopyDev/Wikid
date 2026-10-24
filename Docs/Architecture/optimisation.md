# Performance Optimisation Checklist

## Rendering & Editor
- Consider virtualising very long Tiptap documents and keeping NodeView components lightweight; avoid unnecessary re-renders.

## Sidebar / Trees
- Memoize the page map and children map once per tick; avoid rebuilding them in multiple computeds/watchers.
- Virtualize or paginate the sidebar tree when many pages exist; render only visible nodes.
- Keep indentation calculations lightweight; avoid per-node recompute when resizing.

## Bin refractor checklist
- [ ] Load bin pages on demand (when opening the bin modal) with paging/capping; clear bin state when closed.
- [ ] Keep bin out of hot lookups unless necessary; if needed, store a light id→meta map instead of full arrays.
- [ ] Add server-side purge/retention policy for old bin entries to keep datasets small.

## Delete / Create flows
- During cascade deletes, select the target page once (or clear selection) and skip per-page selects.
- Reintroduce lightweight loading guards to avoid full list rebuilds on every add/delete burst.

## General
- Avoid storing large arrays in long-lived reactive state when not needed; prefer derived/memoized data.
- Profile large-page scenarios; add virtualization where DOM node counts grow (sidebar, bin list).

### Long-lived state refractor (checklist)
- [x] Keep `pages` as the single source of truth; derive `userPages`/`globalPages`/`binPages` via memoized selectors keyed by workspaceId + isDeleted (no duplicated arrays in state).
- [x] Load bin data on demand (open bin modal) with paging/capping; clear bin state when closed. If lookups are needed, keep an id→meta map rather than the full array.
- [ ] Memoize `{ byParent, byId }` children maps and breadcrumbs per render tick; avoid recomputing in multiple computeds.
- [x] Do not embed derived data (e.g., child links) into docs in state; render those from UI-derived data only.
- [x] On add/delete/restore, update the canonical `pages` once and avoid temporary duplicated arrays.
