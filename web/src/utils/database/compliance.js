// Compliance databases: audit statuses and the governance filter.

export const AUDIT_VIEW_ID = 'audit';

export const auditStatusOptions = [
  { id: 'DRAFT', label: 'Draft', tone: 'draft' },
  { id: 'SUBMITTED', label: 'Submitted', tone: 'submitted' },
  { id: 'REVIEW', label: 'In Review', tone: 'review' },
  { id: 'CLOSED', label: 'Closed', tone: 'closed' },
  { id: 'ARCHIVED', label: 'Archived', tone: 'archived' },
];

export const GOVERNANCE_FILTER_ID = '__governanceStatus__';

export const governanceFilterChoices = auditStatusOptions.map((status) => ({
  value: status.id,
  label: status.label,
}));

export const governanceFilterOption = { id: GOVERNANCE_FILTER_ID, name: 'Governance status', type: 'Status' };

export const DEFAULT_INITIAL_STATUS = 'SUBMITTED';

export const auditStatusClassById = Object.fromEntries(auditStatusOptions.map((status) => [status.id, status.tone]));

export const COMPLIANCE_RECORD_KEY = '__complianceRecordId';

export const getComplianceRecordId = (row) => {
  const data = row?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
  const raw = data[COMPLIANCE_RECORD_KEY];
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  return trimmed || '';
};

export const getAuditStatusClass = (status) => {
  if (typeof status !== 'string') return '';
  const normalized = status.trim().toUpperCase();
  return auditStatusClassById[normalized] || '';
};
