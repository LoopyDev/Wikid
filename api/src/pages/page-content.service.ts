import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import * as Y from 'yjs';
import { PrismaService } from '../prisma/prisma.service';
import { CollabMaterializerService } from '../collab/collab-materializer.service';
import { PageVersionRecorder } from '../collab/page-version-recorder.service';
import { contentUpdateForState, normalizeCollabDocState } from '../collab/collab-doc.util';
import { PageAccessService } from './page-access.service';
import { CollabSyncService } from './collab-sync.service';
import { normalizeEditorContent } from './editor-doc.util';
import type { ContentNode } from './markdown/markdown-to-content.util';
import {
  BlockOperationError,
  contentToMarkdown,
  deleteBlock,
  insertBlocks,
  markdownUnits,
  replaceAll,
  updateBlock,
} from './markdown/content-to-markdown.util';

type User = { userId?: string; userName?: string };
type DocPage = { id: string; workspaceId: string; title: string };

// A page's content from outside the editor: read as it is now, and changed so that everyone with
// the page open sees it. Once a page has been opened, its live document is what it holds; the
// stored copy (Page.content) only catches up every few minutes, so a change written there alone
// was lost.
@Injectable()
export class PageContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PageAccessService,
    private readonly materializer: CollabMaterializerService,
    private readonly collabSync: CollabSyncService,
    private readonly versions: PageVersionRecorder,
  ) {}

  private documentName(page: DocPage) {
    return `ws:${page.workspaceId}:${page.id}`;
  }

  private async docPage(pageId: string, user: User, write: boolean, markdown = true): Promise<DocPage> {
    const { page } = write ? await this.access.ensurePageWriteAccess(pageId, user) : await this.access.ensurePageReadAccess(pageId, user);
    if (markdown && page.kind !== 'DOC') throw new BadRequestException('Only document pages have Markdown content; a database has rows');
    const { title } = await this.prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { title: true } });
    return { id: page.id, workspaceId: page.workspaceId, title };
  }

  /** The page's content now: its live document's, saved first if it's open, or the stored copy. */
  private async current(page: DocPage): Promise<{ content: ContentNode[]; state: Uint8Array | null }> {
    const name = this.documentName(page);
    await this.materializer.flushLiveDocuments([name]);
    const record = await this.prisma.collabDoc.findUnique({ where: { documentName: name }, select: { state: true } });
    if (record?.state) {
      const { normalized } = await normalizeCollabDocState(record.state);
      return { content: normalized.content as ContentNode[], state: record.state };
    }
    const stored = await this.prisma.page.findUniqueOrThrow({ where: { id: page.id }, select: { content: true } });
    return { content: normalizeEditorContent(stored.content ?? null).content as ContentNode[], state: null };
  }

  /**
   * Pages moving to another workspace take their live documents with them: saved now (with what's
   * on screen), then renamed for the new workspace. Their names include the workspace, so under a new
   * name they'd start again from the stored copy, which can be minutes behind.
   */
  async moveLiveDocuments(pageIds: string[], fromWorkspaceId: string, toWorkspaceId: string) {
    const names = pageIds.flatMap((id) => [`ws:${fromWorkspaceId}:${id}`, `ws:${fromWorkspaceId}:db:${id}`]);
    await this.materializer.flushLiveDocuments(names);
    const from = `ws:${fromWorkspaceId}:`;
    const rename = (name: string) => `ws:${toWorkspaceId}:${name.slice(from.length)}`;
    await this.prisma.$transaction(async (tx) => {
      const docs = await tx.collabDoc.findMany({ where: { documentName: { in: names } }, select: { documentName: true } });
      if (!docs.length) return;
      await tx.collabDoc.deleteMany({ where: { documentName: { in: docs.map((doc) => rename(doc.documentName)) } } });
      for (const doc of docs) {
        await tx.collabDoc.update({ where: { documentName: doc.documentName }, data: { documentName: rename(doc.documentName) } });
      }
    });
  }

  /** Writes new content: into the live document if the page has one, and the stored copy. */
  private async write(page: DocPage, content: ContentNode[], state: Uint8Array | null, user: User) {
    const normalized = normalizeEditorContent({ type: 'doc', content });
    if (state) {
      const name = this.documentName(page);
      const update = contentUpdateForState(state, normalized.content);
      const pushed = await this.collabSync.pushContentUpdate(name, update, user.userId);
      if (!pushed) {
        // The collab server isn't there: nobody has the page open, so the stored state is it
        const record = await this.prisma.collabDoc.findUnique({ where: { documentName: name }, select: { state: true, updatedAt: true } });
        if (!record) throw new ConflictException('The page changed meanwhile; try again');
        const doc = new Y.Doc();
        Y.applyUpdate(doc, new Uint8Array(record.state));
        Y.applyUpdate(doc, contentUpdateForState(record.state, normalized.content));
        const saved = await this.prisma.collabDoc.updateMany({
          where: { documentName: name, updatedAt: record.updatedAt },
          data: { state: new Uint8Array(Y.encodeStateAsUpdate(doc)) },
        });
        if (!saved.count) throw new ConflictException('The page changed meanwhile; try again');
      }
    }
    await this.prisma.page.update({ where: { id: page.id }, data: { content: normalized as unknown as Prisma.InputJsonValue } });
    await this.versions.recordVersion(page.id, { title: page.title, content: normalized as unknown as Prisma.InputJsonValue, editorIds: user.userId ? [user.userId] : [] });
    return normalized.content as ContentNode[];
  }

  private view(page: DocPage, content: ContentNode[]) {
    return {
      id: page.id,
      title: page.title,
      markdown: contentToMarkdown(content),
      // The same, each block preceded by a comment with its id, for a tool to change it by id
      annotated: contentToMarkdown(content, { sections: true, markers: true }),
      blocks: markdownUnits(content),
    };
  }

  /** Content written by the API as page JSON (PUT /pages/:id/content). */
  async replaceContent(pageId: string, content: ContentNode[], user: User) {
    const page = await this.docPage(pageId, user, true, false);
    const { state } = await this.current(page);
    return this.write(page, content, state, user);
  }

  /** A page's content as it is now (its live document's, if it has one), for copying it. */
  async readContent(pageId: string, user: User) {
    const page = await this.docPage(pageId, user, false);
    return (await this.current(page)).content;
  }

  async getMarkdown(pageId: string, user: User) {
    const page = await this.docPage(pageId, user, false);
    const { content } = await this.current(page);
    return this.view(page, content);
  }

  /** Changes the page's content with one of the block operations, as Markdown in and out. */
  async change(pageId: string, user: User, operation: (content: ContentNode[]) => ContentNode[]) {
    const page = await this.docPage(pageId, user, true);
    const { content, state } = await this.current(page);
    let next: ContentNode[];
    try {
      next = operation(content);
    } catch (err) {
      if (err instanceof BlockOperationError) throw new BadRequestException(err.message);
      throw err;
    }
    return this.view(page, await this.write(page, next, state, user));
  }

  replaceMarkdown(pageId: string, markdown: string, user: User) {
    return this.change(pageId, user, (content) => replaceAll(content, markdown));
  }

  insertMarkdown(pageId: string, markdown: string, where: { afterId?: string; beforeId?: string }, user: User) {
    return this.change(pageId, user, (content) => insertBlocks(content, markdown, where));
  }

  updateBlockMarkdown(pageId: string, blockId: string, markdown: string, user: User) {
    return this.change(pageId, user, (content) => updateBlock(content, blockId, markdown));
  }

  deleteBlock(pageId: string, blockId: string, user: User) {
    return this.change(pageId, user, (content) => deleteBlock(content, blockId));
  }
}
