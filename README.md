# 种草软件

手机优先的个人种草决策库：快速保存大众点评、小红书、抖音等来源里的店铺/菜品线索，再整理、计划和记录轻反馈。

## 本地运行

```bash
npm start
```

打开 `http://localhost:4173`。

## X86 部署准备

复制 `.env.example` 中的非敏感配置到部署环境：

```bash
HOST=0.0.0.0
PORT=4173
```

- 进程健康检查：GET `/healthz`，成功时返回 `{ "status": "ok" }`。
- 当前业务数据仍保存在浏览器 IndexedDB，可在“我的”中导出带版本信息的 JSON 备份。
- `DATABASE_URL` 和 `SESSION_SECRET` 仅为后续 PostgreSQL 与登录阶段预留，当前版本不会读取或连接数据库。
- 真实数据库连接串和会话密钥只能配置在 X86 环境中，不写入仓库。
- Service Worker 只缓存同源静态 GET 资源，不缓存 `/api/*`、健康检查或跨域图片。

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
- 轻后端 `/api/link-preview`，不保存用户收藏数据
