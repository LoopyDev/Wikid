import { Module } from '@nestjs/common';
import { CompliancePrismaService } from './compliance-prisma.service';

@Module({
  providers: [CompliancePrismaService],
  exports: [CompliancePrismaService],
})
export class CompliancePrismaModule {}
