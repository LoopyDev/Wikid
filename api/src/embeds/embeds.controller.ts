import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { safeFetch } from '../utils/safe-fetch.util';

const USER_AGENT = 'Wikid Link Preview/1.0';
const FETCH_TIMEOUT_MS = 5000;
// Only the <head> matters for a preview
const MAX_PAGE_BYTES = 2 * 1024 * 1024;

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

  private async handleLinkRequest(rawUrl?: string) {
    const raw = rawUrl?.trim();
    if (!raw) {
      throw new BadRequestException('url is required');
    }
    // Add a missing protocol, as people often paste "example.com"
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    // Only public addresses: this runs on the server, which can reach Wikid's own services
    const { url: parsed, response: res, body } = await safeFetch(withProtocol, {
      maxBytes: MAX_PAGE_BYTES,
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: { 'user-agent': USER_AGENT },
    });

    const contentType = res.headers.get('content-type') || '';
    const isHtml = contentType.includes('text/html') || contentType.includes('text/plain');
    const html = isHtml ? body.toString('utf8') : '';
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
