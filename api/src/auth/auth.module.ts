import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SessionGuard } from './auth.guard';
import { SessionsService } from './sessions.service';

@Global()
@Module({
  providers: [{ provide: APP_GUARD, useClass: SessionGuard }, SessionsService],
  exports: [SessionsService],
})
export class AuthModule {}
