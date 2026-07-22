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
  assert.match(template, /^DATA_DIR=\.\/data$/m);
  assert.match(template, /^# DATABASE_URL=$/m);
  assert.match(template, /^# SESSION_SECRET=$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
  assert.match(gitignore, /^data\/$/m);
});

test("README documents the current deployment readiness boundary", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

  assert.match(readme, /GET `\/healthz`/);
  assert.match(readme, /HOST=0\.0\.0\.0/);
  assert.match(readme, /DATA_DIR=\.\/data/);
  assert.match(readme, /DATA_DIR\/covers\//);
  assert.match(readme, /当前业务数据仍保存在浏览器 IndexedDB/);
  assert.match(readme, /DATABASE_URL.*预留/);
});
