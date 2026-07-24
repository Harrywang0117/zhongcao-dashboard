import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

test("repository includes a safe deployment environment template", () => {
  const templateUrl = new URL("../.env.example", import.meta.url);
  assert.equal(existsSync(templateUrl), true);

  const template = readFileSync(templateUrl, "utf8");
  const gitignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");

  assert.match(template, /^HOST=0\.0\.0\.0$/m);
  assert.match(template, /^PORT=4173$/m);
  assert.match(template, /^DATA_DIR=\/data$/m);
  assert.match(template, /^ZHONGCAO_DATA_DIR=\/mnt\/nvme0n1-4\/AppData\/zhongcao$/m);
  assert.match(template, /^DATABASE_POOL_MAX=5$/m);
  assert.match(template, /^DATABASE_URL=$/m);
  assert.match(template, /^# MIGRATION_DATABASE_URL=$/m);
  assert.match(template, /^# SESSION_SECRET=$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
  assert.match(gitignore, /^data\/$/m);
});

test("README documents the current deployment readiness boundary", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

  assert.match(readme, /GET `\/healthz`/);
  assert.match(readme, /GET `\/readyz`/);
  assert.match(readme, /HOST=0\.0\.0\.0/);
  assert.match(readme, /DATA_DIR=\/data/);
  assert.match(readme, /DATA_DIR\/covers\//);
  assert.match(readme, /PostgreSQL 是正式业务数据的唯一权威来源/);
  assert.match(readme, /应用启动不会自动改 schema/);
});

test("container deployment is non-root, persistent, and has no host port mapping", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const packageSource = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../server/migrations/001_shared_state.sql", import.meta.url),
    "utf8"
  );

  assert.match(dockerfile, /^FROM node:22-bookworm-slim AS build$/m);
  assert.match(dockerfile, /^FROM node:22-bookworm-slim AS runtime-dependencies$/m);
  assert.match(dockerfile, /^FROM node:22-bookworm-slim AS runtime$/m);
  assert.doesNotMatch(dockerfile, /^FROM node:22-alpine/m);
  assert.match(dockerfile, /groupadd --gid "\$\{APP_GID\}" app/);
  assert.match(dockerfile, /useradd --uid "\$\{APP_UID\}"/);
  assert.match(dockerfile, /^USER app$/m);
  assert.match(dockerfile, /\/readyz/);
  assert.match(compose, /external: true/);
  assert.match(compose, /name: 1panel-network/);
  assert.match(compose, /ZHONGCAO_DATA_DIR/);
  assert.doesNotMatch(compose, /^\s+ports:/m);
  assert.match(packageSource, /"start":\s*"node server\.mjs"/);
  assert.match(packageSource, /"node":\s*"\^20\.19\.0 \|\| >=22\.12\.0"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS app_state/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS app_state_revisions/);
});
