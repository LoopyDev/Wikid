import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PageKind, PageSetupStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ComplianceService } from '../compliance/compliance.service';
import { CollabMaterializerService } from '../collab/collab-materializer.service';
import { normalizeEditorContent } from './editor-doc.util';
import { withoutBlockIds } from './block-id.util';
import { DatabaseSetupService } from './database-setup.service';
import { PageContentService } from './page-content.service';
import { COMPLIANCE_RECORD_KEY } from './pages.shared';

const KEPT_PREFIX = '__kept:';
// Row pages read at once (each may be read from its live document)
const READ_AT_ONCE = 8;
// A big database's copy is one transaction, longer than Prisma's default 5 seconds allows
const COPY_TIMEOUT_MS = 120_000;

type User = { userId?: string; userName?: string };

/** fn over each of items, at most `limit` at a time, results in order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Fills the databases made for copied pages with what the originals have: their columns, views and
 * forms, and (unless only their structure is wanted) their rows, each with a copy of its own page.
 * Everything gets new ids, and anything pointing at one of the originals' (a view's sorted column,
 * a relation to its own rows or to another database copied with it, a row's page) points at the
 * copy's instead. A compliance database's records aren't copied: they and their audit trail belong
 * to the original.
 */
@Injectable()
export class DatabaseCopyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compliance: ComplianceService,
    private readonly materializer: CollabMaterializerService,
    private readonly databaseSetup: DatabaseSetupService,
    private readonly pageContent: PageContentService,
  ) {}

  /** The latest workflow of a compliance database, for its copy (null: the default one). */
  async workflowOf(databasePageId: string) {
    const database = await this.prisma.database.findUnique({ where: { pageId: databasePageId }, select: { id: true, workspaceId: true } });
    if (!database) return null;
    const workflow = await this.compliance.getLatestWorkflowVersion(database.workspaceId, database.id);
    return (workflow?.config as Prisma.InputJsonValue | undefined) ?? null;
  }

  /**
   * Copies each of `databases` (the original's page, and its copy's) into its copy. `pages` has every
   * page copied with them (original → copy), so what points at one of those points at its copy.
   * Returns the row pages made (the original's, and its copy).
   */
  async copyAll(
    databases: Array<{ sourcePageId: string; targetPageId: string }>,
    pages: Map<string, string>,
    options: { rows: boolean; user?: User },
  ): Promise<Array<{ sourceId: string; copyId: string }>> {
    const loaded = [];
    for (const { sourcePageId, targetPageId } of databases) {
      const sourcePage = await this.prisma.page.findUniqueOrThrow({ where: { id: sourcePageId }, select: { workspaceId: true } });
      // What's in the live document first, so the copy has the latest
      await this.materializer.catchUpDatabase(sourcePageId, sourcePage.workspaceId);
      const source = await this.prisma.database.findUnique({
        where: { pageId: sourcePageId },
        include: {
          fields: { orderBy: { position: 'asc' } },
          views: { orderBy: { position: 'asc' } },
          forms: { orderBy: { position: 'asc' } },
          rows: { orderBy: { position: 'asc' } },
        },
      });
      const target = await this.prisma.database.findUnique({ where: { pageId: targetPageId } });
      const targetPage = await this.prisma.page.findUniqueOrThrow({ where: { id: targetPageId } });
      if (source && target) loaded.push({ source, target, targetPage });
    }

    // Each of the originals' ids, and its copy's: across all of them, so a relation between two
    // databases copied together joins their copies
    const ids = new Map(pages);
    for (const { source, target } of loaded) {
      ids.set(source.id, target.id);
      for (const field of source.fields) ids.set(field.id, randomUUID());
    }
    const plans = [];
    for (const { source, target, targetPage } of loaded) {
      const sourceRows = options.rows && !source.complianceMode ? source.rows : [];
      // A row's page is the database's own (hidden under it), copied here; or a page of its own
      // elsewhere (a wiki's pages are its database's rows), copied with the rest or not at all
      const owned = sourceRows.length
        ? await this.prisma.page.findMany({
            where: { id: { in: sourceRows.map((row) => row.pageId).filter((id): id is string => !!id) }, isHidden: true, isDeleted: false },
            select: { id: true, title: true, icon: true, position: true },
          })
        : [];
      const ownedById = new Map(owned.map((page) => [page.id, page]));
      const rows = sourceRows.filter((row) => !row.pageId || ownedById.has(row.pageId) || pages.has(row.pageId));
      for (const row of rows) {
        ids.set(row.id, randomUUID());
        if (row.pageId && ownedById.has(row.pageId)) ids.set(row.pageId, randomUUID());
      }
      plans.push({ source, target, targetPage, rows, owned });
    }

    // A value with the originals' ids swapped for the copies' (as values, and as row data's keys)
    const remap = (value: unknown): unknown => {
      if (typeof value === 'string') return ids.get(value) ?? value;
      if (Array.isArray(value)) return value.map(remap);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([key, inner]) => {
            const mapped = key.startsWith(KEPT_PREFIX) ? `${KEPT_PREFIX}${ids.get(key.slice(KEPT_PREFIX.length)) ?? key.slice(KEPT_PREFIX.length)}` : (ids.get(key) ?? key);
            return [mapped, remap(inner)];
          }),
        );
      }
      return value;
    };
    const json = (value: unknown) => (value === null || value === undefined ? Prisma.JsonNull : (remap(value) as Prisma.InputJsonValue));

    const made: Array<{ sourceId: string; copyId: string }> = [];
    for (const { source, target, targetPage, rows, owned } of plans) {
      // The row pages, read from what they hold now (their live documents)
      const contents = await mapLimit(owned, READ_AT_ONCE, async (page) => {
        const content = await this.pageContent.readContent(page.id, options.user ?? {}).catch(() => null);
        return content ? { type: 'doc', content: withoutBlockIds(content) } : null;
      });
      // Columns as any column made is: checked (a relation whose target's gone is kept as it was)
      const fields: Prisma.DatabaseFieldCreateManyInput[] = [];
      for (const field of source.fields) {
        const remapped = remap(field.options ?? {}) as Prisma.InputJsonValue;
        const options = await this.databaseSetup.sanitizeDatabaseFieldOptions(target, field.type, remapped).catch(() => remapped);
        fields.push({ id: ids.get(field.id)!, databaseId: target.id, name: field.name, type: field.type, position: field.position, options });
      }

      await this.prisma.$transaction(
        async (tx) => {
          // The copy's columns are the original's (the one it was made with goes), and its rows (any
          // it was given as it was made, as a wiki's are, go too)
          await tx.databaseField.deleteMany({ where: { databaseId: target.id } });
          if (rows.length) await tx.databaseRow.deleteMany({ where: { databaseId: target.id } });
          await tx.databaseField.createMany({ data: fields });
          await tx.databaseView.createMany({
            data: source.views.map((view) => ({ databaseId: target.id, name: view.name, type: view.type, icon: view.icon, position: view.position, config: json(view.config) })),
          });
          await tx.databaseForm.createMany({
            data: source.forms.map((form) => ({ databaseId: target.id, name: form.name, icon: form.icon, position: form.position, fields: json(form.fields) })),
          });
          await tx.page.createMany({
            data: owned.map((page, index) => ({
              id: ids.get(page.id)!,
              workspaceId: targetPage.workspaceId,
              parentId: targetPage.id,
              title: page.title,
              icon: page.icon,
              position: page.position,
              content: normalizeEditorContent(contents[index] ?? null),
              kind: PageKind.DOC,
              visibility: targetPage.visibility,
              setupStatus: PageSetupStatus.COMPLETE,
              authorId: options.user?.userId ?? null,
              isHidden: true,
            })),
          });
          await tx.databaseRow.createMany({
            data: rows.map((row) => {
              const data = remap(row.data ?? {}) as Record<string, unknown>;
              delete data[COMPLIANCE_RECORD_KEY];
              const pageId = row.pageId ? (ids.get(row.pageId) ?? null) : null;
              if (!pageId) delete data.__pageId;
              return { id: ids.get(row.id)!, databaseId: target.id, position: row.position, data: data as Prisma.InputJsonValue, pageId, createdById: row.createdById };
            }),
          });
        },
        { timeout: COPY_TIMEOUT_MS },
      );
      made.push(...owned.map((page) => ({ sourceId: page.id, copyId: ids.get(page.id)! })));

      // A compliance copy's schema is its columns (it was made with the default one)
      if (source.complianceMode) {
        const copied = await this.prisma.databaseField.findMany({ where: { databaseId: target.id }, orderBy: { position: 'asc' } });
        await this.compliance.createSchemaVersion(
          { workspaceId: targetPage.workspaceId, databaseId: target.id, schema: this.databaseSetup.buildComplianceSchema(copied) },
          options.user,
        );
      }
    }
    return made;
  }
}
