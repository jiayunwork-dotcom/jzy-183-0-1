# ---- 前端构建 ----
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- 后端构建 ----
FROM node:20-alpine AS backend
WORKDIR /app/backend
COPY backend/package.json ./
RUN npm install
COPY backend/ ./
RUN npm run build

# ---- 运行：node:20-alpine，应用服务同时托管前端静态文件 ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=backend /app/backend/node_modules ./node_modules
COPY --from=backend /app/backend/dist ./dist
COPY --from=backend /app/backend/package.json ./package.json
# 前端打包产物放到后端 public，由 @fastify/static 托管
COPY --from=frontend /app/frontend/dist ./public
ENV FRONTEND_DIST=/app/public
EXPOSE 3000
# 启动时自动迁移，再起服务
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
