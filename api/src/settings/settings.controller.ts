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
    return { ai: { available: await this.settings.aiAvailable() } };
  }

  @Get('admin/settings')
  async adminSettings(@CurrentUser() user: AuthUser) {
    assertSystemAdmin(user.id);
    return this.describe();
  }

  @Patch('admin/settings')
  async updateAdminSettings(@CurrentUser() user: AuthUser, @Body('aiEnabled') aiEnabled?: unknown) {
    assertSystemAdmin(user.id);
    if (aiEnabled !== undefined) {
      if (typeof aiEnabled !== 'boolean') throw new BadRequestException('aiEnabled must be true or false');
      await this.settings.setAiSwitchedOn(aiEnabled);
    }
    return this.describe();
  }

  private async describe() {
    return { ai: { configured: this.settings.aiConfigured(), enabled: await this.settings.aiSwitchedOn() } };
  }
}
