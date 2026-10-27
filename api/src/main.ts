import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { PrismaNotFoundFilter } from './utils/prisma-not-found.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // Don't advertise the framework (X-Powered-By: Express)
  app.disable('x-powered-by');
  // How many of Wikid's own proxies sit in front of the API: the web container's nginx (1), plus
  // Caddy in the production setup (2). The client's address is read that many hops back in
  // X-Forwarded-For, so an address the client makes up is ignored (used to limit failed logins).
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
  app.useGlobalFilters(new PrismaNotFoundFilter(app.getHttpAdapter()));

  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '10mb' });

  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : ['http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:5173', 'http://127.0.0.1:5173'];
  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
}

bootstrap();
