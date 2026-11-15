import { BadRequestException, Body, Controller, Get, Patch } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/auth.guard';
import { assertSystemAdmin } from '../utils/assert-admin.util';
import { SettingsService } from './settings.service';

@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  // What this server offers, for the web app to show or hide features.
  @Get('config')
  async config() {
    const [ai, compliance] = await Promise.all([this.settings.aiAvailable(), this.settings.complianceSwitchedOn()]);
    return { ai: { available: ai }, compliance: { available: compliance } };
  }

  @Get('admin/settings')
  async adminSettings(@CurrentUser() user: AuthUser) {
    assertSystemAdmin(user.id);
    return this.describe();
  }

  @Patch('admin/settings')
  async updateAdminSettings(
    @CurrentUser() user: AuthUser,
    @Body('aiEnabled') aiEnabled?: unknown,
    @Body('complianceEnabled') complianceEnabled?: unknown,
  ) {
    assertSystemAdmin(user.id);
    if (aiEnabled !== undefined && typeof aiEnabled !== 'boolean') throw new BadRequestException('aiEnabled must be true or false');
    if (complianceEnabled !== undefined && typeof complianceEnabled !== 'boolean') {
      throw new BadRequestException('complianceEnabled must be true or false');
    }
    // Both or neither
    await this.settings.setSwitches({ aiEnabled: aiEnabled as boolean | undefined, complianceEnabled: complianceEnabled as boolean | undefined });
    return this.describe();
  }

  private async describe() {
    const [ai, compliance] = await Promise.all([this.settings.aiSwitchedOn(), this.settings.complianceSwitchedOn()]);
    return { ai: { configured: this.settings.aiConfigured(), enabled: ai }, compliance: { enabled: compliance } };
  }
}
