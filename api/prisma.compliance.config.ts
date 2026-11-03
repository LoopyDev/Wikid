// Prisma CLI config for the compliance database: pass it with --config, e.g.
// npx prisma migrate deploy --config prisma.compliance.config.ts
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/compliance/schema.prisma',
  migrations: { path: 'prisma/compliance/migrations' },
  // As in prisma.config.ts: unset is fine for prisma generate
  datasource: { url: process.env.COMPLIANCE_DATABASE_URL },
});
