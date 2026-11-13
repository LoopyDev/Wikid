import { Prisma, WorkspaceRole } from '@prisma/client';
import { SYSTEM_ADMIN_ID } from '../constants/system-admin.const';

// Constants and small helpers shared by the page, database, workspace and user services.

export const POSITION_INCREMENT = new Prisma.Decimal(1);

// The most pages one list request can name (`ids`, about 4 KB of address): a client catching up with a bigger change
// fetches the whole list instead
export const MAX_LISTED_IDS = 100;
export const COMPLIANCE_RECORD_KEY = '__complianceRecordId';
// A database row's own colour (a hex colour), which pills linking to it are shown in
export const ROW_COLOR_KEY = '__color';
export const normalizeRowColor = (value: unknown) =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
export const DEFAULT_COMPLIANCE_WORKFLOW = {
  states: [
    { id: 'draft', label: 'Draft' },
    { id: 'submitted', label: 'Submitted' },
    { id: 'review', label: 'In Review' },
    { id: 'closed', label: 'Closed/Sealed' },
  ],
  transitions: [
    { from: 'draft', to: 'submitted', guards: [] },
    { from: 'submitted', to: 'review', guards: [{ type: 'role', value: 'reviewer' }] },
    { from: 'review', to: 'closed', guards: [{ type: 'role', value: 'reviewer' }, { type: 'approval' }] },
    { from: 'closed', to: 'review', guards: [{ type: 'reason' }, { type: 'approval' }] },
  ],
};

export function isSystemAdmin(userId?: string) {
  if (!userId || userId !== SYSTEM_ADMIN_ID) return false;
  if (process.env.WIKID_ADMIN_BYPASS === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

// Whether the system admin may open other people's private pages: never in production, and outside
// it only with WIKID_ADMIN_BYPASS=true. "Private" means its author only, the admin included.
export function canReadOthersPrivatePages(userId?: string) {
  return userId === SYSTEM_ADMIN_ID && process.env.NODE_ENV !== 'production' && process.env.WIKID_ADMIN_BYPASS === 'true';
}

export function canEdit(role: WorkspaceRole) {
  return role === WorkspaceRole.OWNER || role === WorkspaceRole.EDITOR;
}

export function normalizePageTitle(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function getFieldSource(options: Prisma.JsonValue | null | undefined) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
  const raw = (options as Record<string, any>).source;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

export function normalizeFormIcon(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
