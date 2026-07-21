import assert from "node:assert/strict";
import test from "node:test";

import { readServerConfig } from "../server/config.mjs";

test("reads deployment host and port from environment values", () => {
  assert.deepEqual(readServerConfig({ HOST: "0.0.0.0", PORT: "8080" }), {
    host: "0.0.0.0",
    port: 8080
  });
});

test("rejects an invalid deployment port", () => {
  assert.throws(
    () => readServerConfig({ PORT: "not-a-port" }),
    /PORT 必须是 1 到 65535 之间的整数/
  );
  assert.throws(
    () => readServerConfig({ PORT: "70000" }),
    /PORT 必须是 1 到 65535 之间的整数/
  );
});
