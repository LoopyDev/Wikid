import { PageKind } from '@prisma/client';
import { isUuid } from './uuid.util';

export type ParsedDocName = {
  scope: 'ws' | 'user';
  workspaceId?: string;
  userId?: string;
  pageId?: string;
  kind: PageKind;
};

export function parseDocName(documentName: string): ParsedDocName | null {
  const raw = String(documentName || '').trim();
  const parts = raw.split(':');
  if (parts.length < 3) return null;
  const [scope, second, third, fourth] = parts;
  if (scope === 'ws') {
    if (parts.length === 3) {
      return { scope: 'ws', workspaceId: second, pageId: third, kind: PageKind.DOC };
    }
    if (parts.length === 4 && third === 'db') {
      return { scope: 'ws', workspaceId: second, pageId: fourth, kind: PageKind.DATABASE };
    }
  }
  if (scope === 'user') {
    if (parts.length === 3) {
      return { scope: 'user', userId: second, pageId: third, kind: PageKind.DOC };
    }
    if (parts.length === 4 && third === 'db') {
      return { scope: 'user', userId: second, pageId: fourth, kind: PageKind.DATABASE };
    }
  }
  return null;
}

export function extractPageIdFromDocName(documentName: string): string | null {
  const parsed = parseDocName(documentName);
  if (!parsed?.pageId) return null;
  return isUuid(parsed.pageId) ? parsed.pageId : null;
}
