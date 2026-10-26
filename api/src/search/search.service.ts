import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type SearchResult = {
  /** "page", or "row" for a database row (its page, if it has one, opens it). */
  type: 'page' | 'row';
  /** The page to open: the page itself, the row's page, or the database page for a row without one. */
  pageId: string;
  title: string;
  /** The title with matched words wrapped in [[[ ]]]. */
  titleHighlight: string;
  icon: string | null;
  workspaceId: string;
  workspaceName: string;
  /** For rows: the database they belong to. */
  databaseTitle: string | null;
  /** Text around the match, matched words wrapped in [[[ ]]]; empty when only the title matched. */
  snippet: string;
  rank: number;
};

const HEADLINE = 'StartSel=[[[, StopSel=]]], MaxWords=24, MinWords=10, MaxFragments=1, ShortWord=2';
const TITLE_HEADLINE = 'StartSel=[[[, StopSel=]]], HighlightAll=true';
// ts_headline returns the start of the text when nothing in it matched; that isn't a useful snippet.
const matchedOnly = (snippet: string | null) => (snippet && snippet.includes('[[[') ? snippet : '');

/**
 * The words of a search, as a Postgres tsquery where every word must match and each may be the
 * start of a longer word (so results show while typing). Null when there's nothing to search.
 */
export function toPrefixQuery(text: string): string | null {
  const words = (text.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) || []).slice(0, 8);
  if (!words.length) return null;
  return words.map((word) => `${word.toLowerCase()}:*`).join(' & ');
}

// Full-text search over pages and database rows the user can see: pages in workspaces they're a
// member of, not in the Bin, and either public or their own private pages.
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(userId: string, text: string, limit = 20): Promise<SearchResult[]> {
    const query = toPrefixQuery(text || '');
    if (!query) return [];
    const take = Math.min(Math.max(limit, 1), 50);

    const pages = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT p.id, p.title, p.icon, p."workspaceId", w.name AS "workspaceName",
             ts_headline('english', p.title, q, ${TITLE_HEADLINE}) AS "titleHighlight",
             row_db.title AS "databaseTitle",
             ts_rank_cd(p."searchVector", q) AS rank,
             ts_headline('english', wikid_doc_text(p.content), q, ${HEADLINE}) AS snippet
      FROM "Page" p
      JOIN "UserWorkspace" uw ON uw."workspaceId" = p."workspaceId" AND uw."userId" = ${userId}::uuid
      JOIN "Workspace" w ON w.id = p."workspaceId"
      LEFT JOIN "DatabaseRow" r ON r."pageId" = p.id
      LEFT JOIN "Database" d ON d.id = r."databaseId"
      LEFT JOIN "Page" row_db ON row_db.id = d."pageId"
      CROSS JOIN to_tsquery('english', ${query}) q
      WHERE p."isDeleted" = false
        AND (p.visibility = 'PUBLIC' OR p."authorId" = ${userId}::uuid)
        AND p."searchVector" @@ q
      ORDER BY rank DESC, p."updatedAt" DESC
      LIMIT ${take}
    `);

    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT r.id, r."pageId", rp.title AS "rowTitle", rp.icon,
             ts_headline('english', coalesce(rp.title, ''), q, ${TITLE_HEADLINE}) AS "titleHighlight",
             db.id AS "databasePageId", db.title AS "databaseTitle", db."workspaceId", w.name AS "workspaceName",
             ts_rank_cd(r."searchVector", q) AS rank,
             ts_headline('english', wikid_row_text(r.data), q, ${HEADLINE}) AS snippet
      FROM "DatabaseRow" r
      JOIN "Database" d ON d.id = r."databaseId"
      JOIN "Page" db ON db.id = d."pageId"
      JOIN "UserWorkspace" uw ON uw."workspaceId" = db."workspaceId" AND uw."userId" = ${userId}::uuid
      JOIN "Workspace" w ON w.id = db."workspaceId"
      LEFT JOIN "Page" rp ON rp.id = r."pageId" AND rp."isDeleted" = false
      CROSS JOIN to_tsquery('english', ${query}) q
      WHERE db."isDeleted" = false
        AND (db.visibility = 'PUBLIC' OR db."authorId" = ${userId}::uuid)
        AND r."searchVector" @@ q
      ORDER BY rank DESC, r."updatedAt" DESC
      LIMIT ${take}
    `);

    // A row and its own page can both match: keep one result for them. (Rows without a page of
    // their own each stay separate, though they all open the database page.)
    const byKey = new Map<string, SearchResult>();
    const add = (key: string, result: SearchResult) => {
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, result);
        return;
      }
      const better = result.rank > existing.rank ? result : existing;
      byKey.set(key, {
        ...better,
        type: existing.type === 'row' || result.type === 'row' ? 'row' : 'page',
        databaseTitle: existing.databaseTitle ?? result.databaseTitle,
      });
    };
    for (const p of pages) {
      add(p.id, {
        type: p.databaseTitle != null ? 'row' : 'page',
        pageId: p.id,
        title: p.title || 'Untitled page',
        titleHighlight: p.title ? p.titleHighlight : 'Untitled page',
        icon: p.icon,
        workspaceId: p.workspaceId,
        workspaceName: p.workspaceName,
        databaseTitle: p.databaseTitle ?? null,
        snippet: matchedOnly(p.snippet),
        rank: Number(p.rank),
      });
    }
    for (const r of rows) {
      const hasPage = !!r.pageId && r.rowTitle !== null;
      add(hasPage ? r.pageId : `row:${r.id}`, {
        type: 'row',
        pageId: hasPage ? r.pageId : r.databasePageId,
        title: r.rowTitle || firstWords(r.snippet) || 'Untitled row',
        titleHighlight: r.rowTitle ? r.titleHighlight : firstWords(r.snippet) || 'Untitled row',
        icon: r.icon ?? null,
        workspaceId: r.workspaceId,
        workspaceName: r.workspaceName,
        databaseTitle: r.databaseTitle || 'Untitled database',
        snippet: matchedOnly(r.snippet),
        rank: Number(r.rank),
      });
    }
    return [...byKey.values()].sort((a, b) => b.rank - a.rank).slice(0, take);
  }
}

const firstWords = (snippet: string) => (snippet || '').replace(/\[\[\[|\]\]\]/g, '').split(/\s+/).slice(0, 6).join(' ');
