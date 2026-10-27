import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Req, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response as ExpressResponse } from 'express';
import { memoryStorage } from 'multer';
import { Readable } from 'stream';
import { UploadsService } from './uploads.service';
import { PageAccessService } from '../pages/page-access.service';
import { assertSystemAdmin } from '../utils/assert-admin.util';

import { AdminId, CurrentUserId, CurrentUserName } from '../auth/auth.guard';
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService, private readonly pageAccess: PageAccessService) {}

  private buildUrl(req: Request, filename: string) {
    const explicitBase = process.env.PUBLIC_API_URL?.trim();
    if (explicitBase) return `${explicitBase.replace(/\/+$/, '')}/uploads/${filename}`;
    const protocol = req.protocol;
    const host = req.get('host');
    return `${protocol}://${host}/uploads/${filename}`;
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: Number(process.env.UPLOAD_MAX_BYTES || 52_428_800) },
    })
  )
  async uploadFile(
    @UploadedFile() file?: Express.Multer.File,
    @Body('pageId') pageId?: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
    @Req() req?: Request
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!pageId) throw new BadRequestException('pageId is required');
    if (!userId) throw new BadRequestException('userId is required');
    const ext = file.originalname ? ('.' + file.originalname.split('.').pop()?.toLowerCase()) : '';
    const isImage = file.mimetype?.startsWith('image/');
    const isAllowedExt = ['.spz'].includes(ext);
    if (!isImage && !isAllowedExt) throw new BadRequestException('Unsupported file type');
    await this.pageAccess.ensurePageWriteAccess(pageId, { userId, userName });
    const uploaded = await this.uploads.uploadImage({
      pageId,
      buffer: file.buffer,
      contentType: file.mimetype,
      originalName: file.originalname,
    });
    return {
      success: 1,
      file: { url: this.buildUrl(req as Request, uploaded.key), key: uploaded.key },
    };
  }

  @Post('by-url')
  async uploadByUrl(
    @Body('url') url?: string,
    @Body('pageId') pageId?: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
    @Req() req?: Request
  ) {
    const trimmed = url?.trim();
    if (!trimmed) throw new BadRequestException('url is required');
    if (!pageId) throw new BadRequestException('pageId is required');
    if (!userId) throw new BadRequestException('userId is required');
    await this.pageAccess.ensurePageWriteAccess(pageId, { userId, userName });
    let response: Response;
    try {
      response = await fetch(trimmed);
    } catch (err) {
      throw new BadRequestException(`Failed to fetch url: ${(err as Error)?.message || 'unknown error'}`);
    }
    if (!response.ok) {
      throw new BadRequestException(`Fetch failed with status ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      throw new BadRequestException('URL did not return an image');
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const uploaded = await this.uploads.uploadImage({
      pageId,
      buffer,
      contentType,
      originalName: trimmed,
    });
    return {
      success: 1,
      file: { url: this.buildUrl(req as Request, uploaded.key), key: uploaded.key },
    };
  }

  @Get(':pageId/:filename')
  async getUpload(
    @Param('pageId') pageId?: string,
    @Param('filename') filename?: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
    @Res({ passthrough: true }) res?: ExpressResponse
  ) {
    if (!pageId || !filename) throw new BadRequestException('Invalid upload path');
    if (!userId) throw new BadRequestException('userId is required');
    await this.pageAccess.ensurePageReadAccess(pageId, { userId, userName });
    const key = `${pageId}/${filename}`;
    try {
      const result = await this.uploads.getObject(key);
      const body = result.Body as Readable;
      if (result.ContentType) {
        res?.setHeader('Content-Type', result.ContentType);
      }
      if (result.ContentLength) {
        res?.setHeader('Content-Length', String(result.ContentLength));
      }
      res?.setHeader('Cache-Control', 'private, max-age=0, no-cache, no-store, must-revalidate');
      return new StreamableFile(body);
    } catch (err) {
      throw new NotFoundException('Upload not found');
    }
  }

  @Post('admin/gc')
  async gcUploads(@AdminId() adminId?: string) {
    assertSystemAdmin(adminId);
    const summary = await this.uploads.garbageCollectUploads();
    return { ok: true, ...summary };
  }
}
