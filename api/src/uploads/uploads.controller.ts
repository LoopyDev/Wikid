import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Req, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response as ExpressResponse } from 'express';
import { memoryStorage } from 'multer';
import { Readable } from 'stream';
import { UploadsService } from './uploads.service';
import { PageAccessService } from '../pages/page-access.service';
import { assertSystemAdmin } from '../utils/assert-admin.util';

import { AdminId, CurrentUserId, CurrentUserName } from '../auth/auth.guard';
import { safeFetch } from '../utils/safe-fetch.util';

const MAX_URL_IMAGE_BYTES = 10 * 1024 * 1024;
// Shown in the page as images; anything else (3D scans, a type an image claimed falsely) is served
// as a plain download. All are served sandboxed, so a script in an SVG or a mislabelled file can't
// run on the wiki's address when someone opens its link.
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/heic', 'image/bmp', 'image/svg+xml']);
/** The image type to store an upload as, or null if it isn't one shown in pages. */
const shownImageType = (mime?: string | null) => {
  const type = String(mime || '').split(';')[0].trim().toLowerCase();
  const normalized = type === 'image/jpg' || type === 'image/pjpeg' ? 'image/jpeg' : type;
  return IMAGE_TYPES.has(normalized) ? normalized : null;
};
const UPLOAD_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService, private readonly pageAccess: PageAccessService) {}

  // Saved in the page without the site's name (/api/uploads/...), so it still works when the same
  // pages are served from another address: restored on another machine, or moved to a new domain
  private buildUrl(req: Request, filename: string) {
    const explicitBase = process.env.PUBLIC_API_URL?.trim();
    if (explicitBase) {
      const path = new URL(explicitBase, 'http://localhost').pathname.replace(/\/+$/, '');
      return `${path}/uploads/${filename}`;
    }
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
    // 3D scans by their extension; images by a type pages show
    const isScan = ext === '.spz';
    const imageType = isScan ? null : shownImageType(file.mimetype);
    if (!isScan && !imageType) throw new BadRequestException('Unsupported file type');
    await this.pageAccess.ensurePageWriteAccess(pageId, { userId, userName });
    const uploaded = await this.uploads.uploadImage({
      pageId,
      buffer: file.buffer,
      // A 3D scan is stored as what it is, not as whatever type it was sent with
      contentType: imageType ?? 'application/octet-stream',
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
    // Only public addresses: this runs on the server, which can reach Wikid's own services
    const { response, body: buffer } = await safeFetch(trimmed, { maxBytes: MAX_URL_IMAGE_BYTES });
    const contentType = shownImageType(response.headers.get('content-type'));
    if (!contentType) {
      throw new BadRequestException('URL did not return an image');
    }
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
      const type = shownImageType(result.ContentType);
      const isImage = !!type;
      res?.setHeader('Content-Type', type ?? 'application/octet-stream');
      res?.setHeader('X-Content-Type-Options', 'nosniff');
      res?.setHeader('Content-Security-Policy', UPLOAD_CSP);
      if (!isImage) res?.setHeader('Content-Disposition', 'attachment');
      if (result.ContentLength) {
        res?.setHeader('Content-Length', String(result.ContentLength));
      }
      // An upload's name is unique and its file never changes, so the browser can keep it. Private:
      // only in that person's browser, never in a shared cache.
      res?.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
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
