import { DATA_VERSION, DEFAULT_TAGS, createInitialState } from "./domain.js";

const DB_NAME = "zhongcao-db";
const DB_VERSION = 1;
const STORE_NAME = "kv";
const STATE_KEY = "app-state";
const LOCAL_STORAGE_KEY = "zhongcao-app-state";

export async function loadState() {
  const stored = await readState();
  return migrateState(stored || createInitialState());
}

export async function saveState(state) {
  const migrated = migrateState(state);
  await writeState(migrated);
  return migrated;
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

  return state;
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
