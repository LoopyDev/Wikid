import { Module } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module';
import { CollabModule } from '../collab/collab.module';
import { PagesController } from './pages.controller';
import { PagesService } from './pages.service';
import { PdfService } from '../pdf/pdf.service';
import { HtmlExportService } from '../export/html-export.service';
import { UploadsService } from '../uploads/uploads.service';

@Module({
  imports: [ComplianceModule, CollabModule],
  controllers: [PagesController],
  providers: [PagesService, PdfService, HtmlExportService, UploadsService],
  exports: [PagesService],
})
export class PagesModule {}
