import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CollabMaterializerService } from '../collab/collab-materializer.service';
import { PageVersionRecorder } from '../collab/page-version-recorder.service';
import { PageAccessService } from './page-access.service';
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
  ) {}

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
   * Starts a version holding the one being restored, and returns its content for the restorer's
   * editor to put on the page (so everyone with it open sees it at once). Edits not saved yet are
   * saved first, so the version before the restore has them.
   */
  async restoreVersion(pageId: string, versionId: string, user: User) {
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
    return { versionId: restored.id, content: restored.content };
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
