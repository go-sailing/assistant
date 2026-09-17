# 个人助手前端（Vue3 + Vite）多阶段构建
#
# 产物：nginx:alpine 静态托管 + 同源反向代理 /api → 后端容器。
# 运行时可配环境变量：API_UPSTREAM（后端地址，默认 http://server:3000）、
# API_PROXY_TIMEOUT（SSE/长请求超时秒数，默认 300）。

# ---------- 构建阶段：vue-tsc 类型检查 + vite 打包 ----------
# 静态产物与架构无关，固定跑在构建机原生架构上，多架构构建时避免 QEMU 模拟（vue-tsc 在模拟下很慢）
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- 运行阶段：nginx 托管静态产物 ----------
FROM nginx:1.27-alpine AS runtime

# 模板在容器启动时由官方 entrypoint 用 envsubst 渲染到 /etc/nginx/conf.d/default.conf；
# NGINX_ENVSUBST_FILTER 限定只替换这些变量，避免误伤 nginx 自身的 $uri/$host 等变量
ENV API_UPSTREAM=http://server:3000 \
    API_PROXY_TIMEOUT=300 \
    NGINX_ENVSUBST_FILTER='^(API_UPSTREAM|API_PROXY_TIMEOUT)$'

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]