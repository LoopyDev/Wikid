import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { extractPageIdFromDocName } from '../utils/collab-doc-name.util';
import { deleteDatabasesWithContents } from '../utils/delete-databases.util';

@Injectable()
export class CollabService {
  constructor(private readonly prisma: PrismaService) {}

  async fetchState(documentName: string) {
    return this.prisma.collabDoc.findUnique({
      where: { documentName },
      select: { state: true },
    });
  }

  async storeState(documentName: string, state: Buffer) {
    return this.prisma.collabDoc.upsert({
      where: { documentName },
      create: { documentName, state },
      update: { state },
    });
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
