# Page Tree Reordering Checklist

## Backend
- [x] Add a `position` field to `Page` (per-sibling ordering; Decimal or integer) with an index on `(workspaceId, parentId, position)`.
- [x] Update listPages to order by `position` (fallback to createdAt if needed).
- [x] Backend supports bulk reorder via `PATCH /pages/reorder` updating sibling positions.
- [x] Avoid full rewrites by using midpoint ranks; add periodic normalization per parent when gaps get tight.
- [x] Normalize ranks per parent rarely (when min gap < threshold or via maintenance): re-sequence that parent's children to 1,2,3,… to restore spacing.
- [x] Normalize on-demand after a reorder if the sibling group gap is too small; no scheduled job required (optional periodic sweep as a safety net).
- [x] Migration applied: `20251130142649_add_page_position` (position column live; Prisma client regenerated).
- [x] Reorder API guards invalid parentId (non-UUID -> null) to avoid UUID errors.
- [x] Reorder API ignores deleted/bin pages when validating sibling sets.
- [x] Reorder API scopes siblings to the workspace of the reordered pages (and validates parent belongs to same workspace).

## Frontend
- [x] In the frontend sidebar, add drag-and-drop on page items, constrained within or across parents.
- [x] On drop, compute the next positions for the affected sibling groups (old parent, new parent) and send the bulk update (with optimistic update and rollback on failure).
- [x] Ensure moving a parent does not touch child positions; only reorders siblings in old/new parents.
- [x] Add optimistic UI update and rollback on failure.
- [ ] Add tests/QA notes for move within parent, across parents, and edge cases (first/last positions, deep trees).
- [x] Basic drag/drop guards: prevent cross-workspace moves and dropping into descendants.
- [x] Wire sidebar drag/drop to call bulk reorder API for sibling ordering.
- [x] Add visual drag/hover indicators on sidebar items.
