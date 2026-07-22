# 种草软件图片获取与封面快照后端方案

制定日期：2026-07-21

状态：方案草案，待确认后实施

关联方案：[IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)

## 1. 问题定义

当前 `/api/link-preview` 同时承担两件事：

1. 从用户粘贴的分享文案中解析店名、评分、人均、地址等文本信息。
2. 请求平台页面，从 `og:image` / `twitter:image` 取得封面外链。

这两件事的成功条件不同。以 2026-07-21 实测的大众点评店铺
`k30Ld5XSgFERQgYE` 为例：

- 分享文本解析成功，店名、城市、商圈、地址、评分和人均均可取得。
- 无登录后端访问店铺页时被重定向到 `shopinfo/login-redirect`。
- 登录页只有通用标题“大众点评”，没有 `og:image` 或 `twitter:image`。
- 当前接口仍返回 `status: success`，但 `imageUrl` 为空。
- 当前代码还会把 `sourceKey` 错误改成 `dianping:store:login-redirect`，覆盖真实店铺 ID。

因此，后端必须把“内容解析”和“图片获取”拆成两个独立状态；图片自动获取只能是
best-effort，不能再作为文本解析成功的隐含组成部分。

## 2. 目标与非目标

### 2.1 本阶段目标

- 准确识别平台登录页、验证码页和通用壳页面。
- 保留原始内容 URL、平台内容 ID 和稳定 `sourceKey`。
- 为图片获取返回独立、可操作的结构化状态。
- 自动取得图片时立即下载到自有 `data/covers/`，不长期保存第三方图片外链。
- 自动取图失败时允许前端上传本地图片，并使用同一套自托管路径。
- 服务重启和平台原图失效后，已经保存的封面仍可访问。
- 不引入平台账号、Cookie、登录绕过或无头浏览器依赖。

### 2.2 本阶段非目标

- 不承诺大众点评、小红书、抖音等平台每条链接都能自动取得图片。
- 不绕过登录墙、验证码或平台访问限制。
- 不在本阶段实现图片识别、视频 OCR、语音识别或自动选取最佳菜品图。
- 不在本阶段实现通用媒体库、到店照片和多图相册。
- 不改变 PostgreSQL 主存储和 Cloudflare Access 的后续阶段顺序。

## 3. 推荐数据流

```text
用户粘贴分享文案
        │
        ▼
解析文本与原始内容 ID
        │
        ├─ 文本成功 ─────────────────────────────┐
        │                                         │
        ▼                                         │
请求平台公开页面                                  │
        │                                         │
        ├─ 登录/验证码/壳页面                     │
        │      └─ imageStatus = blocked           │
        │                                         │
        ├─ 没有图片元数据                         │
        │      └─ imageStatus = not_found         │
        │                                         │
        └─ 取得图片外链                           │
               │                                 │
               ▼                                 │
        校验并下载图片                            │
               │                                 │
               ├─ 成功：存入 data/covers/        │
               │        返回 /covers/<hash>.<ext>│
               └─ 失败：返回结构化图片失败原因   │
                                                  │
        ┌─────────────────────────────────────────┘
        ▼
前端保存文字；缺图时提供相册/拍照补图
```

## 4. API 契约调整

### 4.1 `POST /api/link-preview`

保留现有字段，避免一次性破坏前端和旧数据；新增图片与元数据状态字段。

建议响应：

```json
{
  "status": "success",
  "platform": "大众点评",
  "normalizedUrl": "https://m.dianping.com/shopinfo/k30Ld5XSgFERQgYE?...",
  "resolvedUrl": "https://m.dianping.com/shopinfo/k30Ld5XSgFERQgYE?...",
  "sourceKey": "dianping:store:k30Ld5XSgFERQgYE",
  "title": "净味鲜烧烤(天府大悦城店)",
  "imageUrl": "",
  "metadataStatus": "blocked",
  "metadataFailureCode": "platform_login_required",
  "metadataFailureReason": "大众点评向服务器返回了登录页面",
  "imageStatus": "blocked",
  "imageSource": "none",
  "imageFailureCode": "platform_login_required",
  "imageFailureReason": "平台限制自动获取封面，可手动添加图片"
}
```

兼容规则：

- 顶层 `status` 继续表示文本/内容是否足以保存，不用“缺图”把有效文字降级成失败。
- `imageUrl` 只返回自有 `/covers/...` 路径或空字符串，不再把新取得的第三方外链写入业务数据。
- `resolvedUrl` 只接受真实内容页；登录页、验证码页和通用壳页面不得覆盖它。
- `sourceKey` 始终从原始或已验证的内容 URL 生成，不从登录跳转地址生成。

建议枚举：

| 字段 | 值 | 含义 |
|---|---|---|
| `metadataStatus` | `success` | 页面元数据有效 |
|  | `blocked` | 登录、验证码或平台挑战页 |
|  | `failed` | 超时、网络或响应格式失败 |
| `imageStatus` | `stored` | 图片已保存到自有存储 |
|  | `not_found` | 页面可访问但没有图片元数据 |
|  | `blocked` | 平台页面限制导致无法取得图片 |
|  | `download_failed` | 已取得图片 URL，但下载或校验失败 |
|  | `unsupported` | 该平台不进行自动图片解析 |
| `imageSource` | `automatic` | 从平台元数据自动取得 |
|  | `manual` | 用户上传 |
|  | `none` | 当前没有封面 |

### 4.2 `POST /api/cover-upload`

供前端从相册、拍照或粘贴图片后补封面。本阶段建议直接上传原始二进制，避免为了单文件上传
引入 multipart 解析依赖。

请求：

- Body：图片二进制。
- `Content-Type`：`image/jpeg`、`image/png`、`image/webp`、`image/avif` 或 `image/gif`。
- 单张最大 5MB。

响应：

```json
{
  "imageStatus": "stored",
  "imageSource": "manual",
  "imageUrl": "/covers/7f/7f47a1c2c6b8e901.webp"
}
```

### 4.3 `POST /api/cover-fetch`

仅用于把已有的第三方图片 URL 迁移到自有存储，不负责从内容页面发现图片。

安全边界：

- 在 Cloudflare Access 上线前，不对公网开放通用远程抓图能力。
- 第一阶段优先只允许平台解析器刚刚发现的图片 URL，或已知平台 CDN 白名单。
- 如果以后允许任意远程图片 URL，必须完整实现 DNS/IP 校验和重定向校验，不能只检查 HTTPS。

### 4.4 `GET /covers/<hash>.<ext>`

- 只接受严格的内容哈希文件名，不接受任意路径。
- 返回正确 `Content-Type`。
- 添加 `Cache-Control: public, max-age=31536000, immutable`。
- 添加 `X-Content-Type-Options: nosniff`。
- 路径穿越、未知扩展名和不存在文件返回 404。

## 5. 后端内部改造

### 5.1 拆分抓取结果

将当前 `fetchOpenGraphMetadata()` 从“返回若干字段或失败对象”改为稳定的结构：

```js
{
  status: "success | blocked | failed",
  canonicalUrl: "...",
  observedUrl: "...",
  title: "...",
  description: "...",
  imageSourceUrl: "...",
  failureCode: "...",
  failureReason: "..."
}
```

其中：

- `canonicalUrl` 是可以进入业务数据的真实内容 URL。
- `observedUrl` 只用于诊断本次请求最终看到了什么，不参与 `sourceKey`。
- 识别到登录页后立即停止图片提取，不把通用标题“大众点评”当作有效元数据。

### 5.2 平台阻断识别

第一批规则：

- 大众点评：路径包含 `/shopinfo/login-redirect`。
- 通用规则：最终页面只有平台壳标题，且同时没有描述、图片和内容标识。
- 后续按真实样例补充验证码和挑战页规则，不用一个宽泛正则猜测所有平台。

检测到阻断页时：

- 保留原始 `normalizedUrl` 和平台内容 ID。
- 返回 `metadataStatus: blocked`。
- 返回平台专用失败码，例如 `platform_login_required`。
- 本次请求不继续重复尝试多个 User-Agent，避免增加延迟和触发更严格限制。

### 5.3 封面存储服务

新增 `server/cover-store.mjs`，负责自动抓图和手动上传的共同落盘逻辑：

1. 流式读取，超过 5MB 立即中止。
2. 仅允许 JPEG、PNG、WebP、AVIF、GIF；明确拒绝 SVG。
3. 同时校验响应 `Content-Type` 和文件魔数，防止伪装文件。
4. 下载完成后对文件内容计算 SHA-256，以内容哈希命名，而不是按临时签名 URL 命名。
5. 先写入同目录临时文件，再原子重命名，避免进程中断留下半张图片。
6. 相同内容重复抓取时复用已有文件。
7. 只向业务层返回相对路径 `/covers/...`。

建议目录：

```text
data/
└── covers/
    ├── 7f/
    │   └── 7f47a1c2c6b8e901.webp
    └── a2/
        └── a2c18e37f4529a90.jpg
```

两级目录避免未来所有文件堆在同一目录。

### 5.4 远程图片抓取安全

远程图片抓取本质上是服务器代用户访问 URL，必须按 SSRF 高风险接口处理：

- 仅允许 HTTPS，拒绝账号密码和非标准端口。
- 拒绝 IP 字面量。
- DNS 解析后拒绝 loopback、private、link-local、multicast、保留地址和云元数据地址。
- 每一跳重定向重新校验，最多 3 跳。
- 总超时 4 秒，流式上限 5MB。
- 限制并发与每分钟请求数。
- 不携带用户 Cookie、Authorization 或平台登录凭据。
- 不把上游错误正文回传给前端。

如果暂时无法可靠完成 DNS 固定和重绑定防护，第一阶段就只允许明确的图片 CDN 白名单，
不要上线“任意 URL 远程抓图”。

### 5.5 配置和部署

在 `server/config.mjs` 与 `.env.example` 增加：

```text
DATA_DIR=./data
```

固定安全参数建议保留在代码中，不开放成任意环境变量：

- 图片上限 5MB。
- 抓取超时 4 秒。
- 图片重定向最多 3 次。
- 允许的图片类型列表。

部署要求：

- `data/` 加入 `.gitignore`。
- X86/Docker 将 `data/` 挂载为持久 volume。
- 应用进程对 `data/covers/` 有最小读写权限。
- 备份必须包含 `data/covers/`，不能只备份 PostgreSQL 或 JSON。

## 6. 建议文件边界

保持改造小而清晰：

```text
server.mjs                    路由、JSON 响应、静态文件入口
server/config.mjs             HOST、PORT、DATA_DIR
server/preview-fetch.mjs      页面抓取、逐跳校验、阻断页识别、元数据提取
server/cover-store.mjs        图片下载、上传、校验、哈希和原子落盘
tests/server.test.js          API 与路由回归
tests/preview-fetch.test.js   登录跳转、元数据和失败码
tests/cover-store.test.js     图片安全、大小、去重和落盘
```

不建议继续把所有逻辑堆进 `server.mjs`，也不需要为了本阶段引入完整后端框架。

## 7. 前端对接边界

后端方案落地后，前端只依赖以下稳定约定：

- `status` 表示文字是否可保存。
- `imageStatus` 决定显示真实封面、缺图提示还是手动补图入口。
- `imageUrl` 非空时一定是同源 `/covers/...`。
- `imageFailureReason` 使用面向用户的短说明，不暴露内部网络细节。
- 用户上传成功后，前端只把返回的 `/covers/...` 写入 `previewImageUrl` 或 `coverImageUrl`。

存量迁移时：

- 已有非空第三方图片外链：串行调用 `cover-fetch`，成功后替换为自有路径。
- 已有空图片：不做无意义的循环重试，显示“添加封面”。
- 迁移并发固定为 1，避免当前状态闭包和 IndexedDB 整体保存互相覆盖。

## 8. 测试计划

### 8.1 必须新增的自动化测试

1. 大众点评登录跳转被识别为 `blocked`。
2. 登录跳转不能覆盖原始 `resolvedUrl` 和 `sourceKey`。
3. 文本解析成功但图片受限时，顶层 `status` 仍可保存，`imageStatus` 为 `blocked`。
4. 有效 `og:image` 被下载后返回 `/covers/...`。
5. 图片下载失败时不保存第三方外链。
6. 超过 5MB 的图片在流式读取过程中被中止。
7. 假 `Content-Type`、错误魔数和 SVG 被拒绝。
8. 私网地址、重定向到私网和路径穿越被拒绝。
9. 相同图片内容重复保存返回同一路径。
10. 临时文件写入失败不会留下可被公开访问的半成品。
11. `GET /covers/*` 的缓存头、类型和 404 行为正确。
12. `cover-upload` 成功、超限和错误格式均有结构化响应。

自动化测试继续注入模拟 `fetch`，不把真实平台是否返回图片作为 CI 成败条件。

### 8.2 手工验收样例

- 最新大众点评样例 `k30Ld5XSgFERQgYE`：
  - 文字字段正确。
  - `sourceKey = dianping:store:k30Ld5XSgFERQgYE`。
  - `imageStatus = blocked`。
  - 前端出现“添加封面”，而不是假装完整成功。
- 一个真实可公开返回 `og:image` 的页面：
  - 保存后 `imageUrl` 为 `/covers/...`。
  - 平台原图片断开后仍能显示。
- 手机相册上传：
  - 上传成功后卡片立即显示。
  - 重启服务后仍能显示。

## 9. 实施顺序与停止线

### P0：先修判断正确性（约 0.5 天）

- 拆分元数据与图片状态。
- 识别大众点评登录跳转。
- 保留原始 `resolvedUrl` 和 `sourceKey`。
- 增加结构化失败码与回归测试。

完成线：最新大众点评样例不再出现“图片为空但接口假装完整成功”，且店铺 ID 不丢失。

### P1：自动封面快照（约 1 天）

- 实现 `cover-store`。
- `/api/link-preview` 取得图片后立即落盘。
- 实现 `/covers/*` 静态服务和持久目录。
- 补图片安全和存储测试。

完成线：可获取图片的公开页面返回同源封面，重启后仍可访问。

### P2：手动上传兜底（约 0.5-1 天）

- 实现 `POST /api/cover-upload`。
- 前端增加相册/拍照入口和图片状态提示。
- 上传图片进入同一内容寻址存储。

完成线：大众点评自动图片失败时，用户能在一次补图操作后得到永久封面。

### P3：存量迁移和部署（约 0.5 天）

- 只迁移仍然有效的第三方图片外链。
- 空图片进入手动补图队列，不无限自动重试。
- 挂载 X86 volume，并验证备份包含 `data/covers/`。

停止线：

- 如果 P0 完成后平台仍返回登录页，不继续通过伪造 Cookie、批量 User-Agent 或无头浏览器绕过。
- 如果通用远程抓图的 SSRF 防护无法可靠完成，先不上线 `/api/cover-fetch`，保留“自动内部抓取 + 本地上传”。
- 在持久 volume 和备份路径验证前，不执行存量图片批量迁移。

## 10. 推荐结论

后端不应再承诺“链接解析成功就一定有图”。正确产品契约是：

> 文本解析负责不丢线索；自动图片获取负责尽力丰富；手动上传负责确定性补图；自托管负责长期稳定。

建议按 P0 → P1 → P2 → P3 实施，不先上无头浏览器或平台登录态抓取。
