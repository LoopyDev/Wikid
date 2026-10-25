FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY collab/package.json collab/
COPY web/package.json web/
COPY mcp/package.json mcp/
RUN npm ci -w collab
COPY collab/tsconfig.json collab/
COPY collab/src collab/src
RUN npm run build -w collab

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY collab/package.json collab/
COPY web/package.json web/
COPY mcp/package.json mcp/
RUN npm ci -w collab --omit=dev
COPY --from=build /app/collab/dist collab/dist
COPY docker/collab/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
WORKDIR /app/collab
EXPOSE 1234
ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "dist/server.js"]
