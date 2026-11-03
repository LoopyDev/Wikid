import { PrismaPg } from '@prisma/adapter-pg';

// Since Prisma 7 the client reaches Postgres through node-postgres (pg). Its pool waits for a free
// connection forever by default; Prisma's own engine gave up after 10 seconds, which this keeps, so a
// busy pool fails requests instead of hanging them.
export const pgAdapter = (connectionString: string | undefined) =>
  new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000 });
