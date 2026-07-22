# 种草软件 UI 重设计规格

> 状态：设计方向已确认，待实施  
> 日期：2026-07-11  
> 适用仓库：`/Users/wangjunpeng/Desktop/AI小玩具/种草项目`  
> 配套预览：`zhongcao-finesse-ui-preview.png`  
> 设计真相源：根目录 `design-model.yaml`

## 1. 设计结论

`Design Read: 个人美食决策工具 · 城市食册 + 克制鲜活 · register=product · SOUL=7 · SPECTACLE=2 · DENSITY=7 · hero-engine=none`

这不是展示型美食网站，也不是点评社区。它是一款手机优先的个人美食决策工具，设计的第一目标是让用户快速完成四件事：收下线索、整理内容、决定去哪、留下轻反馈。

最终视觉方向定义为 **Urban Food Index / 城市食册**：

- 冷矿物灰作为底色，降低长时间使用的视觉疲劳。
- 椒红作为唯一品牌强调色，只用于主操作、焦点和关键状态。
- 使用高可读无衬线字体，不再使用“米纸 + 衬线 + 手帐装订线”的美食类默认审美。
- 真实或可信的食物图片承担食欲与记忆，界面装饰保持克制。
- 通过空间连续、状态反馈和轻微弹性制造精致感，不依靠大面积渐变、玻璃拟态或连续动画。

## 2. 规格优先级与边界

实施时按以下优先级处理冲突：

1. PRD、数据模型和领域规则。
2. 本文件的交互与页面结构。
3. `design-model.yaml` 的视觉和动效 token。
4. 现有 `FRONTEND_DESIGN.md` 中仍未冲突的可访问性、操作语义和验收要求。

本规格在视觉方向上替代 `FRONTEND_DESIGN.md` 中的“暖纸食帖”方案，但不替代其中的五栏信息架构、撤销逻辑、触控要求、表单语义和功能验收。

### 2.1 必须保护

- 五个底部入口：收件箱、想去、日历、已去过、我的。
- 当前数据模型、领域方法、IndexedDB/localStorage 边界和迁移逻辑。
- `addedBy` 的“小王 / 小张 / 未标记”语义。
- 删除、误标记、计划变更和轻反馈的撤销与恢复路径。
- JSON 备份导出、回收站和本地优先边界。
- 链接解析失败后的手动兜底。

### 2.2 本轮不增加

- 地图、附近推荐、公开社区、关注流和排行榜。
- 账号、头像、成员管理、权限和云同步。
- AI 推荐分数、虚构评分、虚构人均价格或没有来源的精确数字。
- 3D、WebGL、视差滚动、滚动劫持和无限装饰动画。
- 为了展示效果写入的生产模拟数据。

## 3. 灵感来源与取舍

| 来源 | 借鉴 | 明确不借鉴 |
| --- | --- | --- |
| 21st.dev Motion Primitives Dock | 激活项之间的空间连续、共享背景滑块、图标和标签同步 | 桌面 Dock 的鼠标放大、磁吸跟随、隐藏标签 |
| 21st.dev Slide Button | `idle → loading → success/error` 的状态形变、弹性参数、图标交叉淡入 | 拖拽提交、改变按钮物理宽度、把普通操作变成手势门槛 |
| 21st.dev Animated Tab Bar / Bottom Nav | 激活背景平滑移动、标签进出、触控友好 | 每个 Tab 改一套颜色、六个以上主入口、仅激活项显示标签 |
| 21st.dev Scroll Cards | 图片、标题、描述形成一个强记忆单元 | 卡片滚动堆叠、长页面滚动叙事、把产品列表做成品牌展示页 |
| Cosmos | 图片优先、收藏可检索、内容卡片靠来源与语义组织 | 社交发现流、创作者关注和视觉瀑布流照搬 |
| Mapstr / Beli | 标签、个人备注、想去/去过、可信来源与个人记忆 | 地图、社交排名、好友评分和推荐算法 |
| dérive | “每个地点带着添加者的声音”，与 `addedBy` 契合 | 米纸、衬线、深绿的类别默认视觉 |
| Santai | 每个页面只有一个明确决策动作 | 柔绿渐变、营销页式大字和随机推荐机制 |

## 4. 视觉系统

### 4.1 色彩 token

所有组件只能消费语义 token，不在 JSX 中新增零散 hex。

> 2026-07-21 落地修订：为贴合最终确认的预览稿 `zhongcao-finesse-ui-preview-v2.png`，底色/墨色由冷矿物调改为**暖中性调**（下表已更新）。`--color-muted` 同步压深至 `#6B6359`，确保 13–14px 次级文字在卡面上对比度 ≥ 4.5:1。语义色（danger/success/warning）不变。

| Token | 名称与值 | 用途 |
| --- | --- | --- |
| `--color-bg` | Warm Mist `#EEECE8` | 页面底色，暖中性灰 |
| `--color-surface` | Warm Chalk `#FCFBF9` | 卡片、输入框、底栏，不用纯白 |
| `--color-ink` | Warm Ink `#1D1B19` | 标题、选中底色、深色按钮、底栏滑块 |
| `--color-body` | Field Gray `#55504A` | 正文 |
| `--color-muted` | Quiet Stone `#6B6359` | 次级信息，已过对比度检查 |
| `--color-faint` | Mist Line `#948B7E` | 非正文的弱化图标和分隔 |
| `--color-accent` | Pepper `#E34A2C` | 唯一品牌强调色，主 CTA、焦点、关键徽标 |
| `--color-accent-pressed` | Pepper Deep `#C33C22` | 主操作按压态 |
| `--color-border` | `rgba(29,27,25,0.07)` | 轻边框 |
| `--color-overlay` | `rgba(13,22,18,0.52)` | 抽屉和对话框遮罩 |
| `--color-danger` | Cinder `#B42318` | 破坏性操作，必须配文字或图标 |
| `--color-success` | Pine `#2F6B4F` | 成功语义，不作为品牌强调色 |
| `--color-warning` | Ochre `#965B17` | 警告语义 |

色彩规则：

- 品牌强调色只有 Pepper。不要把绿色同时当作选中态和品牌色。
- 成功、警告、危险属于语义色，只在对应状态出现，并附带图标或文字。
- 不使用渐变文字。背景渐变仅限图片 scrim 或极弱页面光晕。
- 不使用纯 `#FFFFFF` / `#000000`。
- 图片上的白字必须配底部 scrim，正文对比度至少 4.5:1。

### 4.2 字体与排版

优先不增加字体依赖，先使用系统字体栈：

```css
font-family: -apple-system, BlinkMacSystemFont, "PingFang SC",
  "HarmonyOS Sans SC", "Microsoft YaHei", "Segoe UI", sans-serif;
```

字体角色：

| 角色 | 字号/行高 | 字重 | 约束 |
| --- | --- | --- | --- |
| 页面标题 | 28/30 | 800 | `letter-spacing: -0.04em`，最多两行 |
| 区块标题 | 20/24 | 750 | 不加装饰性 eyebrow |
| 卡片标题 | 16/21 | 750 | 长名称允许两行 |
| 正文 | 16/25 | 400-500 | 手机输入与主要说明不得小于 16px |
| 元数据 | 13/18 | 600 | 商圈、类型、添加人 |
| 标签 | 12/16 | 650 | 不全大写，不宽字距 |
| 数字/计数 | 14/18 | 700 | `font-variant-numeric: tabular-nums` |

排版规则：

- 不再使用 Fraunces 或系统宋体作为 UI 标题。
- 标题通过字重、紧字距和图文关系产生个性，不靠混用衬线字体。
- 正文使用 `text-wrap: pretty`，标题使用 `text-wrap: balance`。
- 小标签只表达真实元数据，不在每个区块重复“收集入口”“内容管理”等装饰标签。

### 4.3 空间、圆角和层级

```text
Spacing: 4 / 8 / 12 / 16 / 24 / 32
Radius: 10 / 14 / 20 / 24
Icon: 18 / 20 / 24
Z-index: content 0 / sticky 20 / bottom-nav 30 / toast 40 / sheet 60 / modal 80
```

- 页面水平 gutter：16px，小屏 375px 不得低于 14px。
- 卡片内边距：列表卡 12px，表单面板 16px，详情页 20px。
- 卡片阴影只用两级：静态卡片近乎无阴影，浮层使用柔和冷绿阴影。
- 卡片不全部做 24px 大圆角。信息密集控件使用 10-14px，主图片卡使用 20-24px。
- 固定底栏必须为内容预留 `padding-bottom`，包含 safe-area。

### 4.4 质感底座

- 页面保留固定细粒噪点，opacity 约 `0.025`，只制造材质，不可看出明显颗粒。
- 边框使用透明黑，不使用硬灰线。
- 阴影带冷绿倾向，不使用纯黑大阴影。
- 图片通过裁切、暗角和真实内容承担视觉焦点，不用渐变 blob 代替食物图。

## 5. App Shell 与响应式

### 5.1 手机

- 目标基线：390×844。
- 必测：375、390、430 宽度。
- 顶部栏 64-72px，内容标题与状态计数组合，不再放独立统计大胶囊。
- 底部导航最多五项，图标和标签始终可见。
- 主内容使用单列，避免嵌套横向滚动。

### 5.2 平板与桌面

- 640px 起允许卡片列表变为两列，但表单仍保持可读宽度。
- 960px 起最大内容宽度 960px，筛选可成为左侧窄栏，结果区成为主栏。
- 1024px 以上可将五项导航变为左侧 rail，但不能与底部导航同时出现。
- 桌面不是营销页，不增加 hero、统计看板或无业务依据的侧栏模块。

## 6. 页面规格

### 6.1 收件箱

首屏目标：15 秒内保存一条线索。

结构顺序：

1. 页面标题 + 待整理数量。
2. URL 输入与“保存线索”主按钮。
3. 添加人 segmented control。
4. 解析预览或失败兜底。
5. 待整理线索列表。

规则：

- 主按钮整屏只保留一个 Pepper 实心按钮。
- URL 粘贴后立即展示解析状态，不让用户猜系统是否工作。
- 解析超过 300ms 显示结构一致的 skeleton。
- 解析失败写清原因和下一步，例如“未读取到标题，请补充店名或菜名”。
- 线索保存成功后插入列表顶部并短暂高亮，数据来自真实 state。

### 6.2 想去

这是第一阶段重设计样板页，视觉以 `zhongcao-finesse-ui-preview.png` 为基线。

结构顺序：

1. 标题 + 当前结果数量。
2. 搜索框。
3. 快速筛选：全部、小王、小张、场景标签。
4. 第一条结果的重点卡片。
5. 其余结果的高密度列表或两列卡片。

重点卡片不是算法推荐。它只能是当前筛选结果中按 `updatedAt` 排序的第一条，并标注“最近收藏”，不能写“为你推荐”。

卡片最小信息：

- 图片或可信占位。
- 店铺/菜品名称。
- 类型、商圈或绑定店铺。
- 添加人。
- 最多两个标签，更多内容显示 `+N`。
- 一个明确主操作“安排日期”。

编辑、反馈、删除等次级操作放入详情 sheet，不在默认卡面堆叠完整表单。

### 6.3 日历

- 保留月份和日期选择，不改领域逻辑。
- 选中日期使用共享滑块，不能只靠颜色区分。
- 日期格至少 44×44px。
- 当日计划显示对象、类型、状态和主操作。
- 改期使用 bottom sheet，保留当前上下文。
- “放回想去”和“不想去了”视觉分级，危险操作不能紧贴主操作。

### 6.4 已去过

- 采用时间顺序列表，不做数据看板。
- 卡片突出日期、对象和三态反馈。
- 反馈状态使用文字 + 图标 + 语义色，不能只有红绿差异。
- 撤销轻反馈必须继续提供 Toast 快捷动作。
- 空状态说明如何产生第一条记录，并提供返回“日历”的动作。

### 6.5 我的

按任务分组：

1. 标签管理。
2. 不想去了。
3. 回收站。
4. 本地数据与备份。
5. 危险操作。

规则：

- “导出 JSON 备份”是正常次级按钮。
- “清空本地数据”独立放在危险区域，实施前按既定 P0 计划补确认和备份闭环。
- 管理区优先使用内联展开或 sheet，不堆叠多个 modal。

## 7. 组件系统

后续 Agent 应先抽取展示组件，再迁移页面，不修改领域函数：

```text
AppShell
TopBar
BottomNav
SearchField
SegmentedControl
FilterChip
PrimaryButton / SecondaryButton / TextButton / DestructiveButton
FoodCover
FeaturedPlaceCard
CompactPlaceCard
MetaRow
ContributorChip
TagChip
BottomSheet
Toast
SkeletonCard
EmptyState
InlineError
CalendarGrid
PlanCard
VisitCard
```

组件规则：

- 同一意图只有一种按钮样式和同一文案。
- Lucide 图标统一 2px stroke，常规 20px，底栏 22px。
- 所有 icon-only button 必须有 `aria-label` 和至少 44px 点击区域。
- 所有表单使用可见 label，placeholder 只做示例。
- sheet 打开后管理焦点，关闭后焦点回到触发元素。

## 8. 动效系统

动效目标是解释状态和保持空间连续，不负责营造“炫技感”。每个屏幕最多同时出现一到两个显著动效。

### 8.1 Motion token

```yaml
duration:
  press: 100ms
  fast: 160ms
  base: 220ms
  emphasis: 320ms
  sheet: 360ms
easing:
  enter: cubic-bezier(0.16, 1, 0.3, 1)
  exit: cubic-bezier(0.4, 0, 1, 1)
spring:
  stiffness: 400
  damping: 40
  mass: 0.8
stagger:
  list_item: 35ms
```

### 8.2 必做动效

#### A. 底栏共享激活背景

- 切换 Tab 时，深色选中背景在五个项目之间滑动。
- 图标和标签不放大，不使用 macOS Dock 效果。
- 内容区使用 120-180ms 交叉淡入，不做整页飞入。
- 浏览返回时恢复各 Tab 的滚动和筛选状态。

#### B. Segmented control / Filter chip

- 使用一个共享选中背景移动到目标项，而不是每个按钮独立闪色。
- 220ms 内完成，允许用户连续点击并打断动画。
- 筛选结果通过布局动画重排，卡片不先消失再整页重绘。

#### C. 提交按钮状态

参考 21st.dev Slide Button 的状态形变，但去掉拖拽：

```text
保存线索 → 正在保存 → 已保存
安排日期 → 正在安排 → 已加入日历
导出备份 → 正在生成 → 已导出
```

- 按钮尺寸保持稳定，文字与图标使用 `AnimatePresence` 或等价交叉淡入。
- loading 时禁用重复提交。
- success 状态停留约 700-1000ms 后恢复或跟随页面状态离开。

#### D. 卡片到详情 sheet

- 点击卡片时，图片和标题保持视觉连续，详情 sheet 从底部进入。
- sheet 进入 320-360ms，退出时间为进入的约 65%。
- 主内容不缩放，不做背景 3D 倾斜。

#### E. 列表插入、删除与撤销

- 新项目：`opacity 0→1`、`translateY 10px→0`，随后由布局动画接管位置。
- 删除：卡片轻微缩小至 0.98 并淡出，列表补位。
- Toast 从底栏上方进入，带“撤销”。撤销后项目从原位置附近恢复。

#### F. 日历日期选择

- 使用共享选中块在日期间移动。
- 当日计划交叉淡入，不能让整个月份重新闪烁。

### 8.3 可选动效

- 搜索获得焦点时，搜索图标向内移动 2px，边框过渡为 Pepper。
- 重点图片卡在支持 hover 的桌面设备上允许 `scale(1.01)`，手机端只做按压反馈。
- 首次进入页面时，首屏最多四个内容块以 35ms stagger 进入；之后切换 Tab 不重复完整入场。

### 8.4 禁止动效

- 无限漂浮、呼吸、弹跳和跑马灯。
- 跟随鼠标的磁吸按钮、光标跟随和卡片 3D 倾斜。
- scroll-jacking、卡片滚动堆叠、长距离视差。
- 动画 `top/left/width/height`。共享布局应使用 transform 或 FLIP。
- 每次 state 更新都播放大范围入场动画。

### 8.5 Reduced Motion

`prefers-reduced-motion: reduce` 下：

- 共享滑块立即到终态。
- 删除 stagger、缩放、位移和弹性。
- 保留颜色、图标和文字状态变化。
- skeleton 使用静态占位，不使用 shimmer。
- Toast 直接出现并保持完整可读时间。

### 8.6 依赖边界

当前项目没有 Framer Motion。实施时默认先用 CSS transition 和 React 状态完成基础反馈。只有在需要共享布局、可打断 spring 和复杂退出动画时，才提出增加 Motion 依赖，并在安装前取得用户授权。不要为了复制 21st.dev 组件而引入整套依赖。

## 9. 图片规范

- 食物和店铺图片是业务内容，不是装饰背景。
- 首屏重点卡图片使用 3:2，列表图使用 1:1 或 4:3，所有容器预留 aspect-ratio，避免 CLS。
- 优先使用链接解析得到的真实图片。缺图时使用平台与类型占位，不虚构真实店铺照片。
- 上线素材使用 WebP/AVIF，设置 `width`、`height`、`srcset` 和 `sizes`。
- 图片 alt 描述内容，不重复卡片标题；纯装饰图使用空 alt。
- 不把预览图中的概念食物图当作生产素材。

## 10. 文案规范

- 从用户动作出发，按钮使用“动词 + 对象”。
- 同一个动作在按钮、Toast 和状态文本中保持同名。
- 不使用“OK”“提交”“点击这里”“了解更多”。
- 错误写清原因和修复方式，不写“发生错误，请重试”作为唯一说明。
- 空状态提供下一步动作，不写情绪化占位句。

推荐动作词：

```text
保存线索
重新解析
整理为店铺
整理为菜品
安排日期
记录反馈
放回想去
移入回收站
恢复项目
导出 JSON 备份
清空本地数据
```

## 11. 实施顺序

### Gate 0：开始前核验

- 确认当前工作目录是正式仓库。
- 回读 `git status`，保留现有未提交修改。
- 检查 2026-07-10 优化计划中的数据正确性 P0 是否已完成或被用户明确延期。
- UI 改造不能掩盖状态并发、双存储一致性和清空恢复风险。

### Phase 1：视觉 token 与基础组件

- 建立语义色、排版、空间、圆角、阴影和 motion token。
- 先实现 Button、Input、Chip、TopBar、BottomNav、Toast、Sheet。
- 不改领域逻辑，不改 storage。

### Phase 2：想去页样板

- 以已确认预览图为基线完成 Wishlist 页面。
- 接真实 state、搜索、标签、addedBy 和安排日期。
- 完成空、加载、错误、成功、禁用、reduced-motion 状态。
- 浏览器验证通过后再推广到其他页面。

### Phase 3：收件箱与日历

- 优先处理解析反馈、表单错误和计划 sheet。
- 保持 15 秒保存线索目标和当前计划状态规则。

### Phase 4：已去过与我的

- 完成反馈时间线、撤销、回收站、备份和危险区。
- 清空保护与导入恢复仍按数据 P0/P1 计划推进。

### Phase 5：动效与性能

- 先 CSS，再评估是否需要 Motion 依赖。
- 用 Performance/React Profiler 验证，不凭感觉优化。
- 图片、列表和固定底栏完成真实设备测试。

### Phase 6：文档与回归

- 更新 `FRONTEND_DESIGN.md` 已落地状态。
- 更新 UI 测试，增加真实 React 交互和浏览器回归。
- 生成五个 Tab 的 390px 截图和关键状态截图。

## 12. 验收标准

### 视觉

- 全站只有一个品牌强调色 Pepper。
- 没有米纸衬线、装订线、渐变文字、AI 紫光和默认玻璃拟态。
- 没有纯白/纯黑和硬灰边框。
- 真实图片或诚实占位覆盖所有需要图片的卡片。
- 五个页面使用同一套组件、圆角、图标和空间系统。

### 交互

- 所有触控目标至少 44×44px，间距至少 8px。
- 主操作反馈在 100ms 内出现。
- 超过 300ms 的异步操作显示 loading 或 skeleton。
- 动画可打断，不阻止连续操作。
- 删除、轻反馈和状态变更仍可撤销。

### 可访问性

- 正文对比度至少 4.5:1，图形和大字至少 3:1。
- 键盘顺序与视觉顺序一致。
- icon-only button 有 `aria-label`。
- Toast 使用 `aria-live="polite"`，不抢焦点。
- sheet 有焦点圈定和关闭后的焦点恢复。
- reduced-motion 下没有位移、缩放、stagger 和 shimmer。

### 响应式与性能

- 375、390、430、768、1024 宽度无横向滚动。
- 固定底栏不遮挡最后一个内容项。
- 图片预留尺寸，CLS 小于 0.1。
- 列表滚动保持流畅，滚动过程中不在 React 中持续 setState。
- DOM 动画只使用 transform 和 opacity。

### 回归

- `npm test` 全部通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- 五个 Tab 的核心流程逐项浏览器验收。
- 本地数据没有被设计预览或测试 fixture 污染。

## 13. 给后续 Agent 的实施提示

```text
请先阅读：
1. PRD.md
2. docs/UI-REDESIGN-SPEC.md
3. design-model.yaml
4. FRONTEND_DESIGN.md
5. CodeX 中的种草软件优化计划

开始前必须确认正式 repo、git status 和数据正确性 P0 状态。
本轮只实施 docs/UI-REDESIGN-SPEC.md 指定的页面或阶段。
保护 src/lib/domain.js、src/lib/storage.js 的现有业务语义，除非任务明确授权修改。
不要复制 21st.dev 的整套组件；只实现规格中被批准的动效机制。
每完成一个页面都运行测试、构建、浏览器截图和 reduced-motion 验证。
```

## 14. 参考链接

### 21st.dev 动效机制

- Dock: https://21st.dev/@motion-primitives/components/dock
- Slide Button: https://21st.dev/@reuno-ui/components/slide-button
- Animated Tab Bar: https://21st.dev/@abxlfazl__/components/animated-tab-bar
- Bottom Nav Bar: https://21st.dev/@arunachalam0606/components/bottom-nav-bar
- Scroll Cards: https://21st.dev/@ishamsu/components/scroll-cards

### 同类产品与视觉参考

- Mapstr: https://en.mapstr.com/
- Beli: https://beliapp.com/
- Cosmos: https://www.cosmos.so/
- dérive: https://www.ourderive.com/
- Santai: https://santai.app/
- PoiSave: https://poisave.com/
- Doko: https://www.appdoko.com/

