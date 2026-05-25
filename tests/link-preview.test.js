import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPreviewFromUrl,
  inferPlatform,
  normalizeUrl
} from "../public/lib/link-preview.js";

test("normalizes urls by trimming and removing hashes", () => {
  assert.equal(
    normalizeUrl(" https://www.dianping.com/shop/123#comments "),
    "https://www.dianping.com/shop/123"
  );
});

test("infers supported Chinese food discovery platforms", () => {
  assert.equal(inferPlatform("https://www.dianping.com/shop/123"), "大众点评");
  assert.equal(inferPlatform("https://www.xiaohongshu.com/explore/abc"), "小红书");
  assert.equal(inferPlatform("https://v.douyin.com/abc/"), "抖音");
});

test("builds a successful preview for supported urls", () => {
  const preview = buildPreviewFromUrl("https://www.xiaohongshu.com/explore/abc", {
    title: "静安寺新开的牛油火锅"
  });

  assert.equal(preview.status, "success");
  assert.equal(preview.platform, "小红书");
  assert.equal(preview.contentType, "note");
  assert.ok(preview.normalizedUrl.includes("xiaohongshu.com"));
});

test("marks supported urls without meaningful title as partial", () => {
  const emptyTitlePreview = buildPreviewFromUrl("https://www.xiaohongshu.com/explore/abc");
  const platformTitlePreview = buildPreviewFromUrl("https://www.xiaohongshu.com/explore/abc", {
    title: "小红书"
  });

  assert.equal(emptyTitlePreview.status, "partial");
  assert.equal(platformTitlePreview.status, "partial");
  assert.match(platformTitlePreview.failureReason, /标题/);
});

test("returns a failed preview for invalid urls", () => {
  const preview = buildPreviewFromUrl("not a url");

  assert.equal(preview.status, "failed");
  assert.equal(preview.platform, "未知平台");
  assert.match(preview.failureReason, /无法识别/);
});
