import assert from "node:assert/strict";
import test from "node:test";

import { runMigrations } from "../server/migrate.mjs";

test("migration is explicit, transactional, and initializes one shared state row", async () => {
  const queries = [];
  let released = false;
  const client = {
    async query(sql, values = []) {
      const normalized = sql.trim();
      queries.push({ sql: normalized, values });
      if (normalized.startsWith("SELECT 1 FROM schema_migrations")) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {
      released = true;
    }
  };
  const pool = {
    async connect() {
      return client;
    }
  };

  const result = await runMigrations({ env: {}, pool });

  assert.deepEqual(result, {
    migration: "001_shared_state",
    initialized: true
  });
  assert.equal(queries[0].sql, "BEGIN");
  assert.equal(queries.some(({ sql }) => sql.includes("CREATE TABLE IF NOT EXISTS schema_migrations")), true);
  assert.equal(queries.some(({ sql }) => sql.includes("CREATE TABLE IF NOT EXISTS app_state")), true);
  const seed = queries.find(({ sql }) => sql.includes("INSERT INTO app_state (state_key"));
  assert.equal(seed.values[0], "shared");
  assert.equal(JSON.parse(seed.values[1]).tags.length > 0, true);
  assert.equal(queries.at(-1).sql, "COMMIT");
  assert.equal(released, true);
});

test("migration refuses to run without an explicit connection string", async () => {
  await assert.rejects(
    runMigrations({ env: {} }),
    /执行 migration 前必须配置 MIGRATION_DATABASE_URL 或 DATABASE_URL/
  );
});
