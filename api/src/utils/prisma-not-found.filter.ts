import { ArgumentsHost, Catch, NotFoundException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

// Prisma reports a missing record (findUniqueOrThrow, update or delete of a missing row)
// as error code P2025. Answer that with 404 instead of letting it become a 500.
// Checked by shape rather than class, so it covers both generated Prisma clients and
// subclasses such as the NotFoundError thrown by findUniqueOrThrow.
const isPrismaRecordNotFound = (exception: unknown) => {
  const err = exception as { code?: unknown; clientVersion?: unknown } | null;
  return err?.code === 'P2025' && typeof err.clientVersion === 'string';
};

@Catch()
export class PrismaNotFoundFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (isPrismaRecordNotFound(exception)) {
      return super.catch(new NotFoundException('Not found'), host);
    }
    return super.catch(exception, host);
  }
}
