import { Controller, Get, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/auth.guard';
import { SearchService } from './search.service';

@Controller()
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  // Pages and database rows matching `q`, best first.
  @Get('search')
  async search(@CurrentUser() user: AuthUser, @Query('q') q?: string, @Query('limit') limit?: string) {
    const results = await this.searchService.search(user.id, q ?? '', limit ? Number(limit) || 20 : 20);
    return { results };
  }
}
