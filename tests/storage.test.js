import test from "node:test";
import assert from "node:assert/strict";

import { DATA_VERSION } from "../src/lib/domain.js";
import { createStateBackup, migrateState } from "../src/lib/storage.js";

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
