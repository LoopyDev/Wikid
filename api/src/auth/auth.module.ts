import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SessionGuard } from './auth.guard';

@Module({
  providers: [{ provide: APP_GUARD, useClass: SessionGuard }],
})
export class AuthModule {}
