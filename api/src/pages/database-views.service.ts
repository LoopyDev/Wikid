import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PageAccessService } from './page-access.service';
import { DatabasesService } from './databases.service';
import { POSITION_INCREMENT, normalizeFormIcon } from './pages.shared';

// Database views (table, gallery, board): their type, filters, sorts and grouping.
@Injectable()
export class DatabaseViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PageAccessService,
    private readonly databases: DatabasesService,
  ) {}

  private readonly DEFAULT_VIEW_ICON = 'icon:table';
  private readonly VIEW_TYPES = ['TABLE', 'GALLERY', 'BOARD'];
  private readonly VIEW_FILTER_OPERATORS = [
    'is',
    'is_not',
    'contains',
    'not_contains',
    'is_empty',
    'is_not_empty',
    'gt',
    'gte',
    'lt',
    'lte',
    'before',
    'after',
    'on_or_before',
    'on_or_after',
    'is_checked',
    'is_unchecked',
  ];

  private normalizeViewType(value: unknown) {
    const upper = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return this.VIEW_TYPES.includes(upper) ? upper : 'TABLE';
  }

  private async nextDatabaseViewPosition(databaseId: string) {
    const last = await this.prisma.databaseView.findFirst({
      where: { databaseId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return last?.position ? last.position.plus(POSITION_INCREMENT) : POSITION_INCREMENT;
  }

  private async sanitizeDatabaseViewConfig(databaseId: string, config: unknown) {
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId },
      select: { id: true },
    });
    const fieldIds = new Set(fields.map((f) => f.id));
    const source = config && typeof config === 'object' && !Array.isArray(config) ? (config as Record<string, any>) : {};

    const rawFilters = source.filters && typeof source.filters === 'object' ? source.filters : {};
    const match = rawFilters.match === 'OR' ? 'OR' : 'AND';
    const rules = Array.isArray(rawFilters.rules)
      ? rawFilters.rules
          .filter((rule: any) => rule && typeof rule === 'object' && fieldIds.has(rule.fieldId))
          .filter((rule: any) => this.VIEW_FILTER_OPERATORS.includes(rule.operator))
          .map((rule: any) => ({
            fieldId: rule.fieldId as string,
            operator: rule.operator as string,
            // Value is arbitrary JSON (string/number/boolean/array); default to null.
            value: rule.value === undefined ? null : rule.value,
          }))
          .slice(0, 50)
      : [];

    const sorts = Array.isArray(source.sorts)
      ? source.sorts
          .filter((sort: any) => sort && typeof sort === 'object' && fieldIds.has(sort.fieldId))
          .map((sort: any) => ({
            fieldId: sort.fieldId as string,
            direction: sort.direction === 'desc' ? 'desc' : 'asc',
          }))
          .slice(0, 20)
      : [];

    const hiddenFieldIds = Array.isArray(source.hiddenFieldIds)
      ? source.hiddenFieldIds.filter((id: any) => typeof id === 'string' && fieldIds.has(id))
      : [];

    const groupFieldId = fieldIds.has(source.groupFieldId) ? (source.groupFieldId as string) : null;
    const cardFieldId = fieldIds.has(source.cardFieldId) ? (source.cardFieldId as string) : null;

    return {
      filters: { match, rules },
      sorts,
      hiddenFieldIds,
      groupFieldId,
      cardFieldId,
    };
  }

  async createDatabaseView(
    pageId: string,
    payload: { name?: string; type?: string; icon?: string; config?: unknown; position?: Prisma.Decimal },
    user?: { userId?: string; userName?: string }
  ) {
    const database = await this.databases.getDatabaseForPage(pageId, user, { requireWrite: true });
    const rawName = typeof payload.name === 'string' ? payload.name.trim() : '';
    const name = rawName || 'View';
    const type = this.normalizeViewType(payload.type);
    const icon = normalizeFormIcon(payload.icon) || this.DEFAULT_VIEW_ICON;
    const position = payload.position ?? (await this.nextDatabaseViewPosition(database.id));
    const config = await this.sanitizeDatabaseViewConfig(database.id, payload.config);
    return this.prisma.databaseView.create({
      data: {
        databaseId: database.id,
        name,
        type,
        icon,
        config,
        position,
      },
    });
  }

  async updateDatabaseView(
    id: string,
    payload: { name?: string; type?: string; icon?: string; config?: unknown; position?: Prisma.Decimal },
    user?: { userId?: string; userName?: string }
  ) {
    const view = await this.prisma.databaseView.findUnique({
      where: { id },
      select: { id: true, databaseId: true },
    });
    if (!view) throw new NotFoundException('View not found');
    const database = await this.prisma.database.findUnique({
      where: { id: view.databaseId },
      select: { pageId: true },
    });
    if (!database) throw new NotFoundException('Database not found');
    await this.access.requirePageAccess(database.pageId, user, { requireWrite: true });
    const updateData: Prisma.DatabaseViewUpdateInput = {};
    if (typeof payload.name === 'string') {
      updateData.name = payload.name.trim() || 'View';
    }
    if (payload.type !== undefined) {
      updateData.type = this.normalizeViewType(payload.type);
    }
    if (payload.icon !== undefined) {
      updateData.icon = normalizeFormIcon(payload.icon) || this.DEFAULT_VIEW_ICON;
    }
    if (payload.position !== undefined) {
      updateData.position = payload.position;
    }
    if (payload.config !== undefined) {
      updateData.config = await this.sanitizeDatabaseViewConfig(view.databaseId, payload.config);
    }
    return this.prisma.databaseView.update({
      where: { id },
      data: updateData,
    });
  }

  async deleteDatabaseView(id: string, user?: { userId?: string; userName?: string }) {
    const view = await this.prisma.databaseView.findUnique({
      where: { id },
      select: { id: true, databaseId: true },
    });
    if (!view) throw new NotFoundException('View not found');
    const database = await this.prisma.database.findUnique({
      where: { id: view.databaseId },
      select: { pageId: true },
    });
    if (!database) throw new NotFoundException('Database not found');
    await this.access.requirePageAccess(database.pageId, user, { requireWrite: true });
    return this.prisma.databaseView.delete({ where: { id: view.id } });
  }
}
