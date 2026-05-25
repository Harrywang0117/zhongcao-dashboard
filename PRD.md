# 种草软件 v1 产品需求文档

## 1. Executive Summary

### Problem Statement

用户在大众点评、小红书、抖音等平台看到想吃的店铺或菜品后，内容分散在不同 App 和链接里。传统收藏容易变成“链接堆”，后续很难想起为什么收藏、想吃什么、适合什么时候去，也很难真正转化成一次到店行动。

### Proposed Solution

构建一个手机优先的个人 PWA，用“收件箱”承接所有种草线索，再把线索整理成店铺、菜品、日历计划和到店轻反馈。产品核心闭环是：看见种草内容 → 快速保存 → 轻量整理 → 计划日期 → 到店后留下一个简单判断。

### Success Criteria

- 连续 4 周内，用户每周至少主动使用 3 次。
- 从粘贴链接到保存一条收件箱线索，核心路径在 15 秒内完成。
- 链接解析失败时，用户仍能在 30 秒内保存一条可识别线索。
- 收件箱中 70% 以上线索最终被整理为店铺或菜品。
- 已计划内容中 30% 以上最终产生到店轻反馈。

## 2. User Experience & Functionality

### User Personas

主要用户是个人美食探索者。用户经常在大众点评、小红书、抖音等平台看到店铺或菜品推荐，希望先快速保存，再按照品类、口味、商圈、时间段等条件筛选，安排某一天去吃，并在到店后留下轻量判断。v1 面向个人自用，不做公开社区、多人协作或商业化店铺管理。

### Information Architecture

v1 使用 5 个底部导航入口：

- **收件箱**：第一入口，用于粘贴链接、保存线索、查看解析状态、重新解析、快速整理。
- **想去**：主行动页，聚合未去过的店铺和菜品，支持搜索、标签筛选、商圈筛选、列表/图列切换。
- **日历**：展示已安排日期的店铺或菜品，支持改期、放回想去、不想去了。
- **已去过**：展示到店轻反馈记录。
- **我的**：管理默认标签、自定义标签、回收站、本地数据版本信息。

### Core User Flow

```text
看到种草内容
→ 粘贴链接到收件箱
→ 系统尝试解析平台、标题、封面图
→ 解析失败或信息不可识别时，用户补充标题/店名/菜名
→ 保存为 InboxItem
→ 使用快速整理模板转成 Store、Dish 或 Store + Dish
→ 添加标签、城市、商圈、地址备注、适合时间段
→ 出现在想去列表
→ 选择日期后进入日历
→ 到店后选择「还想去 / 一般 / 不再去」
→ 进入已去过视图
```

### User Stories

- As a user, I want to paste a link quickly so that I can save a food recommendation before I forget it.
- As a user, I want failed or low-information links to still be saveable with a title, shop name, or dish name so that my inbox does not become useless URLs.
- As a user, I want to organize clues into stores and dishes so that I can browse by where to go or what to eat.
- As a user, I want tags, search, business district, and time-period filters so that I can quickly decide what fits the current situation.
- As a user, I want to schedule stores or dishes on a date so that recommendations can become real plans.
- As a user, I want to mark visited places with a light three-button feedback so that reviewing does not feel like homework.
- As a user, I want recoverable destructive actions so that mistaken delete, mistaken status change, or mistaken “not interested” actions do not permanently damage my collection.

### Acceptance Criteria

- 收件箱支持粘贴链接、解析状态展示、解析失败兜底、重新解析、快速整理。
- 如果链接解析失败，或只得到平台壳标题（如“小红书”“抖音”），保存前必须填写标题、店名或菜名之一。
- 快速整理模板包含：保存为店铺、保存为菜品、店铺 + 菜品、暂留线索。
- 店铺和菜品支持列表/图列切换、搜索、标签筛选、商圈筛选。
- 整理后的店铺和菜品必须支持编辑名称、标签、备注和封面；店铺还支持编辑城市、商圈、地址备注，菜品支持调整绑定店铺。
- 搜索范围包含店名、菜名、商圈、地址备注、备注、标签；菜品绑定店铺后也能通过店铺商圈被搜索到。
- 标签系统支持默认标签和自定义标签；自定义标签可用于展示、搜索和筛选。
- 店铺支持多个来源链接；疑似重复店铺时提示合并来源。
- 日历只按日期计划，不做具体时间；计划支持改期、放回想去、不想去了。
- 同一店铺或菜品在同一天只能存在一个有效计划；重复安排同一天时不能产生重复日历卡片。
- 同一店铺或菜品存在多个未来计划时，单个计划“放回想去”只取消该日期计划；如果仍有其他未来计划，目标状态必须继续保持“已计划”。
- 日历中的“不想去了”表示该店铺或菜品整体不想去了，应取消该目标下全部未完成计划，并可在“我的”中放回想去。
- 同一店铺或菜品存在多个未来计划时，一次到店轻反馈只完成对应日期的计划，不能误完成全部未来计划；撤销该轻反馈时，需要把由它完成的计划恢复到日历中，除非同日仍存在其他有效轻反馈。
- 到店轻反馈只强制日期和三按钮反馈：还想去、一般、不再去；备注、照片、实际吃过菜品均为可选。
- 删除店铺或菜品时，关联计划和到店轻反馈不能继续以“已删除项目”出现在日历或已去过视图；关联记录应随主对象进入回收站，并在恢复主对象时一并恢复由本次删除带出的记录。
- 删除、误标记、误点不想去了、误记录轻反馈等关键操作必须可撤销或可从回收/历史中恢复。
- 封面图失效时显示平台占位图，并允许手动更换封面链接。
- 本地数据包含版本号和迁移机制，避免升级后字段错乱或数据不可读。

### Non-Goals

v1 不做以下能力：

- 账号、登录、云同步、团队协作。
- 地图定位、附近想去、实时距离。
- 系统日历同步。
- 人均预算、价格档位。
- 来源可信度专门字段。
- 排队、预约、停车、离地铁远等限制条件专门字段。
- 本地导出/导入备份。
- PWA 系统分享入口。
- 公开社区、点评发布、店铺营销能力。

## 3. AI System Requirements

v1 不依赖生成式 AI。

### Tool Requirements

- 链接预览解析使用普通网页解析、Open Graph 元信息、标题解析、URL 规范化和平台域名识别。
- 支持大众点评、小红书、抖音相关链接的平台识别。
- 如果平台限制访问、链接无法解析，或只解析到平台壳标题，系统必须进入手动兜底流程。

### Evaluation Strategy

v1 不评估 AI 生成质量。链接解析质量按以下方式评估：

- 支持平台识别准确率：常见大众点评、小红书、抖音链接识别准确率 >= 95%。
- 解析失败兜底完成率：解析失败时用户仍可保存可识别线索。
- 低信息解析检测：标题仅为平台名、空标题、默认壳标题时，不应被视为完整成功解析。

未来如加入 AI 自动识别店名、菜品或标签，需要单独定义人工确认流程、准确率指标和错误回退机制。

## 4. Technical Specifications

### Architecture Overview

产品采用手机优先 PWA 架构。前端负责主要交互、本地状态管理和 IndexedDB 持久化；轻后端只提供 `/api/link-preview` 链接预览解析，不保存用户收藏、计划、标签或到店记录。

核心数据流：

```text
用户粘贴链接
→ 前端请求 /api/link-preview
→ 后端返回平台、规范化 URL、标题、封面图、内容类型、解析状态
→ 前端根据解析质量决定是否要求手动补充
→ 保存 InboxItem 到本机 IndexedDB
→ 用户整理为 Store/Dish
→ 用户创建 Plan
→ 用户创建 VisitRecord
```

### Core Data Objects

#### InboxItem

原始种草线索。

字段包括：

- `id`
- `sourceUrl`
- `normalizedUrl`
- `platform`
- `parseStatus`
- `title`
- `userLabel`
- `previewImageUrl`
- `contentType`
- `failureReason`
- `note`
- `triageStatus`
- `deletedAt`
- `createdAt`
- `updatedAt`

#### Store

店铺对象，是行动主对象。

字段包括：

- `id`
- `name`
- `city`
- `businessDistrict`
- `addressNote`
- `status`
- `tagNames`
- `sourceLinks`
- `coverImageUrl`
- `note`
- `deletedAt`
- `createdAt`
- `updatedAt`

状态包括：

- `want`
- `planned`
- `visited`
- `not_interested`

#### Dish

菜品对象，是兴趣主对象。菜品可独立存在，也可绑定店铺。

字段包括：

- `id`
- `storeId`
- `name`
- `status`
- `tagNames`
- `coverImageUrl`
- `note`
- `deletedAt`
- `createdAt`
- `updatedAt`

状态包括：

- `want`
- `planned`
- `eaten`
- `not_interested`

#### Plan

计划对象，关联店铺或菜品。

字段包括：

- `id`
- `targetType`
- `targetId`
- `date`
- `status`
- `deletedAt`
- `createdAt`
- `updatedAt`

状态包括：

- `scheduled`
- `backlog`
- `completed`
- `not_interested`

#### VisitRecord

到店或吃过后的轻反馈记录。

字段包括：

- `id`
- `storeId`
- `dishId`
- `date`
- `feedback`
- `note`
- `photoUrl`
- `eatenDishNames`
- `completedPlanIds`
- `deletedAt`
- `createdAt`
- `updatedAt`

反馈值包括：

- `want_again`
- `ok`
- `no_again`

#### Tag

标签对象，支持默认标签和自定义标签。

字段包括：

- `id`
- `name`
- `group`
- `isDefault`

标签分组包括：

- `category`：品类，如火锅、烧烤、日料、甜品。
- `taste`：口味，如辛辣、清淡、酸甜、重口。
- `time`：时间段，如午餐、晚餐、夜宵、下午茶、周末。
- `scene`：场景，如聚餐、一个人吃、约会。
- `custom`：用户自定义。

#### SourceLink

来源链接对象。

字段包括：

- `id`
- `platform`
- `originalUrl`
- `normalizedUrl`
- `title`
- `imageUrl`
- `contentType`
- `parseStatus`
- `createdAt`

### Integration Points

#### POST `/api/link-preview`

输入：

```json
{
  "url": "https://example.com"
}
```

输出：

```json
{
  "status": "success | failed | partial",
  "platform": "大众点评 | 小红书 | 抖音 | 未知平台",
  "originalUrl": "string",
  "normalizedUrl": "string",
  "title": "string",
  "imageUrl": "string",
  "contentType": "store | note | video | link | unknown",
  "failureReason": "string"
}
```

解析规则：

- 平台无法识别：`failed`。
- 平台可识别但无法取得有效标题：`partial`。
- 标题、平台、规范化 URL 至少具备足够识别信息：`success`。
- `failed` 和 `partial` 都必须允许用户手动补充后保存。

### Security & Privacy

- 用户收藏数据默认只保存在本机 IndexedDB。
- 后端不保存收藏内容、计划内容、到店记录、标签或用户行为。
- 不绕过平台登录、付费墙、反爬限制或隐私限制。
- 本地数据迁移必须向后兼容旧数据结构。
- 网络请求失败时不得阻断手动保存流程。

### Performance Requirements

- 首屏加载后 1 秒内可看到收件箱输入入口。
- 10,000 条本地记录内，搜索和筛选响应目标小于 300ms。
- 链接预览请求超时时间不超过 4 秒，超时后进入手动兜底。
- 本地保存操作应在 500ms 内完成。

## 5. Risks & Roadmap

### Phased Rollout

#### v1：完整个人版

- 收件箱快速保存。
- 链接解析和手动兜底。
- 解析失败或低信息解析后重新解析。
- 店铺/菜品双视图。
- 列表/图列切换。
- 默认标签 + 自定义标签。
- 搜索和标签筛选。
- 城市、商圈、地址备注。
- 日历按日期计划。
- 计划改期、放回想去、不想去了。
- 到店轻反馈。
- 回收站和撤销能力。
- 店铺/菜品编辑。
- 手动更换封面链接。
- 封面图兜底。
- 本地数据版本管理。

#### v1.1

- 本地导出/导入备份。
- 价格/人均预算。
- 来源可信度。
- 限制条件标签强化，如排队、预约、停车、距离地铁。
- 更细的重复店铺合并界面。

#### v2.0

- 账号与云同步。
- 地图、定位、附近想去。
- 系统日历同步。
- PWA 系统分享入口。
- 多人协作或公开产品化。
- AI 辅助识别店名、菜品和标签。

### Technical Risks

- 大众点评、小红书、抖音链接解析可能失败，必须保留手动兜底和重新解析。
- 平台页面可能只返回壳标题，系统不能把这类结果视为完整成功。
- 预览图可能缺失或失效，必须提供平台占位图和后续手动改封面能力。
- 本机数据可能因清缓存丢失，导出/导入应在 v1.1 优先实现。
- 重复店铺会污染数据，v1 需要支持多个来源链接和疑似重复合并。
- 复盘过重会降低使用频次，v1 必须只强制三按钮轻反馈。
- 误点“不想去了”或误标记“已去过”会影响数据质量，相关操作必须可恢复。
- 多个计划并存时容易出现目标状态和日历状态不一致，必须通过统一的目标状态重算规则处理计划、轻反馈、删除和恢复。
- 链接预览后端若部署公网，需要限制最终抓取 URL 仍属于原支持平台，避免被当作通用代理访问内网或无关外部地址。

### Current Implementation Status

截至 2026-05-24 当前开发版本，核心 v1 闭环和多轮审查问题已完成修复并补充回归测试：

- 支持平台链接若只解析到平台壳标题，会标记为 `partial`，并要求用户补充标题、店名或菜名。
- 菜品搜索已继承绑定店铺的名称、城市、商圈、地址备注和标签。
- 筛选区展示全部默认标签和自定义标签，不再截断前 18 个。
- 标记到店轻反馈后，关联的已排期计划会自动变为 `completed`，不再停留在日历。
- “不想去了”可以在“我的”中放回想去，误标记轻反馈可以撤销并从回收站恢复。
- 重新解析收件箱线索时，如果用户已经手动补过标题、店名或菜名，不再用平台壳标题覆盖用户输入。
- 同一店铺或菜品有多个未来计划时，到店轻反馈只完成同日期计划，未来计划继续保留在日历。
- 撤销轻反馈时，由该轻反馈完成的同日计划会恢复为已排期，目标状态随日历和轻反馈重新计算。
- 同一店铺或菜品同一天重复安排时不会创建重复计划。
- 多个计划并存时，放回单个计划不会误把仍有计划的店铺或菜品改成“想去”；点击“不想去了”会取消该目标全部未完成计划，保持目标状态和日历一致。
- 删除店铺或菜品会级联软删除关联计划和轻反馈，避免日历或已去过出现“已删除项目”；恢复主对象时恢复由该次删除带出的关联记录。
- 想去卡片已支持编辑店铺和菜品资料；店铺支持名称、城市、商圈、地址备注、标签、封面链接、备注，菜品支持名称、绑定店铺、标签、封面链接、备注。
- 链接预览服务已限制抓取 URL 必须是 HTTPS、无账号密码、且最终跳转后仍属于原支持平台。

### Assumptions

- 产品名暂用“种草软件”。
- 项目目录为 `/Users/wangjunpeng/Desktop/AI小玩具/种草项目`。
- 当前技术方案为移动优先 PWA、本地 IndexedDB、轻后端 link-preview API。
- 成功标准优先看个人持续真实使用，而不是公开用户增长。
