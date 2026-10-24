import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { PagesService } from './pages.service';
import { PdfService } from '../pdf/pdf.service';
import { HtmlExportService } from '../export/html-export.service';
import { AuthUser, CurrentUser } from '../auth/auth.guard';
import { Public } from '../auth/public.decorator';
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
    private readonly pagesService: PagesService,
    private readonly pdfService: PdfService,
    private readonly htmlExportService: HtmlExportService,
  ) {}

  @Get('pages')
  listPages(
    @Query('workspaceId') workspaceId?: string,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
    @Query('includeDeleted') includeDeleted?: string,
    @Query('state') state?: string,
  ) {
    return this.pagesService.listPages({
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
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
    @Query('theme') theme?: string,
    @Query('scale') scale?: string,
  ): Promise<StreamableFile> {
    const pdf = await this.pdfService.generatePagePdf(id, userId, userName, theme, scale ? parseFloat(scale) : undefined);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="${encodeURIComponent(id)}.pdf"`,
    });
  }

  @Post('export/html')
  async exportHtml(
    @Body('rootPageId') rootPageId?: string,
    @Body('workspaceId') workspaceId?: string,
    @Body('mode') mode?: string,
    @Body('excludeIds') excludeIds?: string[],
  ): Promise<StreamableFile> {
    const exportMode = mode === 'pages' ? 'pages' : 'scroll';
    const excluded = Array.isArray(excludeIds) ? excludeIds.filter((id) => typeof id === 'string') : [];
    const opts = { mode: exportMode as 'scroll' | 'pages', excludeIds: excluded };
    const result = workspaceId && !rootPageId
      ? await this.htmlExportService.exportWorkspace(workspaceId, opts)
      : await this.htmlExportService.exportPageTree(rootPageId!, opts);
    return new StreamableFile(Buffer.from(result.html, 'utf-8'), {
      type: 'text/html; charset=utf-8',
      disposition: `attachment; filename="${encodeURIComponent(result.filename)}"`,
    });
  }

  @Get('pages/:id')
  getPage(
    @Param('id') id: string,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    return this.pagesService.getPage(id, { userId, userName });
  }

  @Put('pages/:id/content')
  updatePageContent(
    @Param('id') id: string,
    @Body('content') content: any,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    return this.pagesService.updatePageContent(id, content ?? null, { userId, userName });
  }

  @Patch('pages/reorder')
  reorderPages(
    @Body('parentId') parentId: string | null,
    @Body('orderedIds') orderedIds: string[],
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    return this.pagesService.reorderSiblings({ parentId: parentId ?? null, orderedIds }, { userId, userName });
  }

  @Patch('pages/:id')
  updatePage(
    @Param('id') id: string,
    @Body('title') title: string,
    @Body('icon') icon?: string,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    const nextTitle = typeof title === 'string' ? title : undefined;
    const nextIcon = typeof icon === 'string' ? icon : undefined;
    return this.pagesService.updatePage(id, { title: nextTitle, icon: nextIcon }, { userId, userName });
  }

  @Patch('pages/:id/workspace')
  movePageToWorkspace(
    @Param('id') id: string,
    @Body('targetWorkspaceId') targetWorkspaceId: string,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    return this.pagesService.movePageToWorkspace(id, targetWorkspaceId, { userId, userName });
  }

  @Patch('pages/:id/visibility')
  updatePageVisibility(
    @Param('id') id: string,
    @Body('visibility') visibility: any,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    return this.pagesService.updatePageVisibility(id, visibility, { userId, userName });
  }

  @Patch('pages/:id/setup')
  updatePageSetup(
    @Param('id') id: string,
    @Body('kind') kind: any,
    @Body('setupStatus') setupStatus: any,
    @Body('complianceMode') complianceMode: any,
    @Body('database') database: any,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    const nextCompliance = typeof complianceMode === 'boolean' ? complianceMode : undefined;
    return this.pagesService.updatePageSetup(
      id,
      { kind, setupStatus, complianceMode: nextCompliance, database },
      { userId, userName }
    );
  }

  @Post('pages/:id/wiki')
  convertPageToWiki(
    @Param('id') id: string,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    return this.pagesService.convertPageToWiki(id, { userId, userName });
  }
  @Get('pages/:id/blocks')
  listBlocks(@Param('id') id: string, @Query('userId') userId?: string, @Query('userName') userName?: string) {
    return this.pagesService.listBlocksForPage(id, { userId, userName });
  }

  @Post('pages/:id/blocks')
  createBlock(
    @Param('id') pageId: string,
    @Body() body: any,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    return this.pagesService.createBlock(pageId, body, { userId, userName });
  }

  @Post('pages')
  createPage(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.pagesService.createPage({ ...body, userId: user.id, userName: user.displayName });
  }

  @Get('pages/:id/database')
  getDatabase(
    @Param('id') pageId: string,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    return this.pagesService.getDatabase(pageId, { userId, userName });
  }

  @Patch('pages/:id/database')
  updateDatabase(
    @Param('id') pageId: string,
    @Body('complianceMode') complianceMode: any,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    const next = typeof complianceMode === 'boolean' ? complianceMode : undefined;
    return this.pagesService.updateDatabaseSettings(pageId, { complianceMode: next }, { userId, userName });
  }

  @Post('pages/:id/database/fields')
  createDatabaseField(
    @Param('id') pageId: string,
    @Body() body: any,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    return this.pagesService.createDatabaseField(pageId, body, { userId, userName });
  }

  @Patch('database-fields/:id')
  updateDatabaseField(
    @Param('id') id: string,
    @Body() body: any,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    const data: any = pickDefined(body, ['type', 'options', 'position']);
    if (typeof body.name === 'string') data.name = body.name;
    return this.pagesService.updateDatabaseField(id, data, { userId, userName });
  }

  @Delete('database-fields/:id')
  deleteDatabaseField(@Param('id') id: string, @Query('userId') userId?: string, @Query('userName') userName?: string) {
    return this.pagesService.deleteDatabaseField(id, { userId, userName });
  }

  @Post('pages/:id/database/rows')
  createDatabaseRow(
    @Param('id') pageId: string,
    @Body() body: any,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    return this.pagesService.createDatabaseRow(pageId, body, { userId, userName });
  }

  @Post('pages/:id/database/forms')
  createDatabaseForm(
    @Param('id') pageId: string,
    @Body() body: any,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    return this.pagesService.createDatabaseForm(pageId, body, { userId, userName });
  }

  @Patch('database-forms/:id')
  updateDatabaseForm(
    @Param('id') id: string,
    @Body() body: any,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    const data: any = pickDefined(body, ['fields', 'config', 'position']);
    if (typeof body.name === 'string') data.name = body.name;
    if (typeof body.icon === 'string') data.icon = body.icon;
    return this.pagesService.updateDatabaseForm(id, data, { userId, userName });
  }

  @Get('database-forms/:id')
  getDatabaseForm(
    @Param('id') id: string,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    return this.pagesService.getDatabaseForm(id, { userId, userName });
  }

  @Delete('database-forms/:id')
  deleteDatabaseForm(
    @Param('id') id: string,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    return this.pagesService.deleteDatabaseForm(id, { userId, userName });
  }

  @Post('pages/:id/database/views')
  createDatabaseView(
    @Param('id') pageId: string,
    @Body() body: any,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    return this.pagesService.createDatabaseView(pageId, body, { userId, userName });
  }

  @Patch('database-views/:id')
  updateDatabaseView(
    @Param('id') id: string,
    @Body() body: any,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    const data: any = pickDefined(body, ['config', 'position']);
    if (typeof body.name === 'string') data.name = body.name;
    if (typeof body.type === 'string') data.type = body.type;
    if (typeof body.icon === 'string') data.icon = body.icon;
    return this.pagesService.updateDatabaseView(id, data, { userId, userName });
  }

  @Delete('database-views/:id')
  deleteDatabaseView(
    @Param('id') id: string,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    return this.pagesService.deleteDatabaseView(id, { userId, userName });
  }

  @Post('database-forms/:id/submit')
  submitDatabaseForm(
    @Param('id') id: string,
    @Body() body: any,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    const data = body?.data !== undefined ? body.data : undefined;
    const rowId = typeof body?.rowId === 'string' ? body.rowId : undefined;
    const reason = typeof body?.reason === 'string' ? body.reason : undefined;
    return this.pagesService.submitDatabaseForm(id, { data, rowId, reason }, { userId, userName });
  }

  @Patch('database-rows/:id')
  updateDatabaseRow(
    @Param('id') id: string,
    @Body() body: any,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    return this.pagesService.updateDatabaseRow(id, pickDefined(body, ['data', 'position']), { userId, userName });
  }

  @Get('database-rows/:id/backlinks')
  getDatabaseRowBacklinks(
    @Param('id') id: string,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    return this.pagesService.getDatabaseRowBacklinks(id, { userId, userName });
  }

  @Post('database-rows/:id/page')
  ensureDatabaseRowPage(
    @Param('id') id: string,
    @Body() body: any,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    const title = typeof body.title === 'string' ? body.title : undefined;
    const pageId = typeof body.pageId === 'string' ? body.pageId : undefined;
    const data = body.data !== undefined ? body.data : undefined;
    const position = body.position !== undefined ? body.position : undefined;
    return this.pagesService.ensureDatabaseRowPage(id, { title, pageId, data, position }, { userId, userName });
  }

  @Delete('database-rows/:id')
  deleteDatabaseRow(@Param('id') id: string, @Query('userId') userId?: string, @Query('userName') userName?: string) {
    return this.pagesService.deleteDatabaseRow(id, { userId, userName });
  }

  @Delete('pages/:id')
  deletePage(@Param('id') id: string, @Query('userId') userId?: string, @Query('userName') userName?: string) {
    return this.pagesService.deletePage(id, { userId, userName });
  }

  @Patch('pages/:id/restore')
  restorePage(@Param('id') id: string, @Query('userId') userId?: string, @Query('userName') userName?: string) {
    return this.pagesService.restorePage(id, { userId, userName });
  }

  @Delete('pages')
  destroyPages(@Body('ids') ids: string[], @Query('userId') userId?: string, @Query('userName') userName?: string) {
    return this.pagesService.destroyPages(ids, { userId, userName });
  }

  @Public()
  @Post('auth/login')
  async login(
    @Body('email') email: string,
    @Body('password') password: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.pagesService.loginWithCredentials(email, password);
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
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    return this.pagesService.getUserProfile(id, { userId, userName });
  }

  @Patch('users/:id/preferences')
  updateUserPreferences(
    @Param('id') id: string,
    @Body('preferences') preferences: any,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    return this.pagesService.updateUserPreferences(id, preferences, { userId, userName });
  }

  @Put('users/:id/password')
  changePassword(
    @Param('id') id: string,
    @Body('currentPassword') currentPassword: string,
    @Body('newPassword') newPassword: string,
    @CurrentUser() user: AuthUser,
  ) {
    if (id !== user.id) throw new ForbiddenException('You can only change your own password');
    return this.pagesService.changePassword(id, currentPassword, newPassword);
  }

  // Admin user management
  @Get('admin/users')
  listUsers(@Query('adminId') adminId?: string) {
    return this.pagesService.listUsers(adminId);
  }

  @Post('admin/users')
  adminCreateUser(
    @Body('adminId') adminId: string,
    @Body('displayName') displayName: string,
    @Body('email') email: string,
    @Body('password') password: string,
  ) {
    return this.pagesService.adminCreateUser(adminId, { displayName, email, password });
  }

  @Patch('admin/users/:id')
  adminUpdateUser(
    @Param('id') id: string,
    @Body('adminId') adminId: string,
    @Body('displayName') displayName?: string,
    @Body('email') email?: string,
  ) {
    return this.pagesService.adminUpdateUser(adminId, id, { displayName, email });
  }

  @Post('admin/users/:id/reset-password')
  adminResetPassword(
    @Param('id') id: string,
    @Body('adminId') adminId: string,
    @Body('newPassword') newPassword: string,
  ) {
    return this.pagesService.adminResetPassword(adminId, id, newPassword);
  }

  @Delete('admin/users/:id')
  adminDeleteUser(@Param('id') id: string, @Query('adminId') adminId: string) {
    return this.pagesService.adminDeleteUser(adminId, id);
  }

  @Patch('blocks/:id')
  updateBlock(
    @Param('id') id: string,
    @Body() body: any,
    @Query('userId') userId?: string,
    @Query('userName') userName?: string,
  ) {
    const data: any = pickDefined(body, ['props', 'position', 'type']);
    if (typeof body.content === 'string') data.content = body.content;
    return this.pagesService.updateBlock(id, data, { userId, userName });
  }

  // Collab: issue JWT for Hocuspocus
  @Post('collab/token')
  issueCollabToken(@CurrentUser() user: AuthUser, @Body('workspaceId') workspaceId?: string) {
    return this.pagesService.issueCollabToken({ userId: user.id, userName: user.displayName, workspaceId });
  }

  // Admin: list non-personal workspaces
  @Get('workspaces')
  listWorkspaces(@Query('userId') userId?: string, @Query('userName') userName?: string, @Query('adminId') adminId?: string) {
    return this.pagesService.listWorkspaces(userId, userName, adminId);
  }

  @Post('workspaces')
  createWorkspace(@CurrentUser() user: AuthUser, @Body('name') name?: string) {
    return this.pagesService.createWorkspace({ name, userId: user.id, userName: user.displayName });
  }

  @Patch('workspaces/:id')
  updateWorkspace(
    @Param('id') id: string,
    @Body('name') name: string,
    @Query('userId') userId: string,
  ) {
    return this.pagesService.updateWorkspace(id, { name }, userId);
  }

  @Delete('workspaces/:id')
  deleteWorkspace(@Param('id') id: string, @Query('userId') userId: string) {
    return this.pagesService.deleteWorkspace(id, userId);
  }

  // Admin: list members of a workspace
  @Get('workspaces/:id/members')
  listWorkspaceMembers(
    @Param('id') workspaceId: string,
    @Query('userId') userId?: string,
    @Query('adminId') adminId?: string,
  ) {
    return this.pagesService.listWorkspaceMembers(userId, workspaceId, adminId);
  }

  // Admin: add or update a member (role optional, defaults to EDITOR)
  @Post('workspaces/:id/members')
  addWorkspaceMember(
    @Param('id') workspaceId: string,
    @Body('userId') userId?: string,
    @Body('name') name?: string,
    @Body('role') role?: any,
    @Query('userId') requesterId?: string,
    @Query('adminId') adminId?: string,
  ) {
    return this.pagesService.addWorkspaceMember(requesterId, workspaceId, { userId, name, role }, adminId);
  }

  // Admin: change role
  @Patch('workspaces/:id/members/:userId')
  updateWorkspaceMember(
    @Param('id') workspaceId: string,
    @Param('userId') memberId: string,
    @Body('role') role: any,
    @Query('userId') requesterId?: string,
    @Query('adminId') adminId?: string,
  ) {
    return this.pagesService.updateWorkspaceMemberRole(requesterId, workspaceId, memberId, role, adminId);
  }

  // Admin: remove member
  @Delete('workspaces/:id/members/:userId')
  removeWorkspaceMember(
    @Param('id') workspaceId: string,
    @Param('userId') memberId: string,
    @Query('userId') requesterId?: string,
    @Query('adminId') adminId?: string,
  ) {
    return this.pagesService.removeWorkspaceMember(requesterId, workspaceId, memberId, adminId);
  }

  // Admin: reset all workspaces, documents, and regenerate personal workspaces
  @Post('workspaces/admin/reset')
  resetAllWorkspaces(@Body('confirm') confirm: string, @Query('adminId') adminId?: string) {
    return this.pagesService.resetAllWorkspaces(adminId, confirm);
  }
}
