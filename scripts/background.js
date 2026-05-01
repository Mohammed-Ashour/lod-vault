globalThis.__LOD_WRAPPER_DIRECT_STORE__ = true;
importScripts(
  chrome.runtime.getURL("scripts/store-core.js"),
  chrome.runtime.getURL("scripts/shared.js"),
  chrome.runtime.getURL("scripts/sync.js"),
  chrome.runtime.getURL("scripts/sync-coordinator.js")
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

let storeMutationQueue = Promise.resolve();

const syncCoordinator = LodWrapperSyncCoordinator.createSyncCoordinator({
  store: LodWrapperStore,
  syncNamespace: LodWrapperSync,
  syncAdapter: LodWrapperSync.SyncAdapter,
  logger: console,
  pushDebounceMs: globalThis.__LOD_SYNC_PUSH_DEBOUNCE_MS__
});

function enqueueStoreMutation(task) {
  const result = storeMutationQueue.then(task, task);
  storeMutationQueue = result.catch(() => {});
  return result;
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
    syncCoordinator.handleInstalled("onInstalled");
  }
});

chrome.runtime.onStartup?.addListener(() => {
  syncCoordinator.handleStartup("onStartup");
});

chrome.storage.onChanged?.addListener((changes, areaName) => {
  syncCoordinator.handleStorageChanged(changes, areaName);
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
