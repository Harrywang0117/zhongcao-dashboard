import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("toast announces status changes and exposes a quick undo action", () => {
  assert.match(appSource, /role="status"/);
  assert.match(appSource, /aria-live="polite"/);
  assert.match(appSource, /data-action="undo-last"/);
});

test("icon-only actions have accessible labels", () => {
  assert.match(appSource, /aria-label="重新解析线索"/);
  assert.match(appSource, /aria-label="移入回收站"/);
  assert.match(appSource, /aria-label="撤销轻反馈"/);
});

test("interactive controls have touch and focus-visible styles", () => {
  assert.match(stylesSource, /touch-action:\s*manipulation/);
  assert.match(stylesSource, /:focus-visible/);
});
