import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'wikid:isPublic';

/** Skips the session guard. Use only for login and routes with their own auth (e.g. collab server secret). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
