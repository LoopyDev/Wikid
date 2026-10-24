import { Module } from '@nestjs/common';
import { PagesModule } from './pages/pages.module';
import { PrismaModule } from './prisma/prisma.module';
import { EmbedsModule } from './embeds/embeds.module';
import { UploadsModule } from './uploads/uploads.module';
import { CollabModule } from './collab/collab.module';
import { ComplianceModule } from './compliance/compliance.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [PrismaModule, PagesModule, EmbedsModule, UploadsModule, CollabModule, ComplianceModule, AiModule],
})
export class AppModule {}
