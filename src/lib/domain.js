export const DATA_VERSION = 2;

export const DEFAULT_TAGS = [
  { name: "火锅", group: "category" },
  { name: "烧烤", group: "category" },
  { name: "日料", group: "category" },
  { name: "甜品", group: "category" },
  { name: "面馆", group: "category" },
  { name: "咖啡", group: "category" },
  { name: "辛辣", group: "taste" },
  { name: "清淡", group: "taste" },
  { name: "酸甜", group: "taste" },
  { name: "重口", group: "taste" },
  { name: "午餐", group: "time" },
  { name: "晚餐", group: "time" },
  { name: "夜宵", group: "time" },
  { name: "下午茶", group: "time" },
  { name: "周末", group: "time" },
  { name: "聚餐", group: "scene" },
  { name: "一个人吃", group: "scene" },
  { name: "约会", group: "scene" }
].map((tag) => ({
  ...tag,
  id: `tag_${tag.group}_${tag.name}`,
  isDefault: true
}));

export const ADDED_BY_VALUES = ["xiaowang", "xiaozhang", "unknown"];

const ACTIVE_ADDED_BY_VALUES = new Set(["xiaowang", "xiaozhang"]);
const ALL_ADDED_BY_VALUES = new Set(ADDED_BY_VALUES);
const FEEDBACK_VALUES = new Set(["want_again", "ok", "no_again"]);
const COLLECTIONS = new Set([
  "inboxItems",
  "stores",
  "dishes",
  "plans",
  "visitRecords",
  "tags"
]);

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix) {
  const random =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}

export function createInitialState() {
  const createdAt = nowIso();

  return {
    meta: {
      dataVersion: DATA_VERSION,
      createdAt,
      updatedAt: createdAt
    },
    inboxItems: [],
    stores: [],
    dishes: [],
    plans: [],
    visitRecords: [],
    tags: DEFAULT_TAGS.map((tag) => ({ ...tag }))
  };
}

export function createSourceLink(preview, addedBy = "unknown") {
  return {
    id: createId("source"),
    platform: preview.platform || "未知平台",
    originalUrl: preview.originalUrl || preview.normalizedUrl || "",
    normalizedUrl: preview.normalizedUrl || preview.originalUrl || "",
    title: preview.title || "",
    imageUrl: preview.imageUrl || "",
    addedBy: normalizeAddedBy(addedBy, { allowUnknown: true }),
    contentType: preview.contentType || "unknown",
    parseStatus: preview.status || "failed",
    createdAt: nowIso()
  };
}

export function createInboxItem({ preview, fallbackTitle = "", note = "", addedBy = "" }) {
  const safePreview = preview || {};
  const parsedTitle = String(safePreview.title || "").trim();
  const manualTitle = String(fallbackTitle || "").trim();
  const parseStatus = normalizeParseStatus(safePreview.status);
  const normalizedAddedBy = normalizeAddedBy(addedBy);

  if (parseStatus !== "success" && !manualTitle) {
    throw new Error("解析失败时必须填写标题、店名或菜名");
  }

  const createdAt = nowIso();
  const title = parseStatus === "success" ? parsedTitle || manualTitle : manualTitle || parsedTitle;

  return {
    id: createId("inbox"),
    sourceUrl: safePreview.originalUrl || safePreview.normalizedUrl || "",
    normalizedUrl: safePreview.normalizedUrl || safePreview.originalUrl || "",
    platform: safePreview.platform || "未知平台",
    parseStatus,
    title,
    userLabel: manualTitle,
    previewImageUrl: safePreview.imageUrl || "",
    addedBy: normalizedAddedBy,
    contentType: safePreview.contentType || "unknown",
    failureReason: safePreview.failureReason || "",
    suggested: normalizeSuggestion(safePreview.suggested),
    note: String(note || "").trim(),
    triageStatus: "pending",
    deletedAt: null,
    createdAt,
    updatedAt: createdAt
  };
}

export function applyInboxReparsePreview(item, preview) {
  const safePreview = preview || {};
  const parsedTitle = String(safePreview.title || "").trim();
  const parseStatus = normalizeParseStatus(safePreview.status);
  const hasManualTitle = Boolean(String(item.userLabel || "").trim());

  item.parseStatus = parseStatus;
  item.platform = safePreview.platform || item.platform || "未知平台";
  item.normalizedUrl = safePreview.normalizedUrl || item.normalizedUrl || safePreview.originalUrl || "";
  item.contentType = safePreview.contentType || item.contentType || "unknown";
  item.failureReason = safePreview.failureReason || "";
  item.suggested = normalizeSuggestion(safePreview.suggested);

  if (!hasManualTitle && parseStatus === "success" && parsedTitle) {
    item.title = parsedTitle;
  }
  if (!item.title && parsedTitle) {
    item.title = parsedTitle;
  }
  if (safePreview.imageUrl) {
    item.previewImageUrl = safePreview.imageUrl;
  }

  item.updatedAt = nowIso();
  return item;
}

function normalizeSuggestion(suggestion = {}) {
  return {
    storeName: String(suggestion.storeName || "").trim(),
    city: String(suggestion.city || "").trim(),
    businessDistrict: String(suggestion.businessDistrict || "").trim(),
    addressNote: String(suggestion.addressNote || "").trim(),
    tagNames: Array.isArray(suggestion.tagNames)
      ? [...new Set(suggestion.tagNames.map((tag) => String(tag || "").trim()).filter(Boolean))]
      : [],
    note: String(suggestion.note || "").trim()
  };
}

export function createCustomTag(state, name, group = "custom") {
  const tagName = String(name || "").trim();
  if (!tagName) return null;

  const existing = state.tags.find((tag) => tag.name === tagName);
  if (existing) return existing;

  const tag = {
    id: createId("tag"),
    name: tagName,
    group,
    isDefault: false
  };
  state.tags.push(tag);
  touchState(state);
  return tag;
}

export function organizeInboxItem(state, inboxItemId, options) {
  const item = state.inboxItems.find((candidate) => candidate.id === inboxItemId);
  if (!item) throw new Error("找不到收件箱线索");
  if (item.deletedAt) throw new Error("已删除线索不能整理");

  const template = options?.template || "hold";
  if (template === "hold") {
    item.triageStatus = "held";
    item.updatedAt = nowIso();
    touchState(state);
    return { inboxItem: item, store: null, dish: null };
  }

  const tagNames = [...new Set(options?.tagNames || [])];
  tagNames.forEach((tagName) => createCustomTag(state, tagName));

  let store = null;
  let dish = null;

  if (template === "store" || template === "store-dish") {
    const createdAt = nowIso();
    const addedBy = coerceAddedBy(item.addedBy);
    store = {
      id: createId("store"),
      name: String(options?.storeName || item.title).trim(),
      addedBy,
      city: String(options?.city || "").trim(),
      businessDistrict: String(options?.businessDistrict || "").trim(),
      addressNote: String(options?.addressNote || "").trim(),
      status: "want",
      tagNames,
      sourceLinks: [sourceLinkFromInboxItem(item)],
      coverImageUrl: item.previewImageUrl || "",
      note: String(options?.note || item.note || "").trim(),
      deletedAt: null,
      createdAt,
      updatedAt: createdAt
    };
    state.stores.push(store);
  }

  if (template === "dish" || template === "store-dish") {
    const createdAt = nowIso();
    dish = {
      id: createId("dish"),
      storeId: store?.id || options?.storeId || null,
      name: String(options?.dishName || item.title).trim(),
      addedBy: coerceAddedBy(item.addedBy),
      status: "want",
      tagNames,
      coverImageUrl: item.previewImageUrl || "",
      note: String(options?.note || item.note || "").trim(),
      deletedAt: null,
      createdAt,
      updatedAt: createdAt
    };
    state.dishes.push(dish);
  }

  if (!store && !dish) {
    throw new Error("未知整理模板");
  }

  item.triageStatus = "organized";
  item.updatedAt = nowIso();
  touchState(state);
  return { inboxItem: item, store, dish };
}

export function updateStore(state, storeId, values = {}) {
  const store = findInCollection(state, "stores", storeId);
  const nextName = hasOwn(values, "name") ? String(values.name || "").trim() : store.name;
  if (!nextName) throw new Error("店铺名称不能为空");

  if (hasOwn(values, "tagNames")) {
    store.tagNames = normalizeTagNames(values.tagNames);
    store.tagNames.forEach((tagName) => createCustomTag(state, tagName));
  }

  store.name = nextName;
  if (hasOwn(values, "city")) store.city = String(values.city || "").trim();
  if (hasOwn(values, "businessDistrict")) {
    store.businessDistrict = String(values.businessDistrict || "").trim();
  }
  if (hasOwn(values, "addressNote")) store.addressNote = String(values.addressNote || "").trim();
  if (hasOwn(values, "coverImageUrl")) store.coverImageUrl = String(values.coverImageUrl || "").trim();
  if (hasOwn(values, "addedBy")) {
    store.addedBy = normalizeAddedBy(values.addedBy, { allowUnknown: true });
  }
  if (hasOwn(values, "note")) store.note = String(values.note || "").trim();

  store.updatedAt = nowIso();
  touchState(state);
  return store;
}

export function updateDish(state, dishId, values = {}) {
  const dish = findInCollection(state, "dishes", dishId);
  const nextName = hasOwn(values, "name") ? String(values.name || "").trim() : dish.name;
  if (!nextName) throw new Error("菜品名称不能为空");

  if (hasOwn(values, "tagNames")) {
    dish.tagNames = normalizeTagNames(values.tagNames);
    dish.tagNames.forEach((tagName) => createCustomTag(state, tagName));
  }

  dish.name = nextName;
  if (hasOwn(values, "storeId")) {
    dish.storeId = values.storeId ? String(values.storeId).trim() : null;
  }
  if (hasOwn(values, "coverImageUrl")) dish.coverImageUrl = String(values.coverImageUrl || "").trim();
  if (hasOwn(values, "addedBy")) {
    dish.addedBy = normalizeAddedBy(values.addedBy, { allowUnknown: true });
  }
  if (hasOwn(values, "note")) dish.note = String(values.note || "").trim();

  dish.updatedAt = nowIso();
  touchState(state);
  return dish;
}

export function searchCollections(state, query) {
  const keyword = normalizeKeyword(query);
  const stores = activeItems(state.stores);
  const dishes = activeItems(state.dishes);
  const storeById = new Map(stores.map((store) => [store.id, store]));

  if (!keyword) return { stores, dishes };

  return {
    stores: stores.filter((store) =>
      searchableText([
        store.name,
        store.city,
        store.businessDistrict,
        store.addressNote,
        store.note,
        ...(store.tagNames || [])
      ]).includes(keyword)
    ),
    dishes: dishes.filter((dish) =>
      searchableText([
        dish.name,
        dish.note,
        ...(dish.tagNames || []),
        storeById.get(dish.storeId)?.name,
        storeById.get(dish.storeId)?.city,
        storeById.get(dish.storeId)?.businessDistrict,
        storeById.get(dish.storeId)?.addressNote,
        ...(storeById.get(dish.storeId)?.tagNames || [])
      ]).includes(keyword)
    )
  };
}

export function filterByTags(items, requiredTags = []) {
  const tags = requiredTags.filter(Boolean);
  if (!tags.length) return activeItems(items);

  return activeItems(items).filter((item) =>
    tags.every((tagName) => (item.tagNames || []).includes(tagName))
  );
}

export function filterByAddedBy(items, addedBy = "all") {
  if (!addedBy || addedBy === "all") return activeItems(items);

  const targetAddedBy = normalizeAddedBy(addedBy, { allowUnknown: true });
  return activeItems(items).filter((item) => coerceAddedBy(item.addedBy) === targetAddedBy);
}

export function createPlan(state, { targetType, targetId, date }) {
  if (!["store", "dish"].includes(targetType)) throw new Error("计划对象必须是店铺或菜品");
  if (!targetId) throw new Error("计划对象不能为空");
  if (!date) throw new Error("计划日期不能为空");

  const existingPlan = findScheduledPlanForDate(state, targetType, targetId, date);
  if (existingPlan) {
    recalculateTargetStatus(state, targetType, targetId);
    touchState(state);
    return existingPlan;
  }

  const createdAt = nowIso();
  const plan = {
    id: createId("plan"),
    targetType,
    targetId,
    date,
    status: "scheduled",
    deletedAt: null,
    createdAt,
    updatedAt: createdAt
  };
  state.plans.push(plan);
  recalculateTargetStatus(state, targetType, targetId);
  touchState(state);
  return plan;
}

export function updatePlanStatus(state, planId, action, nextDate = "") {
  const plan = state.plans.find((candidate) => candidate.id === planId);
  if (!plan) throw new Error("找不到计划");

  if (action === "reschedule") {
    if (!nextDate) throw new Error("改期需要新的日期");
    const duplicatePlan = findScheduledPlanForDate(
      state,
      plan.targetType,
      plan.targetId,
      nextDate,
      plan.id
    );
    if (duplicatePlan) {
      plan.status = "backlog";
    } else {
      plan.date = nextDate;
      plan.status = "scheduled";
    }
  } else if (action === "back-to-wishlist") {
    plan.status = "backlog";
  } else if (action === "not-interested") {
    markTargetPlansNotInterested(state, plan.targetType, plan.targetId);
  } else {
    throw new Error("未知计划操作");
  }

  plan.updatedAt = nowIso();
  recalculateTargetStatus(state, plan.targetType, plan.targetId);
  touchState(state);
  return plan;
}

export function createVisitRecord(state, { storeId = null, dishId = null, date, feedback, note = "" }) {
  if (!storeId && !dishId) throw new Error("到店记录需要关联店铺或菜品");
  if (!date) throw new Error("到店日期不能为空");
  if (!FEEDBACK_VALUES.has(feedback)) throw new Error("请选择轻反馈");

  const createdAt = nowIso();
  const visit = {
    id: createId("visit"),
    storeId,
    dishId,
    date,
    feedback,
    note: String(note || "").trim(),
    photoUrl: "",
    eatenDishNames: [],
    completedPlanIds: [],
    deletedAt: null,
    createdAt,
    updatedAt: createdAt
  };
  state.visitRecords.push(visit);

  const targetType = storeId ? "store" : "dish";
  const targetId = storeId || dishId;
  visit.completedPlanIds = completeScheduledPlansForTarget(state, targetType, targetId, date);
  visit.notInterestedPlanStatuses =
    feedback === "no_again" ? markUnfinishedPlansNotInterestedForVisit(state, targetType, targetId) : [];

  recalculateTargetStatus(state, targetType, targetId);
  touchState(state);
  return visit;
}

export function addSourceLink(state, storeId, preview, addedBy = "unknown") {
  const store = state.stores.find((candidate) => candidate.id === storeId);
  if (!store) throw new Error("找不到店铺");

  const sourceLink = createSourceLink(preview, addedBy);
  const exists = store.sourceLinks.some(
    (link) => link.normalizedUrl && link.normalizedUrl === sourceLink.normalizedUrl
  );

  if (!exists) {
    store.sourceLinks.push(sourceLink);
    store.updatedAt = nowIso();
    touchState(state);
  }

  return store;
}

export function mergeInboxItemIntoStore(state, inboxItemId, storeId, options = {}) {
  const item = state.inboxItems.find((candidate) => candidate.id === inboxItemId);
  const store = state.stores.find((candidate) => candidate.id === storeId);
  if (!item) throw new Error("找不到收件箱线索");
  if (!store) throw new Error("找不到店铺");

  const sourceLink = sourceLinkFromInboxItem(item);
  const exists = store.sourceLinks.some(
    (link) => link.normalizedUrl && link.normalizedUrl === sourceLink.normalizedUrl
  );
  if (!exists) {
    store.sourceLinks.push(sourceLink);
  }

  const tagNames = [...new Set([...(store.tagNames || []), ...(options.tagNames || [])])];
  tagNames.forEach((tagName) => createCustomTag(state, tagName));
  store.tagNames = tagNames;
  store.updatedAt = nowIso();

  let dish = null;
  if (options.dishName) {
    const createdAt = nowIso();
    dish = {
      id: createId("dish"),
      storeId: store.id,
      name: String(options.dishName).trim(),
      addedBy: coerceAddedBy(item.addedBy),
      status: "want",
      tagNames: options.tagNames || [],
      coverImageUrl: item.previewImageUrl || "",
      note: String(options.note || item.note || "").trim(),
      deletedAt: null,
      createdAt,
      updatedAt: createdAt
    };
    state.dishes.push(dish);
  }

  item.triageStatus = "organized";
  item.updatedAt = nowIso();
  touchState(state);
  return { inboxItem: item, store, dish };
}

export function findPotentialDuplicateStores(state, name, businessDistrict = "") {
  const targetName = normalizeKeyword(name);
  const targetDistrict = normalizeKeyword(businessDistrict);
  if (!targetName) return [];

  return activeItems(state.stores).filter((store) => {
    const sameName = normalizeKeyword(store.name) === targetName;
    const sameDistrict =
      targetDistrict && normalizeKeyword(store.businessDistrict) === targetDistrict;
    return sameName || (sameDistrict && normalizeKeyword(store.name).includes(targetName));
  });
}

export function findDuplicateSource(state, normalizedUrl) {
  const url = String(normalizedUrl || "").trim();
  if (!url) return null;

  const inboxItem = activeItems(state.inboxItems).find(
    (item) => item.normalizedUrl === url || item.sourceUrl === url
  );
  if (inboxItem) return { collection: "inboxItems", item: inboxItem };

  const store = activeItems(state.stores).find((candidate) =>
    (candidate.sourceLinks || []).some(
      (link) => link.normalizedUrl === url || link.originalUrl === url
    )
  );
  if (store) return { collection: "stores", item: store };

  return null;
}

export function restoreTargetToWishlist(state, targetType, targetId) {
  const target = getTarget(state, targetType, targetId);
  if (!target) return null;

  for (const plan of state.plans) {
    if (plan.targetType === targetType && plan.targetId === targetId && plan.status === "not_interested") {
      plan.status = "backlog";
      plan.updatedAt = nowIso();
    }
  }

  const ignoredVisitIds = new Set(target.ignoredVisitIdsForStatus || []);
  for (const visit of activeVisitsForTarget(state, targetType, targetId)) {
    ignoredVisitIds.add(visit.id);
  }
  target.ignoredVisitIdsForStatus = [...ignoredVisitIds];

  recalculateTargetStatus(state, targetType, targetId);
  touchState(state);
  return target;
}

export function softDeleteItem(state, collectionName, id) {
  const item = findInCollection(state, collectionName, id);
  const deletedAt = nowIso();
  markDeleted(item, deletedAt);
  if (collectionName === "stores") {
    cascadeSoftDeleteTarget(state, "store", id, deletedAt);
  }
  if (collectionName === "dishes") {
    cascadeSoftDeleteTarget(state, "dish", id, deletedAt);
  }
  if (collectionName === "visitRecords") {
    restoreCompletedPlansForVisit(state, item);
    restoreNotInterestedPlansForVisit(state, item);
    recalculateTargetStatusForVisit(state, item);
  }
  touchState(state);
  return item;
}

export function restoreItem(state, collectionName, id) {
  const item = findInCollection(state, collectionName, id);
  const restoredAt = nowIso();
  item.deletedAt = null;
  item.updatedAt = restoredAt;
  delete item.deletedByTarget;
  if (collectionName === "stores") {
    restoreCascadeDeletedTarget(state, "store", id, restoredAt);
    recalculateTargetStatus(state, "store", id);
  }
  if (collectionName === "dishes") {
    restoreCascadeDeletedTarget(state, "dish", id, restoredAt);
    recalculateTargetStatus(state, "dish", id);
  }
  if (collectionName === "visitRecords") {
    completePlansForRestoredVisit(state, item);
    recalculateTargetStatusForVisit(state, item);
  }
  touchState(state);
  return item;
}

export function getTrashItems(state) {
  return {
    inboxItems: state.inboxItems.filter((item) => item.deletedAt),
    stores: state.stores.filter((item) => item.deletedAt),
    dishes: state.dishes.filter((item) => item.deletedAt),
    plans: state.plans.filter((item) => item.deletedAt),
    visitRecords: state.visitRecords.filter((item) => item.deletedAt)
  };
}

export function activeItems(items) {
  return items.filter((item) => !item.deletedAt);
}

export function touchState(state) {
  state.meta.updatedAt = nowIso();
  return state;
}

function sourceLinkFromInboxItem(item) {
  return {
    id: createId("source"),
    platform: item.platform,
    originalUrl: item.sourceUrl,
    normalizedUrl: item.normalizedUrl,
    title: item.title,
    imageUrl: item.previewImageUrl,
    addedBy: coerceAddedBy(item.addedBy),
    contentType: item.contentType,
    parseStatus: item.parseStatus,
    createdAt: nowIso()
  };
}

function findInCollection(state, collectionName, id) {
  if (!COLLECTIONS.has(collectionName)) throw new Error("未知集合");

  const item = state[collectionName].find((candidate) => candidate.id === id);
  if (!item) throw new Error("找不到记录");
  return item;
}

function normalizeParseStatus(status) {
  return status === "success" ? "success" : status === "partial" ? "partial" : "failed";
}

export function normalizeAddedBy(value, { allowUnknown = false } = {}) {
  const normalizedValue = String(value || "").trim();
  const allowedValues = allowUnknown ? ALL_ADDED_BY_VALUES : ACTIVE_ADDED_BY_VALUES;

  if (allowedValues.has(normalizedValue)) return normalizedValue;
  throw new Error(allowUnknown ? "添加人必须是小王、小张或未标记" : "添加人必须选择小王或小张");
}

function coerceAddedBy(value, fallback = "unknown") {
  try {
    return normalizeAddedBy(value, { allowUnknown: true });
  } catch {
    return fallback;
  }
}

function updateTargetStatus(state, targetType, targetId, status) {
  const target = getTarget(state, targetType, targetId);
  if (!target) return null;

  target.status = status;
  target.updatedAt = nowIso();
  return target;
}

function getTarget(state, targetType, targetId) {
  const collection = targetType === "store" ? state.stores : state.dishes;
  return collection.find((item) => item.id === targetId) || null;
}

function findScheduledPlanForDate(state, targetType, targetId, date, excludedPlanId = "") {
  return state.plans.find(
    (plan) =>
      !plan.deletedAt &&
      plan.id !== excludedPlanId &&
      plan.targetType === targetType &&
      plan.targetId === targetId &&
      plan.date === date &&
      plan.status === "scheduled"
  );
}

function completeScheduledPlansForTarget(state, targetType, targetId, date) {
  const completedPlanIds = [];
  for (const plan of state.plans) {
    if (
      plan.targetType === targetType &&
      plan.targetId === targetId &&
      plan.status === "scheduled" &&
      (!date || plan.date === date)
    ) {
      plan.status = "completed";
      plan.updatedAt = nowIso();
      completedPlanIds.push(plan.id);
    }
  }
  return completedPlanIds;
}

function markTargetPlansNotInterested(state, targetType, targetId) {
  for (const plan of state.plans) {
    if (
      !plan.deletedAt &&
      plan.targetType === targetType &&
      plan.targetId === targetId &&
      (plan.status === "scheduled" || plan.status === "backlog")
    ) {
      plan.status = "not_interested";
      plan.updatedAt = nowIso();
    }
  }
}

function markUnfinishedPlansNotInterestedForVisit(state, targetType, targetId) {
  const affectedPlanStatuses = [];

  for (const plan of state.plans) {
    if (
      !plan.deletedAt &&
      plan.targetType === targetType &&
      plan.targetId === targetId &&
      (plan.status === "scheduled" || plan.status === "backlog")
    ) {
      affectedPlanStatuses.push({ id: plan.id, status: plan.status });
      plan.status = "not_interested";
      plan.updatedAt = nowIso();
    }
  }

  return affectedPlanStatuses;
}

function cascadeSoftDeleteTarget(state, targetType, targetId, deletedAt) {
  const deletedByTarget = targetCascadeKey(targetType, targetId);

  for (const plan of state.plans) {
    if (plan.targetType === targetType && plan.targetId === targetId && !plan.deletedAt) {
      markDeleted(plan, deletedAt, deletedByTarget);
    }
  }

  for (const visit of state.visitRecords) {
    if (isVisitForTarget(visit, targetType, targetId) && !visit.deletedAt) {
      markDeleted(visit, deletedAt, deletedByTarget);
    }
  }
}

function restoreCascadeDeletedTarget(state, targetType, targetId, restoredAt) {
  const deletedByTarget = targetCascadeKey(targetType, targetId);

  for (const plan of state.plans) {
    if (plan.deletedByTarget === deletedByTarget) {
      plan.deletedAt = null;
      plan.updatedAt = restoredAt;
      delete plan.deletedByTarget;
    }
  }

  for (const visit of state.visitRecords) {
    if (visit.deletedByTarget === deletedByTarget) {
      visit.deletedAt = null;
      visit.updatedAt = restoredAt;
      delete visit.deletedByTarget;
    }
  }
}

function markDeleted(item, deletedAt, deletedByTarget = "") {
  item.deletedAt = deletedAt;
  item.updatedAt = deletedAt;
  if (deletedByTarget) {
    item.deletedByTarget = deletedByTarget;
  }
}

function targetCascadeKey(targetType, targetId) {
  return `${targetType}:${targetId}`;
}

function isVisitForTarget(visit, targetType, targetId) {
  return targetType === "store" ? visit.storeId === targetId : visit.dishId === targetId;
}

function recalculateTargetStatusForVisit(state, visit) {
  const targetType = visit.storeId ? "store" : "dish";
  const targetId = visit.storeId || visit.dishId;
  if (!targetId) return;

  recalculateTargetStatus(state, targetType, targetId);
}

function recalculateTargetStatus(state, targetType, targetId) {
  const target = getTarget(state, targetType, targetId);
  if (!target) return null;

  const effectiveVisits = activeVisitsForTarget(state, targetType, targetId).filter(
    (visit) => !isVisitIgnoredForTargetStatus(target, visit)
  );
  const hasEffectiveNoAgain = effectiveVisits.some((visit) => visit.feedback === "no_again");
  if (hasEffectiveNoAgain) {
    return updateTargetStatus(state, targetType, targetId, "not_interested");
  }

  const hasScheduledPlan = state.plans.some(
    (plan) => !plan.deletedAt && plan.targetType === targetType && plan.targetId === targetId && plan.status === "scheduled"
  );
  if (hasScheduledPlan) {
    return updateTargetStatus(state, targetType, targetId, "planned");
  }

  const hasNotInterestedPlan = state.plans.some(
    (plan) =>
      !plan.deletedAt &&
      plan.targetType === targetType &&
      plan.targetId === targetId &&
      plan.status === "not_interested"
  );
  if (hasNotInterestedPlan) {
    return updateTargetStatus(state, targetType, targetId, "not_interested");
  }

  const latestVisit = effectiveVisits[effectiveVisits.length - 1];
  if (latestVisit?.feedback === "want_again") {
    return updateTargetStatus(state, targetType, targetId, "want");
  }
  if (latestVisit?.feedback === "ok") {
    return updateTargetStatus(state, targetType, targetId, targetType === "store" ? "visited" : "eaten");
  }

  return updateTargetStatus(state, targetType, targetId, "want");
}

function activeVisitsForTarget(state, targetType, targetId) {
  return state.visitRecords.filter(
    (candidate) => !candidate.deletedAt && isVisitForTarget(candidate, targetType, targetId)
  );
}

function isVisitIgnoredForTargetStatus(target, visit) {
  return Array.isArray(target.ignoredVisitIdsForStatus) && target.ignoredVisitIdsForStatus.includes(visit.id);
}

function restoreCompletedPlansForVisit(state, visit) {
  const targetType = visit.storeId ? "store" : "dish";
  const targetId = visit.storeId || visit.dishId;
  if (!targetId) return;
  if (hasActiveVisitForTargetDate(state, targetType, targetId, visit.date)) return;

  const completedPlanIds = Array.isArray(visit.completedPlanIds) ? visit.completedPlanIds : [];
  for (const plan of state.plans) {
    const explicitlyCompleted = completedPlanIds.includes(plan.id);
    const legacySameDateCompleted =
      !completedPlanIds.length &&
      plan.targetType === targetType &&
      plan.targetId === targetId &&
      plan.date === visit.date;

    if (!plan.deletedAt && plan.status === "completed" && (explicitlyCompleted || legacySameDateCompleted)) {
      plan.status = "scheduled";
      plan.updatedAt = nowIso();
    }
  }
}

function restoreNotInterestedPlansForVisit(state, visit) {
  if (visit.feedback !== "no_again") return;

  const targetType = visit.storeId ? "store" : "dish";
  const targetId = visit.storeId || visit.dishId;
  if (!targetId) return;
  if (hasActiveEffectiveNoAgainForTarget(state, targetType, targetId)) return;

  const affectedPlanStatuses = Array.isArray(visit.notInterestedPlanStatuses)
    ? visit.notInterestedPlanStatuses
    : [];

  for (const affectedPlan of affectedPlanStatuses) {
    const plan = state.plans.find((candidate) => candidate.id === affectedPlan.id);
    if (!plan || plan.deletedAt || plan.status !== "not_interested") continue;

    plan.status = affectedPlan.status === "scheduled" ? "scheduled" : "backlog";
    plan.updatedAt = nowIso();
  }
}

function completePlansForRestoredVisit(state, visit) {
  const targetType = visit.storeId ? "store" : "dish";
  const targetId = visit.storeId || visit.dishId;
  if (!targetId) return;

  const completedPlanIds = Array.isArray(visit.completedPlanIds) ? visit.completedPlanIds : [];
  if (completedPlanIds.length) {
    for (const plan of state.plans) {
      if (!plan.deletedAt && completedPlanIds.includes(plan.id) && plan.status === "scheduled") {
        plan.status = "completed";
        plan.updatedAt = nowIso();
      }
    }
  } else {
    visit.completedPlanIds = completeScheduledPlansForTarget(state, targetType, targetId, visit.date);
  }

  if (visit.feedback === "no_again") {
    if (Array.isArray(visit.notInterestedPlanStatuses) && visit.notInterestedPlanStatuses.length) {
      for (const affectedPlan of visit.notInterestedPlanStatuses) {
        const plan = state.plans.find((candidate) => candidate.id === affectedPlan.id);
        if (!plan || plan.deletedAt || !["scheduled", "backlog"].includes(plan.status)) continue;

        plan.status = "not_interested";
        plan.updatedAt = nowIso();
      }
    } else {
      visit.notInterestedPlanStatuses = markUnfinishedPlansNotInterestedForVisit(state, targetType, targetId);
    }
  }
}

function hasActiveEffectiveNoAgainForTarget(state, targetType, targetId) {
  const target = getTarget(state, targetType, targetId);
  if (!target) return false;

  return activeVisitsForTarget(state, targetType, targetId).some(
    (visit) => visit.feedback === "no_again" && !isVisitIgnoredForTargetStatus(target, visit)
  );
}

function hasActiveVisitForTargetDate(state, targetType, targetId, date) {
  return state.visitRecords.some(
    (candidate) =>
      !candidate.deletedAt &&
      candidate.date === date &&
      ((targetType === "store" && candidate.storeId === targetId) ||
        (targetType === "dish" && candidate.dishId === targetId))
  );
}

function normalizeKeyword(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeTagNames(tagNames = []) {
  const values = Array.isArray(tagNames) ? tagNames : String(tagNames || "").split(/[,，\s]+/);
  return [...new Set(values.map((tagName) => String(tagName || "").trim()).filter(Boolean))];
}

function searchableText(parts) {
  return parts.map((part) => normalizeKeyword(part)).join(" ");
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}
