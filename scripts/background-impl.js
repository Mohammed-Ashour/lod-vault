const LOD_URL_PATTERNS = ["https://lod.lu/*", "https://www.lod.lu/*"];
const LENS_CONTEXT_MENU_ID = "lodvault-open-lens";
const LENS_COMMAND_ID = "open-lod-lens";
const OPEN_LENS_OVERLAY_MESSAGE_TYPE = "lodvault:open-lens-overlay";
const LENS_PROXY_MESSAGE_TYPE = "lodvault:lens-fetch";
const LENS_PROXY_ALLOWED_ORIGIN = "https://lod.lu";
const LENS_PROXY_ALLOWED_LOCALE = "lb";
const LENS_PROXY_SEARCH_PATH = `/api/${LENS_PROXY_ALLOWED_LOCALE}/search`;
const LENS_PROXY_SUGGEST_PATH = `/api/${LENS_PROXY_ALLOWED_LOCALE}/suggest`;
const LENS_PROXY_ENTRY_PREFIX = `/api/${LENS_PROXY_ALLOWED_LOCALE}/entry/`;
const LENS_SCRIPT_FILES = [
  "scripts/store-core.js",
  "scripts/entry-presenter.js",
  "scripts/shared.js",
  "scripts/lens-lookup.js",
  "scripts/lens-session.js",
  "scripts/lens-render.js",
  "scripts/lens-overlay-shell.js",
  "scripts/lens-sentence-mode.js",
  "scripts/lens-overlay-controller.js",
  "scripts/lens-runtime.js"
];
const STORE_MUTATION_MESSAGE_TYPE = LodVaultStore.STORE_MUTATION_MESSAGE_TYPE;
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

const syncCoordinator = LodVaultSyncCoordinator.createSyncCoordinator({
  store: LodVaultStore,
  syncNamespace: LodVaultSync,
  syncAdapter: LodVaultSync.SyncAdapter,
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
    LodVaultStore.resumeHistoryImportHydration?.().catch?.(() => {});
  }, Math.max(0, Number(delayMs) || 0));
}

function sanitizeLensQuery(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasOnlyAllowedSearchParams(searchParams, allowedKeys) {
  return [...new Set(searchParams.keys())].every((key) => allowedKeys.has(key));
}

function isAllowedLensEntryPath(pathname) {
  if (!String(pathname || "").startsWith(LENS_PROXY_ENTRY_PREFIX)) {
    return false;
  }

  const rawEntryId = pathname.slice(LENS_PROXY_ENTRY_PREFIX.length);
  if (!rawEntryId || /%2f|%5c/i.test(rawEntryId)) {
    return false;
  }

  let decodedEntryId = "";
  try {
    decodedEntryId = decodeURIComponent(rawEntryId);
  } catch {
    return false;
  }

  return Boolean(decodedEntryId)
    && !decodedEntryId.includes("/")
    && !decodedEntryId.includes("\\");
}

function validateLensProxyUrl(value) {
  const candidate = String(value || "").trim();
  let parsed = null;

  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Invalid LOD Lens request URL.");
  }

  if (
    parsed.protocol !== "https:"
    || parsed.origin !== LENS_PROXY_ALLOWED_ORIGIN
    || parsed.username
    || parsed.password
    || parsed.hash
  ) {
    throw new Error("Blocked unauthorized LOD Lens request URL.");
  }

  if (parsed.pathname === LENS_PROXY_SEARCH_PATH) {
    if (!hasOnlyAllowedSearchParams(parsed.searchParams, new Set(["lang", "query"]))) {
      throw new Error("Blocked unauthorized LOD Lens request URL.");
    }

    const lang = sanitizeLensQuery(parsed.searchParams.get("lang"));
    const query = sanitizeLensQuery(parsed.searchParams.get("query"));
    if (lang !== LENS_PROXY_ALLOWED_LOCALE || !query) {
      throw new Error("Blocked unauthorized LOD Lens request URL.");
    }

    parsed.search = `?lang=${encodeURIComponent(LENS_PROXY_ALLOWED_LOCALE)}&query=${encodeURIComponent(query)}`;
    return parsed.toString();
  }

  if (parsed.pathname === LENS_PROXY_SUGGEST_PATH) {
    if (!hasOnlyAllowedSearchParams(parsed.searchParams, new Set(["query"]))) {
      throw new Error("Blocked unauthorized LOD Lens request URL.");
    }

    const query = sanitizeLensQuery(parsed.searchParams.get("query"));
    if (!query) {
      throw new Error("Blocked unauthorized LOD Lens request URL.");
    }

    parsed.search = `?query=${encodeURIComponent(query)}`;
    return parsed.toString();
  }

  if (isAllowedLensEntryPath(parsed.pathname)) {
    if ([...new Set(parsed.searchParams.keys())].length > 0) {
      throw new Error("Blocked unauthorized LOD Lens request URL.");
    }

    return parsed.toString();
  }

  throw new Error("Blocked unauthorized LOD Lens request URL.");
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

async function isLensOverlayInjected(tabId) {
  if (!tabId || !chrome.scripting?.executeScript) {
    return false;
  }

  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(globalThis.LodVaultLensRuntime?.openFromSelection)
    });
    return Boolean(result);
  } catch {
    return false;
  }
}

async function ensureLensOverlayInjected(tabId) {
  if (await isLensOverlayInjected(tabId)) {
    return;
  }

  await chrome.scripting.insertCSS?.({
    target: { tabId },
    files: ["styles/lens-overlay.css"]
  }).catch(() => {});

  await chrome.scripting.executeScript({
    target: { tabId },
    files: LENS_SCRIPT_FILES
  });
}

async function openLensOverlay(tabId, selectionText = "") {
  if (!tabId || !chrome.scripting?.executeScript) {
    throw new Error("Cannot open lens overlay without a tab id.");
  }

  await ensureLensOverlayInjected(tabId);

  await chrome.scripting.executeScript({
    target: { tabId },
    func: (text) => {
      globalThis.LodVaultLensRuntime?.openFromSelection?.(text);
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
  if (areaName === "local" && Object.prototype.hasOwnProperty.call(changes || {}, LodVaultStore.HISTORY_IMPORT_STATE_KEY || "lodVault.historyImport")) {
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
    let requestUrl = "";

    try {
      requestUrl = validateLensProxyUrl(message.url);
    } catch (error) {
      sendResponse({
        ok: false,
        status: 400,
        error: error?.message || String(error)
      });
      return;
    }

    fetch(requestUrl, {
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

  if (!STORE_MUTATION_METHODS.has(method) || typeof LodVaultStore?.[method] !== "function") {
    sendResponse({ ok: false, error: `Unsupported store mutation: ${method}` });
    return;
  }

  enqueueStoreMutation(() => LodVaultStore[method](...args))
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));

  return true;
});