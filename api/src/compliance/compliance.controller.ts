import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ComplianceService } from './compliance.service';

import { CurrentUserId, CurrentUserName } from '../auth/auth.guard';
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Post('workflows')
  createWorkflow(
    @Body() body: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string
  ) {
    return this.compliance.createWorkflowVersion(
      { workspaceId: body.workspaceId, databaseId: body.databaseId, config: body.config },
      { userId, userName }
    );
  }

  @Post('schemas')
  createSchema(
    @Body() body: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string
  ) {
    return this.compliance.createSchemaVersion(
      { workspaceId: body.workspaceId, databaseId: body.databaseId, schema: body.schema },
      { userId, userName }
    );
  }

  @Post('records/submit')
  submitRecord(
    @Body() body: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string
  ) {
    return this.compliance.submitRecord(
      {
        workspaceId: body.workspaceId,
        databaseId: body.databaseId,
        workflowVersionId: body.workflowVersionId,
        schemaVersionId: body.schemaVersionId,
        initialStatus: body.initialStatus,
        data: body.data,
        attachments: body.attachments,
      },
      { userId, userName }
    );
  }

  @Post('records/:id/amend')
  amendRecord(
    @Param('id') recordId: string,
    @Body() body: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string
  ) {
    return this.compliance.amendRecord(
      recordId,
      {
        data: body.data,
        reason: body.reason,
        schemaVersionId: body.schemaVersionId,
        attachments: body.attachments,
      },
      { userId, userName }
    );
  }

  @Post('records/:id/transition')
  transitionRecord(
    @Param('id') recordId: string,
    @Body() body: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string
  ) {
    return this.compliance.transitionRecord(
      recordId,
      {
        toStatus: body.toStatus,
        reviewerId: body.reviewerId,
        approverId: body.approverId,
        reason: body.reason,
      },
      { userId, userName }
    );
  }

  @Get('records/:id')
  getRecord(
    @Param('id') recordId: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
    @Query('logView') logView?: string
  ) {
    const shouldLog = logView !== 'false';
    return this.compliance.getRecord(recordId, { userId, userName }, { logView: shouldLog });
  }

  @Post('records/:id/export')
  exportRecord(
    @Param('id') recordId: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string
  ) {
    return this.compliance.logExport(recordId, { userId, userName });
  }

  @Post('records/:id/legal-hold')
  setLegalHold(
    @Param('id') recordId: string,
    @Body('enabled') enabled: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string
  ) {
    if (typeof enabled !== 'boolean') {
      return this.compliance.getRecord(recordId, { userId, userName }, { logView: false });
    }
    return this.compliance.setLegalHold(recordId, enabled, { userId, userName });
  }

  @Post('records/:id/archive')
  archiveRecord(
    @Param('id') recordId: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string
  ) {
    return this.compliance.archiveRecord(recordId, { userId, userName });
  }

  @Post('retention/sweep')
  runRetentionSweep(
    @Body('workspaceId') workspaceId: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string
  ) {
    return this.compliance.runRetentionSweep({ workspaceId }, { userId, userName });
  }
}
