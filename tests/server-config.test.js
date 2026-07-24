import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";

import { readServerConfig } from "../server/config.mjs";

test("reads deployment, database, and pool settings from environment values", () => {
  assert.deepEqual(readServerConfig({
    HOST: "0.0.0.0",
    PORT: "8080",
    DATA_DIR: "/data",
    DATABASE_URL: "postgresql://app@example/zhongcao",
    MIGRATION_DATABASE_URL: "postgresql://owner@example/zhongcao",
    DATABASE_POOL_MAX: "4"
  }), {
    host: "0.0.0.0",
    port: 8080,
    dataDir: resolve("/data"),
    databaseUrl: "postgresql://app@example/zhongcao",
    migrationDatabaseUrl: "postgresql://owner@example/zhongcao",
    databasePoolMax: 4
  });
});

test("rejects an invalid deployment port", () => {
  assert.throws(
    () => readServerConfig({ PORT: "not-a-port" }),
    /PORT 必须是 1 到 65535 之间的整数/
  );
  assert.throws(
    () => readServerConfig({ PORT: "70000" }),
    /PORT 必须是 1 到 65535 之间的整数/
  );
});

test("limits the PostgreSQL pool to at most five connections", () => {
  assert.equal(readServerConfig({}).databasePoolMax, 5);
  assert.throws(
    () => readServerConfig({ DATABASE_POOL_MAX: "0" }),
    /DATABASE_POOL_MAX 必须是 1 到 5 之间的整数/
  );
  assert.throws(
    () => readServerConfig({ DATABASE_POOL_MAX: "6" }),
    /DATABASE_POOL_MAX 必须是 1 到 5 之间的整数/
  );
});
