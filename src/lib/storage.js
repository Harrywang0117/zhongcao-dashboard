import { DATA_VERSION, DEFAULT_TAGS, createInitialState, normalizeAddedBy } from "./domain.js";

const BACKUP_FORMAT = "zhongcao-state-backup";
const BACKUP_VERSION = 1;
let currentRevision = null;

export class StateConflictError extends Error {
  constructor(latestState, revision) {
    super("共享数据已更新，正在重试本次操作");
    this.name = "StateConflictError";
    this.latestState = latestState;
    this.revision = revision;
  }
}

export async function loadState({ fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl("/api/state", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  const payload = await readApiPayload(response);
  if (!response.ok) {
    throw new Error(payload.message || "共享数据加载失败");
  }

  currentRevision = parseRevision(payload.revision);
  return migrateState(structuredClone(payload.state || createInitialState()));
}

export async function saveState(state, { fetchImpl = globalThis.fetch } = {}) {
  if (currentRevision === null) {
    throw new Error("共享数据尚未加载");
  }

  const migrated = migrateState(structuredClone(state));
  const response = await fetchImpl("/api/state", {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      state: migrated,
      expectedRevision: currentRevision
    })
  });
  const payload = await readApiPayload(response);

  if (response.status === 409 && payload.error === "revision_conflict") {
    currentRevision = parseRevision(payload.revision);
    throw new StateConflictError(
      migrateState(structuredClone(payload.state)),
      currentRevision
    );
  }
  if (!response.ok) {
    throw new Error(payload.message || "共享数据保存失败");
  }

  currentRevision = parseRevision(payload.revision);
  return migrateState(structuredClone(payload.state));
}

export async function saveStateMutation(
  baseState,
  mutator,
  {
    saveImpl = saveState,
    onConflict = () => {}
  } = {}
) {
  const applyMutation = (sourceState) => {
    const nextState = structuredClone(sourceState);
    const result = mutator(nextState);
    return { nextState, result };
  };

  let attempt = applyMutation(baseState);
  try {
    return {
      state: await saveImpl(attempt.nextState),
      result: attempt.result,
      replayed: false
    };
  } catch (error) {
    if (!(error instanceof StateConflictError)) throw error;
    onConflict(error.latestState, error.revision);
    attempt = applyMutation(error.latestState);
    try {
      return {
        state: await saveImpl(attempt.nextState),
        result: attempt.result,
        replayed: true
      };
    } catch (replayError) {
      if (replayError instanceof StateConflictError) {
        onConflict(replayError.latestState, replayError.revision);
      }
      throw replayError;
    }
  }
}

export function createStateBackup(state, exportedAt = new Date()) {
  const timestamp = exportedAt instanceof Date ? exportedAt : new Date(exportedAt);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("备份时间无效");
  }

  const migrated = migrateState(structuredClone(state));
  const payload = {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    exportedAt: timestamp.toISOString(),
    dataVersion: DATA_VERSION,
    state: migrated
  };

  return {
    filename: `zhongcao-backup-${timestamp.toISOString().slice(0, 10)}.json`,
    content: JSON.stringify(payload, null, 2)
  };
}

export function migrateState(rawState) {
  const base = createInitialState();
  const state = {
    ...base,
    ...rawState,
    meta: {
      ...base.meta,
      ...(rawState?.meta || {}),
      dataVersion: DATA_VERSION
    },
    inboxItems: Array.isArray(rawState?.inboxItems) ? rawState.inboxItems : [],
    stores: Array.isArray(rawState?.stores) ? rawState.stores : [],
    dishes: Array.isArray(rawState?.dishes) ? rawState.dishes : [],
    plans: Array.isArray(rawState?.plans) ? rawState.plans : [],
    visitRecords: Array.isArray(rawState?.visitRecords) ? rawState.visitRecords : [],
    tags: Array.isArray(rawState?.tags) ? rawState.tags : []
  };

  for (const defaultTag of DEFAULT_TAGS) {
    if (!state.tags.some((tag) => tag.name === defaultTag.name)) {
      state.tags.push({ ...defaultTag });
    }
  }

  migrateAddedByFields(state);
  migrateSourceFields(state);

  return state;
}

function migrateAddedByFields(state) {
  for (const item of state.inboxItems) {
    item.addedBy = coerceStoredAddedBy(item.addedBy);
  }

  for (const store of state.stores) {
    store.addedBy = coerceStoredAddedBy(store.addedBy);
    store.sourceLinks = Array.isArray(store.sourceLinks) ? store.sourceLinks : [];

    for (const sourceLink of store.sourceLinks) {
      sourceLink.addedBy = coerceStoredAddedBy(sourceLink.addedBy, store.addedBy);
    }
  }

  for (const dish of state.dishes) {
    dish.addedBy = coerceStoredAddedBy(dish.addedBy);
  }
}

function migrateSourceFields(state) {
  for (const item of state.inboxItems) {
    const rawShareText = String(item.rawShareText || item.sourceUrl || "").trim();
    const sharedUrl = String(item.sharedUrl || item.normalizedUrl || "").trim();
    const resolvedUrl = String(item.resolvedUrl || item.normalizedUrl || sharedUrl).trim();
    item.rawShareText = rawShareText;
    item.sourceUrl = rawShareText || sharedUrl;
    item.sharedUrl = sharedUrl || resolvedUrl;
    item.resolvedUrl = resolvedUrl || sharedUrl;
    item.normalizedUrl = item.resolvedUrl || item.sharedUrl;
    item.sourceKey = String(item.sourceKey || "").trim();
    item.sourceDescription = String(item.sourceDescription || "").trim();
    item.authorName = String(item.authorName || "").trim();
    item.hashtags = normalizeStoredStrings(item.hashtags);
    item.failureCode = String(item.failureCode || "").trim();
    item.metadataStatus = String(item.metadataStatus || "unknown");
    item.metadataFailureCode = String(item.metadataFailureCode || "").trim();
    item.metadataFailureReason = String(item.metadataFailureReason || "").trim();
    item.imageStatus = String(item.imageStatus || (item.previewImageUrl ? "stored" : "not_found"));
    item.imageSource = String(item.imageSource || (item.previewImageUrl ? "automatic" : "none"));
    item.imageFailureCode = String(item.imageFailureCode || "").trim();
    item.imageFailureReason = String(item.imageFailureReason || "").trim();
  }

  for (const entity of [...state.stores, ...state.dishes]) {
    entity.sourceLinks = Array.isArray(entity.sourceLinks) ? entity.sourceLinks : [];
    for (const link of entity.sourceLinks) migrateStoredSourceLink(link);
  }
}

function migrateStoredSourceLink(link) {
  const rawShareText = String(link.rawShareText || link.originalUrl || "").trim();
  const sharedUrl = String(link.sharedUrl || link.normalizedUrl || "").trim();
  const resolvedUrl = String(link.resolvedUrl || link.normalizedUrl || sharedUrl).trim();
  link.rawShareText = rawShareText;
  link.originalUrl = rawShareText || sharedUrl;
  link.sharedUrl = sharedUrl || resolvedUrl;
  link.resolvedUrl = resolvedUrl || sharedUrl;
  link.normalizedUrl = link.resolvedUrl || link.sharedUrl;
  link.sourceKey = String(link.sourceKey || "").trim();
  link.sourceDescription = String(link.sourceDescription || "").trim();
  link.authorName = String(link.authorName || "").trim();
  link.hashtags = normalizeStoredStrings(link.hashtags);
  link.failureCode = String(link.failureCode || "").trim();
  link.metadataStatus = String(link.metadataStatus || "unknown");
  link.metadataFailureCode = String(link.metadataFailureCode || "").trim();
  link.metadataFailureReason = String(link.metadataFailureReason || "").trim();
  link.imageStatus = String(link.imageStatus || (link.imageUrl ? "stored" : "not_found"));
  link.imageSource = String(link.imageSource || (link.imageUrl ? "automatic" : "none"));
  link.imageFailureCode = String(link.imageFailureCode || "").trim();
  link.imageFailureReason = String(link.imageFailureReason || "").trim();
}

function normalizeStoredStrings(values) {
  return Array.isArray(values)
    ? [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    : [];
}

function coerceStoredAddedBy(value, fallback = "unknown") {
  try {
    return normalizeAddedBy(value, { allowUnknown: true });
  } catch {
    return normalizeAddedBy(fallback, { allowUnknown: true });
  }
}

async function readApiPayload(response) {
  try {
    return await response.json();
  } catch {
    throw new Error("共享数据接口返回无效");
  }
}

function parseRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("共享数据 revision 无效");
  }
  return value;
}
