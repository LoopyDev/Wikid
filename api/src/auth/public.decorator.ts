import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'wikid:isPublic';

/** Skips the session guard. Use only for login and routes with their own auth (e.g. collab server secret). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ALLOW_PENDING_PASSWORD_KEY = 'wikid:allowPendingPassword';

/** Lets a user whose password an admin set (mustChangePassword) use this route before changing it. */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);
