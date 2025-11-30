# Magpie - 轻量级链接收藏系统

[English Version](https://github.com/onevcat/Magpie/blob/master/README_EN.md)

Magpie 是一个轻量级的链接收藏和展示系统，用于收集阅读过程中遇到的有趣链接。结合 AI 自动分析，为链接添加分类和描述，并与管理员确认发布流程，来以一种“可检索”和“可回顾”的方式与他人以及未来的自己进行分享。

我的个人链接收集站 https://onevcat.link 就是一个运行中的 Magpie 示例。

![](https://github.com/user-attachments/assets/c1a270d6-5d6b-468c-8b38-52c7557b614e)

## 最常见场景

#### Chrome Extension

遇到好的页面 -> 点击 extension 收藏按钮

#### iOS 或 macOS

遇到好的页面 -> 复制 URL -> 启动快捷指令

Magpie 将自动调用 LLM，完成分类、标签提取和内容短评，并将链接页面收录到收藏中。

## ✨ 主要功能

### 🔗 链接管理
- **智能收集**：通过浏览器扩展或 API 快速收藏链接
- **AI 分析**：自动提取标题、描述、分类和标签
- **分类管理**：支持自定义分类和预设图标
- **标签系统**：多标签管理，支持标签筛选
- **搜索功能**：全文搜索，支持关键词高亮

### 🎯 展示功能
- **响应式设计**：适配桌面和移动设备
- **分类浏览**：按分类筛选链接
- **时间线视图**：按时间顺序展示链接
- **阅读时间**：自动计算并显示预估阅读时间

### 🔧 管理功能
- **后台管理**：完整的后台管理系统
- **链接审批**：支持人工确认或自动发布
- **分类管理**：拖拽排序，自定义图标
- **API Token**：支持多 Token 管理
- **操作日志**：完整的操作审计

### 🌐 扩展支持
- **Chrome 扩展**：一键收藏当前页面
- **API 接口**：RESTful API 支持
- **SEO 优化**：自动生成 sitemap 和 RSS feed

### 管理页面的一些截图

![](https://github.com/user-attachments/assets/98a5db2b-9b5f-45e0-b8e0-322090adf7cc)

![](https://github.com/user-attachments/assets/9e605fa4-f030-4bf8-9348-0415f2dbde15)

## 🚀 快速开始

该项目支持 Docker 自托管部署。

### 使用 Docker 部署（推荐）

#### 1. 准备工作
确保系统已安装 Docker。

#### 2. 拉取最新镜像
```bash
docker pull ghcr.io/onevcat/magpie:latest
```

#### 3. 启动容器
```bash
# 使用默认配置启动
docker run -d \
  --name magpie \
  --restart unless-stopped \
  -p 3001:3001 \
  -v ./data:/app/data \
  -e JWT_SECRET="your-super-secret-key" \
  -e BASE_URL="http://localhost:3001" \
  -e NODE_ENV=production \
  ghcr.io/onevcat/magpie:latest
```

#### 4. 访问应用并设置管理员密码
打开浏览器访问：`http://localhost:3001/admin`

### 完整部署示例

```bash
# 1. 创建数据目录
mkdir -p ./data

# 2. 生成强密码 JWT 密钥
export JWT_SECRET=$(openssl rand -base64 32)

# 3. 拉取最新镜像
docker pull ghcr.io/onevcat/magpie:latest

# 4. 启动容器（带 OpenAI 支持）
docker run -d \
  --name magpie \
  --restart unless-stopped \
  -p 3001:3001 \
  -v ./data:/app/data \
  -e JWT_SECRET="$JWT_SECRET" \
  -e OPENAI_API_KEY="sk-your-actual-openai-key" \
  -e BASE_URL="https://links.yourdomain.com" \
  -e NODE_ENV=production \
  ghcr.io/onevcat/magpie:latest

# 5. 查看容器状态
docker ps | grep magpie
```

### 环境变量配置

| 变量 | 说明 | 默认值 | 必需 |
|------|------|--------|------|
| `JWT_SECRET` | JWT 签名密钥 | - | ✅ |
| `PORT` | 服务端口 | `3001` | ❌ |
| `DATA_DIR` | 数据目录 | `./data` | ❌ |
| `BASE_URL` | 应用访问地址 | `http://localhost:PORT` | ❌ |
| `OPENAI_API_KEY` | OpenAI API 密钥 | - | ❌ |
| `OPENAI_BASE_URL` | OpenAI API 地址 | `https://api.openai.com/v1` | ❌ |

## 📁 项目结构

```
magpie/
├── apps/
│   ├── web/          # React 前端应用
│   └── api/          # Hono.js 后端 API
├── packages/
│   └── shared/       # 共享 TypeScript 类型定义
├── extension/        # Chrome 浏览器扩展
├── data/            # SQLite 数据库挂载点
├── scripts/         # 工具脚本
└── doc/             # 设计文档
```

## 🔧 开发指南

### 本地开发环境

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 运行测试
pnpm test

# 构建项目
pnpm build
```

### 数据库操作

```bash
# 重置数据库（开发环境）
pnpm db:reset

# 生成数据库迁移
pnpm db:generate

# 执行数据库迁移
pnpm db:migrate

# 打开数据库管理界面
pnpm db:studio
```

## 🔌 API 使用

### 认证方式

**API Token**：用于外部调用
   ```bash
   curl -H "Authorization: Bearer mgp_your_api_token" \
        https://your-magpie-instance.com/api/links
   ```

### 主要 API 端点

- `GET /api/links` - 获取链接列表
- `POST /api/links` - 添加新链接
- `GET /api/search` - 搜索链接
- `GET /api/stats` - 获取统计信息
- `GET /api/admin/pending` - 获取待处理链接

## 🛠️ 浏览器扩展

Magpie 官方 Chrome 扩展已经上架 Chrome Web Store，可直接安装使用，无需手动构建与加载。  
[前往 Chrome Web Store 下载插件](https://chromewebstore.google.com/detail/magpie-%E6%89%A9%E5%B1%95/lpmbkjkipgafgaggkfiappkccccjjing)

### 安装与配置

1. 在 Chrome Web Store 页面点击「添加至 Chrome」，完成安装。
2. 首次点击工具栏图标时，按照向导输入你的 Magpie 实例地址（如 `https://links.example.com`）与 API Token。
3. 可在弹窗内即时选择分类、标签，或开启「自动发布」与「跳过确认」等偏好设置。
4. 若需批量调整默认行为，可打开扩展选项页配置默认分类、标签与自动发布策略。

> 建议为浏览器扩展单独创建 Token，遗失后只需在 Admin → API 令牌 中撤销该 Token 即可立刻失效。

如需本地调试扩展代码，可参考 `extension/README.md` 按经典「开发者模式 → 加载已解压扩展」的方式搭建开发环境。

## 📱 iOS / macOS 快捷指令

Magpie 提供官方的「收藏到 Magpie」快捷指令，适用于 iOS 与 macOS。导入后即可在 Safari 分享菜单、主屏小组件或快捷键中一键发送当前页面。  
[下载「收藏到 Magpie」快捷指令](https://www.icloud.com/shortcuts/1e0189f0c5cb4f59b0480abc10c5dc4a)

### 使用指南

1. 在 Admin → API 令牌 中为快捷指令创建一个专用 Token，便于管理。
2. 导入快捷指令，首次运行时填入你的 Magpie 实例 URL 与刚生成的 API Token；信息会保存在系统快捷指令中，可随时编辑。
3. 复制想要收藏的链接到剪贴板或在 Safari 分享菜单中直接调用该指令，快捷指令会调用 `/api/links` 接口完成上传。
4. 可将快捷指令固定到 Dock、菜单栏、主屏小组件或设置为「背部轻点」等入口，让分享流程更顺手。

> 如果你的实例开启了自动发布策略，快捷指令在发送时也会遵循对应设置。

## 📊 数据持久化

容器会自动创建数据目录并持久化以下数据：

```
./data/
├── magpie.db             # SQLite 数据库
├── logs/                 # 日志文件
│   ├── error.log         # 错误日志
│   └── combined.log      # 完整日志
└── ...
```

## 🔒 安全建议

1. **设置强 JWT 密钥**：生产环境必须设置
2. **使用 HTTPS**：生产环境启用 HTTPS
3. **定期备份**：定期备份数据库文件
4. **监控日志**：监控应用日志和错误
5. **更新及时**：保持系统和依赖更新

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 项目
2. 创建特性分支：`git checkout -b feature/AmazingFeature`
3. 提交更改：`git commit -m 'Add some AmazingFeature'`
4. 推送分支：`git push origin feature/AmazingFeature`
5. 提交 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 免责

本项目仅为个人业余兴趣的 Vibe Coding 学习项目，请谨慎将它用于生产环境。本人无法对项目质量进行任何形式的保障和有效支持。

---

**提示**：
- 架设后**请务必**访问管理后台并设置管理员密码
- 建议在生产环境中使用反向代理（如 Nginx）
- 定期备份数据库文件以防数据丢失
