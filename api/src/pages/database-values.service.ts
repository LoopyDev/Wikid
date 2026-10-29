import { Injectable } from '@nestjs/common';
import { Prisma, DatabaseFieldType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isUuid } from '../utils/uuid.util';
import { coerceCellValue, coerceRelationValue } from '../utils/cell-values.util';
import { DatabaseSetupService } from './database-setup.service';

// Field options and the values stored in database rows and forms: normalises and
// type-checks them so rows only hold values their fields accept.
@Injectable()
export class DatabaseValuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly databaseSetup: DatabaseSetupService,
  ) {}

  private normalizeDatabaseFieldOptions(options: Prisma.JsonValue | null | undefined) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      return { choices: null as { value: string; color?: string | null }[] | null, choiceValues: null as string[] | null };
    }
    const rawChoices = (options as any).choices;
    const choices = Array.isArray(rawChoices)
      ? rawChoices
          .map((choice) => {
            if (typeof choice === 'string') {
              const value = choice.trim();
              return value ? { value, color: null } : null;
            }
            if (choice && typeof choice === 'object') {
              const value = typeof (choice as any).value === 'string' ? (choice as any).value.trim() : '';
              if (!value) return null;
              const color = typeof (choice as any).color === 'string' ? (choice as any).color.trim() : null;
              return { value, color: color || null };
            }
            return null;
          })
          .filter((choice): choice is NonNullable<typeof choice> => !!choice)
      : null;
    const choiceValues = choices ? choices.map((choice) => choice.value) : null;
    return { ...(options as Record<string, any>), choices, choiceValues };
  }

  coerceRelationValue(value: any, allowMultiple: boolean) {
    return coerceRelationValue(value, allowMultiple);
  }

  coerceDatabaseFieldValue(field: { type: DatabaseFieldType; options?: Prisma.JsonValue | null }, value: any) {
    const options = this.normalizeDatabaseFieldOptions(field.options ?? null);
    const relation =
      field.type === DatabaseFieldType.RELATION ? this.databaseSetup.normalizeRelationOptions(field.options ?? null) : null;
    const allowMultiple =
      field.type === DatabaseFieldType.PERSON ? (options as any).allowMultiple === true : relation ? relation.allowMultiple : null;
    return coerceCellValue({ type: field.type, choiceValues: options.choiceValues, allowMultiple }, value);
  }

  normalizeDatabaseFormStorage(raw: Prisma.InputJsonValue) {
    if (Array.isArray(raw)) {
      return { fields: raw, config: null };
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const fields = Array.isArray((raw as any).fields) ? (raw as any).fields : [];
      const config =
        (raw as any).config && typeof (raw as any).config === 'object' && !Array.isArray((raw as any).config)
          ? (raw as any).config
          : null;
      return { fields, config };
    }
    return { fields: [], config: null };
  }

  async sanitizeDatabaseFormFields(databaseId: string, rawFields: Prisma.InputJsonValue) {
    const rawList = Array.isArray(rawFields)
      ? rawFields
      : rawFields && typeof rawFields === 'object' && !Array.isArray(rawFields)
        ? (rawFields as any).fields
        : null;
    if (!Array.isArray(rawList)) return [];
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId },
      select: { id: true, type: true, options: true },
    });
    const fieldMap = new Map(fields.map((field) => [field.id, field]));
    const allowed = new Set(fields.map((field) => field.id));
    const seen = new Set<string>();
    const normalized: Array<{
      fieldId: string;
      label: string | null;
      required: boolean;
      editable: boolean;
      auto?: any;
      selectSource?: { type: string; relationFieldId: string; targetFieldId: string };
      requiredWhen?: { fieldId: string; op: string; value?: any };
      visibleWhen?: { fieldId: string; op: string; value?: any };
      noFuture?: boolean;
    }> = [];
    const relationTargetCache = new Map<string, Set<string> | null>();
    const resolveRelationTargetFields = async (pageId: string) => {
      if (relationTargetCache.has(pageId)) return relationTargetCache.get(pageId) || null;
      const targetDatabase = await this.prisma.database.findUnique({
        where: { pageId },
        select: { id: true },
      });
      if (!targetDatabase?.id) {
        relationTargetCache.set(pageId, null);
        return null;
      }
      const targetFields = await this.prisma.databaseField.findMany({
        where: { databaseId: targetDatabase.id },
        select: { id: true },
      });
      const fieldIds = new Set(targetFields.map((field) => field.id));
      relationTargetCache.set(pageId, fieldIds);
      return fieldIds;
    };
    const normalizeAuto = (
      raw: unknown,
      fieldId: string,
      selectSource?: { type: string } | null
    ) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const type = typeof (raw as any).type === 'string' ? (raw as any).type.trim() : '';
      if (type === 'template') {
        const template = typeof (raw as any).template === 'string' ? (raw as any).template.trim() : '';
        return template ? { type, template } : null;
      }
      if (type === 'currentUser') {
        const mode = typeof (raw as any).mode === 'string' ? (raw as any).mode.trim() : '';
        if (mode === 'id' || mode === 'name') {
          return { type, mode };
        }
        return { type };
      }
      // A date field filled in with the day the form is submitted
      if (type === 'today') {
        return fieldMap.get(fieldId)?.type === DatabaseFieldType.DATE ? { type } : null;
      }
      if (type === 'fixed') {
        const value = typeof (raw as any).value === 'string' ? (raw as any).value.trim() : '';
        if (!value) return null;
        const field = fieldMap.get(fieldId);
        if (!field || (field.type !== DatabaseFieldType.SELECT && field.type !== DatabaseFieldType.RELATION)) {
          return null;
        }
        if (field.type === DatabaseFieldType.RELATION) {
          return isUuid(value) ? { type, value } : null;
        }
        if (selectSource?.type === 'relation') return { type, value };
        const choices = this.normalizeDatabaseFieldOptions(field.options ?? null).choiceValues;
        if (!choices || !choices.includes(value)) return null;
        return { type, value };
      }
      return null;
    };
    const normalizeSelectSource = async (raw: unknown, fieldId: string) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const type = typeof (raw as any).type === 'string' ? (raw as any).type.trim() : '';
      if (type !== 'relation') return null;
      const relationFieldId =
        typeof (raw as any).relationFieldId === 'string' ? (raw as any).relationFieldId.trim() : '';
      const targetFieldId = typeof (raw as any).targetFieldId === 'string' ? (raw as any).targetFieldId.trim() : '';
      if (!relationFieldId || !targetFieldId) return null;
      const field = fieldMap.get(fieldId);
      if (!field || field.type !== DatabaseFieldType.SELECT) return null;
      const relationField = fieldMap.get(relationFieldId);
      if (!relationField || relationField.type !== DatabaseFieldType.RELATION) return null;
      const relation = this.databaseSetup.normalizeRelationOptions(relationField.options ?? null);
      if (!relation?.pageId) return null;
      const targetFieldIds = await resolveRelationTargetFields(relation.pageId);
      if (!targetFieldIds || !targetFieldIds.has(targetFieldId)) return null;
      return { type, relationFieldId, targetFieldId };
    };
    const normalizeRequiredWhen = (raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const rawFieldId = typeof (raw as any).fieldId === 'string' ? (raw as any).fieldId.trim() : '';
      if (!rawFieldId || !allowed.has(rawFieldId)) return null;
      const op = typeof (raw as any).op === 'string' ? (raw as any).op.trim() : 'equals';
      if (op === 'isFilled' || op === 'isEmpty') {
        const field = fieldMap.get(rawFieldId);
        if (!field) return null;
        return { fieldId: rawFieldId, op };
      }
      if (op !== 'equals' && op !== 'isAnyOf') return null;
      const field = fieldMap.get(rawFieldId);
      if (!field || field.type !== DatabaseFieldType.SELECT) return null;
      if (op === 'isAnyOf') {
        // Several of the select's choices, any of which meets the condition
        const list = Array.isArray((raw as any).value) ? (raw as any).value : [(raw as any).value];
        const values = [...new Set(list.map((item: unknown) => this.coerceDatabaseFieldValue(field, item)))].filter(
          (item): item is string => typeof item === 'string'
        );
        return values.length ? { fieldId: rawFieldId, op, value: values } : null;
      }
      const value = this.coerceDatabaseFieldValue(field, (raw as any).value);
      if (typeof value !== 'string') return null;
      return { fieldId: rawFieldId, op, value };
    };
    const normalizeVisibleWhen = (raw: unknown) => normalizeRequiredWhen(raw);
    for (const entry of rawList) {
      let fieldId = '';
      let label: string | null = null;
      let required = false;
      let editable = true;
      let auto: { type: string; template?: string; mode?: string } | null = null;
      let selectSource: { type: string; relationFieldId: string; targetFieldId: string } | null = null;
      let requiredWhen: { fieldId: string; op: string; value?: any } | null = null;
      let visibleWhen: { fieldId: string; op: string; value?: any } | null = null;
      let noFuture = false;
      if (typeof entry === 'string') {
        fieldId = entry.trim();
      } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const rawFieldId = (entry as any).fieldId ?? (entry as any).id;
        if (typeof rawFieldId === 'string') {
          fieldId = rawFieldId.trim();
        }
        if (typeof (entry as any).label === 'string') {
          const nextLabel = (entry as any).label.trim();
          label = nextLabel ? nextLabel : null;
        }
        if (typeof (entry as any).required === 'boolean') {
          required = (entry as any).required;
        }
        if (typeof (entry as any).editable === 'boolean') {
          editable = (entry as any).editable;
        }
        selectSource = await normalizeSelectSource((entry as any).selectSource, fieldId);
        auto = normalizeAuto((entry as any).auto, fieldId, selectSource);
        requiredWhen = normalizeRequiredWhen((entry as any).requiredWhen);
        visibleWhen = normalizeVisibleWhen((entry as any).visibleWhen);
        // A date that can't be later than the day it's entered
        noFuture = (entry as any).noFuture === true && fieldMap.get(fieldId)?.type === DatabaseFieldType.DATE;
      }
      if (!fieldId || !allowed.has(fieldId) || seen.has(fieldId)) {
        continue;
      }
      seen.add(fieldId);
      const extra = noFuture ? { noFuture } : {};
      if (auto) {
        const base = { fieldId, label, required, editable, auto, ...extra };
        const withSource = selectSource ? { ...base, selectSource } : base;
        const withRequired = requiredWhen ? { ...withSource, requiredWhen } : withSource;
        normalized.push(visibleWhen ? { ...withRequired, visibleWhen } : withRequired);
      } else {
        const base = { fieldId, label, required, editable, ...extra };
        const withSource = selectSource ? { ...base, selectSource } : base;
        const withRequired = requiredWhen ? { ...withSource, requiredWhen } : withSource;
        normalized.push(visibleWhen ? { ...withRequired, visibleWhen } : withRequired);
      }
    }
    return normalized;
  }
}
