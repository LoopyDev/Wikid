import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, WorkspaceRole, DatabaseFieldType, PageKind, PageVisibility, PageSetupStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEditorContent } from './editor-doc.util';
import { isUuid } from '../utils/uuid.util';
import { ComplianceService } from '../compliance/compliance.service';
import { PageAccessService } from './page-access.service';
import { DatabaseSetupService } from './database-setup.service';
import { CollabSyncService } from './collab-sync.service';
import { DatabaseValuesService } from './database-values.service';
import { WikiService } from './wiki.service';
import { PagesService } from './pages.service';
import { CollabMaterializerService } from '../collab/collab-materializer.service';
import { KEPT_VALUE_PREFIX, keptValueKey, normalizeKeptValue } from '../utils/cell-values.util';
import { POSITION_INCREMENT, COMPLIANCE_RECORD_KEY, DEFAULT_COMPLIANCE_WORKFLOW, ROW_COLOR_KEY, normalizePageTitle, normalizeRowColor, getFieldSource } from './pages.shared';

// Databases: reading a database, its fields and rows, row pages, relations between
// databases with their history, and compliance records.
@Injectable()
export class DatabasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compliance: ComplianceService,
    private readonly access: PageAccessService,
    private readonly databaseSetup: DatabaseSetupService,
    private readonly collabSync: CollabSyncService,
    private readonly databaseValues: DatabaseValuesService,
    private readonly wiki: WikiService,
    private readonly pages: PagesService,
    private readonly materializer: CollabMaterializerService,
  ) {}

  private readonly RELATION_HISTORY_FIELDS = {
    title: 'Change Summary',
    source: 'Source Record',
    target: 'Target Record',
    action: 'Action',
    changedAt: 'Changed At',
    changedBy: 'Changed By',
  };
  private readonly RELATION_HISTORY_ACTIONS = {
    added: 'Added',
    removed: 'Removed',
  };

  getAssetTagFieldIds(fields: Array<{ id: string; options?: Prisma.JsonValue | null }>) {
    return fields
      .filter((field) => getFieldSource(field.options) === 'assetTag')
      .map((field) => field.id);
  }

  applyAssetTagValues(data: Record<string, any>, fieldIds: string[], value: string) {
    if (!fieldIds.length) return data;
    const next = { ...data };
    fieldIds.forEach((fieldId) => {
      next[fieldId] = value;
    });
    return next;
  }

  applyAssetTagValuesFromExisting(
    data: Record<string, any>,
    fieldIds: string[],
    existing: Record<string, any> | null,
    fallbackValue: string
  ) {
    if (!fieldIds.length) return data;
    const next = { ...data };
    fieldIds.forEach((fieldId) => {
      const existingValue = existing ? existing[fieldId] : undefined;
      if (typeof existingValue === 'string' && existingValue.trim()) {
        next[fieldId] = existingValue.trim();
      } else {
        next[fieldId] = fallbackValue;
      }
    });
    return next;
  }

  private async createDatabaseRowPage(
    databasePage: { id: string; workspaceId: string; visibility: PageVisibility; wikiHomeId: string | null },
    title: string,
    user?: { userId?: string }
  ) {
    const wikiHomeId = databasePage.wikiHomeId || null;
    const parentId = wikiHomeId || databasePage.id;
    const pageTitle = title || 'Untitled page';
    const authorId = isUuid(user?.userId) ? user?.userId : null;
    return this.prisma.page.create({
      data: {
        workspaceId: databasePage.workspaceId,
        parentId,
        wikiHomeId,
        title: pageTitle,
        content: normalizeEditorContent(null),
        kind: PageKind.DOC,
        visibility: databasePage.visibility,
        setupStatus: PageSetupStatus.COMPLETE,
        authorId,
        isHidden: !wikiHomeId,
      },
    });
  }

  async getDatabaseForPage(
    pageId: string,
    user?: { userId?: string; userName?: string },
    options: { requireWrite?: boolean } = {}
  ) {
    const { page } = await this.access.requirePageAccess(pageId, user, { requireWrite: options.requireWrite });
    if (page.kind !== PageKind.DATABASE) {
      throw new BadRequestException('Page is not a database');
    }
    const wikiHomeId = await this.wiki.resolveWikiHomeIdForDatabasePage(page);
    if (wikiHomeId) {
      await this.wiki.ensureWikiRowsForHome(wikiHomeId);
    }
    const include = {
      fields: { orderBy: { position: 'asc' } },
      rows: { orderBy: { position: 'asc' } },
      forms: { orderBy: { position: 'asc' } },
      views: { orderBy: { position: 'asc' } },
    } satisfies Prisma.DatabaseInclude;
    let database = await this.prisma.database.findUnique({ where: { pageId }, include });
    if (!database) {
      await this.databaseSetup.createDatabaseForPage(pageId, page.workspaceId);
      database = await this.prisma.database.findUniqueOrThrow({ where: { pageId }, include });
    }
    if (!wikiHomeId) {
      const { field, updated } = await this.databaseSetup.ensureDatabaseTitleField(database.id);
      if (updated && field) {
        database.fields = database.fields.map((existing) => (existing.id === field.id ? { ...existing, ...field } : existing));
      }
    }
    return database;
  }

  private async nextDatabaseFieldPosition(databaseId: string) {
    const last = await this.prisma.databaseField.findFirst({
      where: { databaseId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return last?.position ? last.position.plus(POSITION_INCREMENT) : POSITION_INCREMENT;
  }

  private normalizeRelationEntry(value: any) {
    if (typeof value === 'string') {
      const id = value.trim();
      if (!isUuid(id)) return null;
      return { id, label: '' };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const rawId = typeof (value as any).id === 'string' ? (value as any).id.trim() : '';
    if (!rawId || !isUuid(rawId)) return null;
    const rawLabel = typeof (value as any).label === 'string' ? (value as any).label.trim() : '';
    return { id: rawId, label: rawLabel };
  }

  private collectRelationEntries(value: any) {
    if (!value) return [];
    const list = Array.isArray(value) ? value : [value];
    return list.map((entry) => this.normalizeRelationEntry(entry)).filter(Boolean) as Array<{ id: string; label: string }>;
  }

  private resolveTitleFromData(data: Record<string, any> | null, titleFieldId: string | null, fallbackId: string) {
    if (!data || !titleFieldId) return fallbackId;
    const raw = data[titleFieldId];
    if (Array.isArray(raw)) {
      const joined = raw.map((item) => String(item ?? '')).filter(Boolean).join(', ');
      return joined || fallbackId;
    }
    if (raw !== null && raw !== undefined) {
      const value = String(raw).trim();
      if (value) return value;
    }
    return fallbackId;
  }

  private async ensureRelationHistoryDatabase(
    database: { pageId: string; workspaceId: string; complianceMode: boolean },
    relation: { pageId: string },
    fieldName: string,
    user?: { userId?: string; userName?: string }
  ) {
    const sourcePage = await this.prisma.page.findUnique({
      where: { id: database.pageId },
      select: { id: true, title: true, parentId: true, visibility: true },
    });
    const targetPage = await this.prisma.page.findUnique({
      where: { id: relation.pageId },
      select: { title: true },
    });
    const sourceTitle = sourcePage?.title?.trim() || 'Database';
    const targetTitle = targetPage?.title?.trim() || 'Database';
    const fieldLabel = fieldName?.trim() || 'Relation';
    const title = `${sourceTitle} - ${fieldLabel} History`;
    const fields = [
      { name: this.RELATION_HISTORY_FIELDS.title, type: DatabaseFieldType.TEXT, options: { source: 'page' }, position: 1 },
      {
        name: this.RELATION_HISTORY_FIELDS.source,
        type: DatabaseFieldType.RELATION,
        options: { relation: { pageId: database.pageId, allowMultiple: false } },
        position: 2,
      },
      {
        name: `${this.RELATION_HISTORY_FIELDS.target} (${targetTitle})`,
        type: DatabaseFieldType.RELATION,
        options: { relation: { pageId: relation.pageId, allowMultiple: false } },
        position: 3,
      },
      {
        name: this.RELATION_HISTORY_FIELDS.action,
        type: DatabaseFieldType.SELECT,
        options: { choices: [this.RELATION_HISTORY_ACTIONS.added, this.RELATION_HISTORY_ACTIONS.removed] },
        position: 4,
      },
      { name: this.RELATION_HISTORY_FIELDS.changedAt, type: DatabaseFieldType.DATE, options: {}, position: 5 },
      { name: this.RELATION_HISTORY_FIELDS.changedBy, type: DatabaseFieldType.TEXT, options: {}, position: 6 },
    ];
    const created = await this.pages.createPage({
      workspaceId: database.workspaceId,
      title,
      parentId: sourcePage?.id || undefined,
      kind: PageKind.DATABASE,
      visibility: sourcePage?.visibility || PageVisibility.PUBLIC,
      setupStatus: PageSetupStatus.COMPLETE,
      complianceMode: database.complianceMode,
      userId: user?.userId,
      userName: user?.userName,
      database: { fields },
    });
    if (!created?.id) {
      throw new Error('Failed to create relation history database.');
    }
    return created.id as string;
  }

  private async ensureRelationHistoryOptions(
    database: { pageId: string; workspaceId: string; complianceMode: boolean },
    fieldName: string,
    options: Prisma.InputJsonValue,
    user?: { userId?: string; userName?: string }
  ) {
    const relation = this.databaseSetup.normalizeRelationOptions(options as Prisma.JsonValue);
    if (!relation?.history?.enabled) return options;
    if (relation.history.pageId && relation.history.pageId === database.pageId) {
      throw new BadRequestException('Relation history database must be different from the source database.');
    }
    if (relation.history.pageId) return options;
    const logPageId = await this.ensureRelationHistoryDatabase(database, relation, fieldName, user);
    return {
      ...(options && typeof options === 'object' && !Array.isArray(options) ? (options as Record<string, any>) : {}),
      relation: {
        pageId: relation.pageId,
        allowMultiple: relation.allowMultiple,
        history: { enabled: true, pageId: logPageId },
      },
    };
  }

  private async resolveRelationHistoryFieldIds(
    logDatabaseId: string,
    sourcePageId: string,
    targetPageId: string
  ) {
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId: logDatabaseId },
      select: { id: true, name: true, type: true, options: true },
    });
    const titleFieldId = fields.find((field) => getFieldSource(field.options) === 'page')?.id || null;
    const actionFieldId = fields.find((field) => field.name === this.RELATION_HISTORY_FIELDS.action)?.id || null;
    const changedAtFieldId = fields.find((field) => field.name === this.RELATION_HISTORY_FIELDS.changedAt)?.id || null;
    const changedByFieldId = fields.find((field) => field.name === this.RELATION_HISTORY_FIELDS.changedBy)?.id || null;
    const sourceFieldId =
      fields.find((field) => {
        if (field.type !== DatabaseFieldType.RELATION) return false;
        const relation = this.databaseSetup.normalizeRelationOptions(field.options ?? null);
        return relation?.pageId === sourcePageId;
      })?.id || null;
    const targetFieldId =
      fields.find((field) => {
        if (field.type !== DatabaseFieldType.RELATION) return false;
        const relation = this.databaseSetup.normalizeRelationOptions(field.options ?? null);
        return relation?.pageId === targetPageId;
      })?.id || null;
    return { titleFieldId, actionFieldId, changedAtFieldId, changedByFieldId, sourceFieldId, targetFieldId };
  }

  private async logRelationHistoryChanges(params: {
    database: { id: string; pageId: string; workspaceId: string; complianceMode: boolean };
    fields: Array<{ id: string; name: string; type: DatabaseFieldType; options?: Prisma.JsonValue | null }>;
    rowId: string;
    previousData: Record<string, any> | null;
    nextData: Record<string, any> | null;
    user?: { userId?: string; userName?: string };
  }) {
    const { database, fields, rowId, previousData, nextData, user } = params;
    const historyFields = fields
      .filter((field) => field.type === DatabaseFieldType.RELATION)
      .map((field) => {
        const relation = this.databaseSetup.normalizeRelationOptions(field.options ?? null);
        if (!relation?.history?.enabled || !relation.history.pageId) return null;
        if (relation.history.pageId === database.pageId) return null;
        return {
          fieldId: field.id,
          fieldName: field.name,
          relationPageId: relation.pageId,
          logPageId: relation.history.pageId,
        };
      })
      .filter(Boolean) as Array<{ fieldId: string; fieldName: string; relationPageId: string; logPageId: string }>;
    if (!historyFields.length) return;

    const titleFieldId = await this.databaseSetup.resolveDatabaseTitleFieldId(database.id);
    const sourceLabel = this.resolveTitleFromData(nextData || previousData || null, titleFieldId, rowId);
    const now = new Date().toISOString();
    const changedBy = user?.userName || user?.userId || '';
    const logEntries: Array<{ logPageId: string; data: Record<string, any> }> = [];
    const logFieldCache = new Map<string, Awaited<ReturnType<typeof this.resolveRelationHistoryFieldIds>>>();

    for (const field of historyFields) {
      const beforeEntries = this.collectRelationEntries(previousData?.[field.fieldId]);
      const afterEntries = this.collectRelationEntries(nextData?.[field.fieldId]);
      const beforeMap = new Map(beforeEntries.map((entry) => [entry.id, entry]));
      const afterMap = new Map(afterEntries.map((entry) => [entry.id, entry]));
      const addedIds = [...afterMap.keys()].filter((id) => !beforeMap.has(id));
      const removedIds = [...beforeMap.keys()].filter((id) => !afterMap.has(id));
      if (!addedIds.length && !removedIds.length) continue;

      let logFields = logFieldCache.get(field.logPageId);
      if (!logFields) {
        const logDb = await this.prisma.database.findUnique({
          where: { pageId: field.logPageId },
          select: { id: true },
        });
        if (!logDb) continue;
        logFields = await this.resolveRelationHistoryFieldIds(logDb.id, database.pageId, field.relationPageId);
        logFieldCache.set(field.logPageId, logFields);
      }
      const { sourceFieldId, targetFieldId } = logFields;
      if (!sourceFieldId || !targetFieldId) continue;

      const pushEntry = (action: string, entry: { id: string; label: string }) => {
        const data: Record<string, any> = {};
        if (logFields.titleFieldId) {
          data[logFields.titleFieldId] = `${action}: ${entry.label || entry.id}`;
        }
        data[sourceFieldId] = { id: rowId, label: sourceLabel };
        data[targetFieldId] = { id: entry.id, label: entry.label || entry.id };
        if (logFields.actionFieldId) data[logFields.actionFieldId] = action;
        if (logFields.changedAtFieldId) data[logFields.changedAtFieldId] = now;
        if (logFields.changedByFieldId && changedBy) data[logFields.changedByFieldId] = changedBy;
        logEntries.push({ logPageId: field.logPageId, data });
      };

      addedIds.forEach((id) => {
        const entry = afterMap.get(id);
        if (entry) pushEntry(this.RELATION_HISTORY_ACTIONS.added, entry);
      });
      removedIds.forEach((id) => {
        const entry = beforeMap.get(id);
        if (entry) pushEntry(this.RELATION_HISTORY_ACTIONS.removed, entry);
      });
    }

    for (const entry of logEntries) {
      try {
        await this.createDatabaseRow(entry.logPageId, { data: entry.data }, user);
      } catch (err) {
        console.warn('Failed to log relation history', { logPageId: entry.logPageId, error: err });
      }
    }
  }

  async ensureComplianceVersions(
    database: { id: string; workspaceId: string },
    fields: Array<{ id: string; name: string; type: DatabaseFieldType; options?: Prisma.JsonValue | null; position?: Prisma.Decimal }>,
    user?: { userId?: string; userName?: string }
  ) {
    let workflow = await this.compliance.getLatestWorkflowVersion(database.workspaceId, database.id);
    if (!workflow) {
      workflow = await this.compliance.createWorkflowVersion(
        { workspaceId: database.workspaceId, databaseId: database.id, config: DEFAULT_COMPLIANCE_WORKFLOW },
        user
      );
    }
    let schema = await this.compliance.getLatestSchemaVersion(database.workspaceId, database.id);
    if (!schema) {
      schema = await this.compliance.createSchemaVersion(
        { workspaceId: database.workspaceId, databaseId: database.id, schema: this.databaseSetup.buildComplianceSchema(fields) },
        user
      );
    }
    return {
      workflowVersionId: workflow?.id || '',
      schemaVersionId: schema?.id || '',
    };
  }

  private async sanitizeDatabaseRowData(databaseId: string, rawData: Prisma.InputJsonValue) {
    if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return {};
    const data = rawData as Record<string, any>;
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId },
      select: { id: true, type: true, options: true },
    });
    const fieldMap = new Map(fields.map((field) => [field.id, field]));
    const relationTargetCache = new Map<string, { databaseId: string; titleFieldId: string | null } | null>();
    const resolveRelationTarget = async (pageId: string) => {
      if (relationTargetCache.has(pageId)) return relationTargetCache.get(pageId) || null;
      const targetDatabase = await this.prisma.database.findUnique({
        where: { pageId },
        select: { id: true },
      });
      if (!targetDatabase) {
        relationTargetCache.set(pageId, null);
        return null;
      }
      const titleFieldId = await this.databaseSetup.resolveDatabaseTitleFieldId(targetDatabase.id);
      const target = { databaseId: targetDatabase.id, titleFieldId };
      relationTargetCache.set(pageId, target);
      return target;
    };
    const resolveRelationLabel = (
      rowData: Record<string, any> | null,
      titleFieldId: string | null,
      fallbackLabel: string,
      fallbackId: string
    ) => {
      let label = '';
      if (titleFieldId && rowData && typeof rowData === 'object' && !Array.isArray(rowData)) {
        const raw = rowData[titleFieldId];
        if (Array.isArray(raw)) {
          label = raw.map((item) => String(item ?? '')).filter(Boolean).join(', ');
        } else if (raw !== null && raw !== undefined) {
          label = String(raw);
        }
      }
      if (!label && fallbackLabel) label = fallbackLabel;
      if (!label && fallbackId) label = fallbackId;
      return label.trim();
    };
    const resolveRelationEntry = async (
      entry: { id: string; label: string },
      target: { databaseId: string; titleFieldId: string | null }
    ) => {
      const row = await this.prisma.databaseRow.findUnique({
        where: { id: entry.id },
        select: { id: true, databaseId: true, data: true },
      });
      if (!row || row.databaseId !== target.databaseId) return null;
      const rowData =
        row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Record<string, any>) : null;
      const label = resolveRelationLabel(rowData, target.titleFieldId, entry.label, row.id);
      return { id: row.id, label };
    };
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === '__pageId') {
        const trimmed = typeof value === 'string' ? value.trim() : '';
        if (isUuid(trimmed)) {
          sanitized[key] = trimmed;
        }
        continue;
      }
      if (key === COMPLIANCE_RECORD_KEY) {
        const trimmed = typeof value === 'string' ? value.trim() : '';
        if (isUuid(trimmed)) {
          sanitized[key] = trimmed;
        }
        continue;
      }
      if (key === ROW_COLOR_KEY) {
        const color = normalizeRowColor(value);
        if (color) sanitized[key] = color;
        continue;
      }
      if (key.startsWith(KEPT_VALUE_PREFIX)) {
        const kept = fieldMap.has(key.slice(KEPT_VALUE_PREFIX.length)) ? normalizeKeptValue(value) : undefined;
        if (kept !== undefined) sanitized[key] = kept;
        continue;
      }
      const field = fieldMap.get(key);
      if (!field) continue;
      if (field.type === DatabaseFieldType.RELATION) {
        const relation = this.databaseSetup.normalizeRelationOptions(field.options ?? null);
        if (!relation) continue;
        const target = await resolveRelationTarget(relation.pageId);
        if (!target) continue;
        const coerced = this.databaseValues.coerceRelationValue(value, relation.allowMultiple);
        if (coerced === undefined) continue;
        if (relation.allowMultiple) {
          const entries = Array.isArray(coerced) ? coerced : [];
          const resolved = await Promise.all(entries.map((entry) => resolveRelationEntry(entry, target)));
          const filtered = resolved.filter(Boolean);
          if (filtered.length) {
            sanitized[key] = filtered;
          }
        } else {
          const entry = Array.isArray(coerced) ? null : coerced;
          if (entry) {
            const resolved = await resolveRelationEntry(entry, target);
            if (resolved) {
              sanitized[key] = resolved;
            }
          }
        }
        continue;
      }
      const next = this.databaseValues.coerceDatabaseFieldValue(field, value);
      if (next !== undefined) {
        sanitized[key] = next;
      }
    }
    // A cell given a value no longer needs what was kept from before its column's type changed
    fieldMap.forEach((_field, fieldId) => {
      if (sanitized[fieldId] !== undefined) delete sanitized[keptValueKey(fieldId)];
    });
    return sanitized;
  }

  async getDatabase(pageId: string, user?: { userId?: string; userName?: string }) {
    // As the live document has it, for whoever reads it here (a form's relation options, say)
    const { page: accessible } = await this.access.requirePageAccess(pageId, user);
    if (accessible.kind === PageKind.DATABASE) await this.materializer.catchUpDatabase(accessible.id, accessible.workspaceId);
    // Include the database page's current title: inline views only store a copy from when
    // they were inserted, so exports would otherwise show a stale name
    const page = await this.prisma.page.findUnique({ where: { id: pageId }, select: { title: true } });
    const database = { ...(await this.getDatabaseForPage(pageId, user)), title: page?.title ?? '' };
    if (!database.complianceMode || !database.rows?.length) {
      return database;
    }
    const recordIds = new Set<string>();
    const recordIdByRowId = new Map<string, string>();
    database.rows.forEach((row) => {
      const data =
        row?.data && typeof row.data === 'object' && !Array.isArray(row.data)
          ? (row.data as Record<string, any>)
          : null;
      if (!data) return;
      const rawRecordId = data[COMPLIANCE_RECORD_KEY];
      const recordId = typeof rawRecordId === 'string' ? rawRecordId.trim() : '';
      if (!isUuid(recordId)) return;
      recordIds.add(recordId);
      if (row?.id) {
        recordIdByRowId.set(row.id, recordId);
      }
    });
    if (!recordIds.size) {
      return database;
    }
    const statusMap = await this.compliance.getRecordStatuses([...recordIds], user, {
      workspaceId: database.workspaceId,
      databaseId: database.id,
    });
    database.rows = database.rows.map((row) => {
      const recordId = row?.id ? recordIdByRowId.get(row.id) : null;
      const status = recordId ? statusMap.get(recordId) ?? null : null;
      return { ...row, complianceStatus: status };
    });
    return database;
  }

  async getDatabaseRowBacklinks(rowId: string, user?: { userId?: string; userName?: string }) {
    const targetId = typeof rowId === 'string' ? rowId.trim() : '';
    if (!targetId || !isUuid(targetId)) {
      throw new NotFoundException('Row not found');
    }
    const row = await this.prisma.databaseRow.findUnique({
      where: { id: targetId },
      select: { id: true, databaseId: true },
    });
    if (!row) {
      throw new NotFoundException('Row not found');
    }
    const database = await this.prisma.database.findUnique({
      where: { id: row.databaseId },
      select: { id: true, pageId: true, workspaceId: true },
    });
    if (!database) {
      throw new NotFoundException('Database not found');
    }
    const { membership } = await this.access.requirePageAccess(database.pageId, user);
    const userId = user?.userId || '';

    const relationFields = await this.prisma.databaseField.findMany({
      where: {
        type: DatabaseFieldType.RELATION,
        database: { workspaceId: database.workspaceId },
      },
      select: { id: true, name: true, databaseId: true, options: true },
    });
    const matchingFields = relationFields
      .map((field) => {
        const relation = this.databaseSetup.normalizeRelationOptions(field.options ?? null);
        if (!relation || relation.pageId !== database.pageId) return null;
        return { id: field.id, name: field.name, databaseId: field.databaseId };
      })
      .filter(Boolean) as Array<{ id: string; name: string; databaseId: string }>;

    if (!matchingFields.length) {
      return { rowId: row.id, backlinks: [] };
    }

    const sourceDatabaseIds = [...new Set(matchingFields.map((field) => field.databaseId))];
    const sourceDatabases = await this.prisma.database.findMany({
      where: { id: { in: sourceDatabaseIds } },
      select: { id: true, pageId: true },
    });
    const sourceDatabaseById = new Map(sourceDatabases.map((db) => [db.id, db]));
    const sourcePageIds = sourceDatabases.map((db) => db.pageId);
    const sourcePages = await this.prisma.page.findMany({
      where: { id: { in: sourcePageIds }, isDeleted: false },
      select: { id: true, title: true, visibility: true, authorId: true, isHidden: true },
    });
    const pageById = new Map(sourcePages.map((page) => [page.id, page]));

    const canSeePrivate = membership.role !== WorkspaceRole.VIEWER;
    const allowedPageIds = new Set(
      sourcePages
        .filter((page) => {
          if (page.isHidden) return false;
          if (page.visibility === PageVisibility.PUBLIC) return true;
          return canSeePrivate && page.authorId === userId;
        })
        .map((page) => page.id)
    );
    const allowedDatabaseIds = new Set(
      sourceDatabases.filter((db) => allowedPageIds.has(db.pageId)).map((db) => db.id)
    );
    if (!allowedDatabaseIds.size) {
      return { rowId: row.id, backlinks: [] };
    }

    const fieldsByDatabase = new Map<string, Array<{ id: string; name: string }>>();
    matchingFields.forEach((field) => {
      if (!allowedDatabaseIds.has(field.databaseId)) return;
      const list = fieldsByDatabase.get(field.databaseId) || [];
      list.push({ id: field.id, name: field.name });
      fieldsByDatabase.set(field.databaseId, list);
    });
    if (!fieldsByDatabase.size) {
      return { rowId: row.id, backlinks: [] };
    }

    const rows = await this.prisma.databaseRow.findMany({
      where: { databaseId: { in: [...fieldsByDatabase.keys()] } },
      select: { id: true, pageId: true, databaseId: true, data: true },
    });
    const titleFieldByDatabase = new Map<string, string | null>();
    await Promise.all(
      [...fieldsByDatabase.keys()].map(async (databaseId) => {
        const titleFieldId = await this.databaseSetup.resolveDatabaseTitleFieldId(databaseId);
        titleFieldByDatabase.set(databaseId, titleFieldId);
      })
    );

    const backlinks: Array<{
      databaseId: string;
      databasePageId: string;
      databaseTitle: string;
      fieldId: string;
      fieldName: string;
      rowId: string;
      rowPageId: string | null;
      rowTitle: string;
    }> = [];

    rows.forEach((sourceRow) => {
      const data =
        sourceRow.data && typeof sourceRow.data === 'object' && !Array.isArray(sourceRow.data)
          ? (sourceRow.data as Record<string, any>)
          : null;
      if (!data) return;
      const fields = fieldsByDatabase.get(sourceRow.databaseId);
      if (!fields?.length) return;
      const titleFieldId = titleFieldByDatabase.get(sourceRow.databaseId) || null;
      const rowTitle = this.resolveTitleFromData(data, titleFieldId, sourceRow.id);
      const sourceDatabase = sourceDatabaseById.get(sourceRow.databaseId);
      const pageId = sourceDatabase?.pageId || '';
      const page = pageById.get(pageId);
      const databaseTitle = page?.title?.trim() || 'Database';

      fields.forEach((field) => {
        const entries = this.collectRelationEntries(data[field.id]);
        if (!entries.some((entry) => entry.id === targetId)) return;
        backlinks.push({
          databaseId: sourceRow.databaseId,
          databasePageId: pageId,
          databaseTitle,
          fieldId: field.id,
          fieldName: field.name,
          rowId: sourceRow.id,
          rowPageId: sourceRow.pageId ?? null,
          rowTitle,
        });
      });
    });

    backlinks.sort((a, b) => {
      const dbCompare = a.databaseTitle.localeCompare(b.databaseTitle);
      if (dbCompare !== 0) return dbCompare;
      const fieldCompare = a.fieldName.localeCompare(b.fieldName);
      if (fieldCompare !== 0) return fieldCompare;
      return a.rowTitle.localeCompare(b.rowTitle);
    });

    return { rowId: row.id, backlinks };
  }

  async updateDatabaseSettings(
    pageId: string,
    payload: { complianceMode?: boolean },
    user?: { userId?: string; userName?: string }
  ) {
    const database = await this.getDatabaseForPage(pageId, user, { requireWrite: true });
    if (typeof payload.complianceMode !== 'boolean') {
      return database;
    }
    return this.prisma.database.update({
      where: { id: database.id },
      data: { complianceMode: payload.complianceMode },
    });
  }

  async createDatabaseField(
    pageId: string,
    payload: { name?: string; type?: DatabaseFieldType; options?: Prisma.InputJsonValue; position?: Prisma.Decimal },
    user?: { userId?: string; userName?: string }
  ) {
    const database = await this.getDatabaseForPage(pageId, user, { requireWrite: true });
    const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : 'Field';
    const type: DatabaseFieldType =
      payload.type && Object.values(DatabaseFieldType).includes(payload.type) ? payload.type : DatabaseFieldType.TEXT;
    const position = payload.position ?? (await this.nextDatabaseFieldPosition(database.id));
    let options: Prisma.InputJsonValue = await this.databaseSetup.sanitizeDatabaseFieldOptions(database, type, payload.options);
    if (type === DatabaseFieldType.RELATION) {
      options = await this.ensureRelationHistoryOptions(database, name, options, user);
    }
    const created = await this.prisma.databaseField.create({
      data: {
        databaseId: database.id,
        name,
        type,
        options,
        position,
      },
    });
    // Into the live document too, or its next save deletes the field (compliance databases have none)
    if (!database.complianceMode) {
      await this.collabSync.syncCollabDatabaseField({ pageId: database.pageId, workspaceId: database.workspaceId }, created);
    }
    return created;
  }

  async updateDatabaseField(
    id: string,
    data: { name?: string; type?: DatabaseFieldType; options?: Prisma.InputJsonValue; position?: Prisma.Decimal },
    user?: { userId?: string; userName?: string }
  ) {
    const field = await this.prisma.databaseField.findUnique({
      where: { id },
      select: { databaseId: true, name: true, type: true, options: true },
    });
    if (!field) throw new NotFoundException('Field not found');
    const database = await this.prisma.database.findUnique({
      where: { id: field.databaseId },
      select: { pageId: true, workspaceId: true, complianceMode: true },
    });
    if (!database) throw new NotFoundException('Database not found');
    await this.access.requirePageAccess(database.pageId, user, { requireWrite: true });
    const updateData: Prisma.DatabaseFieldUpdateInput = {};
    if (typeof data.name === 'string') updateData.name = data.name.trim();
    const nextType =
      data.type && Object.values(DatabaseFieldType).includes(data.type) ? data.type : field.type || DatabaseFieldType.TEXT;
    if (data.type && Object.values(DatabaseFieldType).includes(data.type)) {
      updateData.type = nextType;
    }
    if (nextType === DatabaseFieldType.RELATION) {
      if (data.options === undefined && field.type !== DatabaseFieldType.RELATION) {
        throw new BadRequestException('Relation target is required.');
      }
      const nextOptions = data.options !== undefined ? data.options : field.options ?? {};
      const sanitizedOptions = await this.databaseSetup.sanitizeDatabaseFieldOptions(
        { workspaceId: database.workspaceId, complianceMode: database.complianceMode },
        nextType,
        nextOptions
      );
      if (data.options !== undefined || field.type !== DatabaseFieldType.RELATION) {
        const fieldName = typeof data.name === 'string' ? data.name.trim() : field.name || 'Relation';
        const ensuredOptions = await this.ensureRelationHistoryOptions(database, fieldName, sanitizedOptions, user);
        updateData.options = ensuredOptions;
      }
    } else if (data.options !== undefined) {
      updateData.options = data.options;
    }
    if (data.position !== undefined) updateData.position = data.position;
    const updated = await this.prisma.databaseField.update({
      where: { id },
      data: updateData,
    });
    // Into the live document too, or its next save puts the field back as it was
    if (!database.complianceMode) {
      await this.collabSync.syncCollabDatabaseField({ pageId: database.pageId, workspaceId: database.workspaceId }, updated);
    }
    return updated;
  }

  async deleteDatabaseField(id: string, user?: { userId?: string; userName?: string }) {
    const field = await this.prisma.databaseField.findUnique({ where: { id }, select: { id: true, databaseId: true } });
    if (!field) throw new NotFoundException('Field not found');
    const database = await this.prisma.database.findUnique({
      where: { id: field.databaseId },
      select: { pageId: true, workspaceId: true, complianceMode: true },
    });
    if (!database) throw new NotFoundException('Database not found');
    await this.access.requirePageAccess(database.pageId, user, { requireWrite: true });
    const rows = await this.prisma.databaseRow.findMany({ where: { databaseId: field.databaseId }, select: { id: true, data: true } });
    const updates = rows.map((row) => {
      const data = typeof row.data === 'object' && row.data !== null ? { ...(row.data as any) } : {};
      if (field.id in data) {
        delete data[field.id];
      }
      return this.prisma.databaseRow.update({ where: { id: row.id }, data: { data } });
    });
    if (updates.length) {
      await this.prisma.$transaction(updates);
    }
    const deleted = await this.prisma.databaseField.delete({ where: { id } });
    // Out of the live document too, or its next save brings the field back
    if (!database.complianceMode) {
      await this.collabSync.deleteCollabDatabaseField({ pageId: database.pageId, workspaceId: database.workspaceId }, id);
    }
    const forms = await this.prisma.databaseForm.findMany({
      where: { databaseId: field.databaseId },
      select: { id: true, fields: true },
    });
    // Clean every form first, then apply the updates in one transaction
    const cleanedForms = await Promise.all(
      forms.map(async (form) => {
        if (!Array.isArray(form.fields)) return null;
        const cleaned = await this.databaseValues.sanitizeDatabaseFormFields(field.databaseId, form.fields);
        return cleaned.length === form.fields.length ? null : { id: form.id, fields: cleaned };
      })
    );
    const toApply = cleanedForms
      .filter((form): form is NonNullable<typeof form> => !!form)
      .map((form) => this.prisma.databaseForm.update({ where: { id: form.id }, data: { fields: form.fields } }));
    if (toApply.length) {
      await this.prisma.$transaction(toApply);
    }
    return deleted;
  }

  async createDatabaseRow(
    pageId: string,
    payload: { data?: Prisma.InputJsonValue; position?: Prisma.Decimal },
    user?: { userId?: string; userName?: string },
    options: { rowId?: string } = {}
  ) {
    const database = await this.getDatabaseForPage(pageId, user, { requireWrite: true });
    const databasePage = await this.prisma.page.findUnique({
      where: { id: database.pageId },
      select: { id: true, workspaceId: true, visibility: true, wikiHomeId: true },
    });
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId: database.id },
      select: { id: true, name: true, type: true, options: true, position: true },
    });
    const assetTagFieldIds = this.getAssetTagFieldIds(fields);
    const requestedRowId = typeof options.rowId === 'string' && isUuid(options.rowId) ? options.rowId : null;
    const rowId = requestedRowId || (assetTagFieldIds.length ? randomUUID() : null);
    const position = payload.position ?? (await this.databaseSetup.nextDatabaseRowPosition(database.id));
    const data = payload.data ? await this.sanitizeDatabaseRowData(database.id, payload.data) : {};
    let dataWithAssetTags = rowId
      ? this.applyAssetTagValues(data as Record<string, any>, assetTagFieldIds, rowId)
      : (data as Record<string, any>);
    let complianceStatus: string | null = null;
    if (database.complianceMode) {
      const existingRecordId =
        dataWithAssetTags &&
        typeof dataWithAssetTags === 'object' &&
        !Array.isArray(dataWithAssetTags) &&
        typeof (dataWithAssetTags as Record<string, any>)[COMPLIANCE_RECORD_KEY] === 'string'
          ? (dataWithAssetTags as Record<string, any>)[COMPLIANCE_RECORD_KEY].trim()
          : '';
      if (isUuid(existingRecordId)) {
        const statusMap = await this.compliance.getRecordStatuses([existingRecordId], user, {
          workspaceId: database.workspaceId,
          databaseId: database.id,
        });
        complianceStatus = statusMap.get(existingRecordId) ?? null;
      } else {
        const { workflowVersionId, schemaVersionId } = await this.ensureComplianceVersions(database, fields, user);
        if (!workflowVersionId || !schemaVersionId) {
          throw new Error('Compliance workflow or schema is not configured.');
        }
        const complianceData =
          dataWithAssetTags && typeof dataWithAssetTags === 'object' && !Array.isArray(dataWithAssetTags)
            ? { ...(dataWithAssetTags as Record<string, any>) }
            : {};
        delete complianceData.__pageId;
        delete complianceData[COMPLIANCE_RECORD_KEY];
        const result = await this.compliance.submitRecord(
          {
            workspaceId: database.workspaceId,
            databaseId: database.id,
            workflowVersionId,
            schemaVersionId,
            data: complianceData,
          },
          user
        );
        const recordId = result?.record?.id;
        if (recordId) {
          dataWithAssetTags = { ...(dataWithAssetTags as Record<string, any>), [COMPLIANCE_RECORD_KEY]: recordId };
          complianceStatus = result?.record?.status ?? null;
        }
      }
    }
    const rawData =
      payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
        ? (payload.data as Record<string, any>)
        : null;
    const { field: titleField } = await this.databaseSetup.ensureDatabaseTitleField(database.id);
    const hasTitleUpdate = !!(titleField?.id && rawData && Object.prototype.hasOwnProperty.call(rawData, titleField.id));
    const titleValue = hasTitleUpdate ? normalizePageTitle(rawData?.[titleField?.id as string]) : '';
    let pageRecord: { id: string } | null = null;
    if (hasTitleUpdate && databasePage) {
      pageRecord = await this.createDatabaseRowPage(databasePage, titleValue, user);
    }
    const dataWithPageId =
      pageRecord && dataWithAssetTags && typeof dataWithAssetTags === 'object' && !Array.isArray(dataWithAssetTags)
        ? { ...(dataWithAssetTags as Record<string, any>), __pageId: pageRecord.id }
        : dataWithAssetTags;
    const created = await this.prisma.databaseRow.create({
      data: {
        ...(rowId ? { id: rowId } : {}),
        databaseId: database.id,
        data: dataWithPageId,
        position,
        ...(pageRecord ? { pageId: pageRecord.id } : {}),
        ...(isUuid(user?.userId) ? { createdById: user?.userId } : {}),
      },
    });
    if (!database.complianceMode) {
      await this.collabSync.updateCollabDatabaseRowForPage({ pageId: database.pageId, workspaceId: database.workspaceId }, created);
      await this.collabSync.pushCollabDatabaseRowUpdate({ pageId: database.pageId, workspaceId: database.workspaceId }, created);
    }
    await this.logRelationHistoryChanges({
      database: {
        id: database.id,
        pageId: database.pageId,
        workspaceId: database.workspaceId,
        complianceMode: database.complianceMode,
      },
      fields,
      rowId: created.id,
      previousData: null,
      nextData:
        created.data && typeof created.data === 'object' && !Array.isArray(created.data)
          ? (created.data as Record<string, any>)
          : null,
      user,
    });
    if (complianceStatus) {
      return { ...created, complianceStatus };
    }
    return created;
  }

  async updateDatabaseRow(
    id: string,
    data: { data?: Prisma.InputJsonValue; position?: Prisma.Decimal },
    user?: { userId?: string; userName?: string }
  ) {
    const updateData: Prisma.DatabaseRowUncheckedUpdateInput = {};
    const row = await this.prisma.databaseRow.findUnique({
      where: { id },
      select: { id: true, databaseId: true, pageId: true, data: true },
    });
    if (!row) throw new NotFoundException('Row not found');
    const database = await this.prisma.database.findUnique({
      where: { id: row.databaseId },
      select: { id: true, pageId: true, workspaceId: true, complianceMode: true },
    });
    if (!database) throw new NotFoundException('Database not found');
    await this.access.requirePageAccess(database.pageId, user, { requireWrite: true });
    const databasePage = await this.prisma.page.findUnique({
      where: { id: database.pageId },
      select: { id: true, workspaceId: true, visibility: true, wikiHomeId: true },
    });
    let fieldsForHistory: Array<{ id: string; name: string; type: DatabaseFieldType; options: Prisma.JsonValue | null }> | null = null;
    let previousData: Record<string, any> | null = null;
    let nextData: Record<string, any> | null = null;
    const { field: titleField } = await this.databaseSetup.ensureDatabaseTitleField(row.databaseId);
    const rawData =
      data.data && typeof data.data === 'object' && !Array.isArray(data.data) ? (data.data as Record<string, any>) : null;
    const hasTitleUpdate = !!(titleField?.id && rawData && Object.prototype.hasOwnProperty.call(rawData, titleField.id));
    const titleValue = hasTitleUpdate ? normalizePageTitle(rawData?.[titleField?.id as string]) : '';
    let pageRecord: any = null;
    if (data.data !== undefined) {
      const sanitized = await this.sanitizeDatabaseRowData(row.databaseId, data.data);
      const fields = await this.prisma.databaseField.findMany({
        where: { databaseId: row.databaseId },
        select: { id: true, name: true, type: true, options: true },
      });
      fieldsForHistory = fields;
      const assetTagFieldIds = this.getAssetTagFieldIds(fields);
      const existingData =
        row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Record<string, any>) : null;
      const updatedData = assetTagFieldIds.length
        ? this.applyAssetTagValuesFromExisting(sanitized as Record<string, any>, assetTagFieldIds, existingData, row.id)
        : (sanitized as Record<string, any>);
      if (database.complianceMode && existingData) {
        const recordId = typeof existingData[COMPLIANCE_RECORD_KEY] === 'string' ? existingData[COMPLIANCE_RECORD_KEY] : '';
        if (isUuid(recordId) && !Object.prototype.hasOwnProperty.call(updatedData, COMPLIANCE_RECORD_KEY)) {
          updatedData[COMPLIANCE_RECORD_KEY] = recordId;
        }
      }
      updateData.data = updatedData;
      previousData = existingData;
      nextData = updateData.data && typeof updateData.data === 'object' && !Array.isArray(updateData.data) ? (updateData.data as Record<string, any>) : null;
    }
    if (data.position !== undefined) updateData.position = data.position;
    if (hasTitleUpdate && databasePage) {
      if (!row.pageId) {
        pageRecord = await this.createDatabaseRowPage(databasePage, titleValue, user);
        updateData.pageId = pageRecord.id;
      }
      const pageId = row.pageId || pageRecord?.id || null;
      if (pageId) {
        pageRecord = await this.prisma.page.update({
          where: { id: pageId },
          data: { title: titleValue },
        });
        await this.collabSync.updateCollabTitleForPage(
          { id: pageRecord.id, workspaceId: pageRecord.workspaceId, kind: pageRecord.kind },
          pageRecord.title
        );
        if (updateData.data && typeof updateData.data === 'object' && !Array.isArray(updateData.data)) {
          (updateData.data as Record<string, any>).__pageId = pageId;
        }
      }
    }
    const updatedRow = await this.prisma.databaseRow.update({
      where: { id },
      data: updateData,
    });
    if (!database.complianceMode && (updateData.data !== undefined || updateData.pageId !== undefined)) {
      await this.collabSync.updateCollabDatabaseRowForPage({ pageId: database.pageId, workspaceId: database.workspaceId }, updatedRow);
      await this.collabSync.pushCollabDatabaseRowUpdate({ pageId: database.pageId, workspaceId: database.workspaceId }, updatedRow);
    }
    if (fieldsForHistory && updateData.data !== undefined) {
      await this.logRelationHistoryChanges({
        database,
        fields: fieldsForHistory,
        rowId: updatedRow.id,
        previousData,
        nextData:
          updatedRow.data && typeof updatedRow.data === 'object' && !Array.isArray(updatedRow.data)
            ? (updatedRow.data as Record<string, any>)
            : nextData,
        user,
      });
    }
    if (pageRecord) {
      return { row: updatedRow, page: pageRecord };
    }
    return updatedRow;
  }

  async ensureDatabaseRowPage(
    id: string,
    payload: { title?: string; pageId?: string; data?: Prisma.InputJsonValue; position?: Prisma.Decimal },
    user?: { userId?: string; userName?: string }
  ) {
    let row = await this.prisma.databaseRow.findUnique({
      where: { id },
      select: { id: true, databaseId: true, pageId: true, data: true },
    });
    if (!row) {
      const pageId = isUuid(payload.pageId) ? payload.pageId : null;
      if (!pageId) throw new NotFoundException('Row not found');
      const database = await this.getDatabaseForPage(pageId, user, { requireWrite: true });
      const position = payload.position ?? (await this.databaseSetup.nextDatabaseRowPosition(database.id));
      const data = payload.data ? await this.sanitizeDatabaseRowData(database.id, payload.data) : {};
      try {
        row = await this.prisma.databaseRow.create({
          data: {
            id,
            databaseId: database.id,
            data,
            position,
            ...(isUuid(user?.userId) ? { createdById: user?.userId } : {}),
          },
          select: { id: true, databaseId: true, pageId: true, data: true },
        });
      } catch (err) {
        // Saved from the live document meanwhile (a row added in the table is): carry on with that
        if ((err as { code?: string })?.code !== 'P2002') throw err;
        row = await this.prisma.databaseRow.findUnique({
          where: { id },
          select: { id: true, databaseId: true, pageId: true, data: true },
        });
        if (!row) throw err;
      }
    }
    const database = await this.prisma.database.findUnique({
      where: { id: row.databaseId },
      select: { pageId: true },
    });
    if (!database) throw new NotFoundException('Database not found');
    await this.access.requirePageAccess(database.pageId, user, { requireWrite: true });
    if (row.pageId) {
      const page = await this.prisma.page.findUnique({ where: { id: row.pageId } });
      if (page && typeof payload.title === 'string') {
        const nextTitle = normalizePageTitle(payload.title);
        const updatedPage = await this.prisma.page.update({
          where: { id: row.pageId },
          data: { title: nextTitle },
        });
        await this.collabSync.updateCollabTitleForPage(
          { id: updatedPage.id, workspaceId: updatedPage.workspaceId, kind: updatedPage.kind },
          updatedPage.title
        );
        return { row, page: updatedPage };
      }
      return { row, page };
    }
    const databasePage = await this.prisma.page.findUnique({
      where: { id: database.pageId },
      select: { id: true, workspaceId: true, visibility: true, wikiHomeId: true },
    });
    if (!databasePage) throw new NotFoundException('Database page not found');
    const titleFieldId = await this.databaseSetup.resolveDatabaseTitleFieldId(row.databaseId);
    const fallbackTitle =
      titleFieldId && row.data && typeof row.data === 'object' && !Array.isArray(row.data)
        ? (row.data as Record<string, any>)[titleFieldId]
        : undefined;
    const nextTitle = normalizePageTitle(payload.title ?? fallbackTitle);
    const page = await this.createDatabaseRowPage(databasePage, nextTitle, user);
    const nextData = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? { ...row.data } : {};
    nextData.__pageId = page.id;
    let updatedRow;
    try {
      updatedRow = await this.prisma.databaseRow.update({
        where: { id },
        data: { pageId: page.id, data: nextData },
      });
    } catch (err) {
      updatedRow = await this.prisma.databaseRow.update({
        where: { id },
        data: { data: nextData },
      });
    }
    return { row: updatedRow, page };
  }

  async deleteDatabaseRow(id: string, user?: { userId?: string; userName?: string }) {
    const row = await this.prisma.databaseRow.findUnique({ where: { id }, select: { databaseId: true } });
    if (!row) throw new NotFoundException('Row not found');
    const database = await this.prisma.database.findUnique({
      where: { id: row.databaseId },
      select: { pageId: true, workspaceId: true, complianceMode: true },
    });
    if (!database) throw new NotFoundException('Database not found');
    await this.access.requirePageAccess(database.pageId, user, { requireWrite: true });
    const deleted = await this.prisma.databaseRow.delete({ where: { id } });
    if (!database.complianceMode) {
      await this.collabSync.deleteCollabDatabaseRowForPage({ pageId: database.pageId, workspaceId: database.workspaceId }, id);
      await this.collabSync.pushCollabDatabaseRowDelete({ pageId: database.pageId, workspaceId: database.workspaceId }, id);
    }
    return deleted;
  }
}
