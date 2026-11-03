import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../../prisma/generated/compliance';
import { pgAdapter } from './pg-adapter.util';

@Injectable()
export class CompliancePrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({ adapter: pgAdapter(process.env.COMPLIANCE_DATABASE_URL) });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
