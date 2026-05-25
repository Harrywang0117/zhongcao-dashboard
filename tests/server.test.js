import test from "node:test";
import assert from "node:assert/strict";

import { isSafePreviewFetchUrl } from "../server.mjs";

test("metadata fetch urls must stay inside the same supported platform", () => {
  assert.equal(
    isSafePreviewFetchUrl("https://www.xiaohongshu.com/explore/abc", "小红书"),
    true
  );
  assert.equal(isSafePreviewFetchUrl("https://www.douyin.com/video/abc", "小红书"), false);
  assert.equal(isSafePreviewFetchUrl("http://127.0.0.1:8080/private", "小红书"), false);
  assert.equal(isSafePreviewFetchUrl("https://user:pass@www.xiaohongshu.com/explore/abc", "小红书"), false);
});
