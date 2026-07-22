# 种草软件 · 快照架构与登录实施方案

制定日期：2026-07-15
状态：已确认，待实施
前置文档：[PRD.md](../PRD.md)、[UI-REDESIGN-SPEC.md](UI-REDESIGN-SPEC.md)

## 0. 决策背景

### 0.1 核心产品原则（本方案的出发点）

**收藏即快照**：保存线索的那一刻，把值得留下的内容（文字 + 图片）全部落库；后续浏览、筛选、安排日期不依赖回访原链接。原链接只保留「查看原文」的 best-effort 入口。

### 0.2 现状数据资产盘点（2026-07-15 审查结论）

| 资产 | 现状 | 是否快照 |
|---|---|---|
| 店名/菜名/标题/标签/商圈/备注 | 保存时落库文本 | ✅ |
| 点评/抖音分享文案的评分、人均、品类 | 解析后落库 | ✅ |
| 封面图 | 只存外链 URL，每次渲染回源平台 CDN，小红书签名 URL 会过期 | ❌ |
| 内容正文/描述 | 未解析未保存（og:description 未取） | ❌ |
| 小红书分享文案 | 无解析器（点评/抖音已有） | ❌ |
| 到店照片 | PRD 定义了 `photoUrl`/`eatenDishNames`，domain.js 未实现 | ❌ |
| 整库数据 | 单设备浏览器 IndexedDB；有导出无导入 | ⚠️ 单点风险 |

### 0.3 结构性矛盾

PRD v1 规定「后端不保存任何用户数据」，同时承诺「小王小张两人共用同一套数据」。两人各自设备访问时，IndexedDB 天然隔离，数据不互通，「添加人」筛选失去意义；任何一方清浏览器缓存即全量丢失。本方案推翻「后端零存储」原则，服务端升级为主存储。

### 0.4 已拍板决策

| 决策项 | 结论 |
|---|---|
| 存储主体 | 服务端 PostgreSQL（X86 机器现成实例）；前端 IndexedDB 降级为离线只读缓存 |
| 使用模式 | 小王、小张各自设备访问同一部署实例，共用一个收藏库 |
| 部署方式 | X86 Docker + Cloudflare Tunnel 映射公网（沿用其他项目接法） |
| 认证 | Cloudflare Access 门禁（两人邮箱白名单 + 邮箱验证码），后端校验 Access JWT，一步到位 |
| 添加人 | 保留 `addedBy` 枚举与手动修正能力；登录后保存时自动归属 |
| 封面图 | 服务端下载落盘自托管，原图不转码（不引入 sharp），单张限 5MB |
| 同步模型 | 在线写、离线读；不做双向冲突合并 |
| UI 重设计 | 排在本方案全部阶段之后另案执行；finesse 预览稿的插画风格转为占位图系统 |

## 1. 目标架构

```text
小王手机 PWA ─┐                                      ┌─ PostgreSQL（实体行级存储）
              ├─ Cloudflare Edge ── cloudflared ── Node server ─┤
小张手机 PWA ─┘   (Tunnel + Access 门禁)   (仅绑内网端口)        └─ data/covers/（自托管图片，Docker volume）
```

- **前端**：React PWA 不变；domain.js 领域逻辑继续留在前端（见 3.1 的取舍说明）；IndexedDB 变为服务端数据的只读镜像，离线可浏览、不可写。
- **后端**：在现有零依赖 `server.mjs` 基础上扩展，新增唯一 npm 依赖 `pg`。职责：Access JWT 校验、实体行级存取、图片抓取与静态服务、备份。
- **边缘**：Cloudflare Access 挡在整个域名前（含 `/api/*`），未认证请求到不了 origin；origin 只监听内网，无公网端口。

## 2. 阶段计划

> 量级为保守人日估算；每阶段独立可验收、可回滚，完成后各自提交。

### 阶段 0 · 数据安全网（0.5 天）

**目标**：在动架构之前，先让两台手机上的既有数据可恢复。

- 「我的」页新增**导入 JSON 备份**（与现有导出对称），复用 `migrateState` 做版本兼容校验。
- 导入模式：整库替换 + 二次确认（合并逻辑留给阶段 2 的服务端迁移工具，前端不做）。
- 申请 `navigator.storage.persist()`，降低浏览器自动清理风险。

**验收**：手机 A 导出 → 清空本地数据 → 导入 → 数据与导出前一致（含添加人、计划、轻反馈）。

### 阶段 1 · 封面快照管道（1-2 天）

**目标**：从此封面图存在自己服务器上，不再受平台防盗链和链接过期影响。

- `/api/link-preview` 解析成功且带 `imageUrl` 时，服务端下载图片存入 `data/covers/`，文件名用 `sha256(图片URL)` 前 16 位（天然去重），响应改回自有路径 `/covers/<hash>.<ext>`。
- 新增 `POST /api/cover-fetch`：输入任意 https 图片 URL，抓取落盘返回自有路径。手动填封面链接的表单改走此端点。
- 抓取安全：复用 `isSafePreviewFetchUrl` 的思路做校验（https、无凭证）；Content-Type 必须是 image/*；单张 ≤5MB；超时 4s；简单限流。
- 图片静态服务：`GET /covers/*` 从 `data/covers/` 读文件，带长缓存头（内容寻址文件名可安全设 immutable）。
- **存量自愈**：前端启动时检测库内外链封面（`coverImageUrl`/`previewImageUrl` 非 `/covers/` 开头），逐个调用 `cover-fetch` 替换为自有路径；失败保留原值不阻塞。趁小红书链接未全过期尽快上线此阶段。
- 解析增强（顺带）：提取 `og:description` 存入 InboxItem 新字段 `sourceDescription`（原文快照，与用户 `note` 分离）；补小红书分享文案解析器（分享文本通常含笔记标题）。
- Docker volume 挂载 `data/`，README 部署说明同步。

**验收**：新收藏封面 URL 为自有域名路径；服务器重启后图仍在；构造一条已过期的小红书图片链接线索，存量自愈后卡片显示正常。

### 阶段 2 · Postgres 持久化 + 双机数据合并（3-5 天，核心阶段）

**目标**：数据搬进服务端，两人真正共库；清缓存不再丢数据。

- 表结构见 3.2；连接串走 `DATABASE_URL`（只配置在 X86 环境，不入仓库）。
- API 面见 3.3：全量拉取 + 行级 upsert（`updatedAt` 新者胜）。
- 前端 `storage.js` 改造为「在线写、离线读」：
  - 启动拉取全量 → 写入 IndexedDB 镜像 → 渲染；
  - 每次状态变更推送变更实体到服务端，成功后更新镜像；
  - 离线时可浏览镜像，写操作禁用并明确提示「离线状态，暂不能修改」。
- **一次性迁移工具**：接收两台手机导出的 JSON 备份 → 按 `normalizedUrl` 去重来源、`findPotentialDuplicateStores` 提示疑似重复店铺 → 合并灌入 Postgres。`addedBy` 保留各自原值。
- 迁移期间同步修订 PRD（清单见第 4 节）。

**验收**：手机 A 添加线索，手机 B 刷新可见且添加人正确；手机 A 清空浏览器数据后重新打开，全量恢复；断网时可浏览、写入被拦截并提示；`npm test` 全绿（新增服务端与同步回归测试）。

### 阶段 3 · 公网部署 + 登录（1-2 天）

**目标**：两人从公网安全访问，登录一步到位。

- Docker Compose：app 容器 + cloudflared 容器（Postgres 用现成实例）；app 只暴露给内部网络，`HOST` 绑内网。
- Cloudflare 侧：Tunnel 指到 app；Access 应用覆盖整个域名，策略 = 两人邮箱白名单 + One-time PIN 登录，会话有效期拉长（如 30 天），日常基本无感。
- 后端 JWT 校验中间件：验证 `Cf-Access-Jwt-Assertion`（RS256，`node:crypto` 实现，公钥从 `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` 拉取并缓存）。所有 `/api/*` 与页面请求必须带有效 JWT——内网设备直连端口时没有 CF 签发的 JWT，天然被拒，家庭内网也统一走公网域名访问。
- 身份映射：`members` 表（见 3.2）将 Access 邮箱映射到 `xiaowang`/`xiaozhang`；保存线索时自动写入归属，表单保留手动修改。
- `.env.example` 清理：`SESSION_SECRET` 不再需要（无自建会话），移除或标注废弃。

**验收**：无登录态访问公网域名被 Access 拦截；伪造/缺失 JWT 直连 origin 端口被 401；小王邮箱登录后保存的线索自动归属小王；两人手机各自完成一次真实登录与保存。

### 阶段 4 · 上传能力与离线体验（2-3 天）

**目标**：自产内容也纳入快照体系；PWA 离线完整可用。

- 图片上传端点（multipart，≤10MB，仅登录用户）：
  - 到店轻反馈支持**拍照/相册上传**，补实现 PRD 已定义的 `VisitRecord.photoUrl` 与 `eatenDishNames`；
  - 店铺/菜品封面编辑同时支持「粘贴链接抓取」与「本地上传」两条路。
- Service Worker 缓存同源 `/covers/*`（现在是同源资源了），离线翻「想去」列表带图。
- 服务端定时备份：每日 `pg_dump` + `data/covers/` 打包，保留最近 N 份于 volume；前端「导出 JSON 备份」保留为个人可移植逃生门。

**验收**：到店记录可拍照上传并在「已去过」展示；飞行模式下打开 App，「想去」列表封面完整；备份目录出现按日归档文件。

### 阶段 5 · UI 重设计（另案，见 UI-REDESIGN-SPEC.md）

业务地基完成后执行。预览稿（zhongcao-finesse-ui-preview-v2.png）的插画风格不作为真实条目封面，转化为**分类占位图系统**（面/串/锅/饮等），覆盖缺图与抓取失败场景。

## 3. 设计要点

### 3.1 领域逻辑留在前端（关键取舍）

`domain.js` 是纯函数状态机，覆盖状态重算、级联软删、计划去重等全部业务规则，且有完整测试。本方案**不把领域逻辑搬到服务端**：前端继续执行领域函数，把变更后的实体行推送服务端存储。服务端职责收敛为「认证 + 行级持久化 + 图片资产 + 备份」。

- 收益：改造面最小，现有测试全部保值；两人规模下客户端逻辑分叉风险可控。
- 边界：若未来出现第三方客户端或自动化写入，再评估领域层下沉。

### 3.2 表结构草案（阶段 2 开工时出正式 DDL）

```sql
-- 实体统一存 jsonb，与前端 migrateState/DATA_VERSION 机制天然兼容，
-- 字段演进无需 DDL 迁移；查询模式为全量拉取，无需列级索引。
CREATE TABLE entities (
  entity_type text NOT NULL,        -- inboxItem | store | dish | plan | visitRecord | tag
  id          text NOT NULL,
  updated_at  timestamptz NOT NULL,
  deleted_at  timestamptz,
  payload     jsonb NOT NULL,
  PRIMARY KEY (entity_type, id)
);

CREATE TABLE members (
  added_by     text PRIMARY KEY,    -- xiaowang | xiaozhang
  display_name text NOT NULL,       -- 小王 | 小张（支持将来改名）
  email        text UNIQUE NOT NULL,-- Access 登录邮箱
  enabled      boolean NOT NULL DEFAULT true
);
```

回收站、撤销等语义继续由 payload 内字段（`deletedAt` 等）+ 前端领域逻辑承担；`deleted_at` 列仅作服务端查询冗余。

### 3.3 API 面草案

| 端点 | 用途 | 阶段 |
|---|---|---|
| `POST /api/link-preview` | 既有解析，扩展：落盘封面、返回自有路径、`sourceDescription` | 1 |
| `POST /api/cover-fetch` | 按 URL 抓图落盘，返回自有路径 | 1 |
| `GET /covers/*` | 图片静态服务，immutable 缓存 | 1 |
| `GET /api/state` | 全量拉取（起步够用；后续可加 `?since=` 增量） | 2 |
| `POST /api/entities:sync` | 批量 upsert 实体行，`updatedAt` 新者胜，返回被拒绝/更新的行 | 2 |
| `POST /api/import` | 一次性迁移灌库（可为脚本而非常驻端点） | 2 |
| `GET /api/me` | 返回 JWT 对应成员（addedBy、显示名），前端用于自动归属 | 3 |
| `POST /api/upload` | multipart 图片上传 | 4 |

所有 `/api/*` 自阶段 3 起要求有效 Access JWT。

### 3.4 图片存储约定

- 目录：`data/covers/`（抓取）与 `data/uploads/`（用户上传），均在 Docker volume。
- 命名：内容寻址（URL 或文件内容的 sha256 前 16 位 + 扩展名），重复收藏同图零成本。
- 体量估算：单张原图 100KB-1MB，千条收藏约 0.1-1GB，X86 磁盘无压力；真成问题再考虑转码压缩。

## 4. PRD 修订清单（随阶段 2 落笔）

1. **Architecture Overview**：后端由「不保存用户数据」改为「PostgreSQL 主存储 + 图片资产托管」；前端 IndexedDB 定位改为离线镜像缓存。
2. **Security & Privacy** 重写：数据保存在自托管 Postgres；访问由 Cloudflare Access 双人白名单控制；隐私边界 = 自有服务器；图片自托管仅限私人使用，不对外分发。
3. **Non-Goals** 调整：移出「账号登录」「云同步」「本地导出/导入备份」（均已提前实现）；「多人协作/公开产品化」仍为 Non-Goal。
4. **数据对象**：`coverImageUrl`/`photoUrl` 语义改为自有路径；InboxItem 增补 `sourceDescription`；新增 Member 对象说明。
5. **Phased Rollout** 重排：v1.1/v2.0 清单按本方案实际顺序更新。
6. **AddedBy 规则**：补「登录自动归属，允许手动修正」。

## 5. 风险与边界

| 风险 | 应对 |
|---|---|
| 平台反爬导致解析成功率有限 | 既有 partial/手动兜底流程不变；分享文案解析是最稳信息源，持续增强；不绕登录墙、不违反平台限制 |
| 小红书图片链接在阶段 1 上线前批量过期 | 阶段 0/1 尽快执行；过期部分靠占位图 + 手动换封面兜底 |
| 两人同时编辑同一对象 | 行级 `updatedAt` 新者胜；两人规模冲突概率极低，不做协同合并 |
| 后端引入 `pg` 依赖 | 唯一后端依赖，锁版本；连接串仅存于 X86 环境变量 |
| Access 配置失误导致裸奔 | 阶段 3 验收项明确包含「未登录被拦 + 伪造 JWT 被 401」两条硬检查 |
| 服务器磁盘/数据库故障 | 阶段 4 每日 pg_dump + covers 打包；前端 JSON 导出保留为逃生门 |

## 6. 实施纪律

- 每阶段独立分支/提交，附回归测试（沿用 `node --test` 体系），`npm test` 全绿再合并。
- 阶段顺序不可颠倒：**先持久化（阶段 2）后公网（阶段 3）**，避免两人先各自产生分叉数据。
- 涉及生产数据的动作（迁移灌库、清库）执行前必须先完成对应备份并经用户确认。
- 每阶段完成后更新 README 的运行/部署说明。
