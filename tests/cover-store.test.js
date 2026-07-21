import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CoverStoreError,
  assertSafeRemoteImageUrl,
  fetchAndStoreCover,
  readStoredCover,
  storeCoverBytes
} from "../server/cover-store.mjs";

const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

test("stores validated covers under a content hash and deduplicates identical bytes", async (t) => {
  const dataDir = await createTemporaryDataDir(t);

  const first = await storeCoverBytes(PNG_BYTES, "image/png", { dataDir, imageSource: "manual" });
  const second = await storeCoverBytes(PNG_BYTES, "image/png", { dataDir, imageSource: "automatic" });
  const stored = await readStoredCover(first.imageUrl, dataDir);

  assert.match(first.imageUrl, /^\/covers\/[a-f0-9]{2}\/[a-f0-9]{64}\.png$/);
  assert.equal(second.imageUrl, first.imageUrl);
  assert.equal(first.imageStatus, "stored");
  assert.equal(first.imageSource, "manual");
  assert.equal(stored.contentType, "image/png");
  assert.deepEqual(stored.data, PNG_BYTES);
});

test("rejects unsupported or spoofed upload content", async (t) => {
  const dataDir = await createTemporaryDataDir(t);

  await assert.rejects(
    storeCoverBytes(Buffer.from("<svg></svg>"), "image/svg+xml", { dataDir }),
    (error) => error instanceof CoverStoreError && error.code === "invalid_image_type" && error.statusCode === 415
  );
  await assert.rejects(
    storeCoverBytes(PNG_BYTES, "image/jpeg", { dataDir }),
    (error) => error instanceof CoverStoreError && error.code === "invalid_image_type"
  );
});

test("rejects remote image hosts that resolve to private addresses", async () => {
  await assert.rejects(
    assertSafeRemoteImageUrl(
      "https://images.example/cover.png",
      async () => [{ address: "127.0.0.1", family: 4 }]
    ),
    (error) => error instanceof CoverStoreError && error.code === "unsafe_image_url"
  );
});

test("snapshots a public HTTPS image into the local cover store", async (t) => {
  const dataDir = await createTemporaryDataDir(t);
  let requestedUrl = "";
  let requestOptions;

  const stored = await fetchAndStoreCover("https://images.example/cover.png", {
    dataDir,
    sourcePageUrl: "https://www.example/page",
    lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestOptions = options;
      return new Response(PNG_BYTES, {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(PNG_BYTES.length) }
      });
    }
  });

  assert.equal(requestedUrl, "https://images.example/cover.png");
  assert.equal(requestOptions.redirect, "manual");
  assert.equal(requestOptions.headers.Referer, "https://www.example/page");
  assert.equal(stored.imageStatus, "stored");
  assert.equal(stored.imageSource, "automatic");
  assert.match(stored.imageUrl, /^\/covers\//);
});

async function createTemporaryDataDir(t) {
  const directory = await mkdtemp(join(tmpdir(), "zhongcao-cover-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
