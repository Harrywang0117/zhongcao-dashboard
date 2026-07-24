import assert from "node:assert/strict";
import test from "node:test";

import {
  StateConflictError,
  createStateRepository
} from "../server/state-repository.mjs";
import { createInitialState } from "../src/lib/domain.js";

test("readiness reports missing schema without querying a missing table", async () => {
  const queries = [];
  const repository = createStateRepository({
    async query(sql) {
      queries.push(sql);
      return {
        rows: [{ has_state_table: false, has_revision_table: false }]
      };
    }
  });

  assert.deepEqual(await repository.checkReady(), {
    ready: false,
    reason: "schema_missing"
  });
  assert.equal(queries.length, 1);
  assert.match(queries[0], /to_regclass/);
});

test("repository rejects stale revisions before inserting history", async () => {
  const current = {
    state: createInitialState(),
    revision: "4",
    updated_at: new Date("2026-07-23T00:00:00.000Z")
  };
  const queries = [];
  let released = false;
  const client = {
    async query(sql) {
      queries.push(sql.trim());
      if (sql.includes("FOR UPDATE")) return { rowCount: 1, rows: [current] };
      return { rowCount: 0, rows: [] };
    },
    release() {
      released = true;
    }
  };
  const repository = createStateRepository({
    async connect() {
      return client;
    }
  });

  await assert.rejects(
    repository.putState({
      state: createInitialState(),
      expectedRevision: 3
    }),
    (error) => {
      assert.equal(error instanceof StateConflictError, true);
      assert.equal(error.latest.revision, 4);
      return true;
    }
  );

  assert.equal(queries.some((sql) => sql.includes("INSERT INTO app_state_revisions")), false);
  assert.equal(queries.filter((sql) => sql === "ROLLBACK").length, 1);
  assert.equal(released, true);
});

test("repository stores the prior revision and commits one atomic update", async () => {
  const current = {
    state: createInitialState(),
    revision: "0",
    updated_at: new Date("2026-07-23T00:00:00.000Z")
  };
  const nextState = createInitialState();
  nextState.inboxItems.push({ id: "inbox_1", title: "事务写入", addedBy: "xiaowang" });
  const queries = [];
  const client = {
    async query(sql, values = []) {
      const normalized = sql.trim();
      queries.push({ sql: normalized, values });
      if (sql.includes("FOR UPDATE")) return { rowCount: 1, rows: [current] };
      if (sql.includes("UPDATE app_state")) {
        return {
          rowCount: 1,
          rows: [{
            state: nextState,
            revision: "1",
            updated_at: new Date("2026-07-23T00:00:01.000Z")
          }]
        };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  const repository = createStateRepository({
    async connect() {
      return client;
    }
  }, { historyLimit: 50 });

  const saved = await repository.putState({ state: nextState, expectedRevision: 0 });

  assert.equal(saved.revision, 1);
  assert.equal(saved.state.inboxItems[0].title, "事务写入");
  assert.equal(queries.some(({ sql }) => sql.includes("INSERT INTO app_state_revisions")), true);
  assert.equal(queries.some(({ sql, values }) => sql.includes("OFFSET $2") && values[1] === 50), true);
  assert.equal(queries.at(-1).sql, "COMMIT");
});
