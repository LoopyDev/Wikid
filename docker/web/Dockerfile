FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# Relative URLs: nginx serves the app, API and collab server from one origin
ENV VITE_API_URL=/api \
    VITE_COLLAB_URL=/collab
RUN npm run build

FROM nginx:1.27-alpine
COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
