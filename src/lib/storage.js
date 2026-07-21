import { DATA_VERSION, DEFAULT_TAGS, createInitialState, normalizeAddedBy } from "./domain.js";

const DB_NAME = "zhongcao-db";
const DB_VERSION = 1;
const STORE_NAME = "kv";
const STATE_KEY = "app-state";
const LOCAL_STORAGE_KEY = "zhongcao-app-state";
const BACKUP_FORMAT = "zhongcao-state-backup";
const BACKUP_VERSION = 1;

export async function loadState() {
  const stored = await readState();
  return migrateState(stored || createInitialState());
}

export async function saveState(state) {
  const migrated = migrateState(state);
  await writeState(migrated);
  return migrated;
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

async function readState() {
  if (!("indexedDB" in window)) {
    return readLocalStorage();
  }

  try {
    const db = await openDb();
    return await getValue(db, STATE_KEY);
  } catch {
    return readLocalStorage();
  }
}

async function writeState(state) {
  if (!("indexedDB" in window)) {
    writeLocalStorage(state);
    return;
  }

  try {
    const db = await openDb();
    await setValue(db, STATE_KEY, state);
  } catch {
    writeLocalStorage(state);
  }
}

function readLocalStorage() {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocalStorage(state) {
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function getValue(db, key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

function setValue(db, key, value) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(value, key);

    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
