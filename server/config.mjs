import { resolve } from "node:path";

export function readServerConfig(env = process.env) {
  const port = Number(env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT 必须是 1 到 65535 之间的整数");
  }

  const databasePoolMax = Number(env.DATABASE_POOL_MAX || 5);
  if (!Number.isInteger(databasePoolMax) || databasePoolMax < 1 || databasePoolMax > 5) {
    throw new Error("DATABASE_POOL_MAX 必须是 1 到 5 之间的整数");
  }

  return {
    host: String(env.HOST || "127.0.0.1"),
    port,
    dataDir: resolve(String(env.DATA_DIR || "data")),
    databaseUrl: String(env.DATABASE_URL || "").trim(),
    migrationDatabaseUrl: String(env.MIGRATION_DATABASE_URL || "").trim(),
    databasePoolMax
  };
}
