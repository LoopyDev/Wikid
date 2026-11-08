import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUserId, CurrentUserName } from '../auth/auth.guard';
import { TemplatesService } from './templates.service';

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  // The templates offered in a workspace: { workspace, personal, builtIn }
  @Get()
  list(@Query('workspaceId') workspaceId?: string, @CurrentUserId() userId?: string, @CurrentUserName() userName?: string) {
    return this.templates.list(workspaceId, { userId, userName });
  }

  // A new template: { scope: 'workspace' | 'personal', workspaceId, title?, fromPageId? | fromTemplateId? }
  @Post()
  create(@Body() body: any, @CurrentUserId() userId?: string, @CurrentUserName() userName?: string) {
    return this.templates.create(body ?? {}, { userId, userName });
  }

  // A page made from a template: { workspaceId, parentId? }
  @Post(':id/use')
  use(@Param('id') id: string, @Body() body: any, @CurrentUserId() userId?: string, @CurrentUserName() userName?: string) {
    return this.templates.use(id, body ?? {}, { userId, userName });
  }
}
