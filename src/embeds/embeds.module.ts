import { Module } from '@nestjs/common';
import { EmbedsController } from './embeds.controller';

@Module({
  controllers: [EmbedsController],
})
export class EmbedsModule {}
