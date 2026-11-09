import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CollabMaterializerService } from '../collab/collab-materializer.service';
import { PageVersionRecorder } from '../collab/page-version-recorder.service';
import { PageAccessService } from './page-access.service';
import { PageContentService } from './page-content.service';
import { PagesService } from './pages.service';
import { normalizeEditorContent } from './editor-doc.util';
import { isUuid } from '../utils/uuid.util';

type User = { userId?: string; userName?: string };

// Page history: listing a page's versions, showing one, and restoring one. Versions are noted
// as the page is saved, by PageVersionRecorder.
@Injectable()
export class PageHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PageAccessService,
    private readonly materializer: CollabMaterializerService,
    private readonly recorder: PageVersionRecorder,
    private readonly pageContent: PageContentService,
    private readonly pages: PagesService,
  ) {}

  // One restore of a page at a time: two at once would each change the page from the same starting
  // point, and could put the same blocks in twice
  private readonly restoring = new Map<string, Promise<unknown>>();

  async listVersions(pageId: string, user: User) {
    await this.access.ensurePageReadAccess(pageId, user);
    const versions = await this.prisma.pageVersion.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, editorIds: true, restoredFromId: true, createdAt: true, updatedAt: true },
    });
    const names = await this.userNames(versions.flatMap((version) => version.editorIds));
    return versions.map(({ editorIds, ...version }) => ({
      ...version,
      editors: editorIds.map((id) => ({ id, name: names.get(id) ?? null })),
    }));
  }

  async getVersion(pageId: string, versionId: string, user: User) {
    await this.access.ensurePageReadAccess(pageId, user);
    const version = await this.findVersion(pageId, versionId);
    const names = await this.userNames(version.editorIds);
    const { editorIds, ...rest } = version;
    return { ...rest, editors: editorIds.map((id) => ({ id, name: names.get(id) ?? null })) };
  }

  /**
   * Puts a version back: its content onto the page (into the live document, as a change, so everyone
   * with it open sees it at once) and its title, and starts a version holding it. Edits not saved yet
   * are saved first, so the version before the restore has them.
   */
  async restoreVersion(pageId: string, versionId: string, user: User) {
    const previous = this.restoring.get(pageId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.restoreNow(pageId, versionId, user));
    this.restoring.set(pageId, run);
    try {
      return await run;
    } finally {
      if (this.restoring.get(pageId) === run) this.restoring.delete(pageId);
    }
  }

  private async restoreNow(pageId: string, versionId: string, user: User) {
    const { page } = await this.access.ensurePageWriteAccess(pageId, user);
    const version = await this.findVersion(pageId, versionId);
    await this.materializer.flushLiveDocuments([`ws:${page.workspaceId}:${pageId}`]);
    await this.recorder.settled(pageId);
    const restored = await this.prisma.pageVersion.create({
      data: {
        pageId,
        title: version.title,
        content: version.content as Prisma.InputJsonValue,
        editorIds: user.userId && isUuid(user.userId) ? [user.userId] : [],
        restoredFromId: version.id,
      },
      select: { id: true, content: true },
    });
    // The title first, so the content's save is recorded with it
    if (typeof version.title === 'string' && version.title !== (await this.currentTitle(pageId))) {
      // Into the live document, then as any rename (a database row's name too)
      await this.pageContent.replaceTitle(pageId, version.title, user);
      await this.pages.updatePage(pageId, { title: version.title }, user);
    }
    await this.pageContent.replaceContent(pageId, normalizeEditorContent(version.content).content as any, user);
    return { versionId: restored.id, content: restored.content };
  }

  private async currentTitle(pageId: string) {
    return (await this.prisma.page.findUnique({ where: { id: pageId }, select: { title: true } }))?.title ?? null;
  }

  private async findVersion(pageId: string, versionId: string) {
    if (!isUuid(versionId)) throw new BadRequestException('Invalid version id');
    const version = await this.prisma.pageVersion.findFirst({
      where: { id: versionId, pageId },
      select: { id: true, title: true, content: true, editorIds: true, restoredFromId: true, createdAt: true, updatedAt: true },
    });
    if (!version) throw new NotFoundException('Version not found');
    return version;
  }

  private async userNames(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, displayName: true } });
    return new Map(users.map((u) => [u.id, u.displayName]));
  }
}
