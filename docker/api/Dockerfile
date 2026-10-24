FROM node:20-bookworm-slim

# openssl for the Prisma engines; chromium and fonts for PDF export
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates chromium fonts-dejavu-core fonts-liberation fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
# Only the client generators; the ERD generator needs a browser and isn't needed at runtime
RUN npx prisma generate --generator client \
  && npx prisma generate --schema prisma/compliance/schema.prisma

COPY docker/api/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["entrypoint.sh"]
CMD ["npm", "run", "start:dev"]
