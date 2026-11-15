import { ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const AI_ENABLED_KEY = 'aiEnabled';
const COMPLIANCE_ENABLED_KEY = 'complianceEnabled';

// System-wide settings: whether AI features are on (AI needs an Anthropic API key in the server's
// environment, and the admin can still switch it off for everyone), and whether compliance
// databases can be made (an alpha feature, off unless the admin turns it on).
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

  /** The admin's switch for compliance databases (off unless they turned it on). */
  async complianceSwitchedOn(): Promise<boolean> {
    const setting = await this.prisma.appSetting.findUnique({ where: { key: COMPLIANCE_ENABLED_KEY } });
    return setting?.value === true;
  }

  /** The admin's switches given, saved together (both or neither). */
  async setSwitches({ aiEnabled, complianceEnabled }: { aiEnabled?: boolean; complianceEnabled?: boolean }) {
    const writes = (
      [
        [AI_ENABLED_KEY, aiEnabled],
        [COMPLIANCE_ENABLED_KEY, complianceEnabled],
      ] as const
    )
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => this.prisma.appSetting.upsert({ where: { key }, update: { value: value as boolean }, create: { key, value: value as boolean } }));
    if (writes.length) await this.prisma.$transaction(writes);
  }

  /** Before a database is put into compliance mode (ones already in it keep working either way). */
  async assertComplianceAvailable() {
    if (!(await this.complianceSwitchedOn())) {
      throw new ForbiddenException(
        'Compliance databases are an alpha feature, turned off on this server: the system admin can turn them on (Admin → Settings)',
      );
    }
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
