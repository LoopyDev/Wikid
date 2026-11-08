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

  // A built-in template hidden in a workspace, or shown again: { workspaceId }. Owners only.
  @Post(':id/hide')
  hide(@Param('id') id: string, @Body() body: any, @CurrentUserId() userId?: string, @CurrentUserName() userName?: string) {
    return this.templates.setHidden(id, body ?? {}, true, { userId, userName });
  }

  @Post(':id/show')
  show(@Param('id') id: string, @Body() body: any, @CurrentUserId() userId?: string, @CurrentUserName() userName?: string) {
    return this.templates.setHidden(id, body ?? {}, false, { userId, userName });
  }

  // A page made from a template: { workspaceId, parentId?, visibility? }, or { pageId } to make a
  // new page that hasn't chosen its type yet from it
  @Post(':id/use')
  use(@Param('id') id: string, @Body() body: any, @CurrentUserId() userId?: string, @CurrentUserName() userName?: string) {
    return this.templates.use(id, body ?? {}, { userId, userName });
  }
}
