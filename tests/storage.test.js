import test from "node:test";
import assert from "node:assert/strict";

import { DATA_VERSION, createInitialState } from "../src/lib/domain.js";
import {
  StateConflictError,
  createStateBackup,
  loadState,
  migrateState,
  saveState,
  saveStateMutation
} from "../src/lib/storage.js";

test("creates a versioned JSON backup for later server migration", () => {
  const state = migrateState({
    inboxItems: [{ id: "inbox_1", title: "老城火锅", addedBy: "xiaowang" }],
    stores: [],
    dishes: [],
    plans: [],
    visitRecords: [],
    tags: []
  });

  const backup = createStateBackup(state, new Date("2026-06-23T12:34:56.000Z"));
  const payload = JSON.parse(backup.content);

  assert.equal(backup.filename, "zhongcao-backup-2026-06-23.json");
  assert.equal(payload.format, "zhongcao-state-backup");
  assert.equal(payload.backupVersion, 1);
  assert.equal(payload.exportedAt, "2026-06-23T12:34:56.000Z");
  assert.equal(payload.dataVersion, DATA_VERSION);
  assert.equal(payload.state.inboxItems[0].id, "inbox_1");
});

test("migrates missing added by fields without dropping existing data", () => {
  const rawState = {
    meta: {
      dataVersion: 1,
      createdAt: "2026-05-24T00:00:00.000Z",
      updatedAt: "2026-05-24T00:00:00.000Z"
    },
    inboxItems: [
      {
        id: "inbox_1",
        title: "老城火锅",
        deletedAt: null
      }
    ],
    stores: [
      {
        id: "store_1",
        name: "老城火锅",
        sourceLinks: [
          {
            id: "source_1",
            normalizedUrl: "https://example.com/a"
          }
        ],
        deletedAt: null
      },
      {
        id: "store_2",
        name: "小张烧烤",
        addedBy: "xiaozhang",
        sourceLinks: [
          {
            id: "source_2",
            normalizedUrl: "https://example.com/b"
          },
          {
            id: "source_3",
            normalizedUrl: "https://example.com/c",
            addedBy: "xiaowang"
          }
        ],
        deletedAt: null
      }
    ],
    dishes: [
      {
        id: "dish_1",
        name: "牛油锅底",
        deletedAt: null
      }
    ],
    plans: [
      {
        id: "plan_1",
        targetType: "store",
        targetId: "store_1",
        status: "scheduled"
      }
    ],
    visitRecords: [
      {
        id: "visit_1",
        storeId: "store_1",
        feedback: "ok",
        deletedAt: null
      }
    ],
    tags: [
      {
        id: "tag_custom_朋友局",
        name: "朋友局",
        group: "custom"
      }
    ]
  };

  const state = migrateState(rawState);

  assert.equal(state.meta.dataVersion, DATA_VERSION);
  assert.equal(state.inboxItems[0].addedBy, "unknown");
  assert.equal(state.inboxItems[0].metadataStatus, "unknown");
  assert.equal(state.inboxItems[0].imageStatus, "not_found");
  assert.equal(state.stores[0].addedBy, "unknown");
  assert.equal(state.stores[0].sourceLinks[0].addedBy, "unknown");
  assert.equal(state.stores[0].sourceLinks[0].sharedUrl, "https://example.com/a");
  assert.equal(state.stores[0].sourceLinks[0].resolvedUrl, "https://example.com/a");
  assert.equal(state.stores[0].sourceLinks[0].metadataStatus, "unknown");
  assert.equal(state.stores[0].sourceLinks[0].imageStatus, "not_found");
  assert.equal(state.stores[1].addedBy, "xiaozhang");
  assert.equal(state.stores[1].sourceLinks[0].addedBy, "xiaozhang");
  assert.equal(state.stores[1].sourceLinks[1].addedBy, "xiaowang");
  assert.equal(state.dishes[0].addedBy, "unknown");
  assert.deepEqual(state.dishes[0].sourceLinks, []);
  assert.equal(state.plans.length, 1);
  assert.equal(state.visitRecords.length, 1);
  assert.ok(state.tags.some((tag) => tag.name === "朋友局"));
});

test("migrates invalid added by values to unknown", () => {
  const state = migrateState({
    inboxItems: [{ id: "inbox_1", addedBy: "someone_else" }],
    stores: [{ id: "store_1", addedBy: "someone_else", sourceLinks: [{ id: "source_1", addedBy: "bad" }] }],
    dishes: [{ id: "dish_1", addedBy: "bad" }],
    plans: [],
    visitRecords: [],
    tags: []
  });

  assert.equal(state.inboxItems[0].addedBy, "unknown");
  assert.equal(state.stores[0].addedBy, "unknown");
  assert.equal(state.stores[0].sourceLinks[0].addedBy, "unknown");
  assert.equal(state.dishes[0].addedBy, "unknown");
});

test("loads and saves shared state with an expected revision", async () => {
  const initial = createInitialState();
  const requests = [];
  const loaded = await loadState({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return Response.json({ state: initial, revision: 3 });
    }
  });

  loaded.inboxItems.push({ id: "inbox_1", title: "共享火锅", addedBy: "xiaowang" });
  const saved = await saveState(loaded, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      const body = JSON.parse(options.body);
      assert.equal(body.expectedRevision, 3);
      return Response.json({ state: body.state, revision: 4 });
    }
  });

  assert.equal(requests[0].url, "/api/state");
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[1].options.method, "PUT");
  assert.equal(saved.inboxItems[0].title, "共享火锅");
});

test("exposes the latest state when a revision conflict occurs", async () => {
  const initial = createInitialState();
  await loadState({
    fetchImpl: async () => Response.json({ state: initial, revision: 8 })
  });

  const latest = createInitialState();
  latest.stores.push({ id: "store_1", name: "另一台设备新增", addedBy: "xiaozhang" });

  await assert.rejects(
    saveState(initial, {
      fetchImpl: async () => Response.json({
        error: "revision_conflict",
        state: latest,
        revision: 9
      }, { status: 409 })
    }),
    (error) => {
      assert.equal(error instanceof StateConflictError, true);
      assert.equal(error.revision, 9);
      assert.equal(error.latestState.stores[0].name, "另一台设备新增");
      return true;
    }
  );
});

test("replays one mutation on the latest state after a revision conflict", async () => {
  const base = createInitialState();
  const latest = createInitialState();
  latest.stores.push({ id: "store_remote", name: "远端店铺", addedBy: "xiaozhang" });
  let saveCalls = 0;
  const conflicts = [];

  const saved = await saveStateMutation(
    base,
    (state) => {
      state.inboxItems.push({ id: "inbox_local", title: "本地操作", addedBy: "xiaowang" });
      return "saved";
    },
    {
      saveImpl: async (state) => {
        saveCalls += 1;
        if (saveCalls === 1) throw new StateConflictError(latest, 1);
        return state;
      },
      onConflict: (state, revision) => conflicts.push({ state, revision })
    }
  );

  assert.equal(saveCalls, 2);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].state.stores[0].name, "远端店铺");
  assert.equal(conflicts[0].revision, 1);
  assert.equal(saved.replayed, true);
  assert.equal(saved.result, "saved");
  assert.equal(saved.state.stores[0].name, "远端店铺");
  assert.equal(saved.state.inboxItems[0].title, "本地操作");
});

test("does not retry a mutation more than once", async () => {
  const base = createInitialState();
  let saveCalls = 0;
  const conflicts = [];

  await assert.rejects(
    saveStateMutation(
      base,
      (state) => {
        state.tags.push({ id: "tag_test", name: "测试", group: "custom" });
      },
      {
        saveImpl: async () => {
          saveCalls += 1;
          const latest = createInitialState();
          latest.meta.updatedAt = `2026-07-23T00:00:0${saveCalls}.000Z`;
          throw new StateConflictError(latest, saveCalls);
        },
        onConflict: (state, revision) => conflicts.push({ state, revision })
      }
    ),
    StateConflictError
  );

  assert.equal(saveCalls, 2);
  assert.deepEqual(conflicts.map(({ revision }) => revision), [1, 2]);
  assert.equal(conflicts[1].state.meta.updatedAt, "2026-07-23T00:00:02.000Z");
});

test("adopts the latest state before a replay mutation fails", async () => {
  const base = createInitialState();
  base.stores.push({ id: "store_deleted_remotely", name: "旧店铺", addedBy: "xiaowang" });
  const latest = createInitialState();
  let adopted = null;

  await assert.rejects(
    saveStateMutation(
      base,
      (state) => {
        const store = state.stores.find(({ id }) => id === "store_deleted_remotely");
        if (!store) throw new Error("目标店铺已被其他设备删除");
        store.name = "本地改名";
      },
      {
        saveImpl: async () => {
          throw new StateConflictError(latest, 5);
        },
        onConflict: (state, revision) => {
          adopted = { state, revision };
        }
      }
    ),
    /目标店铺已被其他设备删除/
  );

  assert.equal(adopted.revision, 5);
  assert.equal(adopted.state.stores.length, 0);
});
