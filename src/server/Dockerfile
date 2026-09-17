# 个人助手后端（Express + TypeScript）多阶段构建
#
# 产物：node:22-alpine 运行镜像，仅含编译产物 + 生产依赖 + 迁移 SQL，以非 root 用户运行。
# 运行必需环境变量：DATABASE_URL、JWT_SECRET（缺失会启动失败）；
# 可选：PORT、DB_AUTO_MIGRATE、DEEPSEEK_API_KEY 等，详见 .env.example。

# ---------- 构建阶段：全量依赖 + tsc ----------
# 编译产物与架构无关，固定跑在构建机原生架构上，多架构构建时避免 QEMU 模拟
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- 依赖阶段：只保留生产依赖 ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------- 运行阶段 ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# tsc 不会复制 .sql：迁移 runner 读取的是 dist/db/migrations（迁移源码位于 src/db/migrations）
COPY --from=build /app/src/db/migrations ./dist/db/migrations
COPY package.json ./

# node 镜像自带非 root 用户 node（uid 1000）
USER node
EXPOSE 3000

# /healthz 会 ping 一次数据库，可反映「进程存活 + 数据库可达」
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 应用已处理 SIGTERM/SIGINT（优雅关闭数据库连接池），exec 形式保证信号直达 node
CMD ["node", "dist/index.js"]