import { Module } from '@nestjs/common';
import { CollabController } from './collab.controller';
import { CollabMaterializerService } from './collab-materializer.service';
import { CollabService } from './collab.service';

@Module({
  controllers: [CollabController],
  providers: [CollabService, CollabMaterializerService],
  exports: [CollabMaterializerService],
})
export class CollabModule {}
