import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma, DatabaseFieldType, PageKind, PageVisibility, PageSetupStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEditorContent } from './editor-doc.util';
import { isUuid } from '../utils/uuid.util';
import { PageAccessService } from './page-access.service';
import { DatabaseSetupService } from './database-setup.service';
import { POSITION_INCREMENT, getFieldSource } from './pages.shared';

// Wikis: turning a page into a wiki home and keeping its pages database in step
// with the pages under it.
@Injectable()
export class WikiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PageAccessService,
    private readonly databaseSetup: DatabaseSetupService,
  ) {}

  async convertPageToWiki(pageId: string, user?: { userId?: string; userName?: string }) {
    const { page } = await this.access.requirePageAccess(pageId, user, { requireWrite: true });
    if (page.kind !== PageKind.DOC) {
      throw new BadRequestException('Only document pages can be wiki homes');
    }
    const wikiHomeId = page.id;
    const descendantIds = await this.access.collectDescendantIds(page.id);
    await this.prisma.page.updateMany({
      where: { id: { in: [page.id, ...descendantIds] } },
      data: { wikiHomeId },
    });

    const databasePage = await this.ensureWikiDatabase(page, user);
    await this.ensureWikiRowsForHome(wikiHomeId);

    const { wikiConfig } = await this.prisma.page.findUniqueOrThrow({ where: { id: page.id }, select: { wikiConfig: true } });
    const existingConfig =
      wikiConfig && typeof wikiConfig === 'object' && !Array.isArray(wikiConfig)
        ? (wikiConfig as Record<string, any>)
        : null;
    const nextConfig = existingConfig
      ? { ...existingConfig, databasePageId: databasePage.id }
      : this.buildWikiConfig(databasePage.id);

    const updated = await this.prisma.page.update({
      where: { id: page.id },
      data: { wikiConfig: nextConfig, wikiHomeId },
    });

    return { page: updated, databasePage };
  }

  private buildWikiConfig(databasePageId: string) {
    return {
      databasePageId,
      views: [
        { id: 'home', name: 'Home', type: 'home' },
        { id: 'all-pages', name: 'All Pages', type: 'table', pageId: databasePageId },
        { id: 'gallery', name: 'Gallery', type: 'gallery' },
      ],
    };
  }

  private getWikiDatabasePageIdFromConfig(config: Prisma.JsonValue | null | undefined) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
    const raw = (config as Record<string, any>).databasePageId;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  }

  private async findWikiDatabasePage(wikiHomeId: string) {
    return this.prisma.page.findFirst({
      where: {
        wikiHomeId,
        kind: PageKind.DATABASE,
        isHidden: true,
        isDeleted: false,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async resolveWikiOwnersFieldId(databaseId: string) {
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId },
      select: { id: true, name: true, options: true, type: true },
    });
    const sourceField = fields.find((field) => getFieldSource(field.options) === 'members');
    if (sourceField) return sourceField.id;
    const byName = fields.find((field) => field.name === 'Owners');
    return byName?.id || null;
  }

  private async resolveWikiDatabasePage(wikiHomeId: string) {
    const home = await this.prisma.page.findUnique({
      where: { id: wikiHomeId },
      select: { wikiConfig: true },
    });
    const configuredId = this.getWikiDatabasePageIdFromConfig(home?.wikiConfig);
    if (configuredId) {
      const configured = await this.prisma.page.findFirst({
        where: { id: configuredId, kind: PageKind.DATABASE, isDeleted: false },
      });
      if (configured) return configured;
    }
    const hidden = await this.findWikiDatabasePage(wikiHomeId);
    if (hidden) return hidden;
    const byTitle = await this.prisma.page.findFirst({
      where: {
        wikiHomeId,
        kind: PageKind.DATABASE,
        isDeleted: false,
        title: 'All Pages',
      },
      orderBy: { createdAt: 'asc' },
    });
    if (byTitle) return byTitle;
    return this.prisma.page.findFirst({
      where: { wikiHomeId, kind: PageKind.DATABASE, isDeleted: false },
      orderBy: { createdAt: 'asc' },
    });
  }

  async resolveWikiHomeIdForDatabasePage(page: { id: string; wikiHomeId: string | null; parentId?: string | null }) {
    if (page.wikiHomeId) return page.wikiHomeId;
    if (page.parentId) {
      const parent = await this.prisma.page.findUnique({
        where: { id: page.parentId },
        select: { id: true, wikiHomeId: true },
      });
      if (parent?.id && parent.id === parent.wikiHomeId) return parent.id;
      if (parent?.wikiHomeId) return parent.wikiHomeId;
    }
    const referrers = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "Page"
      WHERE "wikiConfig"->>'databasePageId' = ${page.id}
      LIMIT 1
    `;
    return referrers?.[0]?.id || null;
  }

  private async seedWikiDatabaseFields(databaseId: string) {
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId },
      orderBy: { position: 'asc' },
    });
    const bySource = (source: string) =>
      fields.find((field) => {
        const options = field.options as Record<string, any> | null;
        return options && typeof options === 'object' && !Array.isArray(options) && options.source === source;
      }) || null;

    const updates: Prisma.PrismaPromise<any>[] = [];
    const pageField = bySource('page') || fields[0] || null;
    if (pageField) {
      updates.push(
        this.prisma.databaseField.update({
          where: { id: pageField.id },
          data: {
            name: 'Page',
            type: DatabaseFieldType.TEXT,
            options: { source: 'page', readonly: true },
            position: 1,
          },
        })
      );
    } else {
      updates.push(
        this.prisma.databaseField.create({
          data: {
            databaseId,
            name: 'Page',
            type: DatabaseFieldType.TEXT,
            options: { source: 'page', readonly: true },
            position: 1,
          },
        })
      );
    }

    const ensureField = (source: string | null, name: string, type: DatabaseFieldType, position: number, options: Record<string, any>) => {
      const existing =
        (source && bySource(source)) ||
        fields.find((field) => field.name === name) ||
        null;
      if (existing) {
        updates.push(
          this.prisma.databaseField.update({
            where: { id: existing.id },
            data: {
              name,
              type,
              options,
              position,
            },
          })
        );
        return;
      }
      updates.push(
        this.prisma.databaseField.create({
          data: {
            databaseId,
            name,
            type,
            options,
            position,
          },
        })
      );
    };

    ensureField('members', 'Owners', DatabaseFieldType.MULTI_SELECT, 2, { source: 'members' });
    ensureField(null, 'Tags', DatabaseFieldType.MULTI_SELECT, 3, { choices: [] });
    ensureField('lastEdited', 'Last edited', DatabaseFieldType.DATE, 4, { source: 'lastEdited', readonly: true });

    if (updates.length) {
      await this.prisma.$transaction(updates);
    }
  }

  private async ensureWikiDatabase(page: { id: string; workspaceId: string; visibility: PageVisibility }, user?: { userId?: string }) {
    let databasePage = await this.findWikiDatabasePage(page.id);
    if (!databasePage) {
      const authorId = isUuid(user?.userId) ? user?.userId : null;
      databasePage = await this.prisma.page.create({
        data: {
          workspaceId: page.workspaceId,
          parentId: page.id,
          wikiHomeId: page.id,
          title: 'All Pages',
          content: normalizeEditorContent(null),
          kind: PageKind.DATABASE,
          visibility: page.visibility,
          setupStatus: PageSetupStatus.COMPLETE,
          authorId,
          isHidden: true,
        },
      });
    }
    const database = await this.prisma.database.findUnique({ where: { pageId: databasePage.id } });
    if (!database) {
      await this.databaseSetup.createDatabaseForPage(databasePage.id, databasePage.workspaceId);
    }
    const refreshedDatabase = await this.prisma.database.findUniqueOrThrow({ where: { pageId: databasePage.id } });
    await this.seedWikiDatabaseFields(refreshedDatabase.id);
    return databasePage;
  }

  async ensureWikiRowForPage(page: { id: string; wikiHomeId: string | null; isDeleted?: boolean; kind?: PageKind; isHidden?: boolean }) {
    if (!page.wikiHomeId) return;
    if (page.wikiHomeId === page.id) return;
    if (page.isDeleted) return;
    if (page.isHidden) return;
    if (page.kind && page.kind !== PageKind.DOC) return;
    const databasePage = await this.resolveWikiDatabasePage(page.wikiHomeId);
    if (!databasePage) return;
    const database = await this.prisma.database.findUnique({ where: { pageId: databasePage.id } });
    if (!database) {
      await this.databaseSetup.createDatabaseForPage(databasePage.id, databasePage.workspaceId);
    }
    const ensuredDatabase = await this.prisma.database.findUniqueOrThrow({ where: { pageId: databasePage.id } });
    await this.seedWikiDatabaseFields(ensuredDatabase.id);
    const position = await this.databaseSetup.nextDatabaseRowPosition(ensuredDatabase.id);
    const ownersFieldId = await this.resolveWikiOwnersFieldId(ensuredDatabase.id);
    const authorId = 'authorId' in page ? (page as { authorId?: string | null }).authorId : null;
    const data =
      ownersFieldId && authorId && isUuid(authorId)
        ? { [ownersFieldId]: [authorId] }
        : {};
    await this.prisma.databaseRow.upsert({
      where: { databaseId_pageId: { databaseId: ensuredDatabase.id, pageId: page.id } },
      update: {},
      create: {
        databaseId: ensuredDatabase.id,
        pageId: page.id,
        data,
        position,
      },
    });
  }

  async ensureWikiRowsForHome(wikiHomeId: string) {
    const databasePage = await this.resolveWikiDatabasePage(wikiHomeId);
    if (!databasePage) return;
    const database = await this.prisma.database.findUnique({ where: { pageId: databasePage.id } });
    if (!database) {
      await this.databaseSetup.createDatabaseForPage(databasePage.id, databasePage.workspaceId);
    }
    const ensuredDatabase = await this.prisma.database.findUniqueOrThrow({ where: { pageId: databasePage.id } });
    await this.seedWikiDatabaseFields(ensuredDatabase.id);
    const pages = await this.prisma.page.findMany({
      where: {
        wikiHomeId,
        isDeleted: false,
        isHidden: false,
        kind: PageKind.DOC,
        NOT: { id: wikiHomeId },
      },
      select: { id: true, authorId: true },
    });
    const ownersFieldId = await this.resolveWikiOwnersFieldId(ensuredDatabase.id);
    const existingRows = await this.prisma.databaseRow.findMany({
      where: { databaseId: ensuredDatabase.id, pageId: { not: null } },
      select: { pageId: true },
    });
    const existingIds = new Set(existingRows.map((row) => row.pageId).filter(Boolean));
    const lastPosition = await this.prisma.databaseRow.findFirst({
      where: { databaseId: ensuredDatabase.id },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    let nextPosition = lastPosition?.position ? lastPosition.position.plus(POSITION_INCREMENT) : POSITION_INCREMENT;
    const rowsToCreate = [];
    for (const page of pages) {
      if (!page.id || existingIds.has(page.id)) continue;
      const data =
        ownersFieldId && page.authorId && isUuid(page.authorId)
          ? { [ownersFieldId]: [page.authorId] }
          : {};
      const position = nextPosition;
      nextPosition = nextPosition.plus(POSITION_INCREMENT);
      rowsToCreate.push(
        this.prisma.databaseRow.create({
          data: {
            databaseId: ensuredDatabase.id,
            pageId: page.id,
            data,
            position,
          },
        })
      );
    }
    if (rowsToCreate.length) {
      await this.prisma.$transaction(rowsToCreate);
    }
  }
}
