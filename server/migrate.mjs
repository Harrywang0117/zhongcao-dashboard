import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { createInitialState } from "../src/lib/domain.js";
import { readServerConfig } from "./config.mjs";
import { createDatabasePool } from "./database.mjs";

const MIGRATION_VERSION = "001_shared_state";

export async function runMigrations({
  env = process.env,
  pool: injectedPool
} = {}) {
  const config = readServerConfig(env);
  const connectionString = config.migrationDatabaseUrl || config.databaseUrl;
  if (!injectedPool && !connectionString) {
    throw new Error("执行 migration 前必须配置 MIGRATION_DATABASE_URL 或 DATABASE_URL");
  }

  const pool = injectedPool || createDatabasePool({ connectionString, max: 1 });
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = await client.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1",
      [MIGRATION_VERSION]
    );
    if (!applied.rowCount) {
      const sql = await readFile(
        new URL("./migrations/001_shared_state.sql", import.meta.url),
        "utf8"
      );
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [MIGRATION_VERSION]
      );
    }

    await client.query(`
      INSERT INTO app_state (state_key, state, revision)
      VALUES ($1, $2::jsonb, 0)
      ON CONFLICT (state_key) DO NOTHING
    `, ["shared", JSON.stringify(createInitialState())]);

    await client.query("COMMIT");
    committed = true;
    return { migration: MIGRATION_VERSION, initialized: true };
  } catch (error) {
    if (!committed) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original migration error.
      }
    }
    throw error;
  } finally {
    client.release();
    if (!injectedPool) await pool.end();
  }
}

if (isDirectRun()) {
  runMigrations()
    .then(({ migration }) => {
      console.log(`数据库 migration 已完成：${migration}`);
    })
    .catch((error) => {
      console.error(`数据库 migration 失败：${error.message}`);
      process.exitCode = 1;
    });
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}
