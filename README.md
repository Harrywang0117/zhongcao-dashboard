# 种草软件

手机优先的个人种草决策库：快速保存大众点评、小红书、抖音等来源里的店铺/菜品线索，再整理、计划和记录轻反馈。

## 本地运行

前端演示模式不读写数据库：

```bash
npm run dev
```

打开 Vite 输出的地址并在 URL 后加 `?demo`。

完整应用需要先配置 `DATABASE_URL`，显式执行 migration，再构建和启动：

```bash
npm run db:migrate
npm run build
npm start
```

`npm start` 只启动现有构建产物，不会隐式 build 或执行 migration。

## PostgreSQL 共享状态

- PostgreSQL 是正式业务数据的唯一权威来源，浏览器不再把 IndexedDB 作为主存储。
- `GET /api/state` 返回共享状态与 revision。
- `PUT /api/state` 必须携带 `expectedRevision`；冲突返回 `409 revision_conflict`。
- 浏览器内写入会串行执行；跨设备冲突会基于最新状态重放一次，第二次仍冲突则明确提示刷新。
- `app_state_revisions` 只保留最近 50 个同库历史版本，不等同于离机备份。
- migration 只通过 `npm run db:migrate` 显式执行，应用启动不会自动改 schema。
- 如需使用独立 migration 凭据，只在一次性 migration 命令的进程环境中提供 `MIGRATION_DATABASE_URL`；不要把管理员连接串写进应用 `.env`。

## X86 部署配置

复制 `.env.example` 为不入库的 `.env`，填写真实连接串：

```bash
HOST=0.0.0.0
PORT=4173
DATA_DIR=/data
ZHONGCAO_DATA_DIR=/mnt/nvme0n1-4/AppData/zhongcao
DATABASE_POOL_MAX=5
DATABASE_URL=postgresql://zhongcao_app:REPLACE_ME@postgresql:5432/zhongcao
```

- 进程健康检查：GET `/healthz`，成功时返回 `{ "status": "ok" }`。
- 数据库就绪检查：GET `/readyz`；只有数据库、schema 和共享初始状态均存在时才返回 200。
- 可在“我的”中导出带版本信息的 JSON 备份，但当前测试阶段没有自动恢复或周期备份。
- 自动解析到的封面和手动上传的封面会落到 `DATA_DIR/covers/`，接口只返回同源 `/covers/...` 地址；部署时需要把整个 `DATA_DIR` 挂到持久卷并纳入备份。
- 封面接口包括 `POST /api/cover-upload`（JPEG/PNG/WebP/AVIF/GIF，最大 5MB）、`POST /api/cover-fetch` 和只读 `GET /covers/*`。
- 平台要求登录、未提供图片或图片下载失败时，文字信息仍可保存，前端会明确提示并允许从相册补封面。
- 应用连接池上限硬限制为 5；`DATABASE_POOL_MAX` 只允许 1 到 5。
- 真实数据库连接串只能配置在 X86 环境中，不写入仓库、镜像或日志。
- Service Worker 只缓存成功的同源静态 GET 资源和同源封面，不缓存 `/api/*`、健康/就绪检查或跨域图片。
- Docker Compose 只 `expose` 容器内 4173，不增加宿主端口映射，并接入外部 `1panel-network`。
- 容器使用非 root UID/GID 10001；部署前需让 `ZHONGCAO_DATA_DIR` 对该 UID/GID 可写。
- 当前测试阶段没有应用登录或 Cloudflare Access；一旦配置公网 hostname，任何能访问该地址的人都可读取和修改共享数据。公网开放与访问控制必须在后续阶段单独确认。

构建配置：

```bash
docker compose config
docker compose build zhongcao-app
```

此处只准备配置；数据库创建、migration、容器启动和 Cloudflare hostname 均属于后续单独授权阶段。

## 验证

```bash
npm test
```

## 文档

- [产品需求文档](PRD.md)
- [前端设计方案](FRONTEND_DESIGN.md)
- [轻反馈驱动下一步状态需求说明](docs/feedback-state-requirements.md)
- [添加人字段需求说明](docs/added-by-requirements.md)

## v1 已包含

- 收件箱快速保存、解析失败兜底、重新解析
- 快速整理为店铺、菜品、店铺 + 菜品、暂留线索
- 店铺/菜品列表与图列、搜索、默认标签和自定义标签
- 商圈、地址备注、时间段标签
- 日历按日期计划，支持改期、放回想去、不想去了
- 到店轻反馈：还想去、一般、不再去
- 回收站、封面图兜底、本地数据版本迁移
- 轻后端 `/api/link-preview`，封面落本地持久目录，共享收藏状态保存在 PostgreSQL
