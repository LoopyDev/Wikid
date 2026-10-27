import { Module } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module';
import { CollabModule } from '../collab/collab.module';
import { PagesController } from './pages.controller';
import { PageAccessService } from './page-access.service';
import { CollabSyncService } from './collab-sync.service';
import { DatabaseSetupService } from './database-setup.service';
import { WikiService } from './wiki.service';
import { PagesService } from './pages.service';
import { DatabaseValuesService } from './database-values.service';
import { DatabasesService } from './databases.service';
import { DatabaseFormsService } from './database-forms.service';
import { DatabaseViewsService } from './database-views.service';
import { WorkspacesService } from './workspaces.service';
import { UsersService } from './users.service';
import { PdfService } from '../pdf/pdf.service';
import { HtmlExportService } from '../export/html-export.service';
import { UploadsService } from '../uploads/uploads.service';

import { LoginRateLimiter } from '../auth/login-rate-limiter';
@Module({
  imports: [ComplianceModule, CollabModule],
  controllers: [PagesController],
  providers: [
    LoginRateLimiter,
    PageAccessService,
    CollabSyncService,
    DatabaseSetupService,
    WikiService,
    PagesService,
    DatabaseValuesService,
    DatabasesService,
    DatabaseFormsService,
    DatabaseViewsService,
    WorkspacesService,
    UsersService,
    PdfService,
    HtmlExportService,
    UploadsService,
  ],
  exports: [PageAccessService],
})
export class PagesModule {}
