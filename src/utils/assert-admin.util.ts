import { ForbiddenException } from '@nestjs/common';
import { SYSTEM_ADMIN_ID } from '../constants/system-admin.const';

export function assertSystemAdmin(adminId?: string): void {
  if (!adminId || adminId !== SYSTEM_ADMIN_ID) {
    throw new ForbiddenException('Admin access required');
  }
}
