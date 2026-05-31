const LOD_URL_PATTERNS = ["https://lod.lu/*", "https://www.lod.lu/*"];
const LENS_CONTEXT_MENU_ID = "lodvault-open-lens";
const LENS_COMMAND_ID = "open-lod-lens";
const OPEN_LENS_OVERLAY_MESSAGE_TYPE = "lod-wrapper:open-lens-overlay";
const LENS_PROXY_MESSAGE_TYPE = "lod-wrapper:lens-fetch";
const STORE_MUTATION_MESSAGE_TYPE = LodWrapperStore.STORE_MUTATION_MESSAGE_TYPE;
const STORE_MUTATION_METHODS = new Set([
  "setAutoMode",
  "setSyncLanguages",
  "toggleList",
  "recordAutoVisit",
  "removeFromHistory",
  "refreshEntryData",
  "saveNote",
  "removeEntry",
  "markPortableBackupExported",
  "importJson",
  "importBrowserHistory",
  "recordFlashcardReview",
  "getFlashcardStats"
]);

let storeMutationQueue = Promise.resolve();
let historyHydrationResumeTimer = null;

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

function scheduleHistoryHydrationResume(delayMs = 0) {
  if (historyHydrationResumeTimer) {
    clearTimeout(historyHydrationResumeTimer);
  }

  historyHydrationResumeTimer = setTimeout(() => {
    historyHydrationResumeTimer = null;
    LodWrapperStore.resumeHistoryImportHydration?.().catch?.(() => {});
  }, Math.max(0, Number(delayMs) || 0));
}

function sanitizeLensQuery(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function getActiveSelectionText(tabId) {
  const resolvedTabId = typeof tabId === "number"
    ? tabId
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;

  if (!resolvedTabId || !chrome.scripting?.executeScript) {
    return "";
  }

  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: resolvedTabId },
      func: () => window.getSelection?.()?.toString?.() || ""
    });
    return sanitizeLensQuery(result);
  } catch (_error) {
    return "";
  }
}

async function openLensOverlay(tabId, selectionText = "") {
  if (!tabId || !chrome.scripting?.executeScript) {
    throw new Error("Cannot open lens overlay without a tab id.");
  }

  const files = [
    "scripts/store-core.js",
    "scripts/entry-presenter.js",
    "scripts/shared.js",
    "scripts/lens-lookup.js",
    "scripts/lens-overlay.js"
  ];

  await chrome.scripting.insertCSS?.({
    target: { tabId },
    files: ["styles/lens-overlay.css"]
  }).catch(() => {});

  await chrome.scripting.executeScript({
    target: { tabId },
    files
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    func: (text) => {
      globalThis.LodWrapperLensOverlay?.openFromSelection?.(text);
    },
    args: [sanitizeLensQuery(selectionText)]
  });
}

function registerContextMenus() {
  if (!chrome.contextMenus?.create) return;

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: LENS_CONTEXT_MENU_ID,
      title: "Translate with LODVault",
      contexts: ["selection"]
    }, () => {
      void chrome.runtime?.lastError;
    });
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
    registerContextMenus();
    reloadLodTabs();
    syncCoordinator.handleInstalled("onInstalled");
    scheduleHistoryHydrationResume(50);
  }
});

chrome.runtime.onStartup?.addListener(() => {
  registerContextMenus();
  syncCoordinator.handleStartup("onStartup");
  scheduleHistoryHydrationResume(50);
});

chrome.contextMenus?.onClicked?.addListener((info, tab) => {
  if (info.menuItemId !== LENS_CONTEXT_MENU_ID) return;
  if (!tab?.id) return;
  openLensOverlay(tab.id, info.selectionText || "").catch(() => {});
});

chrome.commands?.onCommand?.addListener(async (command) => {
  if (command !== LENS_COMMAND_ID) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const selectionText = await getActiveSelectionText(tab.id);
    await openLensOverlay(tab.id, selectionText);
  } catch (_error) {
    // Ignore lens overlay failures.
  }
});

chrome.storage.onChanged?.addListener((changes, areaName) => {
  syncCoordinator.handleStorageChanged(changes, areaName);
  if (areaName === "local" && Object.prototype.hasOwnProperty.call(changes || {}, LodWrapperStore.HISTORY_IMPORT_STATE_KEY || "lodVault.historyImport")) {
    scheduleHistoryHydrationResume(25);
  }
});

scheduleHistoryHydrationResume(50);
registerContextMenus();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === OPEN_LENS_OVERLAY_MESSAGE_TYPE) {
    const tabId = sender?.tab?.id;

    if (!tabId) {
      sendResponse({ ok: false, error: "Cannot open LOD Lens without a tab id." });
      return;
    }

    openLensOverlay(tabId, message.selectionText || "")
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({
        ok: false,
        error: error?.message || String(error)
      }));

    return true;
  }

  if (message?.type === LENS_PROXY_MESSAGE_TYPE) {
    fetch(String(message.url || ""), {
      method: "GET",
      headers: { Accept: "application/json" }
    })
      .then(async (response) => {
        const text = await response.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }

        sendResponse({
          ok: response.ok,
          status: response.status,
          json,
          text
        });
      })
      .catch((error) => sendResponse({
        ok: false,
        status: 0,
        error: error?.message || String(error)
      }));

    return true;
  }

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