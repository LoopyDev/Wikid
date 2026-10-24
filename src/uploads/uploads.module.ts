import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { PagesModule } from '../pages/pages.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PagesModule, PrismaModule],
  controllers: [UploadsController],
  providers: [UploadsService],
})
export class UploadsModule {}
