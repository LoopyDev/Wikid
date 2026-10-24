import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';

const USER_AGENT = 'Wikid Link Preview/1.0';
const FETCH_TIMEOUT_MS = 5000;

@Controller('embeds')
export class EmbedsController {
  private decodeHtml(value: string) {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  private extractField(html: string, regex: RegExp) {
    const match = html.match(regex);
    return match?.[1]?.trim() || '';
  }

  private normalizeUrl(value: string, base: string) {
    if (!value) return '';
    try {
      return new URL(value, base).toString();
    } catch {
      return '';
    }
  }

  private extractMeta(html: string, baseUrl: string) {
    const ogTitle =
      this.extractField(html, /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
      this.extractField(html, /<meta[^>]+name=["']title["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    const titleTag = this.extractField(html, /<title[^>]*>([^<]+)<\/title>/i);
    const title = this.decodeHtml(ogTitle || titleTag);

    const description =
      this.extractField(html, /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
      this.extractField(html, /<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i);

    const rawImage = this.extractField(
      html,
      /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    );
    const image = this.normalizeUrl(rawImage, baseUrl);

    const meta: Record<string, unknown> = {};
    if (title) meta.title = title;
    if (description) meta.description = this.decodeHtml(description);
    if (image) meta.image = { url: image };

    return meta;
  }

  private resolveUrl(rawUrl?: string) {
    const url = rawUrl?.trim();
    if (!url) {
      throw new BadRequestException('url is required');
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      // Try to salvage missing protocol
      try {
        parsed = new URL(`https://${url}`);
      } catch {
        throw new BadRequestException('Invalid URL');
      }
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('Only http/https URLs are allowed');
    }
    return parsed;
  }

  private async handleLinkRequest(rawUrl?: string) {
    const parsed = this.resolveUrl(rawUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: any;
    try {
      res = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'user-agent': USER_AGENT },
      });
    } catch (err) {
      // Surface a clean error message to the client
      throw new BadRequestException(`Failed to fetch URL: ${(err as Error)?.message || 'unknown error'}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      throw new BadRequestException(`Request failed with status ${res.status}`);
    }

    const contentType = res.headers.get('content-type') || '';
    const isHtml = contentType.includes('text/html') || contentType.includes('text/plain');
    const html = isHtml ? await res.text() : '';
    const meta = this.extractMeta(html, parsed.toString());

    return {
      success: 1,
      link: parsed.toString(),
      meta,
    };
  }

  @Post('link')
  async linkPost(@Body('url') rawUrl?: string) {
    return this.handleLinkRequest(rawUrl);
  }

  @Get('link')
  async linkGet(@Query('url') rawUrl?: string) {
    return this.handleLinkRequest(rawUrl);
  }
}
