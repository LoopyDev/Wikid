import { SYSTEM_ADMIN_ID } from '../constants/system-admin';

/**
 * What the system admin changed in a workspace, in words: for its members ("The system admin made
 * Bob an owner") or in the admin's own panel ("Made Bob an owner"). The admin making themselves an
 * owner says so, as that's them joining to read its pages.
 */
export function adminActionText(action, { forAdmin = false } = {}) {
  const who = action?.targetName || 'someone';
  const self = action?.targetUserId === SYSTEM_ADMIN_ID;
  if (action?.action === 'SET_OWNER') {
    if (self) return forAdmin ? 'Made yourself an owner' : 'The system admin made themselves an owner';
    return forAdmin ? `Made ${who} an owner` : `The system admin made ${who} an owner`;
  }
  if (action?.action === 'REMOVE_MEMBER') {
    return forAdmin ? `Removed ${who}` : `The system admin removed ${who}`;
  }
  return forAdmin ? 'Changed this workspace' : 'The system admin changed this workspace';
}
