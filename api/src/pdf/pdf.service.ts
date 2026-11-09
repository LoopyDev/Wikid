import { Injectable } from '@nestjs/common';
import puppeteer from 'puppeteer';
import { SESSION_COOKIE } from '../auth/session.util';
import { SessionsService } from '../auth/sessions.service';

// Long enough to load and print the page; the session ends when the PDF is done anyway
const PRINT_SESSION_SECONDS = 2 * 60;

@Injectable()
export class PdfService {
  constructor(private readonly sessions: SessionsService) {}

  private readonly printBaseUrl = (process.env.PRINT_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
  // The API URL as the headless browser sees it, which can differ from the public one inside Docker
  private readonly apiBaseUrl = (process.env.PRINT_API_URL || process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

  async generatePagePdf(pageId: string, userId?: string, userName?: string, theme?: string, scale?: number): Promise<Buffer> {
    const qs = new URLSearchParams();
    if (userId) qs.set('userId', userId);
    if (userName) qs.set('userName', userName);
    if (theme) qs.set('theme', theme);
    const url = `${this.printBaseUrl}/print/${pageId}?${qs}`;

    // Chromium's sandbox doesn't work under Docker's default restrictions, so it runs without one; the
    // container runs the API as an unprivileged user instead (docker/api/entrypoint.sh).
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    // The print page calls the API as the requesting user: a short session of its own
    let session: { id: string; token: string } | null = null;
    try {
      if (userId) session = await this.sessions.start(userId, PRINT_SESSION_SECONDS);
      const page = await browser.newPage();
      if (session) {
        await page.setCookie({ name: SESSION_COOKIE, value: session.token, url: this.apiBaseUrl, httpOnly: true });
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
      // The session first: it ends even if closing the browser fails
      if (session) await this.sessions.end(session.id).catch(() => undefined);
      await browser.close();
    }
  }
}
