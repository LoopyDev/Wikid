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

/** Each found by the word search (whole words, or their start), or only as part of a word. */
type Found = SearchResult & { wholeWords: boolean };

const HEADLINE = 'StartSel=[[[, StopSel=]]], MaxWords=24, MinWords=10, MaxFragments=1, ShortWord=2';
const TITLE_HEADLINE = 'StartSel=[[[, StopSel=]]], HighlightAll=true';
// ts_headline returns the start of the text when nothing in it matched; that isn't a useful snippet.
const matchedOnly = (snippet: string | null) => (snippet && snippet.includes('[[[') ? snippet : '');

/**
 * The words of a search, as a Postgres tsquery where every word must match and each may be the
 * start of a longer word (so results show while typing). Null when there's nothing to search.
 */
export function toPrefixQuery(text: string): string | null {
  const words = searchWords(text);
  if (!words.length) return null;
  return words.map((word) => `${word}:*`).join(' & ');
}

/** The words of a search, lower case (letters and digits only, so safe in a LIKE pattern). */
export function searchWords(text: string): string[] {
  return (text.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) || []).slice(0, 8).map((word) => word.toLowerCase());
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Text a part-word was found in, with each word's every appearance wrapped in [[[ ]]]
export function markWords(text: string, words: string[]): string {
  if (!text || !words.length) return text || '';
  const pattern = new RegExp(`(${[...words].sort((a, b) => b.length - a.length).map((word) => escapeRegExp(word)).join('|')})`, 'giu');
  return text.replace(pattern, '[[[$1]]]');
}

// A part-word find's snippet: about 24 words round the first place its longest word is in the text
const SNIPPET_BEFORE = 60;
const SNIPPET_LENGTH = 180;

/**
 * A part-word find's snippet, from the excerpt the query cut round its first match (where that is
 * in the excerpt, and whether the text was cut at either end): whole words at the edges (but never
 * cutting into the match: a long word running through it, a link say, stays), an ellipsis where
 * it's cut, and the words marked.
 */
export function partWordSnippet(
  found: { excerpt: string | null; matchAt: number | null; cutStart: boolean; cutEnd: boolean },
  words: string[],
): string {
  const excerpt = found.excerpt || '';
  if (!excerpt || found.matchAt == null) return '';
  const matchAt = Number(found.matchAt);
  const matchEnd = matchAt + Math.max(...words.map((word) => word.length));
  let start = 0;
  let end = excerpt.length;
  if (found.cutStart) {
    const space = excerpt.indexOf(' ');
    if (space >= 0 && space < matchAt) start = space + 1;
  }
  if (found.cutEnd) {
    const space = excerpt.lastIndexOf(' ');
    if (space >= matchEnd) end = space;
  }
  return `${found.cutStart ? '…' : ''}${markWords(excerpt.slice(start, end).trim(), words)}${found.cutEnd ? '…' : ''}`;
}

// Full-text search over pages and database rows the user can see: pages in workspaces they're a
// member of, not in the Bin, and either public or their own private pages. Whole words (or their
// start) first; then, after those, what has each word only as part of a longer one ("ployment" in
// "deployment", or "organiz", which the word search keeps under its stem "organ"). Just the one
// workspace when it's given.
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(userId: string, text: string, limit = 20, options: { workspaceId?: string } = {}): Promise<SearchResult[]> {
    const query = toPrefixQuery(text || '');
    if (!query) return [];
    const words = searchWords(text || '');
    const take = Math.min(Math.max(limit, 1), 50);
    const workspaceId = options.workspaceId;

    // Who can see what: pages in workspaces they're a member of, not in the Bin, public or their
    // own (for rows, their database's page); just the one workspace when it's given
    const pageFrom = Prisma.sql`
      FROM "Page" p
      JOIN "UserWorkspace" uw ON uw."workspaceId" = p."workspaceId" AND uw."userId" = ${userId}::uuid
      JOIN "Workspace" w ON w.id = p."workspaceId"
      LEFT JOIN "DatabaseRow" r ON r."pageId" = p.id
      LEFT JOIN "Database" d ON d.id = r."databaseId"
      LEFT JOIN "Page" row_db ON row_db.id = d."pageId"`;
    const pageVisible = Prisma.sql`
      p."isDeleted" = false AND p."isTemplate" = false
      AND (p.visibility = 'PUBLIC' OR p."authorId" = ${userId}::uuid)
      ${workspaceId ? Prisma.sql`AND p."workspaceId" = ${workspaceId}::uuid` : Prisma.empty}`;
    const rowFrom = Prisma.sql`
      FROM "DatabaseRow" r
      JOIN "Database" d ON d.id = r."databaseId"
      JOIN "Page" db ON db.id = d."pageId"
      JOIN "UserWorkspace" uw ON uw."workspaceId" = db."workspaceId" AND uw."userId" = ${userId}::uuid
      JOIN "Workspace" w ON w.id = db."workspaceId"
      LEFT JOIN "Page" rp ON rp.id = r."pageId" AND rp."isDeleted" = false`;
    const rowVisible = Prisma.sql`
      db."isDeleted" = false
      AND (db.visibility = 'PUBLIC' OR db."authorId" = ${userId}::uuid)
      ${workspaceId ? Prisma.sql`AND db."workspaceId" = ${workspaceId}::uuid` : Prisma.empty}`;

    // Part of a word: each word somewhere in the text (the trigram indexes' expressions). Only with
    // a word of three letters or more, which the index can look up; shorter ones alone would mean
    // reading every page, and match nearly all of them
    const anchor = words.reduce((longest, word) => (word.length > longest.length ? word : longest), '');
    const partWords = anchor.length >= 3;
    const pageText = Prisma.sql`lower(coalesce(p."title", '') || ' ' || wikid_doc_text(p."content"))`;
    const rowText = Prisma.sql`lower(wikid_row_text(r."data"))`;
    const containsAll = (expr: Prisma.Sql) => Prisma.join(words.map((word) => Prisma.sql`${expr} LIKE ${`%${word}%`}`), ' AND ');
    // The excerpt round the first place one of the words is in the text (some may be only in the
    // title), cut by the database (not the whole text sent here)
    const firstAt = Prisma.join(words.map((word) => Prisma.sql`nullif(strpos(lower(b.body), ${word}), 0)`), ', ');
    const excerpt = (body: Prisma.Sql) => Prisma.sql`
      CROSS JOIN LATERAL (SELECT ${body} AS body) b
      CROSS JOIN LATERAL (SELECT coalesce(least(${firstAt}), 0) AS at) found
      CROSS JOIN LATERAL (SELECT greatest(found.at - ${SNIPPET_BEFORE}, 1) AS start) cut`;
    const excerptColumns = Prisma.sql`
      CASE WHEN found.at > 0 THEN substr(b.body, cut.start, ${SNIPPET_LENGTH}) END AS excerpt,
      CASE WHEN found.at > 0 THEN found.at - cut.start END AS "matchAt",
      cut.start > 1 AS "cutStart",
      cut.start + ${SNIPPET_LENGTH} <= length(b.body) AS "cutEnd"`;
    const none = Promise.resolve([] as any[]);

    const [pages, partPages, rows, partRows] = await Promise.all([
      this.prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT p.id, p.title, p.icon, p."workspaceId", w.name AS "workspaceName",
               ts_headline('english', p.title, q, ${TITLE_HEADLINE}) AS "titleHighlight",
               row_db.title AS "databaseTitle",
               ts_rank_cd(p."searchVector", q) AS rank,
               ts_headline('english', wikid_doc_text(p.content), q, ${HEADLINE}) AS snippet
        ${pageFrom}
        CROSS JOIN to_tsquery('english', ${query}) q
        WHERE ${pageVisible} AND p."searchVector" @@ q
        ORDER BY rank DESC, p."updatedAt" DESC
        LIMIT ${take}
      `),
      partWords
        ? this.prisma.$queryRaw<any[]>(Prisma.sql`
            SELECT p.id, p.title, p.icon, p."workspaceId", w.name AS "workspaceName", row_db.title AS "databaseTitle",
                   ${excerptColumns}
            ${pageFrom}
            ${excerpt(Prisma.sql`wikid_doc_text(p.content)`)}
            WHERE ${pageVisible} AND ${containsAll(pageText)}
            ORDER BY p."updatedAt" DESC
            LIMIT ${take}
          `)
        : none,
      this.prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT r.id, r."pageId", rp.title AS "rowTitle", rp.icon,
               ts_headline('english', coalesce(rp.title, ''), q, ${TITLE_HEADLINE}) AS "titleHighlight",
               db.id AS "databasePageId", db.title AS "databaseTitle", db."workspaceId", w.name AS "workspaceName",
               ts_rank_cd(r."searchVector", q) AS rank,
               ts_headline('english', wikid_row_text(r.data), q, ${HEADLINE}) AS snippet
        ${rowFrom}
        CROSS JOIN to_tsquery('english', ${query}) q
        WHERE ${rowVisible} AND r."searchVector" @@ q
        ORDER BY rank DESC, r."updatedAt" DESC
        LIMIT ${take}
      `),
      partWords
        ? this.prisma.$queryRaw<any[]>(Prisma.sql`
            SELECT r.id, r."pageId", rp.title AS "rowTitle", rp.icon,
                   db.id AS "databasePageId", db.title AS "databaseTitle", db."workspaceId", w.name AS "workspaceName",
                   ${excerptColumns}
            ${rowFrom}
            ${excerpt(Prisma.sql`wikid_row_text(r.data)`)}
            WHERE ${rowVisible} AND ${containsAll(rowText)}
            ORDER BY r."updatedAt" DESC
            LIMIT ${take}
          `)
        : none,
    ]);

    // A row and its own page can both match: keep one result for them. (Rows without a page of
    // their own each stay separate, though they all open the database page.)
    const byKey = new Map<string, Found>();
    const add = (key: string, result: Found) => {
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, result);
        return;
      }
      // Found by whole words beats found as part of one; then the better rank
      const better =
        result.wholeWords !== existing.wholeWords ? (result.wholeWords ? result : existing) : result.rank > existing.rank ? result : existing;
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
        wholeWords: true,
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
        wholeWords: true,
      });
    }
    // Part-word finds: marked by hand (the word search's highlighter only marks whole words), the
    // title's matches ranking above the text's
    for (const p of partPages) {
      const inTitle = words.every((word) => (p.title || '').toLowerCase().includes(word));
      add(p.id, {
        type: p.databaseTitle != null ? 'row' : 'page',
        pageId: p.id,
        title: p.title || 'Untitled page',
        titleHighlight: p.title ? markWords(p.title, words) : 'Untitled page',
        icon: p.icon,
        workspaceId: p.workspaceId,
        workspaceName: p.workspaceName,
        databaseTitle: p.databaseTitle ?? null,
        snippet: partWordSnippet(p, words),
        rank: inTitle ? 1 : 0,
        wholeWords: false,
      });
    }
    for (const r of partRows) {
      const hasPage = !!r.pageId && r.rowTitle !== null;
      const snippet = partWordSnippet(r, words);
      add(hasPage ? r.pageId : `row:${r.id}`, {
        type: 'row',
        pageId: hasPage ? r.pageId : r.databasePageId,
        title: r.rowTitle || firstWords(snippet) || 'Untitled row',
        titleHighlight: r.rowTitle ? markWords(r.rowTitle, words) : firstWords(snippet) || 'Untitled row',
        icon: r.icon ?? null,
        workspaceId: r.workspaceId,
        workspaceName: r.workspaceName,
        databaseTitle: r.databaseTitle || 'Untitled database',
        snippet,
        rank: 0,
        wholeWords: false,
      });
    }
    return [...byKey.values()]
      .sort((a, b) => Number(b.wholeWords) - Number(a.wholeWords) || b.rank - a.rank)
      .slice(0, take)
      .map(({ wholeWords: _wholeWords, ...result }) => result);
  }
}

const firstWords = (snippet: string) => (snippet || '').replace(/\[\[\[|\]\]\]/g, '').split(/\s+/).slice(0, 6).join(' ');
