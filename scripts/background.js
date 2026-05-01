globalThis.__LOD_WRAPPER_DIRECT_STORE__ = true;
importScripts(
  chrome.runtime.getURL("scripts/shared.js"),
  chrome.runtime.getURL("scripts/sync.js")
);

const LOD_URL_PATTERNS = ["https://lod.lu/artikel/*", "https://www.lod.lu/artikel/*"];
const STORE_MUTATION_MESSAGE_TYPE = "lod-wrapper:store-mutate";
const STORE_MUTATION_METHODS = new Set([
  "setAutoMode",
  "setSyncLanguages",
  "toggleList",
  "recordAutoVisit",
  "removeFromHistory",
  "refreshEntryData",
  "saveNote",
  "removeEntry",
  "importJson"
]);
const SYNC_PUSH_DEBOUNCE_MS = Math.max(0, Number(globalThis.__LOD_SYNC_PUSH_DEBOUNCE_MS__ ?? 2000) || 0);
const SYNC_SUPPRESS_WINDOW_MS = Math.max(SYNC_PUSH_DEBOUNCE_MS * 2, 50);
const LOCAL_SYNC_KEYS = new Set([
  LodWrapperStore?.STORAGE_KEY || "lodVault.entries",
  LodWrapperStore?.SETTINGS_KEY || "lodVault.settings"
]);
const SYNC_MANIFEST_KEY = LodWrapperSync?.SYNC_MANIFEST_KEY || "lodVault.m";
const SYNC_SETTINGS_KEY = LodWrapperSync?.SYNC_SETTINGS_KEY || "lodVault.s";
const SYNC_ENTRY_PREFIX = LodWrapperSync?.SYNC_ENTRY_PREFIX || "lodVault.e.";

let storeMutationQueue = Promise.resolve();
let syncTaskQueue = Promise.resolve();
let syncInitPromise = null;
let syncInitialized = false;
let pendingLocalPushTimer = null;
let pendingLocalPushPlan = null;
let suppressLocalPushUntil = 0;
let suppressSyncPullUntil = 0;

function enqueueStoreMutation(task) {
  const result = storeMutationQueue.then(task, task);
  storeMutationQueue = result.catch(() => {});
  return result;
}

function enqueueSyncTask(task) {
  const result = syncTaskQueue.then(task, task);
  syncTaskQueue = result.catch(() => {});
  return result;
}

function isSuppressed(until) {
  return Date.now() < until;
}

function suppressLocalPush(windowMs = SYNC_SUPPRESS_WINDOW_MS) {
  suppressLocalPushUntil = Date.now() + Math.max(0, windowMs);
}

function suppressSyncPull(windowMs = SYNC_SUPPRESS_WINDOW_MS) {
  suppressSyncPullUntil = Date.now() + Math.max(0, windowMs);
}

function clearPendingLocalPush() {
  if (pendingLocalPushTimer) {
    clearTimeout(pendingLocalPushTimer);
    pendingLocalPushTimer = null;
  }
  pendingLocalPushPlan = null;
}

function isRelevantLocalStorageChange(changes) {
  return Object.keys(changes || {}).some((key) => LOCAL_SYNC_KEYS.has(key));
}

function isRelevantSyncStorageChange(changes) {
  return Object.keys(changes || {}).some((key) => (
    key === SYNC_MANIFEST_KEY
    || key === SYNC_SETTINGS_KEY
    || key.startsWith(SYNC_ENTRY_PREFIX)
  ));
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function normalizeSettingsForComparison(settings = {}) {
  if (typeof LodWrapperStore?.normalizeSettings === "function") {
    return LodWrapperStore.normalizeSettings(settings);
  }

  return {
    autoMode: Boolean(settings?.autoMode),
    syncLanguages: Array.isArray(settings?.syncLanguages) ? [...settings.syncLanguages] : []
  };
}

function getChangedEntryIds(change) {
  const oldMap = change?.oldValue && typeof change.oldValue === "object" ? change.oldValue : {};
  const newMap = change?.newValue && typeof change.newValue === "object" ? change.newValue : {};
  const entryIds = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);

  return [...entryIds].filter((entryId) => stableStringify(oldMap[entryId]) !== stableStringify(newMap[entryId]));
}

function getSettingsChangeKind(change) {
  if (!change) return null;

  const previous = normalizeSettingsForComparison(change.oldValue || {});
  const next = normalizeSettingsForComparison(change.newValue || {});
  const autoModeChanged = previous.autoMode !== next.autoMode;
  const syncLanguagesChanged = stableStringify(previous.syncLanguages) !== stableStringify(next.syncLanguages);

  if (syncLanguagesChanged) return "all";
  if (autoModeChanged) return "settings";
  return null;
}

function describeLocalPushPlan(changes) {
  const entryChange = changes?.[LodWrapperStore?.STORAGE_KEY || "lodVault.entries"];
  const settingsChange = changes?.[LodWrapperStore?.SETTINGS_KEY || "lodVault.settings"];
  const settingsKind = getSettingsChangeKind(settingsChange);

  if (entryChange && settingsKind) {
    return { type: "all" };
  }

  if (settingsKind === "settings") {
    return { type: "settings" };
  }

  if (settingsKind === "all") {
    return { type: "all" };
  }

  if (entryChange) {
    const changedEntryIds = getChangedEntryIds(entryChange);
    if (changedEntryIds.length === 1) {
      return { type: "entry", id: changedEntryIds[0] };
    }
    if (changedEntryIds.length > 1) {
      return { type: "all" };
    }
  }

  return { type: "all" };
}

function mergeLocalPushPlans(previousPlan, nextPlan) {
  if (!previousPlan) return nextPlan;
  if (!nextPlan) return previousPlan;
  if (previousPlan.type === "all" || nextPlan.type === "all") return { type: "all" };
  if (previousPlan.type !== nextPlan.type) return { type: "all" };
  if (previousPlan.type === "entry" && previousPlan.id !== nextPlan.id) return { type: "all" };
  return nextPlan;
}

async function initializeSync(reason = "startup") {
  if (syncInitialized) {
    return { ok: true, mode: "ready", reason };
  }

  if (syncInitPromise) {
    return syncInitPromise;
  }

  syncInitPromise = (async () => {
    const result = await LodWrapperSync?.SyncAdapter?.init?.();
    syncInitialized = true;
    return result || { ok: true, mode: "noop", reason };
  })();

  try {
    return await syncInitPromise;
  } finally {
    syncInitPromise = null;
  }
}

function logSyncWarning(label, error) {
  console.warn(`[LODVault] ${label}:`, error);
}

function scheduleLocalPush(plan = { type: "all" }) {
  pendingLocalPushPlan = mergeLocalPushPlans(pendingLocalPushPlan, plan);

  if (pendingLocalPushTimer) {
    clearTimeout(pendingLocalPushTimer);
  }

  pendingLocalPushTimer = setTimeout(() => {
    pendingLocalPushTimer = null;
    const planToRun = pendingLocalPushPlan || { type: "all" };
    pendingLocalPushPlan = null;

    enqueueSyncTask(async () => {
      if (!syncInitialized) {
        suppressSyncPull();
        await initializeSync("local-change");
        return;
      }

      suppressSyncPull();

      if (planToRun.type === "entry" && planToRun.id) {
        return LodWrapperSync.SyncAdapter.pushEntry(planToRun.id);
      }

      if (planToRun.type === "settings") {
        return LodWrapperSync.SyncAdapter.pushSettings();
      }

      return LodWrapperSync.SyncAdapter.pushAll();
    }).catch((error) => {
      logSyncWarning("Sync push failed", error);
    });
  }, SYNC_PUSH_DEBOUNCE_MS);
}

function scheduleSyncPull() {
  clearPendingLocalPush();

  enqueueSyncTask(async () => {
    if (!syncInitialized) {
      suppressLocalPush();
      await initializeSync("sync-change");
      return;
    }

    suppressLocalPush();
    suppressSyncPull();
    await LodWrapperSync.SyncAdapter.pullAll({ repush: true });
  }).catch((error) => {
    logSyncWarning("Sync pull failed", error);
  });
}

async function reloadLodTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: LOD_URL_PATTERNS });
    await Promise.all(
      tabs
        .filter((tab) => typeof tab.id === "number")
        .map((tab) => chrome.tabs.reload(tab.id))
    );
  } catch (_error) {
    // Ignore tab reload failures.
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "update" || details.reason === "install") {
    reloadLodTabs();
    enqueueSyncTask(() => initializeSync("onInstalled")).catch((error) => {
      logSyncWarning("Initial sync failed", error);
    });
  }
});

chrome.runtime.onStartup?.addListener(() => {
  enqueueSyncTask(() => initializeSync("onStartup")).catch((error) => {
    logSyncWarning("Startup sync failed", error);
  });
});

chrome.storage.onChanged?.addListener((changes, areaName) => {
  if (areaName === "local") {
    if (!isRelevantLocalStorageChange(changes)) return;
    if (isSuppressed(suppressLocalPushUntil)) return;
    scheduleLocalPush(describeLocalPushPlan(changes));
    return;
  }

  if (areaName === "sync") {
    if (!isRelevantSyncStorageChange(changes)) return;
    if (isSuppressed(suppressSyncPullUntil)) return;
    scheduleSyncPull();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== STORE_MUTATION_MESSAGE_TYPE) return;

  const method = String(message.method || "");
  const args = Array.isArray(message.args) ? message.args : [];

  if (!STORE_MUTATION_METHODS.has(method) || typeof LodWrapperStore?.[method] !== "function") {
    sendResponse({ ok: false, error: `Unsupported store mutation: ${method}` });
    return;
  }

  enqueueStoreMutation(() => LodWrapperStore[method](...args))
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));

  return true;
});
