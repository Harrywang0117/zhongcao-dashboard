# 轻反馈驱动下一步状态需求说明

更新日期：2026-06-07

## 1. 背景

当前 v1 已支持到店轻反馈：`还想去 / 一般 / 不再去`。这三个反馈不能只作为历史记录展示，还需要影响店铺/菜品的下一步行动状态。

产品原则：

- `VisitRecord` 表达历史事实：用户哪天去过、反馈是什么。
- `Store.status` / `Dish.status` 表达当前行动状态：现在是否还要安排下一次。
- 用户点“还想去”时，实际表达的是再次安排意图，因此目标需要回到想去池。
- 用户点“不再去”时，语义等同于“不想去了”，应取消该目标下未完成计划。

## 2. 状态规则

| 轻反馈 | 历史记录 | 目标下一步状态 | 计划处理 |
| --- | --- | --- | --- |
| 还想去 `want_again` | 创建 `VisitRecord` | 无未来计划：`want`；有未来计划：`planned` | 完成本次同日计划，保留其他未来计划 |
| 一般 `ok` | 创建 `VisitRecord` | 无未来计划：店铺 `visited` / 菜品 `eaten`；有未来计划：`planned` | 完成本次同日计划，保留其他未来计划 |
| 不再去 `no_again` | 创建 `VisitRecord` | `not_interested` | 完成本次同日计划，并取消该目标下其他未完成计划 |

补充规则：

- “未来计划”指同一目标下状态为 `scheduled` 且未删除的计划。
- “未完成计划”指同一目标下状态为 `scheduled` 或 `backlog` 且未删除的计划。
- 撤销轻反馈时，需恢复由该反馈完成的同日计划，并重新计算目标状态。
- 如果同一天存在多个有效轻反馈，不应误恢复仍被其他轻反馈覆盖的计划。

## 3. 前端需求

### 3.1 想去页

- 用户在想去卡片中选择“还想去”后：
  - 显示 Toast：`已记录，还可以再次安排`。
  - 目标仍应出现在想去页，除非它已有未来计划且显示为“已计划”。
- 用户选择“一般”后：
  - 显示 Toast：`已记录轻反馈`。
  - 无未来计划时目标不再出现在想去页，进入已去过视图。
- 用户选择“不再去”后：
  - 显示 Toast：`已记录为不想去了`。
  - 目标从想去页和日历页移除，在“我的 > 不想去了”中可放回想去。

### 3.2 日历页

- 用户在计划卡上选择“还想去”后：
  - 当前日期计划变为已完成。
  - 如果没有其他未来计划，目标回到想去页，方便再次安排。
  - 如果有其他未来计划，目标保持已计划，其他计划继续显示。
- 用户选择“一般”后：
  - 当前日期计划变为已完成。
  - 其他未来计划不受影响。
- 用户选择“不再去”后：
  - 当前日期计划变为已完成。
  - 同目标其他未完成计划从日历移除。
  - 目标进入“我的 > 不想去了”。

### 3.3 已去过页与恢复

- 已去过页继续展示所有未删除 `VisitRecord`。
- 撤销轻反馈后：
  - 如果撤销的是 `want_again`，目标根据剩余计划和剩余反馈重新计算状态。
  - 如果撤销的是 `no_again`，目标不能永久停留在 `not_interested`，需根据剩余计划和剩余反馈重新计算。
  - Toast 显示：`已撤销`。

## 4. 后端/数据层需求

当前项目为本地 IndexedDB + 前端领域层，没有独立业务后端。这里的“后端/数据层”指 `src/lib/domain.js` 中的状态计算与持久化数据结构。

### 4.1 领域函数

- `createVisitRecord(state, payload)` 需要根据 `feedback` 更新目标状态：
  - `want_again`：完成同日计划后，按剩余 scheduled 计划决定 `planned` 或 `want`。
  - `ok`：完成同日计划后，按剩余 scheduled 计划决定 `planned` 或 `visited/eaten`。
  - `no_again`：完成同日计划后，将同目标未完成计划标记为 `not_interested`，目标状态设为 `not_interested`。
- `recalculateTargetStatus(state, targetType, targetId)` 需要区分反馈语义：
  - `no_again` 优先使目标进入 `not_interested`，除非该反馈已删除或目标被手动放回想去。
  - 存在 scheduled 计划时目标为 `planned`。
  - 最新有效反馈为 `want_again` 且无 scheduled 计划时目标为 `want`。
  - 最新有效反馈为 `ok` 且无 scheduled 计划时目标为 `visited/eaten`。
  - 无有效反馈和无 scheduled 计划时目标为 `want`。
- `restoreTargetToWishlist(state, targetType, targetId)` 需要清理同目标 `not_interested` 计划，并让目标回到 `want`。

### 4.2 数据兼容

- 不新增必填字段。
- 现有 `VisitRecord.feedback` 的三个值继续使用：`want_again`、`ok`、`no_again`。
- 可继续使用 `completedPlanIds` 追踪被本次反馈完成的计划。

## 5. 验收标准

- 有一个店铺，只有当天计划：点击“还想去”后，计划完成，店铺回到想去页。
- 有一个店铺，有当天计划和未来计划：点击“还想去”后，当天计划完成，未来计划仍在日历，店铺状态为已计划。
- 有一个店铺，只有当天计划：点击“一般”后，计划完成，店铺进入已去过，不出现在想去页。
- 有一个店铺，有当天计划和未来计划：点击“一般”后，当天计划完成，未来计划仍在日历，店铺状态为已计划。
- 有一个店铺，有多个未完成计划：点击“不再去”后，所有未完成计划从日历移除，店铺进入不想去了。
- 撤销 `want_again` / `ok` / `no_again` 反馈后，目标状态和日历计划能重新计算，不能残留错误状态。

## 6. 测试建议

### 数据层测试

- `want_again returns target to wishlist when no future plans remain`
- `want_again keeps target planned when another scheduled plan remains`
- `ok keeps target visited when no future plans remain`
- `ok keeps target planned when another scheduled plan remains`
- `no_again marks target not interested and clears unfinished plans`
- `soft deleting visit recalculates target status by remaining feedback and plans`

### 前端端到端测试

- 从想去页打“还想去”，确认卡片仍可再次安排。
- 从日历页打“还想去”，确认同日计划消失，目标重新可安排。
- 从日历页打“不再去”，确认其他未来计划被移除，并可在“我的”放回想去。
