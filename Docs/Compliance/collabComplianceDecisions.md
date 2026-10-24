# Collab vs Compliance: Decision Notes

## Goal
Capture the tradeoffs and possible implementations for using the collab layer with compliant databases and forms.

## Baseline Principles
- Compliance records of truth must be written by the API, not by collab state.
- Collab can be used for draft UX (live editing, presence), but server-side rules enforce compliance.

## Options
1) Collab for UX, API for compliance writes (hybrid)
- Use collab for table editing, schema editing, and form layout draft.
- On submit/amend, write directly to API and ignore collab state.
- Periodically reconcile collab view with server schema.

2) API-only for compliance schema and records
- No collab writes for schema or record updates.
- Collab could still be used for non-compliance pages.
- Lowest risk, less real-time collaboration.

3) Collab for drafts only, locked compliance submit path
- Collab collects draft edits.
- API validates and persists immutable revisions on submit.
- Requires explicit draft-to-submit flow and clear UI cues.

## Risks to Watch
- Collab state drift vs server schema.
- Accidental compliance writes through collab.
- Audit log must reflect only API writes.

## Decision Criteria
- Required level of real-time collaboration for compliance data.
- Appetite for additional reconciliation logic.
- Compliance audit requirements and legal risk tolerance.

## Decision (Current)
API-only for compliance databases and records. Collab may be introduced later for form design and drafts.

## Rationale
- Minimize compliance risk while the core flows stabilize.
- Keep immutability and audit guarantees fully server-controlled.
- Reduce operational complexity during early development.

## Future Upgrade Path (Hybrid)
1) Enable collab for form design only (layout + field ordering) with server reconciliation.
2) Allow collab drafts for record creation, but submit/amend always via API.
3) Add explicit draft -> submit UI and server-side validation checks.
4) Add scheduled reconciliation to keep collab schema aligned with server schema.

## Feature Flag Plan
Default all compliance collab flags to off.

- COMPLIANCE_COLLAB_ENABLED (global gate for any compliance collab usage)
- COMPLIANCE_COLLAB_FORMS_ENABLED (form layout/design collaboration)
- COMPLIANCE_COLLAB_DRAFTS_ENABLED (draft record editing only)
- COMPLIANCE_COLLAB_SCHEMA_ENABLED (schema changes via collab; keep off until reconciliation is solid)

Suggested rollout:
1) Enable COMPLIANCE_COLLAB_ENABLED + COMPLIANCE_COLLAB_FORMS_ENABLED in a dev workspace.
2) Add COMPLIANCE_COLLAB_DRAFTS_ENABLED after draft-submit UX is ready.
3) Keep COMPLIANCE_COLLAB_SCHEMA_ENABLED off until schema reconciliation is proven.
