import { Injectable } from '@nestjs/common';
import puppeteer from 'puppeteer';
import { SESSION_COOKIE, signSession } from '../auth/session.util';

@Injectable()
export class PdfService {
  private readonly printBaseUrl = (process.env.PRINT_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
  private readonly apiBaseUrl = (process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

  async generatePagePdf(pageId: string, userId?: string, userName?: string, theme?: string, scale?: number): Promise<Buffer> {
    const qs = new URLSearchParams();
    if (userId) qs.set('userId', userId);
    if (userName) qs.set('userName', userName);
    if (theme) qs.set('theme', theme);
    const url = `${this.printBaseUrl}/print/${pageId}?${qs}`;

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      // The print page calls the API from the headless browser, so give it the requesting user's session
      if (userId) {
        await page.setCookie({ name: SESSION_COOKIE, value: signSession(userId), url: this.apiBaseUrl, httpOnly: true });
      }
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });
      await page.waitForFunction(() => (window as any).__PRINT_READY__ === true, { timeout: 30_000 });
      const clampedScale = Math.min(2, Math.max(0.1, scale ?? 1));
      return Buffer.from(
        await page.pdf({
          format: 'A4',
          printBackground: true,
          scale: clampedScale,
        }),
      );
    } finally {
      await browser.close();
    }
  }
}
