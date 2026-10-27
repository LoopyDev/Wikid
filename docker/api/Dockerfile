FROM node:26-bookworm-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true
WORKDIR /app
# npm workspaces: install only the API's dependencies from the shared lockfile
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY collab/package.json collab/
COPY web/package.json web/
COPY mcp/package.json mcp/
RUN npm ci -w api
WORKDIR /app/api
COPY api/tsconfig.json api/tsconfig.build.json ./
COPY api/prisma ./prisma
COPY api/src ./src
RUN npx prisma generate \
  && npx prisma generate --schema prisma/compliance/schema.prisma \
  && npm run build \
  && cp -r prisma/generated dist/prisma/generated

FROM node:26-bookworm-slim
# openssl for the Prisma engines; chromium and fonts for PDF export
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates chromium fonts-dejavu-core fonts-liberation fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY collab/package.json collab/
COPY web/package.json web/
COPY mcp/package.json mcp/
# Runtime dependencies only: no compilers, test tools or diagram generators
RUN npm ci -w api --omit=dev

WORKDIR /app/api
# The schemas and migrations, for "prisma migrate deploy" at startup
COPY api/prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/api/dist ./dist

COPY docker/api/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "dist/src/main.js"]
