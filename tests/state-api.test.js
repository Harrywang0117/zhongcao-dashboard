import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createRequestHandler } from "../server.mjs";
import { StateConflictError } from "../server/state-repository.mjs";
import { createInitialState } from "../src/lib/domain.js";

test("readiness distinguishes process health from database readiness", async () => {
  const unavailableHandler = createRequestHandler({ stateRepository: null });
  const unavailable = createMockResponse();
  await unavailableHandler(createRequest("GET", "/readyz"), unavailable);
  assert.equal(unavailable.statusCode, 503);
  assert.deepEqual(JSON.parse(unavailable.body), {
    status: "not_ready",
    reason: "database_not_configured"
  });

  const readyHandler = createRequestHandler({
    stateRepository: {
      async checkReady() {
        return { ready: true };
      }
    }
  });
  const ready = createMockResponse();
  await readyHandler(createRequest("GET", "/readyz"), ready);
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(JSON.parse(ready.body), { status: "ready" });
});

test("stale concurrent writes return the latest state instead of silently overwriting it", async () => {
  const repository = createInMemoryRepository();
  const handler = createRequestHandler({ stateRepository: repository });

  const initialResponse = createMockResponse();
  await handler(createRequest("GET", "/api/state"), initialResponse);
  const initial = JSON.parse(initialResponse.body);
  assert.equal(initial.revision, 0);

  const firstState = structuredClone(initial.state);
  firstState.inboxItems.push({
    id: "inbox_first",
    title: "第一台设备保存",
    addedBy: "xiaowang"
  });
  const firstResponse = createMockResponse();
  await handler(
    createRequest("PUT", "/api/state", {
      state: firstState,
      expectedRevision: 0
    }),
    firstResponse
  );
  assert.equal(firstResponse.statusCode, 200);
  assert.equal(JSON.parse(firstResponse.body).revision, 1);

  const staleState = structuredClone(initial.state);
  staleState.stores.push({
    id: "store_stale",
    name: "第二台设备的旧副本",
    addedBy: "xiaozhang"
  });
  const staleResponse = createMockResponse();
  await handler(
    createRequest("PUT", "/api/state", {
      state: staleState,
      expectedRevision: 0
    }),
    staleResponse
  );
  const conflict = JSON.parse(staleResponse.body);

  assert.equal(staleResponse.statusCode, 409);
  assert.equal(conflict.error, "revision_conflict");
  assert.equal(conflict.revision, 1);
  assert.equal(conflict.state.inboxItems[0].title, "第一台设备保存");
  assert.equal(conflict.state.stores.length, 0);
});

test("state writes reject unsupported data versions", async () => {
  const repository = createInMemoryRepository();
  const handler = createRequestHandler({ stateRepository: repository });
  const state = createInitialState();
  state.meta.dataVersion -= 1;
  const response = createMockResponse();

  await handler(
    createRequest("PUT", "/api/state", { state, expectedRevision: 0 }),
    response
  );

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, "unsupported_data_version");
});

test("state writes reject malformed JSON as a client error", async () => {
  const repository = createInMemoryRepository();
  const handler = createRequestHandler({ stateRepository: repository });
  const request = Readable.from(["{not-json"]);
  request.method = "PUT";
  request.url = "/api/state";
  request.headers = {
    host: "127.0.0.1",
    "content-type": "application/json"
  };
  const response = createMockResponse();

  await handler(request, response);

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, "invalid_json");
});

test("state writes reject a null JSON body as a client error", async () => {
  const repository = createInMemoryRepository();
  const handler = createRequestHandler({ stateRepository: repository });
  const request = createRawRequest("PUT", "/api/state", "null");
  const response = createMockResponse();

  await handler(request, response);

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, "invalid_request");
});

test("oversized state writes return a structured 413 response", async () => {
  const repository = createInMemoryRepository();
  const handler = createRequestHandler({ stateRepository: repository });
  const request = createRawRequest(
    "PUT",
    "/api/state",
    JSON.stringify({ state: { payload: "x".repeat(1_200_000) }, expectedRevision: 0 })
  );
  const response = createMockResponse();

  await handler(request, response);

  assert.equal(response.statusCode, 413);
  assert.equal(JSON.parse(response.body).error, "state_too_large");
});

test("invalid state stored in PostgreSQL is reported as a service failure", async () => {
  const handler = createRequestHandler({
    stateRepository: {
      async getState() {
        return {
          state: null,
          revision: 3,
          updatedAt: "2026-07-23T00:00:00.000Z"
        };
      }
    }
  });
  const response = createMockResponse();

  await handler(createRequest("GET", "/api/state"), response);

  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error, "invalid_stored_state");
});

function createInMemoryRepository() {
  let current = {
    state: createInitialState(),
    revision: 0,
    updatedAt: "2026-07-23T00:00:00.000Z"
  };

  return {
    async checkReady() {
      return { ready: true };
    },
    async getState() {
      return structuredClone(current);
    },
    async putState({ state, expectedRevision }) {
      if (expectedRevision !== current.revision) {
        throw new StateConflictError(structuredClone(current));
      }
      current = {
        state: structuredClone(state),
        revision: current.revision + 1,
        updatedAt: "2026-07-23T00:00:01.000Z"
      };
      return structuredClone(current);
    }
  };
}

function createRequest(method, url, body) {
  return createRawRequest(
    method,
    url,
    body === undefined ? "" : JSON.stringify(body)
  );
}

function createRawRequest(method, url, body) {
  const request = Readable.from(body ? [body] : []);
  request.method = method;
  request.url = url;
  request.headers = {
    host: "127.0.0.1",
    "content-type": "application/json"
  };
  return request;
}

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
