// Prisma CLI config for the main database. The compliance database has its own config,
// prisma.compliance.config.ts, passed with --config.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  // Read directly rather than with env(), which throws when it's unset: prisma generate runs
  // without a database (in CI and the Docker build)
  datasource: { url: process.env.DATABASE_URL },
});
