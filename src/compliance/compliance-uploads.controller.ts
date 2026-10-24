import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response as ExpressResponse } from 'express';
import { ComplianceUploadsService } from './compliance-uploads.service';
import { ComplianceService } from './compliance.service';

@Controller('compliance')
export class ComplianceUploadsController {
  constructor(
    private readonly uploads: ComplianceUploadsService,
    private readonly compliance: ComplianceService
  ) {}

  @Post('attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: Number(process.env.COMPLIANCE_UPLOAD_MAX_BYTES || process.env.UPLOAD_MAX_BYTES || 52_428_800) },
    })
  )
  async uploadAttachment(
    @UploadedFile() file?: Express.Multer.File,
    @Body('workspaceId') workspaceId?: string,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!workspaceId) throw new BadRequestException('workspaceId is required');
    await this.compliance.ensureWorkspaceAccess(workspaceId, { userId, userName });
    return this.uploads.uploadAttachment({
      buffer: file.buffer,
      contentType: file.mimetype,
      originalName: file.originalname,
    });
  }

  @Get('attachments/:id')
  async downloadAttachment(
    @Param('id') attachmentId: string,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
    @Res({ passthrough: true }) res?: ExpressResponse
  ) {
    const result = await this.compliance.getAttachmentDownload(attachmentId, { userId, userName });
    res?.setHeader('Content-Type', result.contentType);
    res?.setHeader('Content-Length', String(result.buffer.length));
    res?.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res?.setHeader('Cache-Control', 'private, max-age=0, no-cache, no-store, must-revalidate');
    return new StreamableFile(result.buffer);
  }
}
