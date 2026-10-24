FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY collab/package.json collab/package-lock.json ./
RUN npm ci
COPY collab/tsconfig.json ./
COPY collab/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker/collab/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
EXPOSE 1234
ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "dist/server.js"]
