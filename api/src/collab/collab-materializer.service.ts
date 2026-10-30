import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseFieldType, PageKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeCollabDocState } from './collab-doc.util';
import { CollabDatabaseState, databaseStateFromYjsState } from './collab-database.util';
import { isUuid } from '../utils/uuid.util';
import { CellValueRules, sanitizeRowCells } from '../utils/cell-values.util';
import { ParsedDocName, parseDocName } from '../utils/collab-doc-name.util';
import { ROW_COLOR_KEY, normalizeRowColor } from '../pages/pages.shared';

const DEFAULT_MATERIALIZE_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_MATERIALIZE_POLL_MS = 60 * 1000;
const PAGE_ID_KEY = '__pageId';
const COMPLIANCE_RECORD_KEY = '__complianceRecordId';

type NormalizedFieldOptions = {
  options: Record<string, any>;
  choices: { value: string; color?: string | null }[] | null;
  choiceValues: string[] | null;
};

@Injectable()
export class CollabMaterializerService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const pollMs = this.getPollMs();
    this.timer = setInterval(() => {
      void this.runCycle();
    }, pollMs);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private getPollMs() {
    const raw = Number(process.env.COLLAB_MATERIALIZE_POLL_MS);
    if (Number.isFinite(raw) && raw > 0) return raw;
    return DEFAULT_MATERIALIZE_POLL_MS;
  }

  private getIntervalMs() {
    const raw = Number(process.env.COLLAB_MATERIALIZE_INTERVAL_MS);
    if (Number.isFinite(raw) && raw > 0) return raw;
    return DEFAULT_MATERIALIZE_INTERVAL_MS;
  }

  private shouldMaterialize(now: number, updatedAt: Date, materializedAt: Date | null, requestedAt: Date | null) {
    if (requestedAt && (!materializedAt || requestedAt > materializedAt)) {
      return true;
    }
    if (!materializedAt) {
      return true;
    }
    if (updatedAt <= materializedAt) {
      return false;
    }
    const intervalMs = this.getIntervalMs();
    return now - materializedAt.getTime() >= intervalMs;
  }

  private async runCycle() {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      const docs = await this.prisma.collabDoc.findMany({
        select: {
          documentName: true,
          updatedAt: true,
          materializedAt: true,
          materializeRequestedAt: true,
        },
      });
      for (const doc of docs) {
        if (!this.shouldMaterialize(now, doc.updatedAt, doc.materializedAt, doc.materializeRequestedAt)) {
          continue;
        }
        await this.materializeOnce(doc.documentName);
      }
    } catch (err) {
      console.warn('Collab materializer failed', err);
    } finally {
      this.running = false;
    }
  }

  /**
   * Brings a database's own tables up to date with its live document, before something reads
   * them that must see its columns as they are now (a form's fields, a relation's options): the
   * collab server saves what it hasn't yet, then the database is copied from it if that's newer.
   * Changes made in a table otherwise reach the tables only at the next periodic save.
   */
  async catchUpDatabase(pageId: string, workspaceId: string) {
    if (!isUuid(pageId) || !isUuid(workspaceId)) return;
    const documentName = `ws:${workspaceId}:db:${pageId}`;
    await this.flushLiveDocuments([documentName]);
    const record = await this.prisma.collabDoc.findUnique({
      where: { documentName },
      select: { updatedAt: true, materializedAt: true },
    });
    if (!record || (record.materializedAt && record.updatedAt <= record.materializedAt)) return;
    await this.materializeDocuments([documentName]);
  }

  // Asks the collab server to save the documents someone has open; carries on if it can't
  async flushLiveDocuments(documentNames: string[]) {
    const collabServerUrl = process.env.COLLAB_SERVER_URL;
    const collabApiSecret = process.env.COLLAB_API_SECRET;
    if (!collabServerUrl || !collabApiSecret || !documentNames.length) return;
    try {
      await fetch(`${collabServerUrl}/collab/flush`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${collabApiSecret}` },
        body: JSON.stringify({ documentNames }),
      });
    } catch {
      // Collab server unavailable: what's stored is the latest there is
    }
  }

  async materializeDocuments(documentNames: string[]) {
    for (const name of documentNames) {
      try {
        await this.materializeOnce(name);
      } catch (err) {
        console.warn('On-demand materialization failed', { documentName: name, error: err });
      }
    }
  }

  // One copy of a document at a time: two at once race each other (both creating the same rows).
  // A copy asked for while one runs waits for it, then copies again only if there's something newer.
  private readonly copying = new Map<string, Promise<void>>();

  private async materializeOnce(documentName: string): Promise<void> {
    const running = this.copying.get(documentName);
    if (running) {
      await running.catch(() => undefined);
      const record = await this.prisma.collabDoc.findUnique({
        where: { documentName },
        select: { updatedAt: true, materializedAt: true },
      });
      if (record?.materializedAt && record.updatedAt <= record.materializedAt) return;
      return this.materializeOnce(documentName);
    }
    const copy = this.materializeDocument(documentName).finally(() => {
      if (this.copying.get(documentName) === copy) this.copying.delete(documentName);
    });
    this.copying.set(documentName, copy);
    return copy;
  }

  private async materializeDocument(documentName: string) {
    const record = await this.prisma.collabDoc.findUnique({
      where: { documentName },
      select: { state: true, updatedAt: true },
    });
    if (!record?.state) {
      return;
    }
    const parsed = parseDocName(documentName);
    if (!parsed || !parsed.pageId || !isUuid(parsed.pageId)) {
      await this.markMaterialized(documentName);
      return;
    }
    if (parsed.kind === PageKind.DATABASE) {
      try {
        const state = databaseStateFromYjsState(record.state);
        await this.materializeDatabaseState(parsed.pageId, state, record.updatedAt);
        // As of the state copied: one stored meanwhile is still to copy
        await this.markMaterialized(documentName, record.updatedAt);
      } catch (err) {
        console.warn('Database materialization failed', { documentName, error: err });
      }
      return;
    }
    try {
      const { normalized, title, repairedState, hadDuplicateIds, hadInvalidIds } = await normalizeCollabDocState(
        record.state
      );
      if (repairedState) {
        const repairResult = await this.prisma.collabDoc.updateMany({
          where: { documentName, updatedAt: record.updatedAt },
          data: { state: repairedState },
        });
        if (repairResult.count) {
          console.warn('Collab materializer repaired block ids', {
            documentName,
            hadDuplicateIds,
            hadInvalidIds,
          });
        }
      }
      const pageData: Prisma.PageUpdateInput = { content: normalized };
      if (title) {
        pageData.title = title;
      }
      const result = await this.prisma.page.updateMany({
        where: { id: parsed.pageId, kind: PageKind.DOC },
        data: pageData,
      });
      if (!result.count) {
        await this.handleMissingPage(documentName, parsed.pageId);
        return;
      }
      await this.markMaterialized(documentName);
    } catch (err) {
      console.warn('Collab materialization failed', { documentName, error: err });
    }
  }

  private normalizeDatabaseFieldOptions(options: any): NormalizedFieldOptions {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      return { options: {}, choices: null, choiceValues: null };
    }
    const rawOptions = options as Record<string, any>;
    const rawChoices = Array.isArray(rawOptions.choices) ? rawOptions.choices : null;
    const choices = rawChoices
      ? rawChoices
          .map((choice) => {
            if (typeof choice === 'string') {
              const value = choice.trim();
              return value ? { value, color: null } : null;
            }
            if (choice && typeof choice === 'object') {
              const value = typeof choice.value === 'string' ? choice.value.trim() : '';
              if (!value) return null;
              const color = typeof choice.color === 'string' ? choice.color.trim() : null;
              return { value, color: color || null };
            }
            return null;
          })
          .filter((item): item is NonNullable<typeof item> => !!item)
      : null;
    const choiceValues = choices ? choices.map((choice) => choice.value) : null;
    return { options: rawOptions, choices, choiceValues };
  }

  private normalizeRelationOptions(options: Record<string, any>) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
    const relation = (options as Record<string, any>).relation;
    if (!relation || typeof relation !== 'object' || Array.isArray(relation)) return null;
    const pageId = typeof (relation as any).pageId === 'string' ? (relation as any).pageId.trim() : '';
    if (!pageId || !isUuid(pageId)) return null;
    const allowMultiple = (relation as any).allowMultiple === true;
    const history = relation?.history;
    const historyEnabled =
      history === true ||
      (history && typeof history === 'object' && !Array.isArray(history) && history.enabled === true);
    return { pageId, allowMultiple, history: historyEnabled ? { enabled: true } : null };
  }

  private cellRulesFor(type: DatabaseFieldType, options: NormalizedFieldOptions): CellValueRules {
    const relation = type === DatabaseFieldType.RELATION ? this.normalizeRelationOptions(options.options || {}) : null;
    const allowMultiple =
      type === DatabaseFieldType.PERSON ? options.options?.allowMultiple === true : relation ? relation.allowMultiple : null;
    return { type, choiceValues: options.choiceValues, allowMultiple };
  }

  private sanitizeDatabaseRowData(
    fields: Array<{ id: string; type: DatabaseFieldType; normalizedOptions: NormalizedFieldOptions }>,
    rawData: Record<string, any>,
    options: { preservePageId?: boolean; preserveComplianceRecordId?: boolean } = {}
  ) {
    if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return {};
    const sanitized: Record<string, any> = {};
    Object.assign(
      sanitized,
      sanitizeRowCells(
        fields.map((field) => ({ id: field.id, ...this.cellRulesFor(field.type, field.normalizedOptions) })),
        rawData
      )
    );
    if (options.preservePageId) {
      const rawPageId = typeof rawData[PAGE_ID_KEY] === 'string' ? rawData[PAGE_ID_KEY].trim() : '';
      if (isUuid(rawPageId)) {
        sanitized[PAGE_ID_KEY] = rawPageId;
      }
    }
    // A row's own colour, kept as it's set
    const color = normalizeRowColor(rawData[ROW_COLOR_KEY]);
    if (color) sanitized[ROW_COLOR_KEY] = color;
    if (options.preserveComplianceRecordId) {
      const rawComplianceId = typeof rawData[COMPLIANCE_RECORD_KEY] === 'string' ? rawData[COMPLIANCE_RECORD_KEY].trim() : '';
      if (isUuid(rawComplianceId)) {
        sanitized[COMPLIANCE_RECORD_KEY] = rawComplianceId;
      }
    }
    return sanitized;
  }

  // stateAt: when the state was stored. Rows and fields made after it (through the API, say)
  // aren't in it yet rather than deleted, so they're kept: the next copy sees them.
  private async materializeDatabaseState(pageId: string, state: CollabDatabaseState, stateAt: Date) {
    if (!state.fields.length) return;
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true, kind: true, workspaceId: true },
    });
    if (!page || page.kind !== PageKind.DATABASE) {
      return;
    }
    const database = await this.prisma.database.upsert({
      where: { pageId: page.id },
      update: {},
      create: { pageId: page.id, workspaceId: page.workspaceId },
      select: { id: true, complianceMode: true },
    });
    if (database.complianceMode) {
      return;
    }
    const fields = state.fields.map((field, index) => {
      const normalizedOptions = this.normalizeDatabaseFieldOptions(field.options);
      const optionsForStorage: Record<string, any> = { ...normalizedOptions.options };
      if (normalizedOptions.choices) {
        optionsForStorage.choices = normalizedOptions.choices;
      } else if ('choices' in optionsForStorage) {
        delete optionsForStorage.choices;
      }
      return {
        id: field.id,
        name: field.name?.trim() || `Column ${index + 1}`,
        type: field.type,
        options: optionsForStorage,
        normalizedOptions,
      };
    });
    const fieldIds = fields.map((field) => field.id);
    // Who added each row, as the browser that added it stamped it: kept only if they're in the
    // workspace, and only when the row is first saved (it never changes after)
    const stampedBy = [...new Set(state.rows.map((row) => row.createdBy).filter((id): id is string => !!id))];
    const members = stampedBy.length
      ? new Set(
          (
            await this.prisma.userWorkspace.findMany({
              where: { workspaceId: page.workspaceId, userId: { in: stampedBy } },
              select: { userId: true },
            })
          ).map((member) => member.userId)
        )
      : new Set<string>();
    const rows = state.rows.map((row) => ({
      id: row.id,
      data: row.data,
      pageId: row.pageId,
      createdById: row.createdBy && members.has(row.createdBy) ? row.createdBy : null,
    }));
    const rowIds = rows.map((row) => row.id);
    await this.prisma.$transaction(async (tx) => {
      for (const [index, field] of fields.entries()) {
        await tx.databaseField.upsert({
          where: { id: field.id },
          update: {
            name: field.name,
            type: field.type,
            options: field.options,
            position: index + 1,
          },
          create: {
            id: field.id,
            databaseId: database.id,
            name: field.name,
            type: field.type,
            options: field.options,
            position: index + 1,
          },
        });
      }
      await tx.databaseField.deleteMany({
        where: { databaseId: database.id, id: { notIn: fieldIds }, createdAt: { lte: stateAt } },
      });
      for (const [index, row] of rows.entries()) {
        const data = this.sanitizeDatabaseRowData(fields, row.data, {
          preservePageId: true,
          preserveComplianceRecordId: database.complianceMode === true,
        });
        const rowData: Prisma.DatabaseRowUncheckedUpdateInput = {
          data,
          position: index + 1,
        };
        if (row.pageId) {
          rowData.pageId = row.pageId;
        }
        const createData: Prisma.DatabaseRowUncheckedCreateInput = {
          id: row.id,
          databaseId: database.id,
          data,
          position: index + 1,
          ...(row.pageId ? { pageId: row.pageId } : {}),
          ...(row.createdById ? { createdById: row.createdById } : {}),
        };
        await tx.databaseRow.upsert({
          where: { id: row.id },
          update: rowData,
          create: createData,
        });
      }
      if (rowIds.length) {
        await tx.databaseRow.deleteMany({
          where: { databaseId: database.id, id: { notIn: rowIds }, createdAt: { lte: stateAt } },
        });
      } else {
        await tx.databaseRow.deleteMany({ where: { databaseId: database.id, createdAt: { lte: stateAt } } });
      }
    });
  }

  private async handleMissingPage(documentName: string, pageId: string) {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true, kind: true },
    });
    if (!page) {
      console.warn('Collab materializer could not find page', { documentName, pageId });
      await this.prisma.collabDoc.deleteMany({ where: { documentName } });
      return;
    }
    if (page.kind === PageKind.DATABASE) {
      console.warn('Collab materializer could not update database page', { documentName });
      await this.markMaterialized(documentName);
      return;
    }
    console.warn('Collab materializer could not update page', { documentName, pageId });
    await this.markMaterialized(documentName);
  }

  // at: the stored state's time, when that's what was copied (so a state stored since is newer)
  private async markMaterialized(documentName: string, at?: Date) {
    await this.prisma.$executeRaw`
      UPDATE "CollabDoc"
      SET "materializedAt" = COALESCE(${at ?? null}::timestamp, NOW()), "materializeRequestedAt" = NULL
      WHERE "documentName" = ${documentName}
    `;
  }
}
