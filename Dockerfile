# Dockerfile - Magpie

# 第一阶段：安装所有依赖用于构建
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# 只复制 package 文件来安装依赖
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# 安装所有依赖（包括开发依赖，用于构建）
RUN pnpm install --frozen-lockfile

# 第二阶段：构建应用
FROM deps AS builder
WORKDIR /app

# 复制源代码和配置文件（避免覆盖 pnpm 创建的 node_modules symlinks）
COPY tsconfig.json ./

COPY packages/shared/src ./packages/shared/src
COPY packages/shared/tsconfig.json ./packages/shared/

COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/drizzle ./apps/api/drizzle

COPY apps/web/src ./apps/web/src
COPY apps/web/tsconfig.json ./apps/web/
COPY apps/web/index.html ./apps/web/
COPY apps/web/vite.config.ts ./apps/web/
COPY apps/web/tailwind.config.js ./apps/web/
COPY apps/web/postcss.config.js ./apps/web/
COPY apps/web/public ./apps/web/public

# 构建所有包
RUN cd packages/shared && pnpm build && \
    cd ../.. && \
    cd apps/web && pnpm build && \
    cd ../.. && \
    cd apps/api && pnpm build

# 第三阶段：准备生产依赖
FROM node:22-alpine AS prod-deps
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# 复制 package 文件
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# 只安装生产依赖
RUN pnpm install --frozen-lockfile --prod

# 第四阶段：最终的精简镜像
FROM node:22-alpine AS production
WORKDIR /app

# 从 prod-deps 复制生产依赖
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules

# 复制必要的配置文件
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

# 复制构建产物
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/drizzle ./apps/api/drizzle
COPY --from=builder /app/apps/web/dist ./apps/web/dist

# 创建必要的空目录
RUN mkdir -p /app/data /app/apps/api/static

# 环境变量
ENV NODE_ENV=production
ENV PORT=3001
ENV BASE_URL=http://localhost:3001
ENV DATABASE_URL=/app/data/magpie.db

EXPOSE 3001

# 设置工作目录到 API 目录，保持现有的相对路径逻辑
WORKDIR /app/apps/api
CMD ["node", "dist/index.js"]