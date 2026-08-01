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
const SELECTION_TRIGGER_SCRIPT_ID = "lodvault-selection-trigger";
const SELECTION_TRIGGER_SCRIPT_FILES = ["scripts/selection-trigger.js"];
const SELECTION_TRIGGER_STYLE_FILES = ["styles/selection-trigger.css"];
const SELECTION_TRIGGER_CONTRACT = "1";
const STORE_MUTATION_MESSAGE_TYPE = LodVaultStore.STORE_MUTATION_MESSAGE_TYPE;
const STORE_MUTATION_METHODS = new Set([
  "setAutoMode",
  "setSyncLanguages",
  "markSyncVerified",
  "toggleList",
  "recordAutoVisit",
  "removeFromHistory",
  "refreshEntryData",
  "saveNote",
  "removeEntry",
  "restoreEntry",
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

function getTabOriginPattern(tabUrl) {
  let parsed = null;

  try {
    parsed = new URL(String(tabUrl || ""));
  } catch {
    return "";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "";
  }

  return `${parsed.origin}/*`;
}

async function requestLensSitePermission(tabUrl) {
  const originPattern = getTabOriginPattern(tabUrl);
  if (!originPattern || typeof chrome.permissions?.request !== "function") {
    return false;
  }

  try {
    return Boolean(await chrome.permissions.request({ origins: [originPattern] }));
  } catch {
    return false;
  }
}

function normalizeGrantedOriginPattern(value) {
  const candidate = String(value || "").trim();
  if (!candidate.endsWith("/*")) {
    return "";
  }

  let parsed = null;
  try {
    parsed = new URL(candidate.slice(0, -2));
  } catch {
    return "";
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || !parsed.hostname
    || parsed.hostname.includes("*")
    || parsed.hostname === "lod.lu"
    || parsed.hostname === "www.lod.lu"
  ) {
    return "";
  }

  return `${parsed.origin}/*`;
}

async function getGrantedOriginPatterns() {
  if (typeof chrome.permissions?.getAll !== "function") {
    return [];
  }

  try {
    const granted = await chrome.permissions.getAll();
    return [...new Set(
      (Array.isArray(granted?.origins) ? granted.origins : [])
        .map(normalizeGrantedOriginPattern)
        .filter(Boolean)
    )];
  } catch {
    return [];
  }
}

async function syncSelectionTriggerRegistration() {
  if (!chrome.scripting?.unregisterContentScripts || !chrome.scripting?.registerContentScripts) {
    return;
  }

  const matches = await getGrantedOriginPatterns();
  await chrome.scripting.unregisterContentScripts({ ids: [SELECTION_TRIGGER_SCRIPT_ID] }).catch(() => {});

  if (!matches.length) {
    return;
  }

  await chrome.scripting.registerContentScripts([{
    id: SELECTION_TRIGGER_SCRIPT_ID,
    matches,
    js: SELECTION_TRIGGER_SCRIPT_FILES,
    css: SELECTION_TRIGGER_STYLE_FILES,
    runAt: "document_idle"
  }]).catch(() => {});
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

async function isSelectionTriggerInjected(tabId) {
  if (!tabId || !chrome.scripting?.executeScript) {
    return false;
  }

  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (contract) => {
        const trigger = globalThis.LodVaultSelectionTrigger;
        return Boolean(trigger?.loaded && trigger.contract === contract);
      },
      args: [SELECTION_TRIGGER_CONTRACT]
    });
    return Boolean(result);
  } catch {
    return false;
  }
}

async function ensureSelectionTriggerInjected(tabId) {
  if (await isSelectionTriggerInjected(tabId)) {
    return;
  }

  await chrome.scripting.insertCSS?.({
    target: { tabId },
    files: SELECTION_TRIGGER_STYLE_FILES
  }).catch(() => {});

  await chrome.scripting.executeScript({
    target: { tabId },
    files: SELECTION_TRIGGER_SCRIPT_FILES
  });
}

async function openLensOverlay(tabId, selectionText = "", { tabUrl = "", requestSitePermission = false } = {}) {
  if (!tabId || !chrome.scripting?.executeScript) {
    throw new Error("Cannot open lens overlay without a tab id.");
  }

  const resolvedTabUrl = String(tabUrl || "");

  if (requestSitePermission) {
    if (!getTabOriginPattern(resolvedTabUrl)) {
      throw new Error("LODVault needs site access to open Lens on this page.");
    }

    // Must be the first async call: the caller's user gesture (context menu
    // click, trigger click, or command) is what allows the permission prompt
    // to appear. Awaiting anything before it loses the gesture and makes
    // chrome.permissions.request throw "must be called during a user gesture".
    // Already-granted origins resolve true without a prompt, so no contains()
    // pre-check is needed.
    const granted = await requestLensSitePermission(resolvedTabUrl);
    if (!granted) {
      throw new Error("LODVault needs site access to open Lens on this page.");
    }

    await syncSelectionTriggerRegistration();
    await ensureSelectionTriggerInjected(tabId);
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
    void syncSelectionTriggerRegistration();
    syncCoordinator.handleInstalled("onInstalled");
    scheduleHistoryHydrationResume(50);
  }
});

chrome.runtime.onStartup?.addListener(() => {
  registerContextMenus();
  void syncSelectionTriggerRegistration();
  syncCoordinator.handleStartup("onStartup");
  scheduleHistoryHydrationResume(50);
});

chrome.contextMenus?.onClicked?.addListener((info, tab) => {
  if (info.menuItemId !== LENS_CONTEXT_MENU_ID) return;
  if (!tab?.id) return;
  openLensOverlay(tab.id, info.selectionText || "", {
    tabUrl: tab.url || "",
    requestSitePermission: true
  }).catch((error) => {
    console.error("LOD Lens: could not open from context menu:", error?.message || error);
  });
});

chrome.commands?.onCommand?.addListener(async (command) => {
  if (command !== LENS_COMMAND_ID) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const selectionText = await getActiveSelectionText(tab.id);
    // No optional host permission is requested here: the keyboard shortcut
    // grants activeTab for the active tab, which is enough to inject the lens
    // runtime and open the overlay. Requesting persistent site access from the
    // command path would require the permission prompt to fire inside the
    // shortcut's gesture window, before the tabs.query/selection round-trips
    // above; the context-menu path remains the opt-in flow for persistent
    // access and the floating trigger.
    await openLensOverlay(tab.id, selectionText, {
      tabUrl: tab.url || ""
    });
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
void syncSelectionTriggerRegistration();
chrome.permissions?.onAdded?.addListener(() => {
  void syncSelectionTriggerRegistration();
});
chrome.permissions?.onRemoved?.addListener(() => {
  void syncSelectionTriggerRegistration();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === OPEN_LENS_OVERLAY_MESSAGE_TYPE) {
    const tabId = sender?.tab?.id;

    if (!tabId) {
      sendResponse({ ok: false, error: "Cannot open LOD Lens without a tab id." });
      return;
    }

    openLensOverlay(tabId, message.selectionText || "", {
      tabUrl: sender?.url || "",
      requestSitePermission: true
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("LOD Lens: could not open for the selection trigger:", error?.message || error);
        sendResponse({
          ok: false,
          error: error?.message || String(error)
        });
      });

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