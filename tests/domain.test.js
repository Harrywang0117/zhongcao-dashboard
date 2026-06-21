import test from "node:test";
import assert from "node:assert/strict";

import {
  ADDED_BY_VALUES,
  DEFAULT_TAGS,
  addSourceLink,
  applyInboxReparsePreview,
  createInitialState,
  createInboxItem,
  createPlan,
  createVisitRecord,
  findDuplicateSource,
  filterByAddedBy,
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
} from "../src/lib/domain.js";

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

function makeDish(overrides = {}) {
  return {
    id: "dish_1",
    storeId: "store_1",
    name: "牛油锅底",
    status: "want",
    tagNames: [],
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

  assert.equal(state.meta.dataVersion, 2);
  assert.ok(DEFAULT_TAGS.some((tag) => tag.name === "火锅"));
  assert.ok(state.tags.some((tag) => tag.name === "晚餐"));
  assert.deepEqual(ADDED_BY_VALUES, ["xiaowang", "xiaozhang", "unknown"]);
});

test("failed previews require a user supplied title before saving", () => {
  assert.throws(
    () => createInboxItem({ preview: failedPreview, fallbackTitle: "", addedBy: "xiaowang" }),
    /标题、店名或菜名/
  );

  const item = createInboxItem({ preview: failedPreview, fallbackTitle: "待查火锅店", addedBy: "xiaowang" });
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
    () => createInboxItem({ preview: partialPreview, fallbackTitle: "", addedBy: "xiaowang" }),
    /标题、店名或菜名/
  );

  const item = createInboxItem({ preview: partialPreview, fallbackTitle: "静安寺火锅", addedBy: "xiaowang" });
  assert.equal(item.title, "静安寺火锅");
  assert.equal(item.parseStatus, "partial");
});

test("inbox items require a known active added by value", () => {
  assert.throws(
    () => createInboxItem({ preview: successPreview }),
    /添加人/
  );
  assert.throws(
    () => createInboxItem({ preview: successPreview, addedBy: "unknown" }),
    /添加人/
  );
  assert.throws(
    () => createInboxItem({ preview: successPreview, addedBy: "xiaoli" }),
    /添加人/
  );

  const item = createInboxItem({ preview: successPreview, addedBy: "xiaozhang" });
  assert.equal(item.addedBy, "xiaozhang");
});

test("inbox items preserve parsed share suggestions for triage forms", () => {
  const item = createInboxItem({
    preview: {
      ...successPreview,
      status: "partial",
      title: "凤隐·炉端烧鸟居酒场",
      suggested: {
        storeName: "凤隐·炉端烧鸟居酒场",
        city: "成都",
        businessDistrict: "天府新区",
        addressNote: "兴隆街道",
        tagNames: ["日料"],
        note: "评分 4.6，人均 ¥136/人，日本料理"
      }
    },
    fallbackTitle: "凤隐·炉端烧鸟居酒场",
    addedBy: "xiaowang"
  });

  assert.deepEqual(item.suggested, {
    storeName: "凤隐·炉端烧鸟居酒场",
    city: "成都",
    businessDistrict: "天府新区",
    addressNote: "兴隆街道",
    tagNames: ["日料"],
    note: "评分 4.6，人均 ¥136/人，日本料理"
  });
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
    fallbackTitle: "静安寺火锅",
    addedBy: "xiaowang"
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
  const item = createInboxItem({ preview: successPreview, addedBy: "xiaowang" });

  assert.equal(item.title, "老城火锅收藏");
  assert.equal(item.platform, "小红书");
  assert.equal(item.triageStatus, "pending");
  assert.equal(item.addedBy, "xiaowang");
});

test("finds duplicate source links in inbox and store sources", () => {
  const state = createInitialState();
  const inboxItem = createInboxItem({ preview: successPreview, addedBy: "xiaowang" });
  state.inboxItems.push(inboxItem);

  assert.deepEqual(findDuplicateSource(state, successPreview.normalizedUrl), {
    collection: "inboxItems",
    item: inboxItem
  });

  inboxItem.deletedAt = "2026-05-24T00:00:00.000Z";
  state.stores.push({
    id: "store_1",
    name: "老城火锅",
    city: "",
    businessDistrict: "",
    addressNote: "",
    status: "want",
    tagNames: [],
    sourceLinks: [
      {
        id: "source_1",
        platform: successPreview.platform,
        originalUrl: successPreview.originalUrl,
        normalizedUrl: successPreview.normalizedUrl,
        title: successPreview.title,
        imageUrl: successPreview.imageUrl,
        contentType: successPreview.contentType,
        parseStatus: successPreview.status,
        createdAt: "2026-05-24T00:00:00.000Z"
      }
    ],
    coverImageUrl: "",
    note: "",
    deletedAt: null,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z"
  });

  assert.equal(findDuplicateSource(state, successPreview.normalizedUrl).collection, "stores");
  assert.equal(findDuplicateSource(state, successPreview.normalizedUrl).item.id, "store_1");
});

test("organizes an inbox item into store and dish records", () => {
  const state = createInitialState();
  const inboxItem = createInboxItem({ preview: successPreview, addedBy: "xiaozhang" });
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
  assert.equal(result.store.addedBy, "xiaozhang");
  assert.equal(result.dish.addedBy, "xiaozhang");
  assert.equal(result.store.sourceLinks[0].addedBy, "xiaozhang");
});

test("filters stores, dishes, and inbox items by added by", () => {
  const state = createInitialState();
  const xiaowangStore = makeStore({ id: "store_1", addedBy: "xiaowang", tagNames: ["火锅"] });
  const xiaozhangStore = makeStore({ id: "store_2", addedBy: "xiaozhang", tagNames: ["火锅"] });
  const unknownStore = makeStore({ id: "store_3", addedBy: "unknown", tagNames: ["烧烤"] });
  state.stores.push(xiaowangStore, xiaozhangStore, unknownStore);
  state.dishes.push(
    makeDish({ id: "dish_1", addedBy: "xiaowang", tagNames: ["火锅"] }),
    makeDish({ id: "dish_2", addedBy: "xiaozhang", tagNames: ["火锅"] })
  );
  state.inboxItems.push(
    createInboxItem({ preview: { ...successPreview, normalizedUrl: "https://xhs.example/1" }, addedBy: "xiaowang" }),
    createInboxItem({ preview: { ...successPreview, normalizedUrl: "https://xhs.example/2" }, addedBy: "xiaozhang" })
  );

  assert.deepEqual(filterByAddedBy(state.stores, "xiaowang").map((store) => store.id), ["store_1"]);
  assert.deepEqual(filterByAddedBy(state.dishes, "xiaozhang").map((dish) => dish.id), ["dish_2"]);
  assert.deepEqual(filterByAddedBy(state.inboxItems, "xiaozhang").map((item) => item.addedBy), ["xiaozhang"]);
  assert.deepEqual(filterByAddedBy(filterByTags(state.stores, ["火锅"]), "xiaozhang").map((store) => store.id), ["store_2"]);
  assert.deepEqual(filterByAddedBy(state.stores, "unknown").map((store) => store.id), ["store_3"]);
  assert.equal(filterByAddedBy(state.stores, "all").length, 3);
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

test("want again returns target to wishlist when no future plans remain", () => {
  const state = createInitialState();
  state.stores.push(makeStore());
  const plan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-06-01"
  });

  createVisitRecord(state, {
    storeId: "store_1",
    date: "2026-06-01",
    feedback: "want_again"
  });

  assert.equal(state.plans.find((candidate) => candidate.id === plan.id).status, "completed");
  assert.equal(state.stores[0].status, "want");
});

test("want again keeps target planned when another scheduled plan remains", () => {
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

  createVisitRecord(state, {
    storeId: "store_1",
    date: "2026-06-01",
    feedback: "want_again"
  });

  assert.equal(state.plans.find((candidate) => candidate.id === firstPlan.id).status, "completed");
  assert.equal(state.plans.find((candidate) => candidate.id === laterPlan.id).status, "scheduled");
  assert.equal(state.stores[0].status, "planned");
});

test("ok marks a store visited and a dish eaten when no future plans remain", () => {
  const state = createInitialState();
  state.stores.push(makeStore());
  state.dishes.push(makeDish());

  createVisitRecord(state, {
    storeId: "store_1",
    date: "2026-06-01",
    feedback: "ok"
  });
  createVisitRecord(state, {
    dishId: "dish_1",
    date: "2026-06-01",
    feedback: "ok"
  });

  assert.equal(state.stores[0].status, "visited");
  assert.equal(state.dishes[0].status, "eaten");
});

test("ok keeps target planned when another scheduled plan remains", () => {
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

  createVisitRecord(state, {
    storeId: "store_1",
    date: "2026-06-01",
    feedback: "ok"
  });

  assert.equal(state.plans.find((candidate) => candidate.id === firstPlan.id).status, "completed");
  assert.equal(state.plans.find((candidate) => candidate.id === laterPlan.id).status, "scheduled");
  assert.equal(state.stores[0].status, "planned");
});

test("no again marks target not interested and clears unfinished plans", () => {
  const state = createInitialState();
  state.stores.push(makeStore());
  const todayPlan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-06-01"
  });
  const laterPlan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-07-01"
  });
  const backlogPlan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-08-01"
  });
  updatePlanStatus(state, backlogPlan.id, "back-to-wishlist");

  createVisitRecord(state, {
    storeId: "store_1",
    date: "2026-06-01",
    feedback: "no_again"
  });

  assert.equal(state.plans.find((candidate) => candidate.id === todayPlan.id).status, "completed");
  assert.equal(state.plans.find((candidate) => candidate.id === laterPlan.id).status, "not_interested");
  assert.equal(state.plans.find((candidate) => candidate.id === backlogPlan.id).status, "not_interested");
  assert.equal(state.stores[0].status, "not_interested");
});

test("soft deleting a no again visit restores affected plans and recalculates status", () => {
  const state = createInitialState();
  state.stores.push(makeStore());
  const todayPlan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-06-01"
  });
  const laterPlan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-07-01"
  });
  const visit = createVisitRecord(state, {
    storeId: "store_1",
    date: "2026-06-01",
    feedback: "no_again"
  });

  softDeleteItem(state, "visitRecords", visit.id);

  assert.equal(state.plans.find((candidate) => candidate.id === todayPlan.id).status, "scheduled");
  assert.equal(state.plans.find((candidate) => candidate.id === laterPlan.id).status, "scheduled");
  assert.equal(state.stores[0].status, "planned");
});

test("soft deleting one same-day visit does not restore a plan covered by another visit", () => {
  const state = createInitialState();
  state.stores.push(makeStore());
  const plan = createPlan(state, {
    targetType: "store",
    targetId: "store_1",
    date: "2026-06-01"
  });
  const firstVisit = createVisitRecord(state, {
    storeId: "store_1",
    date: "2026-06-01",
    feedback: "ok"
  });
  createVisitRecord(state, {
    storeId: "store_1",
    date: "2026-06-01",
    feedback: "want_again"
  });

  softDeleteItem(state, "visitRecords", firstVisit.id);

  assert.equal(state.plans.find((candidate) => candidate.id === plan.id).status, "completed");
  assert.equal(state.stores[0].status, "want");
});

test("restoring a not interested target suppresses old feedback status effects", () => {
  const state = createInitialState();
  state.stores.push(makeStore());
  const visit = createVisitRecord(state, {
    storeId: "store_1",
    date: "2026-06-01",
    feedback: "no_again"
  });

  restoreTargetToWishlist(state, "store", "store_1");

  assert.equal(state.visitRecords.find((candidate) => candidate.id === visit.id).deletedAt, null);
  assert.equal(state.stores[0].status, "want");
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
    addedBy: "xiaowang",
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

  addSourceLink(state, "store_1", successPreview, "xiaozhang");
  addSourceLink(state, "store_1", successPreview, "xiaowang");

  assert.equal(state.stores[0].sourceLinks.length, 1);
  assert.equal(state.stores[0].sourceLinks[0].addedBy, "xiaozhang");
});

test("merges inbox source into existing store and can create a bound dish", () => {
  const state = createInitialState();
  const inboxItem = createInboxItem({ preview: successPreview, addedBy: "xiaozhang" });
  state.inboxItems.push(inboxItem);
  state.stores.push({
    id: "store_1",
    name: "老城火锅",
    addedBy: "xiaowang",
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
  assert.equal(result.store.addedBy, "xiaowang");
  assert.equal(result.store.sourceLinks[0].addedBy, "xiaozhang");
  assert.equal(result.dish.addedBy, "xiaozhang");
  assert.equal(state.inboxItems[0].triageStatus, "organized");
});

test("updates store and dish details including tags and manual cover urls", () => {
  const state = createInitialState();
  state.stores.push({
    id: "store_1",
    name: "老城火锅",
    addedBy: "unknown",
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
    addedBy: "unknown",
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
    addedBy: "xiaowang",
    note: "适合晚餐"
  });
  const dish = updateDish(state, "dish_1", {
    name: "鲜切牛肉",
    tagNames: ["牛肉", "晚餐"],
    coverImageUrl: "https://image.example/dish.jpg",
    addedBy: "xiaozhang",
    note: "记得点小份"
  });

  assert.equal(store.name, "老城鲜切火锅");
  assert.equal(store.businessDistrict, "愚园路");
  assert.equal(store.coverImageUrl, "https://image.example/store.jpg");
  assert.equal(store.addedBy, "xiaowang");
  assert.deepEqual(store.tagNames, ["火锅", "辛辣"]);
  assert.equal(dish.name, "鲜切牛肉");
  assert.equal(dish.coverImageUrl, "https://image.example/dish.jpg");
  assert.equal(dish.addedBy, "xiaozhang");
  assert.ok(state.tags.some((tag) => tag.name === "牛肉"));
});
