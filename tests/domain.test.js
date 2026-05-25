import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_TAGS,
  addSourceLink,
  applyInboxReparsePreview,
  createInitialState,
  createInboxItem,
  createPlan,
  createVisitRecord,
  filterByTags,
  mergeInboxItemIntoStore,
  organizeInboxItem,
  restoreTargetToWishlist,
  restoreItem,
  searchCollections,
  softDeleteItem,
  updateDish,
  updatePlanStatus,
  updateStore
} from "../public/lib/domain.js";

const failedPreview = {
  status: "failed",
  platform: "未知平台",
  originalUrl: "https://bad.example/link",
  normalizedUrl: "https://bad.example/link",
  title: "",
  imageUrl: "",
  contentType: "unknown",
  failureReason: "解析失败"
};

const successPreview = {
  status: "success",
  platform: "小红书",
  originalUrl: "https://www.xiaohongshu.com/explore/abc",
  normalizedUrl: "https://www.xiaohongshu.com/explore/abc",
  title: "老城火锅收藏",
  imageUrl: "https://image.example/cover.jpg",
  contentType: "note",
  failureReason: ""
};

function makeStore(overrides = {}) {
  return {
    id: "store_1",
    name: "老城火锅",
    city: "",
    businessDistrict: "",
    addressNote: "",
    status: "want",
    tagNames: [],
    sourceLinks: [],
    coverImageUrl: "",
    note: "",
    deletedAt: null,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
    ...overrides
  };
}

test("initial state contains default searchable tags and data version", () => {
  const state = createInitialState();

  assert.equal(state.meta.dataVersion, 1);
  assert.ok(DEFAULT_TAGS.some((tag) => tag.name === "火锅"));
  assert.ok(state.tags.some((tag) => tag.name === "晚餐"));
});

test("failed previews require a user supplied title before saving", () => {
  assert.throws(
    () => createInboxItem({ preview: failedPreview, fallbackTitle: "" }),
    /标题、店名或菜名/
  );

  const item = createInboxItem({ preview: failedPreview, fallbackTitle: "待查火锅店" });
  assert.equal(item.title, "待查火锅店");
  assert.equal(item.parseStatus, "failed");
});

test("partial previews require a user supplied title before saving", () => {
  const partialPreview = {
    ...successPreview,
    status: "partial",
    title: "小红书",
    failureReason: "未解析到可识别标题"
  };

  assert.throws(
    () => createInboxItem({ preview: partialPreview, fallbackTitle: "" }),
    /标题、店名或菜名/
  );

  const item = createInboxItem({ preview: partialPreview, fallbackTitle: "静安寺火锅" });
  assert.equal(item.title, "静安寺火锅");
  assert.equal(item.parseStatus, "partial");
});

test("reparsing preserves a manually supplied inbox title while refreshing metadata", () => {
  const item = createInboxItem({
    preview: {
      ...successPreview,
      status: "partial",
      title: "小红书",
      imageUrl: "",
      failureReason: "未解析到可识别标题"
    },
    fallbackTitle: "静安寺火锅"
  });

  applyInboxReparsePreview(item, {
    ...successPreview,
    status: "success",
    title: "小红书",
    imageUrl: "https://image.example/fresh.jpg",
    contentType: "note",
    failureReason: ""
  });

  assert.equal(item.title, "静安寺火锅");
  assert.equal(item.parseStatus, "success");
  assert.equal(item.previewImageUrl, "https://image.example/fresh.jpg");
});

test("successful previews can be saved directly into inbox", () => {
  const item = createInboxItem({ preview: successPreview });

  assert.equal(item.title, "老城火锅收藏");
  assert.equal(item.platform, "小红书");
  assert.equal(item.triageStatus, "pending");
});

test("organizes an inbox item into store and dish records", () => {
  const state = createInitialState();
  const inboxItem = createInboxItem({ preview: successPreview });
  state.inboxItems.push(inboxItem);

  const result = organizeInboxItem(state, inboxItem.id, {
    template: "store-dish",
    storeName: "老城火锅",
    dishName: "牛油锅底",
    city: "上海",
    businessDistrict: "静安寺",
    tagNames: ["火锅", "晚餐"]
  });

  assert.equal(result.store.name, "老城火锅");
  assert.equal(result.dish.storeId, result.store.id);
  assert.equal(state.inboxItems[0].triageStatus, "organized");
  assert.deepEqual(result.store.sourceLinks.map((link) => link.platform), ["小红书"]);
});

test("searches stores and dishes by name, district, notes, and tags", () => {
  const state = createInitialState();
  state.stores.push({
    id: "store_1",
    name: "老城火锅",
    city: "上海",
    businessDistrict: "静安寺",
    addressNote: "地铁口附近",
    status: "want",
    tagNames: ["火锅", "晚餐"],
    sourceLinks: [],
    coverImageUrl: "",
    note: "适合朋友聚餐",
    deletedAt: null,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z"
  });
  state.dishes.push({
    id: "dish_1",
    storeId: "store_1",
    name: "清淡鸡汤面",
    status: "want",
    tagNames: ["清淡", "午餐"],
    coverImageUrl: "",
    note: "",
    deletedAt: null,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z"
  });

  assert.equal(searchCollections(state, "静安").stores.length, 1);
  assert.equal(searchCollections(state, "静安").dishes.length, 1);
  assert.equal(searchCollections(state, "鸡汤").dishes.length, 1);
  assert.equal(filterByTags(state.stores, ["火锅"]).length, 1);
});

test("plans, reschedules, returns to wishlist, and marks items not interested", () => {
  const state = createInitialState();
  const plan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-06-01"
  });

  assert.equal(plan.status, "scheduled");
  assert.equal(updatePlanStatus(state, plan.id, "reschedule", "2026-06-03").date, "2026-06-03");
  assert.equal(updatePlanStatus(state, plan.id, "back-to-wishlist").status, "backlog");
  assert.equal(updatePlanStatus(state, plan.id, "not-interested").status, "not_interested");
});

test("does not duplicate scheduled plans for the same target on the same date", () => {
  const state = createInitialState();
  state.stores.push(makeStore());

  const firstPlan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-06-01"
  });
  const secondPlan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-06-01"
  });

  assert.equal(secondPlan.id, firstPlan.id);
  assert.equal(state.plans.length, 1);
  assert.equal(state.stores[0].status, "planned");
});

test("returning one plan to wishlist keeps a target planned when another plan remains scheduled", () => {
  const state = createInitialState();
  state.stores.push(makeStore());
  const firstPlan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-06-01"
  });
  const laterPlan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-07-01"
  });

  updatePlanStatus(state, firstPlan.id, "back-to-wishlist");

  assert.equal(state.plans.find((plan) => plan.id === firstPlan.id).status, "backlog");
  assert.equal(state.plans.find((plan) => plan.id === laterPlan.id).status, "scheduled");
  assert.equal(state.stores[0].status, "planned");
});

test("marking a plan not interested clears the target's remaining scheduled plans", () => {
  const state = createInitialState();
  state.stores.push(makeStore());
  const firstPlan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-06-01"
  });
  const laterPlan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-07-01"
  });

  updatePlanStatus(state, firstPlan.id, "not-interested");

  assert.equal(state.plans.find((plan) => plan.id === firstPlan.id).status, "not_interested");
  assert.equal(state.plans.find((plan) => plan.id === laterPlan.id).status, "not_interested");
  assert.equal(state.stores[0].status, "not_interested");
});

test("visit records require only date and three-button feedback", () => {
  const state = createInitialState();
  state.stores.push({
    id: "store_1",
    name: "老城火锅",
    city: "",
    businessDistrict: "",
    addressNote: "",
    status: "want",
    tagNames: [],
    sourceLinks: [],
    coverImageUrl: "",
    note: "",
    deletedAt: null,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z"
  });
  const plan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-06-01"
  });
  const visit = createVisitRecord(state, {
    storeId: "store_1",
    date: "2026-06-01",
    feedback: "want_again"
  });

  assert.equal(visit.feedback, "want_again");
  assert.equal(visit.note, "");
  assert.equal(state.plans.find((candidate) => candidate.id === plan.id).status, "completed");
});

test("visit records complete only the scheduled plan on the same date", () => {
  const state = createInitialState();
  state.stores.push({
    id: "store_1",
    name: "老城火锅",
    city: "",
    businessDistrict: "",
    addressNote: "",
    status: "want",
    tagNames: [],
    sourceLinks: [],
    coverImageUrl: "",
    note: "",
    deletedAt: null,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z"
  });
  const firstPlan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-06-01"
  });
  const laterPlan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-07-01"
  });

  createVisitRecord(state, {
    storeId: "store_1",
    date: "2026-06-01",
    feedback: "ok"
  });

  assert.equal(state.plans.find((plan) => plan.id === firstPlan.id).status, "completed");
  assert.equal(state.plans.find((plan) => plan.id === laterPlan.id).status, "scheduled");
});

test("soft deleting a visit restores the plan it completed", () => {
  const state = createInitialState();
  state.stores.push(makeStore());
  const plan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-06-01"
  });
  const visit = createVisitRecord(state, {
    storeId: "store_1",
    date: "2026-06-01",
    feedback: "ok"
  });

  softDeleteItem(state, "visitRecords", visit.id);

  assert.equal(state.plans.find((candidate) => candidate.id === plan.id).status, "scheduled");
  assert.equal(state.stores[0].status, "planned");
});

test("soft deletes and restores records", () => {
  const state = createInitialState();
  state.stores.push({
    id: "store_1",
    name: "老城火锅",
    city: "",
    businessDistrict: "",
    addressNote: "",
    status: "want",
    tagNames: [],
    sourceLinks: [],
    coverImageUrl: "",
    note: "",
    deletedAt: null,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z"
  });

  softDeleteItem(state, "stores", "store_1");
  assert.ok(state.stores[0].deletedAt);

  restoreItem(state, "stores", "store_1");
  assert.equal(state.stores[0].deletedAt, null);
});

test("soft deleting and restoring a store cascades plans and visit records for that store", () => {
  const state = createInitialState();
  state.stores.push({
    id: "store_1",
    name: "老城火锅",
    city: "",
    businessDistrict: "",
    addressNote: "",
    status: "want",
    tagNames: [],
    sourceLinks: [],
    coverImageUrl: "",
    note: "",
    deletedAt: null,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z"
  });
  const plan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-06-01"
  });
  const visit = createVisitRecord(state, {
    storeId: "store_1",
    date: "2026-06-01",
    feedback: "ok"
  });

  softDeleteItem(state, "stores", "store_1");

  assert.ok(state.plans.find((candidate) => candidate.id === plan.id).deletedAt);
  assert.ok(state.visitRecords.find((candidate) => candidate.id === visit.id).deletedAt);

  restoreItem(state, "stores", "store_1");

  assert.equal(state.plans.find((candidate) => candidate.id === plan.id).deletedAt, null);
  assert.equal(state.visitRecords.find((candidate) => candidate.id === visit.id).deletedAt, null);
});

test("soft deleting the last visit restores target status to wishlist", () => {
  const state = createInitialState();
  state.stores.push({
    id: "store_1",
    name: "老城火锅",
    city: "",
    businessDistrict: "",
    addressNote: "",
    status: "want",
    tagNames: [],
    sourceLinks: [],
    coverImageUrl: "",
    note: "",
    deletedAt: null,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z"
  });
  const visit = createVisitRecord(state, {
    storeId: "store_1",
    date: "2026-06-01",
    feedback: "ok"
  });

  softDeleteItem(state, "visitRecords", visit.id);

  assert.equal(state.visitRecords[0].deletedAt !== null, true);
  assert.equal(state.stores[0].status, "want");
});

test("restores a not interested target back to wishlist", () => {
  const state = createInitialState();
  state.stores.push({
    id: "store_1",
    name: "老城火锅",
    city: "",
    businessDistrict: "",
    addressNote: "",
    status: "want",
    tagNames: [],
    sourceLinks: [],
    coverImageUrl: "",
    note: "",
    deletedAt: null,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z"
  });
  const plan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-06-01"
  });
  updatePlanStatus(state, plan.id, "not-interested");

  restoreTargetToWishlist(state, "store", "store_1");

  assert.equal(state.stores[0].status, "want");
  assert.equal(state.plans[0].status, "backlog");
});

test("adds multiple source links to a store without duplicating normalized urls", () => {
  const state = createInitialState();
  state.stores.push({
    id: "store_1",
    name: "老城火锅",
    city: "",
    businessDistrict: "",
    addressNote: "",
    status: "want",
    tagNames: [],
    sourceLinks: [],
    coverImageUrl: "",
    note: "",
    deletedAt: null,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z"
  });

  addSourceLink(state, "store_1", successPreview);
  addSourceLink(state, "store_1", successPreview);

  assert.equal(state.stores[0].sourceLinks.length, 1);
});

test("merges inbox source into existing store and can create a bound dish", () => {
  const state = createInitialState();
  const inboxItem = createInboxItem({ preview: successPreview });
  state.inboxItems.push(inboxItem);
  state.stores.push({
    id: "store_1",
    name: "老城火锅",
    city: "",
    businessDistrict: "",
    addressNote: "",
    status: "want",
    tagNames: ["火锅"],
    sourceLinks: [],
    coverImageUrl: "",
    note: "",
    deletedAt: null,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z"
  });

  const result = mergeInboxItemIntoStore(state, inboxItem.id, "store_1", {
    dishName: "牛油锅底",
    tagNames: ["晚餐"]
  });

  assert.equal(result.store.sourceLinks.length, 1);
  assert.equal(result.dish.storeId, "store_1");
  assert.equal(state.inboxItems[0].triageStatus, "organized");
});

test("updates store and dish details including tags and manual cover urls", () => {
  const state = createInitialState();
  state.stores.push({
    id: "store_1",
    name: "老城火锅",
    city: "上海",
    businessDistrict: "静安寺",
    addressNote: "",
    status: "want",
    tagNames: ["火锅"],
    sourceLinks: [],
    coverImageUrl: "",
    note: "",
    deletedAt: null,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z"
  });
  state.dishes.push({
    id: "dish_1",
    storeId: "store_1",
    name: "牛油锅底",
    status: "want",
    tagNames: ["晚餐"],
    coverImageUrl: "",
    note: "",
    deletedAt: null,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z"
  });

  const store = updateStore(state, "store_1", {
    name: "老城鲜切火锅",
    city: "上海",
    businessDistrict: "愚园路",
    addressNote: "二楼",
    tagNames: ["火锅", "辛辣"],
    coverImageUrl: "https://image.example/store.jpg",
    note: "适合晚餐"
  });
  const dish = updateDish(state, "dish_1", {
    name: "鲜切牛肉",
    tagNames: ["牛肉", "晚餐"],
    coverImageUrl: "https://image.example/dish.jpg",
    note: "记得点小份"
  });

  assert.equal(store.name, "老城鲜切火锅");
  assert.equal(store.businessDistrict, "愚园路");
  assert.equal(store.coverImageUrl, "https://image.example/store.jpg");
  assert.deepEqual(store.tagNames, ["火锅", "辛辣"]);
  assert.equal(dish.name, "鲜切牛肉");
  assert.equal(dish.coverImageUrl, "https://image.example/dish.jpg");
  assert.ok(state.tags.some((tag) => tag.name === "牛肉"));
});
