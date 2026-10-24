FROM node:20-bookworm-slim
WORKDIR /app
COPY collab/package.json collab/package-lock.json ./
RUN npm ci
COPY collab/tsconfig.json ./
COPY collab/src ./src
COPY docker/collab/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
EXPOSE 1234
ENTRYPOINT ["entrypoint.sh"]
# Runs from source like `npm run dev`; the strict tsc build doesn't pass yet
CMD ["npx", "tsx", "src/server.ts"]
