import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isUuid } from '../utils/uuid.util';
import { planVersion } from './page-versions.util';

// Notes each save of a page in its history, by the rules in page-versions.util.ts
@Injectable()
export class PageVersionRecorder {
  constructor(private readonly prisma: PrismaService) {}

  // One save of a page at a time, so two arriving together don't both start a version
  private readonly recording = new Map<string, Promise<void>>();

  /** Notes a save of the page: into its newest version, or as a new one. Never throws. */
  async recordVersion(pageId: string, change: { title?: string | null; content: Prisma.InputJsonValue; editorIds?: string[] }, now = new Date()) {
    const previous = this.recording.get(pageId) ?? Promise.resolve();
    const next = previous.then(() => this.record(pageId, change, now)).catch((err) => {
      console.warn('Page history: could not record a version', { pageId, error: (err as Error)?.message || err });
    });
    this.recording.set(pageId, next);
    await next;
    if (this.recording.get(pageId) === next) this.recording.delete(pageId);
  }

  private async record(pageId: string, change: { title?: string | null; content: Prisma.InputJsonValue; editorIds?: string[] }, now: Date) {
    if (!isUuid(pageId)) return;
    const editorIds = [...new Set((change.editorIds ?? []).filter(isUuid))];
    const latest = await this.prisma.pageVersion.findFirst({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, content: true, editorIds: true, createdAt: true, updatedAt: true },
    });
    const title = change.title ?? latest?.title ?? (await this.prisma.page.findUnique({ where: { id: pageId }, select: { title: true } }))?.title ?? '';
    const plan = planVersion(latest, { title, content: change.content, editorIds }, now);
    if (plan.kind === 'update') {
      await this.prisma.pageVersion.update({ where: { id: plan.id }, data: { ...plan.data, content: change.content } });
    } else if (plan.kind === 'create') {
      await this.prisma.pageVersion.create({ data: { pageId, ...plan.data, content: change.content } });
    }
  }

  /** Once the saves of the page already arriving are noted. */
  async settled(pageId: string) {
    await (this.recording.get(pageId) ?? Promise.resolve());
  }
}
