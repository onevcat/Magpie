# Magpie Docker 开发指南

## 🚀 快速开始

Magpie 提供了便捷的 pnpm 脚本来管理 Docker 容器的构建和运行。

### 基本用法

```bash
# 构建 Docker 镜像
pnpm docker:build

# 启动容器（使用默认配置）
pnpm docker:run

# 或者直接使用脚本
scripts/run-docker.sh build
scripts/run-docker.sh start
```

### 传递环境变量

你可以通过环境变量来配置 Docker 容器：

```bash
# 设置 JWT 密钥和 OpenAI API Key
JWT_SECRET="your-secret-key" OPENAI_API_KEY="sk-your-api-key" pnpm docker:run

# 自定义端口和数据目录
PORT=8080 DATA_DIR="./custom-data" pnpm docker:run

# 完整配置示例
JWT_SECRET="my-secret" \
PORT=3001 \
BASE_URL="https://link.mydomain.com" \
pnpm docker:run
```

## 📋 可用的 pnpm 命令

| 命令 | 功能 | 等价脚本命令 |
|------|------|------------|
| `pnpm docker:build` | 智能构建（自动版本管理） | `scripts/run-docker.sh build` |
| `pnpm docker:build:dev` | 构建开发版本 | `IMAGE_TAG=dev scripts/run-docker.sh build` |
| `pnpm docker:push` | 构建并推送多架构镜像 | `scripts/run-docker.sh push` |
| `pnpm docker:run` | 启动容器 | `scripts/run-docker.sh start` |
| `pnpm docker:status` | 查看容器状态 | `scripts/run-docker.sh status` |
| `pnpm docker:logs` | 查看容器日志 | `scripts/run-docker.sh logs` |
| `pnpm docker:stop` | 停止容器 | `scripts/run-docker.sh stop` |

## 🛠️ 脚本命令总览

除了 pnpm 命令，你也可以直接使用脚本获得完整功能：

```bash
# 基本操作
scripts/run-docker.sh start    # 启动容器
scripts/run-docker.sh stop     # 停止容器  
scripts/run-docker.sh restart  # 重启容器
scripts/run-docker.sh status   # 查看状态
scripts/run-docker.sh logs     # 查看日志
scripts/run-docker.sh clean    # 删除容器
scripts/run-docker.sh build    # 构建镜像
scripts/run-docker.sh help     # 显示帮助

# 带参数启动
scripts/run-docker.sh start -p 8080 -s "my-secret-key"

# 常用选项
- `-b, --base-url`：设置对外访问地址，例如 `scripts/run-docker.sh start -b "https://links.example.com"`
- `-r, --registry`：在推送时自定义容器注册表，例如 `scripts/run-docker.sh push --registry docker.io`
- `-u, --user`：指定注册表命名空间/用户名，例如 `scripts/run-docker.sh push --user your-user`
```

## ⚙️ 环境变量配置

### 必需配置

| 变量 | 说明 | 示例 |
|------|------|------|
| `JWT_SECRET` | JWT 签名密钥（强烈建议设置） | `"your-super-secret-key"` |

### 可选配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 容器端口映射 | `3001` |
| `DATA_DIR` | 数据目录 | `./data` |
| `BASE_URL` | 应用访问地址 | `http://localhost:PORT` |
| `CONTAINER_NAME` | 容器名称 | `magpie` |
| `IMAGE_TAG` | Docker 镜像标签 | `latest` |
| `LOG_LEVEL` | 日志级别 | `info` |
| `LOG_DIR` | 日志目录 | `/app/data/logs` |

### AI 功能配置

| 变量 | 说明 | 示例 |
|------|------|------|
| `OPENAI_API_KEY` | OpenAI API 密钥 | `"sk-your-api-key"` |
| `OPENAI_BASE_URL` | OpenAI API 基础地址 | `"https://api.openai.com/v1"` |

这些配置是完全可以选的，可以在容器启动后通过 Admin 页面修改。

## 📁 数据持久化

容器会自动创建数据目录并持久化以下数据：

```bash
./data/                    # 默认数据目录
├── magpie.db             # SQLite 数据库文件
└── logs/                 # 日志文件目录
    ├── error.log         # 错误日志
    ├── combined.log      # 完整日志
    ├── error.log.1       # 历史错误日志（轮转）
    └── combined.log.1    # 历史完整日志（轮转）
```

**重要说明**：
- 数据库使用 `DELETE` 日志模式和 `FULL` 同步模式确保容器环境下的数据完整性
- 所有数据修改都会立即写入磁盘，避免容器重启时数据丢失
- 日志文件支持自动轮转（5MB × 5个文件），确保磁盘空间可控

### 日志挂载配置

如需单独挂载日志目录以便于监控和分析：

```bash
# 方法1：单独挂载日志目录
docker run -d \
  --name magpie \
  -p 3001:3001 \
  -v ./data:/app/data \
  -v ./logs:/app/data/logs \
  -e JWT_SECRET="your-secret-key" \
  magpie:latest

# 方法2：使用 docker-compose
version: '3.8'
services:
  magpie:
    image: magpie:latest
    ports:
      - "3001:3001"
    volumes:
      - ./data:/app/data
      - ./logs:/app/data/logs  # 单独挂载日志
    environment:
      - JWT_SECRET=your-secret-key
      - LOG_LEVEL=info         # 可选：设置日志级别
```

## 🔧 开发工作流

### 典型开发流程

```bash
# 1. 修改代码后构建新镜像
pnpm docker:build

# 2. 停止现有容器（如果运行中）
scripts/run-docker.sh stop

# 3. 启动新容器
JWT_SECRET="dev-secret" OPENAI_API_KEY="sk-xxx" pnpm docker:run

# 4. 查看应用状态
scripts/run-docker.sh status

# 5. 查看日志（如需调试）
scripts/run-docker.sh logs
```

### 快速重启

```bash
# 重启容器（保持现有配置）
scripts/run-docker.sh restart
```

## 🏷️ 版本管理策略

### 智能标签系统

Magpie 的 Docker 构建系统会自动根据项目状态创建合适的标签：

#### 1. **默认行为** (`pnpm docker:build`)
```bash
# 自动读取 package.json 版本并创建多个标签
pnpm docker:build

# 示例输出:
# 📋 版本信息:
#    Package 版本: 1.0.0
#    Git 信息: master-abc1234
#    构建标签: latest
# 🏷️ 构建多个标签: 1.0.0, latest
# 🎯 主分支检测，添加 stable 标签
```

这会创建：
- `magpie:1.0.0` - 精确版本
- `magpie:latest` - 最新版本  
- `magpie:stable` - 稳定版本（主分支）

#### 2. **开发版本** (`pnpm docker:build:dev`)
```bash
# 在特性分支构建开发版本
pnpm docker:build:dev

# 创建标签：
# - magpie:dev
# - magpie:dev-feature-auth-7f8e9a2
```

#### 3. **手动版本管理**
```bash
# 构建特定版本
IMAGE_TAG=v1.2.3 pnpm docker:build

# 构建发布候选版本
IMAGE_TAG=1.2.3-rc.1 pnpm docker:build

# 构建带日期的快照版本
IMAGE_TAG="snapshot-$(date +%Y%m%d)" pnpm docker:build
```

### 推荐的版本工作流

#### **日常开发**
```bash
# 开发时使用开发版本
pnpm docker:build:dev
pnpm docker:run
```

#### **测试发布**
```bash
# 准备发布时更新版本号
npm version patch  # 或 minor, major

# 构建版本化镜像
pnpm docker:build

# 测试新版本
pnpm docker:run
```

#### **正式发布**
```bash
# 在主分支构建稳定版本
git checkout master
git merge develop

# 构建生产版本（自动创建 stable 标签）
pnpm docker:build

# 可选：推送到镜像仓库
docker tag magpie:1.2.3 your-registry.com/magpie:1.2.3
docker push your-registry.com/magpie:1.2.3
```

## 🌐 镜像推送到 GitHub Container Registry (GHCR)

### 设置 GitHub 访问令牌

1. **创建 GitHub Personal Access Token**
   - 访问 GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
   - 点击 "Generate new token (classic)"
   - 选择权限：`write:packages`, `read:packages`, `delete:packages`
   - 复制生成的令牌

2. **登录 GHCR**
```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

### 推送镜像

> ℹ️ `pnpm docker:push` 会自动通过 Docker Buildx 构建 `linux/amd64` 与 `linux/arm64` 多架构镜像，如本地未配置 builder 会自动创建 `magpie-builder`。

**方法一：使用环境变量**
```bash
# 设置环境变量
export REGISTRY_USER="YOUR_GITHUB_USERNAME"

# 推送镜像
pnpm docker:push
```

**方法二：使用脚本参数**
```bash
# 直接指定用户名
REGISTRY_USER=YOUR_GITHUB_USERNAME pnpm docker:push

# 或使用脚本
scripts/run-docker.sh push --user YOUR_GITHUB_USERNAME

# 自定义注册表并推送
scripts/run-docker.sh push --registry docker.io --user YOUR_DOCKERHUB_USERNAME
```

### 推送示例输出

```bash
$ REGISTRY_USER=onevcat pnpm docker:push

📤 推送镜像到注册表...

📋 推送信息:
   注册表: ghcr.io
   用户名: onevcat
   版本: 0.1.0
   目标仓库: ghcr.io/onevcat/magpie

🏷️ 将推送的镜像标签:
   - ghcr.io/onevcat/magpie:0.1.0
   - ghcr.io/onevcat/magpie:latest
   - ghcr.io/onevcat/magpie:stable

🛠️ 构建平台: linux/amd64,linux/arm64

🚀 开始构建并推送多架构镜像...
... (buildx 输出省略) ...
✅ 多架构镜像推送完成

💡 使用方式:
   docker pull ghcr.io/onevcat/magpie:0.1.0
   docker pull ghcr.io/onevcat/magpie:latest
```

#### 自定义构建平台

- 使用 `BUILD_PLATFORMS` 环境变量覆盖默认平台，例如：

  ```bash
  BUILD_PLATFORMS="linux/amd64,linux/arm64,linux/arm/v7" REGISTRY_USER=onevcat pnpm docker:push
  ```

- 通过设置 `BUILDX_BUILDER_NAME=my-magpie-builder` 自定义 builder 名称。

### 在其他设备拉取镜像

```bash
# 拉取最新版本
docker pull ghcr.io/YOUR_GITHUB_USERNAME/magpie:latest

# 拉取特定版本
docker pull ghcr.io/YOUR_GITHUB_USERNAME/magpie:0.1.0

# 运行拉取的镜像
docker run -d \
  --name magpie \
  -p 3001:3001 \
  -v ./data:/app/data \
  -e JWT_SECRET="your-secret-key" \
  ghcr.io/YOUR_GITHUB_USERNAME/magpie:latest
```

### 支持的注册表

当前支持推送到以下注册表：

- **GitHub Container Registry**: `ghcr.io` (默认)
- **Docker Hub**: `docker.io`
- **阿里云容器镜像服务**: `registry.cn-hangzhou.aliyuncs.com`

使用不同注册表：
```bash
# Docker Hub
REGISTRY=docker.io REGISTRY_USER=username pnpm docker:push

# 阿里云
REGISTRY=registry.cn-hangzhou.aliyuncs.com REGISTRY_USER=namespace pnpm docker:push
```

## 📊 镜像信息

- **镜像大小**: ~238MB
- **基础镜像**: `node:22-alpine`  
- **构建方式**: 多阶段构建
- **包含内容**:
  - Node.js 22 运行时
  - 编译后的前端和后端应用
  - 生产依赖
  - SQLite 数据库支持
  - 静态文件服务

## 🛠️ 故障排除

### 常见问题

1. **端口被占用**
   ```bash
   # 查看端口占用
   lsof -i :3001
   
   # 使用不同端口
   PORT=8080 pnpm docker:run
   ```

2. **权限问题**
   ```bash
   # 确保脚本可执行
   chmod +x scripts/run-docker.sh
   
   # 确保数据目录可写
   mkdir -p ./data
   chmod 755 ./data
   ```

3. **容器启动失败**
   ```bash
   # 查看详细日志
   scripts/run-docker.sh logs

   # 或直接查看 Docker 日志
   docker logs magpie

   # 查看应用程序日志文件
   tail -f ./data/logs/combined.log
   tail -f ./data/logs/error.log
   ```

4. **镜像不存在**
   ```bash
   # 构建镜像
   pnpm docker:build
   ```

### 健康检查

访问以下端点检查服务状态：

- **健康检查**: `http://localhost:3001/api/health`
- **主页**: `http://localhost:3001/`

## 🔐 生产部署建议

### 1. 安全配置

```bash
# 生成强 JWT 密钥
export JWT_SECRET="$(openssl rand -base64 32)"

# 启动容器
JWT_SECRET="$JWT_SECRET" \
BASE_URL="https://your-domain.com" \
pnpm docker:run
```

### 2. 反向代理配置

**Nginx 示例**:
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 3. 数据备份

```bash
# 定期备份数据库
cp ./data/magpie.db ./backup/magpie-$(date +%Y%m%d).db
```

### 4. 日志管理

```bash
# 设置 Docker 日志轮转
docker run --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 ...
```

## 🔄 更新升级

```bash
# 停止现有容器
scripts/run-docker.sh stop

# 拉取最新代码
git pull

# 重新构建镜像
pnpm docker:build

# 启动新容器（使用相同配置）
JWT_SECRET="your-secret" pnpm docker:run
```

---

**提示**: 推荐在生产环境中使用环境变量来管理配置，避免将敏感信息硬编码在脚本中。
