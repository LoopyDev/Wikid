import { Body, Controller, ForbiddenException, HttpException, HttpStatus, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { AiService, AiMode, AiSuggestBlock } from './ai.service';
import { AuthUser, CurrentUser } from '../auth/auth.guard';
import { SettingsService } from '../settings/settings.service';
import { PageAccessService } from '../pages/page-access.service';
import { isUuid } from '../utils/uuid.util';
// AiSummarizeResult is returned implicitly — no explicit import needed for the route

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly access: PageAccessService,
    private readonly settings: SettingsService,
  ) {}

  @Post('generate')
  async generate(
    @Res() res: Response,
    @Body('prompt') prompt: string,
    @Body('context') context?: string,
    @Body('mode') mode?: AiMode,
  ) {
    if (!prompt?.trim()) {
      throw new HttpException('prompt is required', HttpStatus.BAD_REQUEST);
    }
    await this.settings.assertAiAvailable();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      for await (const text of this.aiService.streamGenerate(prompt, context, mode)) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
    } catch (err) {
      // The details stay in the server log; the browser gets a plain message
      console.warn('AI generation failed', err);
      res.write(`data: ${JSON.stringify({ error: 'AI generation failed. Try again in a moment.' })}\n\n`);
    } finally {
      res.end();
    }
  }

  @Post('suggest')
  async suggest(
    @Body('prompt') prompt: string,
    @Body('blocks') blocks: AiSuggestBlock[],
  ) {
    if (!prompt?.trim()) {
      throw new HttpException('prompt is required', HttpStatus.BAD_REQUEST);
    }
    if (!blocks?.length) {
      throw new HttpException('blocks is required', HttpStatus.BAD_REQUEST);
    }
    await this.settings.assertAiAvailable();
    return this.aiService.generateSuggestions(prompt, blocks);
  }

  @Post('chat')
  async chat(
    @Res() res: Response,
    @Body('messages') messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    @Body('workspaceId') workspaceId: string,
    @Body('pageContext') pageContext?: string,
    @Body('currentPageOnly') currentPageOnly?: boolean,
    @CurrentUser() user?: AuthUser,
  ) {
    if (!messages?.length) {
      throw new HttpException('messages is required', HttpStatus.BAD_REQUEST);
    }
    if (!workspaceId) {
      throw new HttpException('workspaceId is required', HttpStatus.BAD_REQUEST);
    }
    // The chat's tools read the workspace's pages (those this person can open), so it needs
    // membership, checked like every other workspace request (the system admin is no exception
    // in production)
    if (!user?.id || !isUuid(workspaceId)) throw new ForbiddenException('Workspace access required');
    await this.access.requireMembership(user.id, workspaceId);
    await this.settings.assertAiAvailable();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      for await (const event of this.aiService.streamChat(messages, { workspaceId, userId: user.id }, pageContext, currentPageOnly)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      res.write('data: [DONE]\n\n');
    } catch (err) {
      // The details stay in the server log; the browser gets a plain message
      console.warn('AI chat failed', err);
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'AI chat failed. Try again in a moment.' })}\n\n`);
    } finally {
      res.end();
    }
  }

  @Post('summarize-blocks')
  async summarizeBlocks(@Body('blocks') blocks: AiSuggestBlock[]) {
    if (!blocks?.length) {
      throw new HttpException('blocks is required', HttpStatus.BAD_REQUEST);
    }
    await this.settings.assertAiAvailable();
    return this.aiService.summarizeBlocks(blocks);
  }
}
