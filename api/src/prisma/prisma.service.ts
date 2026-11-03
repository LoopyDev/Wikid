import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { pgAdapter } from './pg-adapter.util';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({ adapter: pgAdapter(process.env.DATABASE_URL) });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
