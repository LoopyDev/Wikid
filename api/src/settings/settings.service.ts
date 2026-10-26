import { ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const AI_ENABLED_KEY = 'aiEnabled';

// System-wide settings. For now: whether AI features are on. AI needs an Anthropic API key in the
// server's environment, and the admin can still switch it off for everyone.
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  aiConfigured(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  /** The admin's switch (on unless they turned it off). */
  async aiSwitchedOn(): Promise<boolean> {
    const setting = await this.prisma.appSetting.findUnique({ where: { key: AI_ENABLED_KEY } });
    return setting?.value !== false;
  }

  async setAiSwitchedOn(on: boolean) {
    await this.prisma.appSetting.upsert({
      where: { key: AI_ENABLED_KEY },
      update: { value: on },
      create: { key: AI_ENABLED_KEY, value: on },
    });
  }

  async aiAvailable(): Promise<boolean> {
    return this.aiConfigured() && (await this.aiSwitchedOn());
  }

  /** For the AI routes: refuses when there's no key, or the admin turned AI off. */
  async assertAiAvailable() {
    if (!this.aiConfigured()) {
      throw new HttpException('AI is not configured on this server', HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (!(await this.aiSwitchedOn())) {
      throw new ForbiddenException('AI features are turned off on this server');
    }
  }
}
