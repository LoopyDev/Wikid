import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseFieldType, PageKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeCollabDocState } from './collab-doc.util';
import { CollabDatabaseState, databaseStateFromYjsState } from './collab-database.util';
import { isUuid } from '../utils/uuid.util';
import { coerceCellValue, keptValueKey, normalizeKeptValue } from '../utils/cell-values.util';
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
        await this.materializeDocument(doc.documentName);
      }
    } catch (err) {
      console.warn('Collab materializer failed', err);
    } finally {
      this.running = false;
    }
  }

  async materializeDocuments(documentNames: string[]) {
    for (const name of documentNames) {
      try {
        await this.materializeDocument(name);
      } catch (err) {
        console.warn('On-demand materialization failed', { documentName: name, error: err });
      }
    }
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
        await this.materializeDatabaseState(parsed.pageId, state);
        await this.markMaterialized(documentName);
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

  private coerceDatabaseFieldValue(
    field: { type: DatabaseFieldType; options: NormalizedFieldOptions },
    value: any
  ) {
    const relation =
      field.type === DatabaseFieldType.RELATION ? this.normalizeRelationOptions(field.options.options || {}) : null;
    return coerceCellValue(
      { type: field.type, choiceValues: field.options.choiceValues, allowMultiple: relation ? relation.allowMultiple : null },
      value
    );
  }

  private sanitizeDatabaseRowData(
    fields: Array<{ id: string; type: DatabaseFieldType; normalizedOptions: NormalizedFieldOptions }>,
    rawData: Record<string, any>,
    options: { preservePageId?: boolean; preserveComplianceRecordId?: boolean } = {}
  ) {
    if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return {};
    const sanitized: Record<string, any> = {};
    fields.forEach((field) => {
      const next =
        field.id in rawData
          ? this.coerceDatabaseFieldValue({ type: field.type, options: field.normalizedOptions }, rawData[field.id])
          : undefined;
      if (next !== undefined) {
        sanitized[field.id] = next;
        return;
      }
      // What doesn't fit the column is kept beside it rather than lost: a value kept when the
      // column's type changed, or one left in the cell that doesn't fit it
      const kept = normalizeKeptValue(rawData[keptValueKey(field.id)]) ?? normalizeKeptValue(rawData[field.id]);
      if (kept !== undefined) sanitized[keptValueKey(field.id)] = kept;
    });
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

  private async materializeDatabaseState(pageId: string, state: CollabDatabaseState) {
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
    const rows = state.rows.map((row) => ({
      id: row.id,
      data: row.data,
      pageId: row.pageId,
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
        where: { databaseId: database.id, id: { notIn: fieldIds } },
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
        };
        await tx.databaseRow.upsert({
          where: { id: row.id },
          update: rowData,
          create: createData,
        });
      }
      if (rowIds.length) {
        await tx.databaseRow.deleteMany({
          where: { databaseId: database.id, id: { notIn: rowIds } },
        });
      } else {
        await tx.databaseRow.deleteMany({ where: { databaseId: database.id } });
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

  private async markMaterialized(documentName: string) {
    await this.prisma.$executeRaw`
      UPDATE "CollabDoc"
      SET "materializedAt" = NOW(), "materializeRequestedAt" = NULL
      WHERE "documentName" = ${documentName}
    `;
  }
}
