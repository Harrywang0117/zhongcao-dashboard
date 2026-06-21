import assert from "node:assert/strict";
import test from "node:test";

import { isSafePreviewFetchUrl, serveStatic } from "../server.mjs";

test("metadata fetch urls must stay inside the same supported platform", () => {
  assert.equal(
    isSafePreviewFetchUrl("https://www.xiaohongshu.com/explore/abc", "小红书"),
    true
  );
  assert.equal(isSafePreviewFetchUrl("https://www.douyin.com/video/abc", "小红书"), false);
  assert.equal(isSafePreviewFetchUrl("http://127.0.0.1:8080/private", "小红书"), false);
  assert.equal(isSafePreviewFetchUrl("https://user:pass@www.xiaohongshu.com/explore/abc", "小红书"), false);
});

test("missing legacy static assets return 404 instead of the React app shell", async () => {
  const response = createMockResponse();

  await serveStatic(new URL("http://127.0.0.1/app.js"), response);

  assert.equal(response.statusCode, 404);
  assert.match(response.headers["Content-Type"], /text\/plain/);
  assert.equal(response.body, "Not Found");
});

function createMockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = "") {
      this.body = String(body);
    }
  };
}
