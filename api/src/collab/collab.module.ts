import { Module } from '@nestjs/common';
import { CollabController } from './collab.controller';
import { CollabMaterializerService } from './collab-materializer.service';
import { CollabService } from './collab.service';
import { PageVersionRecorder } from './page-version-recorder.service';

@Module({
  controllers: [CollabController],
  providers: [CollabService, CollabMaterializerService, PageVersionRecorder],
  exports: [CollabMaterializerService, PageVersionRecorder],
})
export class CollabModule {}
