import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, DatabaseFieldType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isUuid } from '../utils/uuid.util';
import { INVENTORY_TEMPLATE_FIELDS, MAINTENANCE_TEMPLATE_FIELDS, ASSIGNMENTS_TEMPLATE_FIELDS } from '../constants/database-templates.const';
import { ComplianceService } from '../compliance/compliance.service';
import { POSITION_INCREMENT, DEFAULT_COMPLIANCE_WORKFLOW, getFieldSource } from './pages.shared';

// Creating a database for a page: default and template fields, compliance schema,
// and finding its title field. Used by pages, wikis and the database services.
@Injectable()
export class DatabaseSetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compliance: ComplianceService,
  ) {}

  private readonly DEFAULT_DB_FIELD_NAME = 'Name';

  async createDatabaseForPage(
    pageId: string,
    workspaceId: string,
    options: {
      complianceMode?: boolean;
      fields?: Array<{
        name: string;
        type: DatabaseFieldType;
        options: Prisma.JsonValue;
        position: Prisma.Decimal;
      }>;
      workflowConfig?: Prisma.InputJsonValue | null;
    } = {},
    user?: { userId?: string; userName?: string }
  ) {
    const complianceMode = typeof options.complianceMode === 'boolean' ? options.complianceMode : false;
    const database = await this.prisma.database.create({
      data: { pageId, workspaceId, complianceMode },
    });
    const fields = Array.isArray(options.fields) ? options.fields : [];
    const fieldsToCreate = fields.length
      ? fields
      : [
          {
            name: this.DEFAULT_DB_FIELD_NAME,
            type: DatabaseFieldType.TEXT,
            position: POSITION_INCREMENT,
            options: { source: 'page' },
          },
        ];
    const sanitizedFields = await Promise.all(
      fieldsToCreate.map(async (field) => ({
        ...field,
        options: await this.sanitizeDatabaseFieldOptions({ workspaceId, complianceMode }, field.type, field.options ?? {}),
      }))
    );
    const createdFields = await this.prisma.$transaction(
      sanitizedFields.map((field) =>
        this.prisma.databaseField.create({
          data: {
            databaseId: database.id,
            name: field.name,
            type: field.type,
            position: field.position,
            options: field.options ?? {},
          },
        })
      )
    );
    if (complianceMode) {
      const workflowConfig = this.normalizeWorkflowConfig(options.workflowConfig) || DEFAULT_COMPLIANCE_WORKFLOW;
      await this.compliance.createWorkflowVersion(
        {
          workspaceId,
          databaseId: database.id,
          config: workflowConfig,
        },
        user
      );
      await this.compliance.createSchemaVersion(
        {
          workspaceId,
          databaseId: database.id,
          schema: this.buildComplianceSchema(createdFields),
        },
        user
      );
    }
    return database;
  }

  private normalizeWorkflowConfig(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Prisma.InputJsonValue;
  }

  private normalizeDatabaseFieldInputs(raw: unknown) {
    if (!Array.isArray(raw)) return [];
    const normalized: Array<{
      name: string;
      type: DatabaseFieldType;
      options: Prisma.JsonValue;
      position: Prisma.Decimal;
    }> = [];
    raw.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;
      const name = typeof (entry as any).name === 'string' ? (entry as any).name.trim() : '';
      if (!name) return;
      const type = (entry as any).type;
      const resolvedType =
        type && Object.values(DatabaseFieldType).includes(type) ? (type as DatabaseFieldType) : DatabaseFieldType.TEXT;
      const rawOptions = (entry as any).options;
      const options =
        rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions)
          ? (rawOptions as Prisma.JsonValue)
          : {};
      const rawPosition = (entry as any).position;
      const posNumber = typeof rawPosition === 'string' || typeof rawPosition === 'number' ? Number(rawPosition) : NaN;
      const position = Number.isFinite(posNumber) ? new Prisma.Decimal(posNumber) : new Prisma.Decimal(index + 1);
      normalized.push({ name, type: resolvedType, options, position });
    });
    if (!normalized.length) return normalized;
    const hasTitleField = normalized.some((field) => getFieldSource(field.options) === 'page');
    if (!hasTitleField) {
      const first = normalized[0];
      const options =
        first.options && typeof first.options === 'object' && !Array.isArray(first.options)
          ? { ...(first.options as Record<string, any>), source: 'page' }
          : { source: 'page' };
      normalized[0] = { ...first, type: DatabaseFieldType.TEXT, options };
    }
    return normalized;
  }

  resolveDatabaseSetupConfig(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {
        fields: [] as Array<{
          name: string;
          type: DatabaseFieldType;
          options: Prisma.JsonValue;
          position: Prisma.Decimal;
        }>,
        workflowConfig: null,
      };
    }
    const raw = value as Record<string, any>;
    const template = typeof raw.template === 'string' ? raw.template.trim().toLowerCase() : '';
    let fields = this.normalizeDatabaseFieldInputs(raw.fields);
    if (!fields.length && template === 'inventory') {
      fields = this.normalizeDatabaseFieldInputs(INVENTORY_TEMPLATE_FIELDS);
    }
    if (!fields.length && template === 'maintenance') {
      fields = this.normalizeDatabaseFieldInputs(MAINTENANCE_TEMPLATE_FIELDS);
    }
    if (!fields.length && template === 'assignments') {
      fields = this.normalizeDatabaseFieldInputs(ASSIGNMENTS_TEMPLATE_FIELDS);
    }
    const workflowConfig = this.normalizeWorkflowConfig(raw.workflow);
    return { fields, workflowConfig };
  }

  async ensureDatabaseTitleField(databaseId: string) {
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId },
      orderBy: { position: 'asc' },
    });
    const pageField = fields.find((field) => getFieldSource(field.options) === 'page') || null;
    if (pageField) {
      return { field: pageField, updated: false };
    }
    if (!fields.length) {
      return { field: null, updated: false };
    }
    const target = fields[0];
    const options =
      target.options && typeof target.options === 'object' && !Array.isArray(target.options)
        ? { ...(target.options as Record<string, any>), source: 'page' }
        : { source: 'page' };
    const updatedField = await this.prisma.databaseField.update({
      where: { id: target.id },
      data: {
        type: DatabaseFieldType.TEXT,
        options,
      },
    });
    return { field: updatedField, updated: true };
  }

  async resolveDatabaseTitleFieldId(databaseId: string) {
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId },
      orderBy: { position: 'asc' },
      select: { id: true, options: true },
    });
    const pageField = fields.find((field) => getFieldSource(field.options) === 'page');
    if (pageField) return pageField.id;
    return fields[0]?.id || null;
  }

  async nextDatabaseRowPosition(databaseId: string) {
    const last = await this.prisma.databaseRow.findFirst({
      where: { databaseId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return last?.position ? last.position.plus(POSITION_INCREMENT) : POSITION_INCREMENT;
  }

  private normalizeRelationHistory(relation: Record<string, any>) {
    const raw = relation?.history;
    if (raw === true) {
      return { enabled: true, pageId: null as string | null };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const enabled = raw.enabled === true;
    const pageId = typeof raw.pageId === 'string' ? raw.pageId.trim() : '';
    return enabled ? { enabled: true, pageId: isUuid(pageId) ? pageId : null } : null;
  }

  normalizeRelationOptions(options: Prisma.JsonValue | null | undefined) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
    const relation = (options as Record<string, any>).relation;
    if (!relation || typeof relation !== 'object' || Array.isArray(relation)) return null;
    const pageId = typeof (relation as any).pageId === 'string' ? (relation as any).pageId.trim() : '';
    if (!pageId || !isUuid(pageId)) return null;
    const allowMultiple = (relation as any).allowMultiple === true;
    const history = this.normalizeRelationHistory(relation);
    return { pageId, allowMultiple, history };
  }

  async sanitizeDatabaseFieldOptions(
    database: { workspaceId: string; complianceMode: boolean },
    type: DatabaseFieldType,
    rawOptions: Prisma.InputJsonValue | null | undefined
  ) {
    const options =
      rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions)
        ? { ...(rawOptions as Record<string, any>) }
        : {};
    if (type !== DatabaseFieldType.RELATION) {
      return options;
    }
    const relation = this.normalizeRelationOptions(options);
    if (!relation) {
      throw new BadRequestException('Relation target is required.');
    }
    const targetDatabase = await this.prisma.database.findUnique({
      where: { pageId: relation.pageId },
      select: { id: true, workspaceId: true, complianceMode: true },
    });
    if (!targetDatabase) {
      throw new NotFoundException('Relation target not found.');
    }
    if (targetDatabase.workspaceId !== database.workspaceId) {
      throw new BadRequestException('Relation target must be in the same workspace.');
    }
    if (database.complianceMode && !targetDatabase.complianceMode) {
      throw new BadRequestException('Relation target must be a compliant database.');
    }
    let history: { enabled: boolean; pageId?: string | null } | null = relation.history || null;
    if (history?.pageId) {
      const historyDatabase = await this.prisma.database.findUnique({
        where: { pageId: history.pageId },
        select: { workspaceId: true, complianceMode: true },
      });
      if (!historyDatabase) {
        throw new NotFoundException('Relation history database not found.');
      }
      if (historyDatabase.workspaceId !== database.workspaceId) {
        throw new BadRequestException('Relation history database must be in the same workspace.');
      }
      if (database.complianceMode && !historyDatabase.complianceMode) {
        throw new BadRequestException('Relation history database must be compliant.');
      }
    }
    const historyConfig = history?.enabled
      ? { enabled: true, ...(history?.pageId ? { pageId: history.pageId } : {}) }
      : null;
    return {
      ...options,
      relation: {
        pageId: relation.pageId,
        allowMultiple: relation.allowMultiple,
        ...(historyConfig ? { history: historyConfig } : {}),
      },
    };
  }

  buildComplianceSchema(
    fields: Array<{ id: string; name: string; type: DatabaseFieldType; options?: Prisma.JsonValue | null; position?: Prisma.Decimal }>
  ) {
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      fields: fields.map((field) => ({
        id: field.id,
        name: field.name,
        type: field.type,
        options: field.options ?? {},
        position: field.position?.toString?.() ?? null,
      })),
    };
  }
}
