import { Module } from '@nestjs/common';
import { PagesModule } from './pages/pages.module';
import { PrismaModule } from './prisma/prisma.module';
import { EmbedsModule } from './embeds/embeds.module';
import { UploadsModule } from './uploads/uploads.module';
import { CollabModule } from './collab/collab.module';
import { ComplianceModule } from './compliance/compliance.module';
import { AiModule } from './ai/ai.module';
import { SettingsModule } from './settings/settings.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule, PagesModule, EmbedsModule, UploadsModule, CollabModule, ComplianceModule, AiModule, SettingsModule],
})
export class AppModule {}
