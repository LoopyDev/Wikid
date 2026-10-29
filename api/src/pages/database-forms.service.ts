import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, DatabaseFieldType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isUuid } from '../utils/uuid.util';
import { ComplianceService } from '../compliance/compliance.service';
import { PageAccessService } from './page-access.service';
import { DatabaseValuesService } from './database-values.service';
import { DatabasesService } from './databases.service';
import { POSITION_INCREMENT, COMPLIANCE_RECORD_KEY, getFieldSource, normalizeFormIcon } from './pages.shared';

// Database forms: their fields and settings, and submitting entries through them.
@Injectable()
export class DatabaseFormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compliance: ComplianceService,
    private readonly access: PageAccessService,
    private readonly databaseValues: DatabaseValuesService,
    private readonly databases: DatabasesService,
  ) {}

  private readonly DEFAULT_FORM_ICON = 'icon:pencil-square';
  private readonly GOVERNANCE_FILTER_FIELD_ID = '__governanceStatus__';

  private async nextDatabaseFormPosition(databaseId: string) {
    const last = await this.prisma.databaseForm.findFirst({
      where: { databaseId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return last?.position ? last.position.plus(POSITION_INCREMENT) : POSITION_INCREMENT;
  }

  private async sanitizeDatabaseFormConfig(
    databaseId: string,
    rawConfig: unknown,
    options: { complianceMode?: boolean } = {}
  ) {
    if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) return null;
    const mode = (rawConfig as any).mode === 'update' ? 'update' : 'create';
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId },
      select: { id: true, type: true, options: true },
    });
    const fieldMap = new Map(fields.map((field) => [field.id, field]));
    const complianceMode = options.complianceMode === true;
    let filter: any = null;
    const rawFilter = (rawConfig as any).filter;
    if (rawFilter && typeof rawFilter === 'object' && !Array.isArray(rawFilter)) {
      const fieldId = typeof rawFilter.fieldId === 'string' ? rawFilter.fieldId.trim() : '';
      const op = typeof rawFilter.op === 'string' ? rawFilter.op.trim() : '';
      if (complianceMode && fieldId === this.GOVERNANCE_FILTER_FIELD_ID && ['isEmpty', 'isNotEmpty', 'equals', 'notEquals'].includes(op)) {
        if (op === 'equals' || op === 'notEquals') {
          const rawValue = Object.prototype.hasOwnProperty.call(rawFilter as any, 'value')
            ? (rawFilter as any).value
            : '';
          const normalized =
            typeof rawValue === 'string'
              ? rawValue.trim().toUpperCase()
              : rawValue === null || rawValue === undefined
              ? ''
              : String(rawValue).trim().toUpperCase();
          filter = { fieldId, op, value: normalized };
        } else {
          filter = { fieldId, op };
        }
      }
      const field = fieldMap.get(fieldId);
      if (!filter && field && ['isEmpty', 'isNotEmpty', 'equals', 'notEquals'].includes(op)) {
        if (op === 'equals' || op === 'notEquals') {
          const rawValue = Object.prototype.hasOwnProperty.call(rawFilter as any, 'value')
            ? (rawFilter as any).value
            : '';
          const coerced = this.databaseValues.coerceDatabaseFieldValue(field, rawValue);
          if (coerced !== undefined) {
            filter = { fieldId, op, value: coerced };
          } else {
            let fallback: any = '';
            if (Array.isArray(rawValue)) {
              const cleaned = rawValue
                .map((item) => String(item ?? '').trim())
                .filter((item) => item);
              fallback = cleaned.length ? cleaned : '';
            } else if (rawValue === null || rawValue === undefined) {
              fallback = '';
            } else if (typeof rawValue === 'string') {
              fallback = rawValue.trim();
            } else {
              fallback = String(rawValue);
            }
            filter = { fieldId, op, value: fallback };
          }
        } else {
          filter = { fieldId, op };
        }
      }
    }
    const rawMessage = typeof (rawConfig as any).successMessage === 'string' ? (rawConfig as any).successMessage.trim() : '';
    const successMessage = rawMessage || '';
    const showReturnButton = (rawConfig as any).showReturnButton === true;
    let initialStatus: string | null = null;
    if (complianceMode) {
      const rawStatus = typeof (rawConfig as any).initialStatus === 'string' ? (rawConfig as any).initialStatus.trim() : '';
      const normalized = rawStatus.toUpperCase();
      const allowed = new Set(['DRAFT', 'SUBMITTED', 'REVIEW', 'CLOSED', 'ARCHIVED']);
      initialStatus = allowed.has(normalized) ? normalized : 'SUBMITTED';
    }
    let transitionStatus: string | null = null;
    if (complianceMode && mode === 'update') {
      const rawStatus =
        typeof (rawConfig as any).transitionStatus === 'string' ? (rawConfig as any).transitionStatus.trim() : '';
      const normalized = rawStatus.toUpperCase();
      const allowed = new Set(['DRAFT', 'SUBMITTED', 'REVIEW', 'CLOSED', 'ARCHIVED']);
      transitionStatus = allowed.has(normalized) ? normalized : null;
    }
    return {
      mode,
      ...(filter ? { filter } : {}),
      ...(successMessage ? { successMessage } : {}),
      showReturnButton,
      ...(initialStatus ? { initialStatus } : {}),
      ...(transitionStatus ? { transitionStatus } : {}),
    };
  }

  async createDatabaseForm(
    pageId: string,
    payload: {
      name?: string;
      icon?: string;
      fields?: Prisma.InputJsonValue;
      config?: Prisma.InputJsonValue;
      position?: Prisma.Decimal;
    },
    user?: { userId?: string; userName?: string }
  ) {
    const database = await this.databases.getDatabaseForPage(pageId, user, { requireWrite: true });
    const rawName = typeof payload.name === 'string' ? payload.name.trim() : '';
    const name = rawName || 'Form';
    const icon = normalizeFormIcon(payload.icon) || this.DEFAULT_FORM_ICON;
    const position = payload.position ?? (await this.nextDatabaseFormPosition(database.id));
    const fields = payload.fields ? await this.databaseValues.sanitizeDatabaseFormFields(database.id, payload.fields) : [];
    const config = payload.config
      ? await this.sanitizeDatabaseFormConfig(database.id, payload.config, { complianceMode: database.complianceMode })
      : null;
    const storage = config ? { fields, config } : fields;
    return this.prisma.databaseForm.create({
      data: {
        databaseId: database.id,
        name,
        icon,
        fields: storage,
        position,
      },
    });
  }

  async updateDatabaseForm(
    id: string,
    payload: {
      name?: string;
      icon?: string;
      fields?: Prisma.InputJsonValue;
      config?: Prisma.InputJsonValue;
      position?: Prisma.Decimal;
    },
    user?: { userId?: string; userName?: string }
  ) {
    const form = await this.prisma.databaseForm.findUnique({
      where: { id },
      select: { id: true, databaseId: true },
    });
    if (!form) throw new NotFoundException('Form not found');
    const database = await this.prisma.database.findUnique({
      where: { id: form.databaseId },
      select: { pageId: true, complianceMode: true },
    });
    if (!database) throw new NotFoundException('Database not found');
    await this.access.requirePageAccess(database.pageId, user, { requireWrite: true });
    const updateData: Prisma.DatabaseFormUpdateInput = {};
    if (typeof payload.name === 'string') {
      updateData.name = payload.name.trim() || 'Form';
    }
    if (payload.icon !== undefined) {
      updateData.icon = normalizeFormIcon(payload.icon) || this.DEFAULT_FORM_ICON;
    }
    if (payload.position !== undefined) {
      updateData.position = payload.position;
    }
    if (payload.fields === undefined && payload.config === undefined) {
      return this.prisma.databaseForm.update({ where: { id }, data: updateData });
    }
    // The fields and the settings share one column, and each save changes only one of them: lock the
    // row and read it again, so saves that overlap don't overwrite each other's half.
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "DatabaseForm" WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.databaseForm.findUnique({ where: { id }, select: { fields: true } });
      const existing = this.databaseValues.normalizeDatabaseFormStorage(current?.fields ?? []);
      const nextFields =
        payload.fields !== undefined
          ? await this.databaseValues.sanitizeDatabaseFormFields(form.databaseId, payload.fields)
          : await this.databaseValues.sanitizeDatabaseFormFields(form.databaseId, existing.fields);
      const nextConfig =
        payload.config !== undefined
          ? await this.sanitizeDatabaseFormConfig(form.databaseId, payload.config, { complianceMode: database.complianceMode })
          : existing.config
          ? await this.sanitizeDatabaseFormConfig(form.databaseId, existing.config, { complianceMode: database.complianceMode })
          : null;
      updateData.fields = nextConfig ? { fields: nextFields, config: nextConfig } : nextFields;
      return tx.databaseForm.update({ where: { id }, data: updateData });
    });
  }

  async deleteDatabaseForm(id: string, user?: { userId?: string; userName?: string }) {
    const form = await this.prisma.databaseForm.findUnique({
      where: { id },
      select: { id: true, databaseId: true },
    });
    if (!form) throw new NotFoundException('Form not found');
    const database = await this.prisma.database.findUnique({
      where: { id: form.databaseId },
      select: { pageId: true },
    });
    if (!database) throw new NotFoundException('Database not found');
    await this.access.requirePageAccess(database.pageId, user, { requireWrite: true });
    return this.prisma.databaseForm.delete({ where: { id: form.id } });
  }

  async getDatabaseForm(id: string, user?: { userId?: string; userName?: string }) {
    const form = await this.prisma.databaseForm.findUnique({
      where: { id },
      select: { id: true, name: true, icon: true, fields: true, databaseId: true },
    });
    if (!form) throw new NotFoundException('Form not found');
    const database = await this.prisma.database.findUnique({
      where: { id: form.databaseId },
      select: { id: true, pageId: true, complianceMode: true, fields: { orderBy: { position: 'asc' } } },
    });
    if (!database) throw new NotFoundException('Database not found');
    await this.access.requirePageAccess(database.pageId, user);
    const storage = this.databaseValues.normalizeDatabaseFormStorage(form.fields ?? []);
    const fields = await this.databaseValues.sanitizeDatabaseFormFields(form.databaseId, storage.fields);
    const config = storage.config
      ? await this.sanitizeDatabaseFormConfig(form.databaseId, storage.config, { complianceMode: database.complianceMode })
      : null;
    const rowCount = await this.prisma.databaseRow.count({ where: { databaseId: database.id } });
    return {
      id: form.id,
      name: form.name,
      icon: form.icon || this.DEFAULT_FORM_ICON,
      fields,
      ...(config ? { config } : {}),
      databaseId: database.id,
      databasePageId: database.pageId,
      databaseComplianceMode: database.complianceMode,
      databaseFields: database.fields,
      databaseRowCount: rowCount,
    };
  }

  async submitDatabaseForm(
    id: string,
    payload: { data?: Prisma.InputJsonValue; rowId?: string; reason?: string },
    user?: { userId?: string; userName?: string }
  ) {
    const form = await this.prisma.databaseForm.findUnique({
      where: { id },
      select: { id: true, fields: true, databaseId: true },
    });
    if (!form) throw new NotFoundException('Form not found');
    const database = await this.prisma.database.findUnique({
      where: { id: form.databaseId },
      select: { id: true, pageId: true, workspaceId: true, complianceMode: true },
    });
    if (!database) throw new NotFoundException('Database not found');
    await this.access.requirePageAccess(database.pageId, user, { requireWrite: true });
    const storage = this.databaseValues.normalizeDatabaseFormStorage(form.fields ?? []);
    const allowedFields = await this.databaseValues.sanitizeDatabaseFormFields(form.databaseId, storage.fields);
    const config = storage.config
      ? await this.sanitizeDatabaseFormConfig(form.databaseId, storage.config, { complianceMode: database.complianceMode })
      : null;
    const databaseFields = await this.prisma.databaseField.findMany({
      where: { databaseId: form.databaseId },
      select: { id: true, name: true, type: true, options: true },
    });
    const fieldMap = new Map(databaseFields.map((field) => [field.id, field]));
    const rowCount = await this.prisma.databaseRow.count({ where: { databaseId: form.databaseId } });
    const editableSet = new Set(
      allowedFields.filter((entry: any) => entry?.editable !== false).map((entry: any) => entry.fieldId)
    );
    const allowedSet = new Set(allowedFields.map((entry: any) => entry.fieldId));
    const rawData =
      payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
        ? (payload.data as Record<string, any>)
        : {};
    const filtered: Record<string, any> = {};
    Object.entries(rawData).forEach(([key, value]) => {
      if (allowedSet.has(key) && editableSet.has(key)) {
        filtered[key] = value;
      }
    });
    const userId = user?.userId || '';
    const userName = user?.userName || userId || '';
    const nextCounter = rowCount + 1;
    const resolveTemplate = (template: string) => {
      const replacements: Record<string, string> = {
        counter: String(nextCounter),
        user: userName || '',
        userId: userId || '',
        date: new Date().toISOString().slice(0, 10),
        datetime: new Date().toISOString(),
      };
      return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
        const token = String(key || '').trim();
        if (token in replacements) return replacements[token] || '';
        return '';
      });
    };
    // "Today", as the person submitting has it (their local date, sent by the form), if it's within
    // a day of the server's; otherwise the server's own (UTC)
    const todayFor = (sent: unknown) => {
      const serverToday = new Date().toISOString().slice(0, 10);
      if (typeof sent !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(sent.trim())) return serverToday;
      const days = Math.abs(Date.parse(sent.trim()) - Date.parse(serverToday)) / 86_400_000;
      return days <= 1 ? sent.trim() : serverToday;
    };
    const resolveAutoValue = (auto: any, field: any, sent?: unknown) => {
      if (!auto || !field) return undefined;
      if (auto.type === 'today') {
        return field.type === DatabaseFieldType.DATE ? todayFor(sent) : undefined;
      }
      if (auto.type === 'currentUser') {
        const source = getFieldSource(field.options);
        const mode = auto.mode === 'id' || auto.mode === 'name' ? auto.mode : source === 'members' ? 'id' : 'name';
        const value = mode === 'id' ? userId : userName;
        if (!value) return undefined;
        if (field.type === DatabaseFieldType.MULTI_SELECT) {
          return [value];
        }
        return value;
      }
      if (auto.type === 'fixed') {
        const value = typeof auto.value === 'string' ? auto.value.trim() : '';
        if (!value) return undefined;
        if (field.type === DatabaseFieldType.SELECT) {
          return value;
        }
        if (field.type === DatabaseFieldType.RELATION) {
          return isUuid(value) ? value : undefined;
        }
        return undefined;
      }
      if (auto.type === 'template' && typeof auto.template === 'string') {
        const rendered = resolveTemplate(auto.template);
        if (!rendered) return undefined;
        if (field.type === DatabaseFieldType.NUMBER) {
          const num = Number(rendered);
          return Number.isFinite(num) ? num : undefined;
        }
        return rendered;
      }
      return undefined;
    };
    const autoData: Record<string, any> = {};
    allowedFields.forEach((entry: any) => {
      const auto = entry?.auto;
      if (!auto) return;
      const field = fieldMap.get(entry.fieldId);
      const value = resolveAutoValue(auto, field, filtered[entry.fieldId]);
      if (value !== undefined) {
        autoData[entry.fieldId] = value;
      }
    });
    const merged = { ...filtered, ...autoData };
    const allowedFieldMap = new Map(allowedFields.map((entry: any) => [entry.fieldId, entry]));
    const sanitized: Record<string, any> = {};
    Object.entries(merged).forEach(([key, value]) => {
      const field = fieldMap.get(key);
      if (!field) return;
      const entry = allowedFieldMap.get(key);
      const selectSource =
        entry?.selectSource && typeof entry.selectSource === 'object' && !Array.isArray(entry.selectSource)
          ? entry.selectSource
          : null;
      const hasRelationSelectSource =
        selectSource?.type === 'relation' &&
        typeof selectSource.relationFieldId === 'string' &&
        selectSource.relationFieldId.trim() &&
        typeof selectSource.targetFieldId === 'string' &&
        selectSource.targetFieldId.trim();
      let next;
      if (field.type === DatabaseFieldType.SELECT && hasRelationSelectSource) {
        if (value === null || value === undefined) return;
        const trimmed = typeof value === 'string' ? value.trim() : String(value).trim();
        if (!trimmed) return;
        next = trimmed;
      } else {
        next = this.databaseValues.coerceDatabaseFieldValue(field, value);
      }
      if (next !== undefined) {
        sanitized[key] = next;
      }
    });
    const isUpdateMode = config?.mode === 'update';
    const transitionStatus =
      typeof config?.transitionStatus === 'string' ? config.transitionStatus.trim().toUpperCase() : '';
    let existingRow: { id: string; databaseId: string; data: Prisma.InputJsonValue | null } | null = null;
    let existingData: Record<string, any> | null = null;
    if (isUpdateMode) {
      const rowId = typeof payload?.rowId === 'string' ? payload.rowId.trim() : '';
      if (!rowId) throw new BadRequestException('rowId is required');
      existingRow = await this.prisma.databaseRow.findUnique({
        where: { id: rowId },
        select: { id: true, databaseId: true, data: true },
      });
      if (!existingRow || existingRow.databaseId !== form.databaseId) throw new NotFoundException('Row not found');
      existingData =
        existingRow.data && typeof existingRow.data === 'object' && !Array.isArray(existingRow.data)
          ? { ...(existingRow.data as Record<string, any>) }
          : {};
    }
    const candidateData = existingData ? { ...existingData, ...sanitized } : sanitized;
    const isMissingRequiredValue = (field: any, value: any) => {
      if (field.type === DatabaseFieldType.RELATION) {
        if (Array.isArray(value)) {
          return !value.some((entry) => entry && isUuid(entry.id));
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return !isUuid(typeof value.id === 'string' ? value.id : '');
        }
        if (typeof value === 'string') {
          return !isUuid(value.trim());
        }
        return true;
      }
      if (field.type === DatabaseFieldType.MULTI_SELECT) {
        return !Array.isArray(value) || value.length === 0;
      }
      if (field.type === DatabaseFieldType.CHECKBOX) {
        return value !== true;
      }
      if (field.type === DatabaseFieldType.NUMBER) {
        return value === undefined || value === null || String(value).trim() === '';
      }
      return value === undefined || value === null || String(value).trim() === '';
    };
    const isConditionMet = (condition: any) => {
      if (!condition || typeof condition !== 'object') return false;
      const fieldId = typeof condition.fieldId === 'string' ? condition.fieldId.trim() : '';
      if (!fieldId) return false;
      const field = fieldMap.get(fieldId);
      if (!field) return false;
      const op = typeof condition.op === 'string' ? condition.op.trim() : 'equals';
      if (op === 'isFilled' || op === 'isEmpty') {
        const value = candidateData[fieldId];
        const missing = isMissingRequiredValue(field, value);
        return op === 'isEmpty' ? missing : !missing;
      }
      if (op !== 'equals') return false;
      const expected = typeof condition.value === 'string' ? condition.value.trim() : '';
      if (!expected) return false;
      const value = candidateData[fieldId];
      return String(value ?? '').trim() === expected;
    };
    const missingRequired = allowedFields
      .map((entry: any) => {
        if (entry?.editable === false && !entry?.auto) return null;
        const field = fieldMap.get(entry.fieldId);
        if (!field) return null;
        if (getFieldSource(field.options) === 'assetTag') return null;
        const isVisible = entry?.visibleWhen ? isConditionMet(entry.visibleWhen) : true;
        if (!isVisible) return null;
        const conditionMet = entry?.requiredWhen ? isConditionMet(entry.requiredWhen) : false;
        if (!entry?.required && !conditionMet) return null;
        const hasValue = Object.prototype.hasOwnProperty.call(sanitized, entry.fieldId);
        const value = entry?.required ? (hasValue ? sanitized[entry.fieldId] : undefined) : candidateData[entry.fieldId];
        if (isMissingRequiredValue(field, value)) {
          const label =
            typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : field.name || 'Field';
          return label;
        }
        return null;
      })
      .filter(Boolean) as string[];
    if (missingRequired.length) {
      throw new BadRequestException(`Missing required fields: ${missingRequired.join(', ')}`);
    }
    // "No future" dates: a day's leeway, as the person may be ahead of the server's time zone
    const latestAllowed = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const futureDates = allowedFields
      .map((entry: any) => {
        if (entry?.noFuture !== true) return null;
        const field = fieldMap.get(entry.fieldId);
        const value = sanitized[entry.fieldId];
        if (field?.type !== DatabaseFieldType.DATE || typeof value !== 'string') return null;
        const day = /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : new Date(Date.parse(value)).toISOString().slice(0, 10);
        if (day <= latestAllowed) return null;
        return typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : field.name || 'Field';
      })
      .filter(Boolean) as string[];
    if (futureDates.length) {
      throw new BadRequestException(`Dates can't be in the future: ${futureDates.join(', ')}`);
    }
    const assetTagFieldIds = this.databases.getAssetTagFieldIds(databaseFields);
    const rowIdForCreate = !isUpdateMode && assetTagFieldIds.length ? randomUUID() : null;
    const sanitizedWithAssetTags = rowIdForCreate
      ? this.databases.applyAssetTagValues(sanitized, assetTagFieldIds, rowIdForCreate)
      : sanitized;
    if (database.complianceMode) {
      const { workflowVersionId, schemaVersionId } = await this.databases.ensureComplianceVersions(database, databaseFields, user);
      if (!workflowVersionId || !schemaVersionId) {
        throw new Error('Compliance workflow or schema is not configured.');
      }
      if (isUpdateMode) {
        const row = existingRow;
        if (!row) throw new NotFoundException('Row not found');
        const existing = existingData || {};
        const recordId =
          typeof existing[COMPLIANCE_RECORD_KEY] === 'string' ? (existing[COMPLIANCE_RECORD_KEY] as string) : '';
        if (!isUuid(recordId)) {
          throw new Error('Compliance record ID is missing for this row.');
        }
        const reason = typeof payload?.reason === 'string' ? payload.reason.trim() : '';
        if (!reason) {
          throw new BadRequestException('Reason is required for compliance amendments.');
        }
        const dataForAmend = assetTagFieldIds.length
          ? this.databases.applyAssetTagValuesFromExisting(sanitized, assetTagFieldIds, existing, row.id)
          : sanitized;
        await this.compliance.amendRecord(recordId, { data: dataForAmend, reason, schemaVersionId }, user);
        const mergedData = { ...existing, ...sanitized, [COMPLIANCE_RECORD_KEY]: recordId };
        const updated = await this.databases.updateDatabaseRow(row.id, { data: mergedData }, user);
        let complianceStatus: string | null = null;
        let transitionError = '';
        if (transitionStatus) {
          try {
            const result = await this.compliance.transitionRecord(
              recordId,
              {
                toStatus: transitionStatus,
                reviewerId: userId || undefined,
                approverId: userId || undefined,
                reason,
              },
              user
            );
            complianceStatus = result?.status ?? null;
          } catch (err) {
            transitionError = (err instanceof Error && err.message) || 'Failed to transition governance status.';
          }
        }
        const updatedRow = (updated as any)?.row ? (updated as any).row : updated;
        const rowWithStatus = complianceStatus ? { ...updatedRow, complianceStatus } : updatedRow;
        if ((updated as any)?.row) {
          return {
            ...(updated as any),
            row: rowWithStatus,
            ...(transitionError ? { transitionError } : {}),
          };
        }
        return transitionError ? { row: rowWithStatus, transitionError } : rowWithStatus;
      }
      const result = await this.compliance.submitRecord(
        {
          workspaceId: database.workspaceId,
          databaseId: database.id,
          workflowVersionId,
          schemaVersionId,
          initialStatus: config?.initialStatus,
          data: sanitizedWithAssetTags,
        },
        user
      );
      const recordId = result?.record?.id;
      const dataWithCompliance = recordId
        ? { ...sanitizedWithAssetTags, [COMPLIANCE_RECORD_KEY]: recordId }
        : sanitizedWithAssetTags;
      return this.databases.createDatabaseRow(database.pageId, { data: dataWithCompliance }, user, rowIdForCreate ? { rowId: rowIdForCreate } : {});
    }
    if (isUpdateMode) {
      const row = existingRow;
      if (!row) throw new NotFoundException('Row not found');
      const existing = existingData || {};
      const mergedData = { ...existing, ...sanitized };
      return this.databases.updateDatabaseRow(row.id, { data: mergedData }, user);
    }
    return this.databases.createDatabaseRow(database.pageId, { data: sanitizedWithAssetTags }, user, rowIdForCreate ? { rowId: rowIdForCreate } : {});
  }
}
