import pg from "pg";

const { Pool } = pg;

export function createDatabasePool({ connectionString, max = 5 } = {}) {
  if (!connectionString) return null;

  return new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: "zhongcao-app"
  });
}
