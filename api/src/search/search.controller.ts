import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/auth.guard';
import { SearchService } from './search.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller()
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  // Pages and database rows matching `q`, best first; only those in `workspaceId`, when it's given
  // (one workspace's id: anything else is refused, rather than finding nothing)
  @Get('search')
  async search(@CurrentUser() user: AuthUser, @Query('q') q?: string, @Query('limit') limit?: string, @Query('workspaceId') workspaceId?: unknown) {
    if (workspaceId !== undefined && workspaceId !== '' && (typeof workspaceId !== 'string' || !UUID.test(workspaceId))) {
      throw new BadRequestException('workspaceId must be one workspace id');
    }
    const results = await this.searchService.search(user.id, q ?? '', limit ? Number(limit) || 20 : 20, {
      workspaceId: typeof workspaceId === 'string' && workspaceId ? workspaceId : undefined,
    });
    return { results };
  }
}
