# ---- 构建阶段 ----
FROM node:22-alpine AS build
WORKDIR /app
# 容器内构建使用国内镜像（如构建环境不可达，可改为官方源：npm config set registry https://registry.npmjs.org）
RUN npm config set registry https://registry.npmmirror.com
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---- 运行阶段：nginx 托管纯静态产物（无后端，模拟数据全部在浏览器 IndexedDB）----
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/ >/dev/null 2>&1 || exit 1
CMD ["nginx", "-g", "daemon off;"]
