import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma, WorkspaceRole, PageKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { updateCollabTitleState } from '../collab/collab-doc.util';
import { deleteCollabDatabaseRowState, updateCollabDatabaseRowState } from '../collab/collab-database.util';
import jwt from 'jsonwebtoken';
import { PageAccessService } from './page-access.service';

// Keeps live-editing (Hocuspocus) documents in step with changes made through the API,
// and issues the tokens the browser uses to join them.
@Injectable()
export class CollabSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PageAccessService,
  ) {}

  private readonly collabJwtSecret = process.env.COLLAB_JWT_SECRET;
  private readonly collabServerUrl = process.env.COLLAB_SERVER_URL;
  private readonly collabApiSecret = process.env.COLLAB_API_SECRET;

  private async applyCollabStateUpdate(
    documentName: string,
    updater: (state: Buffer) => Buffer | null,
    warnMessage: string,
    warnContext: Record<string, unknown> = {},
  ) {
    try {
      let record = await this.prisma.collabDoc.findUnique({
        where: { documentName },
        select: { state: true, updatedAt: true },
      });
      if (!record?.state) return;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const nextState = updater(record.state);
        if (!nextState) return;
        const res = await this.prisma.collabDoc.updateMany({
          where: { documentName, updatedAt: record.updatedAt },
          data: { state: nextState },
        });
        if (res.count) return;
        record = await this.prisma.collabDoc.findUnique({
          where: { documentName },
          select: { state: true, updatedAt: true },
        });
        if (!record?.state) return;
      }
    } catch (err) {
      console.warn(warnMessage, { documentName, ...warnContext, error: err });
    }
  }

  async updateCollabTitleForPage(
    page: { id: string; workspaceId: string; kind: PageKind },
    title: string
  ) {
    if (!page?.id || !page.workspaceId) return;
    if (page.kind !== PageKind.DOC) return;
    const documentName = `ws:${page.workspaceId}:${page.id}`;
    await this.applyCollabStateUpdate(
      documentName,
      (state) => updateCollabTitleState(state, title),
      'Failed to sync collab title',
    );
  }

  async updateCollabDatabaseRowForPage(
    database: { pageId: string; workspaceId: string },
    row: { id: string; data?: Prisma.InputJsonValue | null; pageId?: string | null }
  ) {
    if (!database?.pageId || !database.workspaceId || !row?.id) return;
    const documentName = `ws:${database.workspaceId}:db:${database.pageId}`;
    await this.applyCollabStateUpdate(
      documentName,
      (state) => updateCollabDatabaseRowState(state, {
        id: row.id,
        data: row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Record<string, any>) : {},
        pageId: row.pageId || null,
      }),
      'Failed to sync collab db row',
      { rowId: row.id },
    );
  }

  async pushCollabDatabaseRowUpdate(
    database: { pageId: string; workspaceId: string },
    row: { id: string; data?: Prisma.InputJsonValue | null; pageId?: string | null }
  ) {
    if (!this.collabServerUrl || !this.collabApiSecret) return;
    if (!database?.pageId || !database.workspaceId || !row?.id) return;
    const documentName = `ws:${database.workspaceId}:db:${database.pageId}`;
    const payload = {
      documentName,
      rowId: row.id,
      data: row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data : {},
      pageId: row.pageId || null,
    };
    try {
      const res = await fetch(`${this.collabServerUrl}/collab/push/db-row`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.collabApiSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.warn('Collab push failed', { documentName, rowId: row.id, status: res.status });
      }
    } catch (err) {
      console.warn('Collab push error', { documentName, rowId: row.id, error: err });
    }
  }

  async pushCollabDatabaseRowDelete(database: { pageId: string; workspaceId: string }, rowId: string) {
    if (!this.collabServerUrl || !this.collabApiSecret) return;
    if (!database?.pageId || !database.workspaceId || !rowId) return;
    const documentName = `ws:${database.workspaceId}:db:${database.pageId}`;
    const payload = { documentName, rowId };
    try {
      const res = await fetch(`${this.collabServerUrl}/collab/push/db-row-delete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.collabApiSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.warn('Collab push delete failed', { documentName, rowId, status: res.status });
      }
    } catch (err) {
      console.warn('Collab push delete error', { documentName, rowId, error: err });
    }
  }

  async deleteCollabDatabaseRowForPage(database: { pageId: string; workspaceId: string }, rowId: string) {
    if (!database?.pageId || !database.workspaceId || !rowId) return;
    const documentName = `ws:${database.workspaceId}:db:${database.pageId}`;
    await this.applyCollabStateUpdate(
      documentName,
      (state) => deleteCollabDatabaseRowState(state, rowId),
      'Failed to sync collab db row delete',
      { rowId },
    );
  }

  async issueCollabToken(payload: { userId?: string; userName?: string; workspaceId?: string }) {
    const { userId, userName, workspaceId } = payload;
    if (!this.collabJwtSecret) {
      throw new Error('COLLAB_JWT_SECRET is not configured on the API');
    }
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    const user = await this.access.ensureUser(userId, userName);
    const memberships = await this.access.getWorkspaceMemberships(user.id);
    const editable = memberships.filter((m) => m.role !== WorkspaceRole.VIEWER).map((m) => m.workspaceId);
    if (!editable.length) {
      throw new ForbiddenException('No workspace access for user');
    }

    let allowedWorkspaces = editable;
    if (workspaceId) {
      if (!editable.includes(workspaceId)) {
        throw new ForbiddenException('User does not have edit access to requested workspace');
      }
      allowedWorkspaces = [workspaceId];
    }

    const token = jwt.sign({ sub: user.id, workspaceIds: allowedWorkspaces }, this.collabJwtSecret, { expiresIn: '12h' });
    return { token, workspaceIds: allowedWorkspaces };
  }
}
