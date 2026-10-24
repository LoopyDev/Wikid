import { Module } from '@nestjs/common';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { ComplianceUploadsService } from './compliance-uploads.service';
import { ComplianceUploadsController } from './compliance-uploads.controller';
import { CompliancePrismaModule } from '../prisma/compliance-prisma.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [CompliancePrismaModule, PrismaModule],
  providers: [ComplianceService, ComplianceUploadsService],
  controllers: [ComplianceController, ComplianceUploadsController],
  exports: [ComplianceService],
})
export class ComplianceModule {}
