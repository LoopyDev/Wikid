FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY collab/package.json collab/
COPY web/package.json web/
COPY mcp/package.json mcp/
RUN npm ci -w web
COPY web/ web/
# Relative URLs: nginx serves the app, API and collab server from one origin
ENV VITE_API_URL=/api \
    VITE_COLLAB_URL=/collab
# Where the "Source code" link points; set it to your fork if you run a modified Wikid (AGPL)
ARG VITE_SOURCE_URL=
RUN npm run build -w web

FROM nginx:1.31-alpine
COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
