import { BadRequestException, Controller, ForbiddenException, Get, Headers, NotFoundException, Post, Put, Query, Body } from '@nestjs/common';
import { CollabService } from './collab.service';
import { assertSystemAdmin } from '../utils/assert-admin.util';

@Controller('collab')
export class CollabController {
  constructor(private readonly collabService: CollabService) {}

  private readonly PURGE_CONFIRM_TEXT = 'PURGE ALL DOCUMENTS';

  private assertSecret(authHeader?: string) {
    const secret = process.env.COLLAB_API_SECRET;
    if (!secret) {
      throw new ForbiddenException('Collab API secret not configured');
    }
    const token = (authHeader || '').replace(/^Bearer\s+/i, '').trim();
    if (!token || token !== secret) {
      throw new ForbiddenException('Invalid collab API secret');
    }
  }

  @Get('docs')
  async getDoc(@Query('documentName') documentName: string, @Headers('authorization') authHeader?: string) {
    this.assertSecret(authHeader);
    if (!documentName) {
      throw new BadRequestException('documentName is required');
    }
    const result = await this.collabService.fetchState(documentName);
    if (!result?.state) {
      throw new NotFoundException('Document not found');
    }
    return { state: result.state.toString('base64') };
  }

  @Put('docs')
  async putDoc(@Body('documentName') documentName: string, @Body('state') state: string, @Headers('authorization') authHeader?: string) {
    this.assertSecret(authHeader);
    if (!documentName || typeof documentName !== 'string') {
      throw new BadRequestException('documentName is required');
    }
    if (!state || typeof state !== 'string') {
      throw new BadRequestException('state is required');
    }
    const buffer = Buffer.from(state, 'base64');
    await this.collabService.storeState(documentName, buffer);
    return { ok: true };
  }

  @Post('docs/materialize')
  async requestMaterialize(@Body('documentName') documentName: string, @Headers('authorization') authHeader?: string) {
    this.assertSecret(authHeader);
    if (!documentName || typeof documentName !== 'string') {
      throw new BadRequestException('documentName is required');
    }
    await this.collabService.requestMaterialize(documentName);
    return { ok: true };
  }

  @Get('admin/docs')
  async listDocs(@Query('adminId') adminId?: string) {
    assertSystemAdmin(adminId);
    return this.collabService.listDocs();
  }

  @Post('admin/materialize')
  async requestAdminMaterialize(@Body('documentName') documentName: string, @Query('adminId') adminId?: string) {
    assertSystemAdmin(adminId);
    if (!documentName || typeof documentName !== 'string') {
      throw new BadRequestException('documentName is required');
    }
    await this.collabService.requestMaterialize(documentName);
    return { ok: true };
  }

  @Post('admin/purge')
  async purgeAllDocs(@Body('confirm') confirm: string, @Query('adminId') adminId?: string) {
    assertSystemAdmin(adminId);
    if (!confirm || typeof confirm !== 'string') {
      throw new BadRequestException('confirm is required');
    }
    if (confirm.trim() !== this.PURGE_CONFIRM_TEXT) {
      throw new BadRequestException(`confirm must match "${this.PURGE_CONFIRM_TEXT}"`);
    }
    const deleted = await this.collabService.purgeAllDocs();
    return { ok: true, deleted };
  }
}
