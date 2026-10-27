import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpException, HttpStatus, Param, Patch, Post, Put, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { Request, Response } from 'express';
import { LoginRateLimiter } from '../auth/login-rate-limiter';
import { isUuid } from '../utils/uuid.util';
import { PageAccessService } from './page-access.service';
import { CollabSyncService } from './collab-sync.service';
import { WikiService } from './wiki.service';
import { PagesService } from './pages.service';
import { DatabasesService } from './databases.service';
import { DatabaseFormsService } from './database-forms.service';
import { DatabaseViewsService } from './database-views.service';
import { WorkspacesService } from './workspaces.service';
import { UsersService } from './users.service';
import { PdfService } from '../pdf/pdf.service';
import { HtmlExportService } from '../export/html-export.service';
import { AdminId, AuthUser, CurrentUser, CurrentUserId, CurrentUserName } from '../auth/auth.guard';
import { AllowPendingPasswordChange, Public } from '../auth/public.decorator';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '../auth/session.util';

function pickDefined(source: Record<string, any>, keys: string[]): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}

@Controller()
export class PagesController {
  constructor(
    private readonly access: PageAccessService,
    private readonly collabSync: CollabSyncService,
    private readonly wiki: WikiService,
    private readonly pages: PagesService,
    private readonly databases: DatabasesService,
    private readonly databaseForms: DatabaseFormsService,
    private readonly databaseViews: DatabaseViewsService,
    private readonly workspaces: WorkspacesService,
    private readonly users: UsersService,
    private readonly pdfService: PdfService,
    private readonly htmlExportService: HtmlExportService,
    private readonly loginLimiter: LoginRateLimiter,
  ) {}

  @Get('pages')
  listPages(
    @Query('workspaceId') workspaceId?: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
    @Query('includeDeleted') includeDeleted?: string,
    @Query('state') state?: string,
  ) {
    return this.pages.listPages({
      workspaceId,
      userId,
      userName,
      includeDeleted: includeDeleted === 'true',
      state,
    });
  }

  @Get('pages/:id/export/pdf')
  async exportPagePdf(
    @Param('id') id: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
    @Query('theme') theme?: string,
    @Query('scale') scale?: string,
  ): Promise<StreamableFile> {
    // The id becomes part of the address the PDF browser opens, so only accept a real page id
    if (!isUuid(id)) throw new BadRequestException('Invalid page id');
    const pdf = await this.pdfService.generatePagePdf(id, userId, userName, theme, scale ? parseFloat(scale) : undefined);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="${encodeURIComponent(id)}.pdf"`,
    });
  }

  @Post('export/html')
  async exportHtml(
    @CurrentUser() user: AuthUser,
    @Body('rootPageId') rootPageId?: string,
    @Body('workspaceId') workspaceId?: string,
    @Body('mode') mode?: string,
    @Body('excludeIds') excludeIds?: string[],
  ): Promise<StreamableFile> {
    const actor = { userId: user.id, userName: user.displayName };
    const exportWorkspace = !!workspaceId && !rootPageId;
    let sourceWorkspaceId: string;
    if (exportWorkspace) {
      await this.access.ensureWorkspaceReadAccess(workspaceId!, actor);
      sourceWorkspaceId = workspaceId!;
    } else {
      if (!rootPageId) throw new BadRequestException('rootPageId or workspaceId is required');
      const { page } = await this.access.ensurePageReadAccess(rootPageId, actor);
      sourceWorkspaceId = page.workspaceId;
    }
    // Leave out pages this user can't open, such as other people's private pages.
    const hidden = await this.access.listHiddenPageIds(sourceWorkspaceId, user.id);
    const exportMode = mode === 'pages' ? 'pages' : 'scroll';
    const excluded = Array.isArray(excludeIds) ? excludeIds.filter((id) => typeof id === 'string') : [];
    const opts = { mode: exportMode as 'scroll' | 'pages', excludeIds: [...excluded, ...hidden] };
    const result = exportWorkspace
      ? await this.htmlExportService.exportWorkspace(sourceWorkspaceId, opts)
      : await this.htmlExportService.exportPageTree(rootPageId!, opts);
    return new StreamableFile(Buffer.from(result.html, 'utf-8'), {
      type: 'text/html; charset=utf-8',
      disposition: `attachment; filename="${encodeURIComponent(result.filename)}"`,
    });
  }

  @Get('pages/:id')
  getPage(
    @Param('id') id: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    return this.pages.getPage(id, { userId, userName });
  }

  @Put('pages/:id/content')
  updatePageContent(
    @Param('id') id: string,
    @Body('content') content: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    return this.pages.updatePageContent(id, content ?? null, { userId, userName });
  }

  @Patch('pages/reorder')
  reorderPages(
    @Body('parentId') parentId: string | null,
    @Body('orderedIds') orderedIds: string[],
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    return this.pages.reorderSiblings({ parentId: parentId ?? null, orderedIds }, { userId, userName });
  }

  @Patch('pages/:id')
  updatePage(
    @Param('id') id: string,
    @Body('title') title: string,
    @Body('icon') icon?: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    const nextTitle = typeof title === 'string' ? title : undefined;
    const nextIcon = typeof icon === 'string' ? icon : undefined;
    return this.pages.updatePage(id, { title: nextTitle, icon: nextIcon }, { userId, userName });
  }

  @Patch('pages/:id/workspace')
  movePageToWorkspace(
    @Param('id') id: string,
    @Body('targetWorkspaceId') targetWorkspaceId: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    return this.pages.movePageToWorkspace(id, targetWorkspaceId, { userId, userName });
  }

  @Patch('pages/:id/visibility')
  updatePageVisibility(
    @Param('id') id: string,
    @Body('visibility') visibility: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    return this.pages.updatePageVisibility(id, visibility, { userId, userName });
  }

  @Patch('pages/:id/setup')
  updatePageSetup(
    @Param('id') id: string,
    @Body('kind') kind: any,
    @Body('setupStatus') setupStatus: any,
    @Body('complianceMode') complianceMode: any,
    @Body('database') database: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    const nextCompliance = typeof complianceMode === 'boolean' ? complianceMode : undefined;
    return this.pages.updatePageSetup(
      id,
      { kind, setupStatus, complianceMode: nextCompliance, database },
      { userId, userName }
    );
  }

  @Post('pages/:id/wiki')
  convertPageToWiki(
    @Param('id') id: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    return this.wiki.convertPageToWiki(id, { userId, userName });
  }
  @Get('pages/:id/blocks')
  listBlocks(@Param('id') id: string, @CurrentUserId() userId?: string, @CurrentUserName() userName?: string) {
    return this.pages.listBlocksForPage(id, { userId, userName });
  }

  @Post('pages/:id/blocks')
  createBlock(
    @Param('id') pageId: string,
    @Body() body: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    return this.pages.createBlock(pageId, body, { userId, userName });
  }

  @Post('pages')
  createPage(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.pages.createPage({ ...body, userId: user.id, userName: user.displayName });
  }

  @Get('pages/:id/database')
  getDatabase(
    @Param('id') pageId: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    return this.databases.getDatabase(pageId, { userId, userName });
  }

  @Patch('pages/:id/database')
  updateDatabase(
    @Param('id') pageId: string,
    @Body('complianceMode') complianceMode: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    const next = typeof complianceMode === 'boolean' ? complianceMode : undefined;
    return this.databases.updateDatabaseSettings(pageId, { complianceMode: next }, { userId, userName });
  }

  @Post('pages/:id/database/fields')
  createDatabaseField(
    @Param('id') pageId: string,
    @Body() body: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    return this.databases.createDatabaseField(pageId, body, { userId, userName });
  }

  @Patch('database-fields/:id')
  updateDatabaseField(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    const data: any = pickDefined(body, ['type', 'options', 'position']);
    if (typeof body.name === 'string') data.name = body.name;
    return this.databases.updateDatabaseField(id, data, { userId, userName });
  }

  @Delete('database-fields/:id')
  deleteDatabaseField(@Param('id') id: string, @CurrentUserId() userId?: string, @CurrentUserName() userName?: string) {
    return this.databases.deleteDatabaseField(id, { userId, userName });
  }

  @Post('pages/:id/database/rows')
  createDatabaseRow(
    @Param('id') pageId: string,
    @Body() body: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    return this.databases.createDatabaseRow(pageId, body, { userId, userName });
  }

  @Post('pages/:id/database/forms')
  createDatabaseForm(
    @Param('id') pageId: string,
    @Body() body: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    return this.databaseForms.createDatabaseForm(pageId, body, { userId, userName });
  }

  @Patch('database-forms/:id')
  updateDatabaseForm(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    const data: any = pickDefined(body, ['fields', 'config', 'position']);
    if (typeof body.name === 'string') data.name = body.name;
    if (typeof body.icon === 'string') data.icon = body.icon;
    return this.databaseForms.updateDatabaseForm(id, data, { userId, userName });
  }

  @Get('database-forms/:id')
  getDatabaseForm(
    @Param('id') id: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    return this.databaseForms.getDatabaseForm(id, { userId, userName });
  }

  @Delete('database-forms/:id')
  deleteDatabaseForm(
    @Param('id') id: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    return this.databaseForms.deleteDatabaseForm(id, { userId, userName });
  }

  @Post('pages/:id/database/views')
  createDatabaseView(
    @Param('id') pageId: string,
    @Body() body: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    return this.databaseViews.createDatabaseView(pageId, body, { userId, userName });
  }

  @Patch('database-views/:id')
  updateDatabaseView(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    const data: any = pickDefined(body, ['config', 'position']);
    if (typeof body.name === 'string') data.name = body.name;
    if (typeof body.type === 'string') data.type = body.type;
    if (typeof body.icon === 'string') data.icon = body.icon;
    return this.databaseViews.updateDatabaseView(id, data, { userId, userName });
  }

  @Delete('database-views/:id')
  deleteDatabaseView(
    @Param('id') id: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    return this.databaseViews.deleteDatabaseView(id, { userId, userName });
  }

  @Post('database-forms/:id/submit')
  submitDatabaseForm(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    const data = body?.data !== undefined ? body.data : undefined;
    const rowId = typeof body?.rowId === 'string' ? body.rowId : undefined;
    const reason = typeof body?.reason === 'string' ? body.reason : undefined;
    return this.databaseForms.submitDatabaseForm(id, { data, rowId, reason }, { userId, userName });
  }

  @Patch('database-rows/:id')
  updateDatabaseRow(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    return this.databases.updateDatabaseRow(id, pickDefined(body, ['data', 'position']), { userId, userName });
  }

  @Get('database-rows/:id/backlinks')
  getDatabaseRowBacklinks(
    @Param('id') id: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    return this.databases.getDatabaseRowBacklinks(id, { userId, userName });
  }

  @Post('database-rows/:id/page')
  ensureDatabaseRowPage(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    const title = typeof body.title === 'string' ? body.title : undefined;
    const pageId = typeof body.pageId === 'string' ? body.pageId : undefined;
    const data = body.data !== undefined ? body.data : undefined;
    const position = body.position !== undefined ? body.position : undefined;
    return this.databases.ensureDatabaseRowPage(id, { title, pageId, data, position }, { userId, userName });
  }

  @Delete('database-rows/:id')
  deleteDatabaseRow(@Param('id') id: string, @CurrentUserId() userId?: string, @CurrentUserName() userName?: string) {
    return this.databases.deleteDatabaseRow(id, { userId, userName });
  }

  @Delete('pages/:id')
  deletePage(@Param('id') id: string, @CurrentUserId() userId?: string, @CurrentUserName() userName?: string) {
    return this.pages.deletePage(id, { userId, userName });
  }

  @Patch('pages/:id/restore')
  restorePage(
    @Param('id') id: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
    @Body('placement') placement?: 'withParents' | 'topLevel'
  ) {
    return this.pages.restorePage(id, { userId, userName }, { placement });
  }

  @Delete('pages')
  destroyPages(@Body('ids') ids: string[], @CurrentUserId() userId?: string, @CurrentUserName() userName?: string) {
    return this.pages.destroyPages(ids, { userId, userName });
  }

  @Public()
  @Post('auth/login')
  async login(
    @Body('login') login: string | undefined,
    @Body('email') email: string | undefined,
    @Body('password') password: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // `login` is an email or a username; `email` is the older name for it.
    const name = login ?? email ?? '';
    // The client's address, as passed on by Wikid's own proxies (see TRUST_PROXY_HOPS in main.ts)
    const address = req.ip || req.socket.remoteAddress || 'unknown';
    try {
      this.loginLimiter.check(name, address);
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
        res.setHeader('Retry-After', String((err.getResponse() as { retryAfter: number }).retryAfter));
      }
      throw err;
    }
    let result: Awaited<ReturnType<UsersService['loginWithCredentials']>>;
    try {
      result = await this.users.loginWithCredentials(name, password);
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === HttpStatus.UNAUTHORIZED) {
        this.loginLimiter.recordFailure(name, address);
      }
      throw err;
    }
    this.loginLimiter.recordSuccess(name, address);
    res.cookie(SESSION_COOKIE, signSession(result.user.id), sessionCookieOptions());
    return result;
  }

  @Public()
  @Post('auth/logout')
  logout(@Res({ passthrough: true }) res: Response) {
    const { maxAge: _maxAge, ...options } = sessionCookieOptions();
    res.clearCookie(SESSION_COOKIE, options);
    return { ok: true };
  }

  @Get('auth/me')
  me(@CurrentUser() user: AuthUser) {
    return { user };
  }

  @Get('users/:id')
  getUser(
    @Param('id') id: string,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    return this.users.getUserProfile(id, { userId, userName });
  }

  @Patch('users/:id/preferences')
  updateUserPreferences(
    @Param('id') id: string,
    @Body('preferences') preferences: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    return this.users.updateUserPreferences(id, preferences, { userId, userName });
  }

  @Put('users/:id/password')
  @AllowPendingPasswordChange()
  changePassword(
    @Param('id') id: string,
    @Body('currentPassword') currentPassword: string,
    @Body('newPassword') newPassword: string,
    @CurrentUser() user: AuthUser,
  ) {
    if (id !== user.id) throw new ForbiddenException('You can only change your own password');
    return this.users.changePassword(id, currentPassword, newPassword);
  }

  // Admin user management
  @Get('admin/users')
  listUsers(@AdminId() adminId?: string) {
    return this.users.listUsers(adminId);
  }

  @Post('admin/users')
  adminCreateUser(
    @AdminId() adminId: string,
    @Body('displayName') displayName: string,
    @Body('email') email: string,
    @Body('password') password: string,
    @Body('username') username?: string,
    @Body('mustChangePassword') mustChangePassword?: boolean,
  ) {
    return this.users.adminCreateUser(adminId, { displayName, email, password, username, mustChangePassword });
  }

  @Patch('admin/users/:id')
  adminUpdateUser(
    @Param('id') id: string,
    @AdminId() adminId: string,
    @Body('displayName') displayName?: string,
    @Body('email') email?: string,
    @Body('username') username?: string | null,
  ) {
    return this.users.adminUpdateUser(adminId, id, { displayName, email, username });
  }

  @Post('admin/users/:id/reset-password')
  adminResetPassword(
    @Param('id') id: string,
    @AdminId() adminId: string,
    @Body('newPassword') newPassword: string,
    @Body('mustChangePassword') mustChangePassword?: boolean,
  ) {
    return this.users.adminResetPassword(adminId, id, newPassword, mustChangePassword);
  }

  @Delete('admin/users/:id')
  adminDeleteUser(@Param('id') id: string, @AdminId() adminId: string) {
    return this.users.adminDeleteUser(adminId, id);
  }

  @Patch('blocks/:id')
  updateBlock(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUserId() userId?: string,
    @CurrentUserName() userName?: string,
  ) {
    const data: any = pickDefined(body, ['props', 'position', 'type']);
    if (typeof body.content === 'string') data.content = body.content;
    return this.pages.updateBlock(id, data, { userId, userName });
  }

  // Collab: issue JWT for Hocuspocus
  @Post('collab/token')
  issueCollabToken(@CurrentUser() user: AuthUser, @Body('workspaceId') workspaceId?: string) {
    return this.collabSync.issueCollabToken({ userId: user.id, userName: user.displayName, workspaceId });
  }

  // Admin: list non-personal workspaces
  @Get('workspaces')
  listWorkspaces(@CurrentUserId() userId?: string, @CurrentUserName() userName?: string, @AdminId() adminId?: string) {
    return this.workspaces.listWorkspaces(userId, userName, adminId);
  }

  @Post('workspaces')
  createWorkspace(@CurrentUser() user: AuthUser, @Body('name') name?: string) {
    return this.workspaces.createWorkspace({ name, userId: user.id, userName: user.displayName });
  }

  @Patch('workspaces/:id')
  updateWorkspace(
    @Param('id') id: string,
    @Body('name') name: string,
    @CurrentUserId() userId: string,
  ) {
    return this.workspaces.updateWorkspace(id, { name }, userId);
  }

  @Delete('workspaces/:id')
  deleteWorkspace(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.workspaces.deleteWorkspace(id, userId);
  }

  // Admin: list members of a workspace
  @Get('workspaces/:id/members')
  listWorkspaceMembers(
    @Param('id') workspaceId: string,
    @CurrentUserId() userId?: string,
    @AdminId() adminId?: string,
  ) {
    return this.workspaces.listWorkspaceMembers(userId, workspaceId, adminId);
  }

  // Add or update a member by email or username (role optional, defaults to EDITOR)
  @Post('workspaces/:id/members')
  addWorkspaceMember(
    @Param('id') workspaceId: string,
    @Body('login') login?: string,
    @Body('email') email?: string,
    @Body('userId') userId?: string,
    @Body('role') role?: any,
    @CurrentUserId() requesterId?: string,
    @AdminId() adminId?: string,
  ) {
    return this.workspaces.addWorkspaceMember(requesterId, workspaceId, { login: login ?? email, userId, role }, adminId);
  }

  // Admin: change role
  @Patch('workspaces/:id/members/:userId')
  updateWorkspaceMember(
    @Param('id') workspaceId: string,
    @Param('userId') memberId: string,
    @Body('role') role: any,
    @CurrentUserId() requesterId?: string,
    @AdminId() adminId?: string,
  ) {
    return this.workspaces.updateWorkspaceMemberRole(requesterId, workspaceId, memberId, role, adminId);
  }

  // Admin: remove member
  @Delete('workspaces/:id/members/:userId')
  removeWorkspaceMember(
    @Param('id') workspaceId: string,
    @Param('userId') memberId: string,
    @CurrentUserId() requesterId?: string,
    @AdminId() adminId?: string,
  ) {
    return this.workspaces.removeWorkspaceMember(requesterId, workspaceId, memberId, adminId);
  }

  // Admin: reset all workspaces, documents, and regenerate personal workspaces
  @Post('workspaces/admin/reset')
  resetAllWorkspaces(@Body('confirm') confirm: string, @AdminId() adminId?: string) {
    return this.workspaces.resetAllWorkspaces(adminId, confirm);
  }
}
