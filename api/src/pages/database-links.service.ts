import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseFieldType, PageKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { databaseStateFromYjsState } from '../collab/collab-database.util';
import { isUuid } from '../utils/uuid.util';
import { PageAccessService } from './page-access.service';
import { DatabaseSetupService } from './database-setup.service';
import { getFieldSource } from './pages.shared';

type User = { userId?: string; userName?: string };
type LinkedRow = { rowId: string; rowPageId: string | null; title: string };
type DatabaseContents = {
  fields: Array<{ id: string; name: string; type: DatabaseFieldType; options: any }>;
  rows: Array<{ id: string; pageId: string | null; data: Record<string, any> }>;
};

// The other side of relations: which rows of other databases link to a database's rows. Shown in
// a "Linked from" column, worked out from the relations rather than stored.
@Injectable()
export class DatabaseLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PageAccessService,
    private readonly databaseSetup: DatabaseSetupService,
  ) {}

  /** The relation columns, in databases this user can open, that point at the database on `pageId`. */
  async listIncomingRelations(pageId: string, user: User) {
    const { page } = await this.access.requirePageAccess(pageId, user);
    const sources = await this.readableDatabases(page.workspaceId, user);
    const relations: Array<{ databasePageId: string; databaseTitle: string; fieldId: string; fieldName: string }> = [];
    for (const source of sources) {
      const contents = await this.readDatabase(page.workspaceId, source.pageId, source.id, { rows: false });
      for (const field of contents.fields) {
        if (this.relationTarget(field) !== pageId) continue;
        relations.push({
          databasePageId: source.pageId,
          databaseTitle: source.title?.trim() || 'Untitled database',
          fieldId: field.id,
          fieldName: field.name || 'Relation',
        });
      }
    }
    relations.sort((a, b) => a.databaseTitle.localeCompare(b.databaseTitle) || a.fieldName.localeCompare(b.fieldName));
    return { relations };
  }

  /**
   * For the relation `fieldId` of the database on `sourcePageId`, which of its rows link to each
   * row of the database on `pageId`: `{ rows: { [rowId]: [{ rowId, rowPageId, title }] } }`.
   * Empty when the source can't be opened by this user or no longer points here.
   */
  async getLinkedRows(pageId: string, sourcePageId: string, fieldId: string, user: User) {
    const { page } = await this.access.requirePageAccess(pageId, user);
    if (!isUuid(sourcePageId) || !isUuid(fieldId)) throw new NotFoundException('Relation not found');
    const source = (await this.readableDatabases(page.workspaceId, user)).find((db) => db.pageId === sourcePageId);
    if (!source) return { rows: {} };
    const contents = await this.readDatabase(page.workspaceId, source.pageId, source.id, { rows: true });
    const field = contents.fields.find((entry) => entry.id === fieldId);
    if (!field || this.relationTarget(field) !== pageId) return { rows: {} };
    const titleField = contents.fields.find((entry) => getFieldSource(entry.options) === 'page') || contents.fields[0];

    const rows: Record<string, LinkedRow[]> = {};
    for (const row of contents.rows) {
      const linked = { rowId: row.id, rowPageId: row.pageId, title: this.titleOf(row.data, titleField?.id) };
      for (const targetId of this.relationIds(row.data[fieldId])) {
        (rows[targetId] ||= []).push(linked);
      }
    }
    for (const list of Object.values(rows)) list.sort((a, b) => a.title.localeCompare(b.title));
    return { rows };
  }

  /**
   * Each row's current title (and page), from the database's live document: what a relation
   * pointing here shows, so a row renamed a moment ago shows its new name.
   */
  async getRowTitles(pageId: string, user: User) {
    const { page } = await this.access.requirePageAccess(pageId, user);
    const database = await this.prisma.database.findUnique({ where: { pageId }, select: { id: true } });
    if (!database) throw new NotFoundException('Database not found');
    const contents = await this.readDatabase(page.workspaceId, pageId, database.id, { rows: true });
    const titleField = contents.fields.find((entry) => getFieldSource(entry.options) === 'page') || contents.fields[0];
    return {
      rows: contents.rows.map((row) => ({ id: row.id, pageId: row.pageId, title: this.titleOf(row.data, titleField?.id) })),
    };
  }

  /** The databases in a workspace this user can open (not in the Bin, not someone else's private page). */
  private async readableDatabases(workspaceId: string, user: User) {
    const hidden = new Set(await this.access.listHiddenPageIds(workspaceId, user.userId || ''));
    const databases = await this.prisma.database.findMany({
      where: { workspaceId, page: { isDeleted: false, isHidden: false, kind: PageKind.DATABASE } },
      select: { id: true, pageId: true, page: { select: { title: true } } },
    });
    return databases
      .filter((db) => !hidden.has(db.pageId))
      .map((db) => ({ id: db.id, pageId: db.pageId, title: db.page?.title || '' }));
  }

  /**
   * A database's fields (and rows), from its live document where there is one, so columns and
   * changes not yet saved to the database tables are included.
   */
  private async readDatabase(workspaceId: string, pageId: string, databaseId: string, { rows }: { rows: boolean }): Promise<DatabaseContents> {
    const doc = await this.prisma.collabDoc.findUnique({
      where: { documentName: `ws:${workspaceId}:db:${pageId}` },
      select: { state: true },
    });
    if (doc?.state) {
      try {
        const state = databaseStateFromYjsState(Buffer.from(doc.state));
        if (state.fields.length) {
          return {
            fields: state.fields,
            rows: rows ? state.rows.map((row) => ({ id: row.id, pageId: row.pageId || null, data: row.data || {} })) : [],
          };
        }
      } catch {
        // Fall back to the database tables
      }
    }
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, type: true, options: true },
    });
    const storedRows = rows
      ? await this.prisma.databaseRow.findMany({ where: { databaseId }, select: { id: true, pageId: true, data: true } })
      : [];
    return {
      fields,
      rows: storedRows.map((row) => ({
        id: row.id,
        pageId: row.pageId ?? null,
        data: row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Record<string, any>) : {},
      })),
    };
  }

  /** The database page a relation field points at, or null for any other field. */
  private relationTarget(field: { type: DatabaseFieldType; options: any }) {
    if (field.type !== DatabaseFieldType.RELATION) return null;
    return this.databaseSetup.normalizeRelationOptions(field.options ?? null)?.pageId || null;
  }

  /** The row ids a relation value links to (one id, or a list of ids or { id, label }). */
  private relationIds(value: any): string[] {
    const list = Array.isArray(value) ? value : value ? [value] : [];
    return list
      .map((entry) => (typeof entry === 'string' ? entry.trim() : typeof entry?.id === 'string' ? entry.id.trim() : ''))
      .filter((id) => isUuid(id));
  }

  private titleOf(data: Record<string, any>, titleFieldId: string | undefined) {
    const raw = titleFieldId ? data[titleFieldId] : null;
    const text = Array.isArray(raw) ? raw.map((item) => String(item ?? '')).filter(Boolean).join(', ') : raw == null ? '' : String(raw).trim();
    return text || 'Untitled';
  }
}
