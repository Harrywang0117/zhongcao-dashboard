import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import {
  createRequestHandler,
  fetchOpenGraphMetadata,
  handleRequest,
  isSafePreviewFetchUrl,
  serveStatic
} from "../server.mjs";

const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

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
    assert.equal(metadata.imageUrl, "");
    assert.equal(metadata.imageSourceUrl, "https://img.example/cover.jpg");
    assert.equal(metadata.imageStatus, "discovered");
    assert.equal(metadata.resolvedUrl, "https://xhslink.com/a/abc");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dianping login redirects are reported as a platform barrier without replacing the source url", async () => {
  const metadata = await fetchOpenGraphMetadata(
    "https://m.dianping.com/shopinfo/k30Ld5XSgFERQgYE",
    "大众点评",
    {
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { location: "/shopinfo/login-redirect" }
      })
    }
  );

  assert.equal(metadata.metadataStatus, "blocked");
  assert.equal(metadata.imageStatus, "blocked");
  assert.equal(metadata.failureCode, "platform_login_required");
  assert.equal(metadata.resolvedUrl, undefined);
  assert.equal(metadata.observedUrl, "https://m.dianping.com/shopinfo/login-redirect");
});

test("link preview snapshots discovered images and returns only a same-origin cover url", async (t) => {
  const dataDir = await createTemporaryDataDir(t);
  const handler = createRequestHandler({
    dataDir,
    coverLookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (url) => {
      if (url === "https://images.example/cover.png") {
        return new Response(PNG_BYTES, { status: 200, headers: { "content-type": "image/png" } });
      }
      return new Response(
        '<html><head><meta property="og:title" content="火锅收藏"><meta property="og:image" content="https://images.example/cover.png"></head></html>',
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }
  });
  const request = createStreamRequest(
    "POST",
    "/api/link-preview",
    { "content-type": "application/json" },
    JSON.stringify({ url: "https://www.xiaohongshu.com/explore/note-1" })
  );
  const response = createMockResponse();

  await handler(request, response);
  const preview = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(preview.status, "success");
  assert.equal(preview.metadataStatus, "success");
  assert.equal(preview.imageStatus, "stored");
  assert.equal(preview.imageSource, "automatic");
  assert.match(preview.imageUrl, /^\/covers\//);
  assert.doesNotMatch(preview.imageUrl, /^https?:/);
});

test("manual cover upload can be read back through the immutable cover route", async (t) => {
  const dataDir = await createTemporaryDataDir(t);
  const handler = createRequestHandler({ dataDir });
  const uploadRequest = createStreamRequest(
    "POST",
    "/api/cover-upload",
    { "content-type": "image/png" },
    PNG_BYTES
  );
  const uploadResponse = createMockResponse();

  await handler(uploadRequest, uploadResponse);
  const uploaded = JSON.parse(uploadResponse.body);
  const coverResponse = createBinaryMockResponse();
  await handler(
    { method: "GET", url: uploaded.imageUrl, headers: { host: "127.0.0.1" } },
    coverResponse
  );

  assert.equal(uploadResponse.statusCode, 201);
  assert.equal(uploaded.imageSource, "manual");
  assert.equal(coverResponse.statusCode, 200);
  assert.equal(coverResponse.headers["Content-Type"], "image/png");
  assert.equal(coverResponse.headers["Cache-Control"], "public, max-age=31536000, immutable");
  assert.deepEqual(coverResponse.body, PNG_BYTES);
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

function createBinaryMockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: Buffer.alloc(0),
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = Buffer.alloc(0)) {
      this.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    }
  };
}

function createStreamRequest(method, url, headers, body) {
  const request = Readable.from([body]);
  request.method = method;
  request.url = url;
  request.headers = { host: "127.0.0.1", ...headers };
  return request;
}

async function createTemporaryDataDir(t) {
  const directory = await mkdtemp(join(tmpdir(), "zhongcao-server-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
