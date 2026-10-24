import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import {
  ComplianceAuditEventType,
  ComplianceRecordStatus,
  ComplianceRevisionKind,
  Prisma as CompliancePrisma,
} from '../../prisma/generated/compliance';
import { CompliancePrismaService } from '../prisma/compliance-prisma.service';
import { PrismaService } from '../prisma/prisma.service';
import { ComplianceUploadsService } from './compliance-uploads.service';
import { isUuid } from '../utils/uuid.util';

type UserContext = { userId?: string; userName?: string };

@Injectable()
export class ComplianceService {
  constructor(
    private readonly compliance: CompliancePrismaService,
    private readonly prisma: PrismaService,
    private readonly uploads: ComplianceUploadsService
  ) {}

  async ensureWorkspaceAccess(workspaceId: string, user?: UserContext, requireWrite = true) {
    const userId = user?.userId;
    if (!userId) throw new BadRequestException('userId is required');
    const membership = await this.prisma.userWorkspace.findFirst({
      where: { userId, workspaceId },
      select: { role: true },
    });
    if (!membership) throw new ForbiddenException('Workspace access required');
    if (requireWrite && membership.role === WorkspaceRole.VIEWER) {
      throw new ForbiddenException('Workspace write access required');
    }
    return membership;
  }

  private normalizeRecordStatus(value?: string | null) {
    if (!value) return null;
    const upper = value.trim().toUpperCase();
    const allowed = Object.values(ComplianceRecordStatus);
    return allowed.includes(upper as ComplianceRecordStatus) ? (upper as ComplianceRecordStatus) : null;
  }

  async getRecordStatuses(
    recordIds: string[],
    user?: UserContext,
    options: { workspaceId?: string; databaseId?: string } = {}
  ) {
    const workspaceId = options.workspaceId || '';
    const databaseId = options.databaseId || '';
    const uniqueIds = Array.isArray(recordIds)
      ? Array.from(
          new Set(
            recordIds
              .map((id) => (typeof id === 'string' ? id.trim() : ''))
              .filter((id) => isUuid(id))
          )
        )
      : [];
    if (!uniqueIds.length || !workspaceId || !databaseId) {
      return new Map<string, ComplianceRecordStatus>();
    }
    await this.ensureWorkspaceAccess(workspaceId, user, false);
    const records = await this.compliance.complianceRecord.findMany({
      where: { id: { in: uniqueIds }, workspaceId, sourceDatabaseId: databaseId },
      select: { id: true, status: true },
    });
    return new Map(records.map((record) => [record.id, record.status]));
  }

  async getLatestWorkflowVersion(workspaceId: string, databaseId: string) {
    if (!workspaceId || !databaseId) return null;
    return this.compliance.complianceWorkflowVersion.findFirst({
      where: { workspaceId, sourceDatabaseId: databaseId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getLatestSchemaVersion(workspaceId: string, databaseId: string) {
    if (!workspaceId || !databaseId) return null;
    return this.compliance.complianceSchemaVersion.findFirst({
      where: { workspaceId, sourceDatabaseId: databaseId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async requireWorkflowVersion(workflowVersionId: string, workspaceId: string, databaseId: string) {
    const workflow = await this.compliance.complianceWorkflowVersion.findUnique({ where: { id: workflowVersionId } });
    if (!workflow) throw new NotFoundException('Workflow version not found');
    if (workflow.workspaceId !== workspaceId || workflow.sourceDatabaseId !== databaseId) {
      throw new BadRequestException('Workflow version does not match database');
    }
    return workflow;
  }

  private async requireSchemaVersion(schemaVersionId: string, workspaceId: string, databaseId: string) {
    const schema = await this.compliance.complianceSchemaVersion.findUnique({ where: { id: schemaVersionId } });
    if (!schema) throw new NotFoundException('Schema version not found');
    if (schema.workspaceId !== workspaceId || schema.sourceDatabaseId !== databaseId) {
      throw new BadRequestException('Schema version does not match database');
    }
    return schema;
  }

  private sanitizeAttachmentInputs(
    entries?: Array<{ hash: string; storageKey: string; size: number; mimeType: string; originalName: string }>
  ) {
    if (!Array.isArray(entries)) return [];
    return entries
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const hash = typeof entry.hash === 'string' ? entry.hash.trim() : '';
        const storageKey = typeof entry.storageKey === 'string' ? entry.storageKey.trim() : '';
        const size = Number(entry.size);
        const mimeType = typeof entry.mimeType === 'string' ? entry.mimeType.trim() : '';
        const originalName = typeof entry.originalName === 'string' ? entry.originalName.trim() : '';
        if (!hash || !storageKey || !mimeType || !originalName || !Number.isFinite(size)) return null;
        if (!storageKey.includes(hash)) return null;
        return { hash, storageKey, size, mimeType, originalName };
      })
      .filter(Boolean) as Array<{
      hash: string;
      storageKey: string;
      size: number;
      mimeType: string;
      originalName: string;
    }>;
  }

  async createWorkflowVersion(
    payload: { workspaceId?: string; databaseId?: string; config?: CompliancePrisma.InputJsonValue },
    user?: UserContext
  ) {
    const workspaceId = payload.workspaceId || '';
    const databaseId = payload.databaseId || '';
    if (!workspaceId || !databaseId) throw new BadRequestException('workspaceId and databaseId are required');
    await this.ensureWorkspaceAccess(workspaceId, user);
    if (!payload.config || typeof payload.config !== 'object') {
      throw new BadRequestException('config is required');
    }
    return this.compliance.complianceWorkflowVersion.create({
      data: {
        workspaceId,
        sourceDatabaseId: databaseId,
        config: payload.config,
        createdById: user?.userId || null,
        createdByName: user?.userName || null,
      },
    });
  }

  async createSchemaVersion(
    payload: { workspaceId?: string; databaseId?: string; schema?: CompliancePrisma.InputJsonValue },
    user?: UserContext
  ) {
    const workspaceId = payload.workspaceId || '';
    const databaseId = payload.databaseId || '';
    if (!workspaceId || !databaseId) throw new BadRequestException('workspaceId and databaseId are required');
    await this.ensureWorkspaceAccess(workspaceId, user);
    if (!payload.schema || typeof payload.schema !== 'object') {
      throw new BadRequestException('schema is required');
    }
    return this.compliance.complianceSchemaVersion.create({
      data: {
        workspaceId,
        sourceDatabaseId: databaseId,
        schema: payload.schema,
        createdById: user?.userId || null,
        createdByName: user?.userName || null,
      },
    });
  }

  async submitRecord(
    payload: {
      workspaceId?: string;
      databaseId?: string;
      workflowVersionId?: string;
      schemaVersionId?: string;
      initialStatus?: string;
      data?: CompliancePrisma.InputJsonValue;
      attachments?: Array<{
        hash: string;
        storageKey: string;
        size: number;
        mimeType: string;
        originalName: string;
      }>;
    },
    user?: UserContext
  ) {
    const workspaceId = payload.workspaceId || '';
    const databaseId = payload.databaseId || '';
    const workflowVersionId = payload.workflowVersionId || '';
    const schemaVersionId = payload.schemaVersionId || '';
    if (!workspaceId || !databaseId) throw new BadRequestException('workspaceId and databaseId are required');
    if (!workflowVersionId || !schemaVersionId) {
      throw new BadRequestException('workflowVersionId and schemaVersionId are required');
    }
    await this.ensureWorkspaceAccess(workspaceId, user);
    await this.requireWorkflowVersion(workflowVersionId, workspaceId, databaseId);
    await this.requireSchemaVersion(schemaVersionId, workspaceId, databaseId);

    const data =
      payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? payload.data : {};
    const attachments = this.sanitizeAttachmentInputs(payload.attachments);
    const attachmentHashes = attachments.map((entry) => entry.hash);
    const initialStatus = this.normalizeRecordStatus(payload.initialStatus) || ComplianceRecordStatus.SUBMITTED;
    const creationEvent =
      initialStatus === ComplianceRecordStatus.SUBMITTED ? ComplianceAuditEventType.SUBMIT : ComplianceAuditEventType.CREATE;

    const result = await this.compliance.$transaction(async (tx) => {
      const record = await tx.complianceRecord.create({
        data: {
          workspaceId,
          sourceDatabaseId: databaseId,
          status: initialStatus,
          workflowVersionId,
        },
      });
      const revision = await tx.complianceRecordRevision.create({
        data: {
          recordId: record.id,
          workflowVersionId,
          schemaVersionId,
          kind: ComplianceRevisionKind.SUBMIT,
          data,
          attachmentHashes,
          createdById: user?.userId || null,
          createdByName: user?.userName || null,
        },
      });
      await tx.complianceRecord.update({
        where: { id: record.id },
        data: { latestRevisionId: revision.id },
      });
      if (attachments.length) {
        await tx.complianceAttachment.createMany({
          data: attachments.map((entry) => ({
            recordId: record.id,
            revisionId: revision.id,
            hash: entry.hash,
            storageKey: entry.storageKey,
            size: BigInt(entry.size),
            mimeType: entry.mimeType,
            originalName: entry.originalName,
            uploadedById: user?.userId || null,
            uploadedByName: user?.userName || null,
          })),
        });
      }
      await tx.complianceAuditEvent.create({
        data: {
          recordId: record.id,
          revisionId: revision.id,
          eventType: creationEvent,
          actorId: user?.userId || null,
          actorName: user?.userName || null,
          metadata: { attachmentCount: attachments.length },
        },
      });
      return { record, revision };
    });

    return result;
  }

  async amendRecord(
    recordId: string,
    payload: {
      data?: CompliancePrisma.InputJsonValue;
      reason?: string;
      schemaVersionId?: string;
      attachments?: Array<{
        hash: string;
        storageKey: string;
        size: number;
        mimeType: string;
        originalName: string;
      }>;
    },
    user?: UserContext
  ) {
    if (!recordId) throw new BadRequestException('recordId is required');
    const record = await this.compliance.complianceRecord.findUnique({
      where: { id: recordId },
      select: { id: true, workspaceId: true, sourceDatabaseId: true, workflowVersionId: true, status: true },
    });
    if (!record) throw new NotFoundException('Record not found');
    await this.ensureWorkspaceAccess(record.workspaceId, user);
    if (record.status === ComplianceRecordStatus.ARCHIVED) {
      throw new BadRequestException('Archived records cannot be amended');
    }
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
    if (!reason) throw new BadRequestException('reason is required for amendments');
    const workflowVersionId = record.workflowVersionId || '';
    if (!workflowVersionId) throw new BadRequestException('workflowVersionId is missing on record');
    const schemaVersionId = payload.schemaVersionId || '';
    if (!schemaVersionId) throw new BadRequestException('schemaVersionId is required');
    await this.requireSchemaVersion(schemaVersionId, record.workspaceId, record.sourceDatabaseId);

    const data =
      payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? payload.data : {};
    const attachments = this.sanitizeAttachmentInputs(payload.attachments);
    const attachmentHashes = attachments.map((entry) => entry.hash);

    const result = await this.compliance.$transaction(async (tx) => {
      const revision = await tx.complianceRecordRevision.create({
        data: {
          recordId: record.id,
          workflowVersionId,
          schemaVersionId,
          kind: ComplianceRevisionKind.AMEND,
          data,
          attachmentHashes,
          createdById: user?.userId || null,
          createdByName: user?.userName || null,
          reason,
        },
      });
      await tx.complianceRecord.update({
        where: { id: record.id },
        data: { latestRevisionId: revision.id },
      });
      if (attachments.length) {
        await tx.complianceAttachment.createMany({
          data: attachments.map((entry) => ({
            recordId: record.id,
            revisionId: revision.id,
            hash: entry.hash,
            storageKey: entry.storageKey,
            size: BigInt(entry.size),
            mimeType: entry.mimeType,
            originalName: entry.originalName,
            uploadedById: user?.userId || null,
            uploadedByName: user?.userName || null,
          })),
        });
      }
      await tx.complianceAuditEvent.create({
        data: {
          recordId: record.id,
          revisionId: revision.id,
          eventType: ComplianceAuditEventType.AMEND,
          actorId: user?.userId || null,
          actorName: user?.userName || null,
          metadata: { reason, attachmentCount: attachments.length },
        },
      });
      return revision;
    });

    return result;
  }

  private resolveWorkflowStatus(status: ComplianceRecordStatus) {
    return status.toLowerCase();
  }

  private async requireWorkflowTransition(
    workflowVersionId: string,
    fromStatus: ComplianceRecordStatus,
    toStatus: ComplianceRecordStatus
  ) {
    const workflow = await this.compliance.complianceWorkflowVersion.findUnique({ where: { id: workflowVersionId } });
    if (!workflow) throw new NotFoundException('Workflow version not found');
    const config = workflow.config as any;
    const transitions = Array.isArray(config?.transitions) ? config.transitions : [];
    const from = this.resolveWorkflowStatus(fromStatus);
    const to = this.resolveWorkflowStatus(toStatus);
    const match = transitions.find((entry: any) => entry?.from === from && entry?.to === to);
    if (!match) {
      throw new BadRequestException('Transition not allowed by workflow config');
    }
    return { workflow, transition: match };
  }

  async transitionRecord(
    recordId: string,
    payload: { toStatus?: string; reviewerId?: string; approverId?: string; reason?: string },
    user?: UserContext
  ) {
    if (!recordId) throw new BadRequestException('recordId is required');
    const record = await this.compliance.complianceRecord.findUnique({
      where: { id: recordId },
      select: { id: true, workspaceId: true, status: true, workflowVersionId: true },
    });
    if (!record) throw new NotFoundException('Record not found');
    await this.ensureWorkspaceAccess(record.workspaceId, user);
    const nextStatus = this.normalizeRecordStatus(payload.toStatus);
    if (!nextStatus) throw new BadRequestException('Invalid toStatus');
    if (!record.workflowVersionId) throw new BadRequestException('workflowVersionId is missing on record');
    const { transition } = await this.requireWorkflowTransition(record.workflowVersionId, record.status, nextStatus);
    const guards = Array.isArray(transition?.guards) ? transition.guards : [];
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
    const reviewerId = typeof payload.reviewerId === 'string' ? payload.reviewerId.trim() : '';
    const approverId = typeof payload.approverId === 'string' ? payload.approverId.trim() : '';
    for (const guard of guards) {
      if (!guard || typeof guard !== 'object') continue;
      if (guard.type === 'role' && guard.value === 'reviewer' && !reviewerId) {
        throw new BadRequestException('reviewerId is required for this transition');
      }
      if (guard.type === 'approval' && !approverId) {
        throw new BadRequestException('approverId is required for this transition');
      }
      if (guard.type === 'reason' && !reason) {
        throw new BadRequestException('reason is required for this transition');
      }
    }
    const updated = await this.compliance.complianceRecord.update({
      where: { id: record.id },
      data: { status: nextStatus },
    });
    await this.compliance.complianceAuditEvent.create({
      data: {
        recordId: record.id,
        revisionId: updated.latestRevisionId || null,
        eventType: ComplianceAuditEventType.TRANSITION,
        actorId: user?.userId || null,
        actorName: user?.userName || null,
        metadata: {
          from: record.status,
          to: nextStatus,
          reviewerId: reviewerId || undefined,
          approverId: approverId || undefined,
          reason: reason || undefined,
        },
      },
    });
    return updated;
  }

  async getRecord(recordId: string, user?: UserContext, options: { logView?: boolean } = {}) {
    if (!recordId) throw new BadRequestException('recordId is required');
    const record = await this.compliance.complianceRecord.findUnique({
      where: { id: recordId },
      include: {
        latestRevision: true,
        attachments: true,
      },
    });
    if (!record) throw new NotFoundException('Record not found');
    await this.ensureWorkspaceAccess(record.workspaceId, user, false);
    if (options.logView !== false && record.latestRevisionId) {
      await this.compliance.complianceAuditEvent.create({
        data: {
          recordId: record.id,
          revisionId: record.latestRevisionId,
          eventType: ComplianceAuditEventType.REVISION_VIEW,
          actorId: user?.userId || null,
          actorName: user?.userName || null,
        },
      });
    }
    return record;
  }

  async logExport(recordId: string, user?: UserContext) {
    if (!recordId) throw new BadRequestException('recordId is required');
    const record = await this.compliance.complianceRecord.findUnique({
      where: { id: recordId },
      include: { latestRevision: true, attachments: true },
    });
    if (!record) throw new NotFoundException('Record not found');
    await this.ensureWorkspaceAccess(record.workspaceId, user, false);
    for (const attachment of record.attachments) {
      await this.uploads.getObjectAndVerify({
        key: attachment.storageKey,
        expectedHash: attachment.hash,
      });
    }
    await this.compliance.complianceAuditEvent.create({
      data: {
        recordId: record.id,
        revisionId: record.latestRevisionId,
        eventType: ComplianceAuditEventType.EXPORT,
        actorId: user?.userId || null,
        actorName: user?.userName || null,
      },
    });
    return { exportedAt: new Date().toISOString(), record };
  }

  async setLegalHold(recordId: string, enabled: boolean, user?: UserContext) {
    if (!recordId) throw new BadRequestException('recordId is required');
    const record = await this.compliance.complianceRecord.findUnique({
      where: { id: recordId },
      select: { id: true, workspaceId: true, legalHold: true, latestRevisionId: true },
    });
    if (!record) throw new NotFoundException('Record not found');
    await this.ensureWorkspaceAccess(record.workspaceId, user);
    if (record.legalHold === enabled) {
      return record;
    }
    const updated = await this.compliance.complianceRecord.update({
      where: { id: record.id },
      data: { legalHold: enabled },
    });
    await this.compliance.complianceAuditEvent.create({
      data: {
        recordId: record.id,
        revisionId: record.latestRevisionId,
        eventType: enabled ? ComplianceAuditEventType.LEGAL_HOLD : ComplianceAuditEventType.LEGAL_HOLD_RELEASE,
        actorId: user?.userId || null,
        actorName: user?.userName || null,
      },
    });
    return updated;
  }

  async archiveRecord(recordId: string, user?: UserContext) {
    if (!recordId) throw new BadRequestException('recordId is required');
    const record = await this.compliance.complianceRecord.findUnique({
      where: { id: recordId },
      select: { id: true, workspaceId: true, legalHold: true, latestRevisionId: true },
    });
    if (!record) throw new NotFoundException('Record not found');
    await this.ensureWorkspaceAccess(record.workspaceId, user);
    if (record.legalHold) throw new BadRequestException('Record is under legal hold');
    const updated = await this.compliance.complianceRecord.update({
      where: { id: record.id },
      data: { status: ComplianceRecordStatus.ARCHIVED },
    });
    await this.compliance.complianceAuditEvent.create({
      data: {
        recordId: record.id,
        revisionId: record.latestRevisionId,
        eventType: ComplianceAuditEventType.ARCHIVE,
        actorId: user?.userId || null,
        actorName: user?.userName || null,
      },
    });
    return updated;
  }

  async runRetentionSweep(payload: { workspaceId?: string }, user?: UserContext) {
    const workspaceId = payload.workspaceId || '';
    if (!workspaceId) throw new BadRequestException('workspaceId is required');
    await this.ensureWorkspaceAccess(workspaceId, user);
    return {
      ok: true,
      skipped: true,
      reason: 'indefinite retention',
    };
  }

  async getAttachmentDownload(attachmentId: string, user?: UserContext) {
    if (!attachmentId) throw new BadRequestException('attachmentId is required');
    const attachment = await this.compliance.complianceAttachment.findUnique({
      where: { id: attachmentId },
      include: { record: { select: { workspaceId: true } } },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    await this.ensureWorkspaceAccess(attachment.record.workspaceId, user, false);
    const { buffer, contentType } = await this.uploads.getObjectAndVerify({
      key: attachment.storageKey,
      expectedHash: attachment.hash,
    });
    return { buffer, contentType, filename: attachment.originalName };
  }
}
