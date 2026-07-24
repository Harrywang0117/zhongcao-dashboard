import { DATA_VERSION } from "../src/lib/domain.js";
import { migrateState } from "../src/lib/storage.js";

export const MAX_STATE_BYTES = 1024 * 1024;
const STATE_COLLECTIONS = [
  "inboxItems",
  "stores",
  "dishes",
  "plans",
  "visitRecords",
  "tags"
];

export class StatePayloadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StatePayloadError";
    this.code = code;
  }
}

export function validateStateDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StatePayloadError("invalid_state", "state 必须是对象");
  }
  if (!value.meta || typeof value.meta !== "object" || Array.isArray(value.meta)) {
    throw new StatePayloadError("invalid_state_meta", "state.meta 必须是对象");
  }
  if (value.meta.dataVersion !== DATA_VERSION) {
    throw new StatePayloadError(
      "unsupported_data_version",
      `仅支持数据版本 ${DATA_VERSION}`
    );
  }
  for (const collection of STATE_COLLECTIONS) {
    if (!Array.isArray(value[collection])) {
      throw new StatePayloadError("invalid_state_collection", `${collection} 必须是数组`);
    }
  }

  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new StatePayloadError("invalid_state", "state 无法序列化");
  }
  if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) {
    throw new StatePayloadError("state_too_large", "state 不能超过 1MB");
  }

  return migrateState(structuredClone(value));
}

export function normalizeStoredState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StatePayloadError("invalid_stored_state", "数据库中的共享状态无效");
  }
  return migrateState(structuredClone(value));
}

export function validateExpectedRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StatePayloadError("invalid_revision", "expectedRevision 必须是非负整数");
  }
  return value;
}
