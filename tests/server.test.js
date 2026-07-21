import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchOpenGraphMetadata,
  handleRequest,
  isSafePreviewFetchUrl,
  serveStatic
} from "../server.mjs";

test("health endpoint reports the process as ready for deployment checks", async () => {
  const response = createMockResponse();

  await handleRequest(
    { method: "GET", url: "/healthz", headers: { host: "127.0.0.1" } },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["Content-Type"], /application\/json/);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(response.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(response.headers["X-Frame-Options"], "DENY");
  assert.equal(response.headers["Referrer-Policy"], "no-referrer");
  assert.deepEqual(JSON.parse(response.body), { status: "ok" });
});

test("metadata fetch urls must stay inside the same supported platform", () => {
  assert.equal(
    isSafePreviewFetchUrl("https://www.xiaohongshu.com/explore/abc", "小红书"),
    true
  );
  assert.equal(isSafePreviewFetchUrl("https://www.douyin.com/video/abc", "小红书"), false);
  assert.equal(isSafePreviewFetchUrl("http://127.0.0.1:8080/private", "小红书"), false);
  assert.equal(isSafePreviewFetchUrl("https://user:pass@www.xiaohongshu.com/explore/abc", "小红书"), false);
  assert.equal(isSafePreviewFetchUrl("https://weibo.com/1/2", "微博"), false);
});

test("metadata fetch extracts descriptions without following redirects automatically", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    '<html><head><meta property="og:title" content="一条笔记"><meta property="og:description" content="正文摘要"><meta property="og:image" content="https://img.example/cover.jpg"></head></html>',
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );

  try {
    const metadata = await fetchOpenGraphMetadata("https://xhslink.com/a/abc", "小红书");
    assert.equal(metadata.title, "一条笔记");
    assert.equal(metadata.description, "正文摘要");
    assert.equal(metadata.imageUrl, "https://img.example/cover.jpg");
    assert.equal(metadata.resolvedUrl, "https://xhslink.com/a/abc");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("metadata fetch rejects an unsafe redirect before contacting its target", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
  };

  try {
    const metadata = await fetchOpenGraphMetadata("https://xhslink.com/a/abc", "小红书");
    assert.equal(metadata.failureCode, "unsafe_redirect");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
