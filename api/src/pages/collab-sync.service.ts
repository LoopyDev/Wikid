import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma, WorkspaceRole, PageKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { updateCollabTitleState } from '../collab/collab-doc.util';
import {
  CollabFieldChange,
  deleteCollabDatabaseFieldState,
  deleteCollabDatabaseRowState,
  updateCollabDatabaseFieldState,
  updateCollabDatabaseRowState,
} from '../collab/collab-database.util';
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

  /**
   * Tells everyone with the workspace open that pages changed (created, renamed, moved, set up,
   * deleted or restored), so their sidebar and open page catch up. Fire-and-forget: a missing or
   * slow collab server never fails or delays the request that made the change.
   */
  // `deleted` says which page was moved to the Bin (the others in pageIds are its sub-pages) and by
  // whom, so people with one of them open can be told; `restored` marks pages coming back from the Bin.
  announcePagesChanged(
    workspaceId: string | null | undefined,
    pageIds: Array<string | null | undefined>,
    extra?: { deleted?: { pageId: string; byUserId?: string; byName?: string }; restored?: boolean },
  ) {
    if (!this.collabServerUrl || !this.collabApiSecret || !workspaceId) return;
    const ids = Array.from(new Set(pageIds.filter((id): id is string => typeof id === 'string' && !!id)));
    const message = { type: 'pages-changed', workspaceId, pageIds: ids, ...extra };
    fetch(`${this.collabServerUrl}/collab/broadcast`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.collabApiSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ workspaceId, message }),
      signal: AbortSignal.timeout(2000),
    })
      .then((res) => {
        if (!res.ok) console.warn('Collab broadcast failed', { workspaceId, status: res.status });
      })
      .catch((err) => console.warn('Collab broadcast error', { workspaceId, error: (err as Error)?.message || err }));
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

  /**
   * A field (column) created or changed through the API, into the database's live document: its
   * stored state, and the collab server's copy if someone has it open. Without this the next save
   * from the live document deletes a new field and puts back an edited one.
   */
  async syncCollabDatabaseField(
    database: { pageId: string; workspaceId: string },
    field: { id: string; name: string; type: string; options?: Prisma.JsonValue | null }
  ) {
    if (!database?.pageId || !database.workspaceId || !field?.id) return;
    const documentName = `ws:${database.workspaceId}:db:${database.pageId}`;
    const change: CollabFieldChange = {
      id: field.id,
      name: field.name,
      type: field.type,
      options: field.options && typeof field.options === 'object' && !Array.isArray(field.options) ? (field.options as Record<string, any>) : {},
    };
    await this.applyCollabStateUpdate(documentName, (state) => updateCollabDatabaseFieldState(state, change), 'Failed to sync collab db field', {
      fieldId: field.id,
    });
    await this.pushCollab('/collab/push/db-field', { documentName, field: change }, { documentName, fieldId: field.id });
  }

  // A field deleted through the API, out of the live document (or the next save brings it back)
  async deleteCollabDatabaseField(database: { pageId: string; workspaceId: string }, fieldId: string) {
    if (!database?.pageId || !database.workspaceId || !fieldId) return;
    const documentName = `ws:${database.workspaceId}:db:${database.pageId}`;
    await this.applyCollabStateUpdate(documentName, (state) => deleteCollabDatabaseFieldState(state, fieldId), 'Failed to sync collab db field delete', {
      fieldId,
    });
    await this.pushCollab('/collab/push/db-field-delete', { documentName, fieldId }, { documentName, fieldId });
  }

  private async pushCollab(path: string, payload: Record<string, unknown>, context: Record<string, unknown>) {
    if (!this.collabServerUrl || !this.collabApiSecret) return;
    try {
      const res = await fetch(`${this.collabServerUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.collabApiSecret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) console.warn('Collab push failed', { path, ...context, status: res.status });
    } catch (err) {
      console.warn('Collab push error', { path, ...context, error: err });
    }
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
