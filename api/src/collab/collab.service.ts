import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { initialStateFromContent, normalizeCollabDocState, type CollabState } from './collab-doc.util';
import { collabDocumentTarget } from '../utils/collab-document-target.util';
import { extractPageIdFromDocName, parseDocName } from '../utils/collab-doc-name.util';
import { PageVersionRecorder } from './page-version-recorder.service';
import { deleteDatabasesWithContents } from '../utils/delete-databases.util';

@Injectable()
export class CollabService {
  constructor(private readonly prisma: PrismaService, private readonly versions: PageVersionRecorder) {}

  /**
   * A document's stored state. A page's that has never been stored starts from the page's saved
   * content, made here and stored, so everyone opening it gets the same (see initialStateFromContent).
   */
  async fetchState(documentName: string) {
    const stored = await this.prisma.collabDoc.findUnique({ where: { documentName }, select: { state: true } });
    if (stored) return stored;
    const target = collabDocumentTarget(documentName);
    if (!target || target.type !== 'page' || target.kind !== 'DOC') return null;
    const page = await this.prisma.page.findUnique({
      where: { id: target.pageId },
      select: { workspaceId: true, kind: true, setupStatus: true, title: true, content: true },
    });
    if (!page || page.workspaceId !== target.workspaceId || page.kind !== 'DOC' || page.setupStatus !== 'COMPLETE') return null;
    const state = initialStateFromContent(page.content, page.title);
    if (!state) return null;
    try {
      await this.prisma.collabDoc.create({ data: { documentName, state, materializedAt: new Date() } });
      return { state };
    } catch (err) {
      // Made meanwhile by another request: that one's it. Anything else is a real failure.
      if ((err as { code?: string })?.code !== 'P2002') throw err;
      return this.prisma.collabDoc.findUnique({ where: { documentName }, select: { state: true } });
    }
  }

  async storeState(documentName: string, state: CollabState) {
    return this.prisma.collabDoc.upsert({
      where: { documentName },
      create: { documentName, state },
      update: { state },
    });
  }

  // A saved page goes into its history (databases have none yet)
  async recordPageVersion(documentName: string, state: CollabState, editorIds: string[]) {
    const parsed = parseDocName(documentName);
    if (!parsed?.pageId || parsed.kind !== 'DOC' || parsed.scope !== 'ws') return;
    // History is kept as well as it can be; failing at it never fails the save
    try {
      // Only the history of the page the document belongs to (in the workspace its name says)
      const page = await this.prisma.page.findUnique({ where: { id: parsed.pageId }, select: { workspaceId: true, kind: true } });
      if (!page || page.workspaceId !== parsed.workspaceId || page.kind !== 'DOC') return;
      const { normalized, title } = await normalizeCollabDocState(state);
      await this.versions.recordVersion(parsed.pageId, { title, content: normalized as any, editorIds });
    } catch (err) {
      console.warn('Page history: could not read a saved page', { documentName, error: (err as Error)?.message || err });
    }
  }

  async requestMaterialize(documentName: string) {
    return this.prisma.collabDoc.updateMany({
      where: { documentName },
      data: { materializeRequestedAt: new Date() },
    });
  }

  async listDocs() {
    const docs = await this.prisma.collabDoc.findMany({
      select: {
        documentName: true,
        updatedAt: true,
        materializedAt: true,
        materializeRequestedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    const pageIds = Array.from(
      new Set(
        docs
          .map((doc) => extractPageIdFromDocName(doc.documentName))
          .filter((id): id is string => !!id)
      )
    );
    const pages = pageIds.length
      ? await this.prisma.page.findMany({
          where: { id: { in: pageIds } },
          select: { id: true, title: true },
        })
      : [];
    const pageMap = new Map(pages.map((page) => [page.id, page]));
    return docs.map((doc) => {
      const pageId = extractPageIdFromDocName(doc.documentName);
      const page = pageId ? pageMap.get(pageId) : null;
      return {
        ...doc,
        pageTitle: page?.title ?? null,
      };
    });
  }

  async purgeAllDocs() {
    return this.prisma.$transaction(async (tx) => {
      const databases = await deleteDatabasesWithContents(tx);
      const childBlocks = await tx.block.deleteMany({ where: { parentId: { not: null } } });
      const rootBlocks = await tx.block.deleteMany({ where: { parentId: null } });
      const childPages = await tx.page.deleteMany({ where: { parentId: { not: null } } });
      const rootPages = await tx.page.deleteMany({ where: { parentId: null } });
      const collabDocs = await tx.collabDoc.deleteMany();
      return {
        databaseRows: databases.rows,
        databaseFields: databases.fields,
        databases: databases.databases,
        blocks: childBlocks.count + rootBlocks.count,
        pages: childPages.count + rootPages.count,
        collabDocs: collabDocs.count,
      };
    });
  }
}
