const BANNER_ID = "lod-wrapper-banner";
let contextInvalidated = false;
let refreshDebounce = null;
let domObserver = null;
let locationHooksInstalled = false;
let lastAutoRecordKey = "";
let currentAutoMode = false;

const { extractCurrentEntry } = LodWrapperArticleReader;

let bannerController = null;

function isExtensionContextInvalidated(error) {
  return String(error || "").includes("Extension context invalidated") || String(error || "").includes("Extension updated — refresh the page");
}

function notifyPopup(entry, savedEntry) {
  try {
    chrome.runtime.sendMessage({
      type: "lod-wrapper:page-state-changed",
      entry: entry || null,
      savedEntry: savedEntry || null
    });
  } catch {
    // Ignore when no extension page is listening.
  }
}

function handleInvalidatedContext() {
  if (contextInvalidated) return;
  contextInvalidated = true;

  if (refreshDebounce) {
    clearTimeout(refreshDebounce);
    refreshDebounce = null;
  }

  if (domObserver) {
    domObserver.disconnect();
    domObserver = null;
  }

  bannerController?.handleInvalidatedContext();
}

bannerController = LodWrapperPageBanner.createController({
  bannerId: BANNER_ID,
  store: LodWrapperStore,
  articleReader: LodWrapperArticleReader,
  getCurrentEntry: () => extractCurrentEntry(),
  getCurrentAutoMode: () => currentAutoMode,
  onPopupStateChange: notifyPopup,
  isContextInvalidated: () => contextInvalidated,
  onInvalidate: handleInvalidatedContext
});

const {
  ensureBanner,
  applyState
} = bannerController;

async function maybeAutoRecord(entry, savedEntry, autoMode = currentAutoMode) {
  if (!autoMode) {
    lastAutoRecordKey = "";
    return savedEntry;
  }

  const autoRecordKey = `${entry.id}|${entry.url}`;
  if (autoRecordKey === lastAutoRecordKey) {
    return savedEntry;
  }

  lastAutoRecordKey = autoRecordKey;
  return LodWrapperStore.recordAutoVisit(entry);
}

async function refreshUI() {
  if (contextInvalidated) return;

  try {
    const entry = extractCurrentEntry();
    if (!entry) {
      bannerController.clearRenderKey();
      applyState(null, null);
      return;
    }

    let savedEntry = await LodWrapperStore.getEntry(entry.id);
    currentAutoMode = await LodWrapperStore.getAutoMode();
    savedEntry = await maybeAutoRecord(entry, savedEntry, currentAutoMode);
    if (savedEntry) {
      savedEntry = await LodWrapperStore.refreshEntryData(entry) || savedEntry;
    }
    applyState(savedEntry, entry);
    notifyPopup(entry, savedEntry);
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      handleInvalidatedContext();
    }
  }
}

function scheduleRefresh(delay = 120) {
  if (contextInvalidated) return;
  if (refreshDebounce) clearTimeout(refreshDebounce);
  refreshDebounce = setTimeout(() => {
    refreshDebounce = null;
    refreshUI();
  }, delay);
}

async function handleListToggle(listName) {
  if (contextInvalidated) return;

  const entry = extractCurrentEntry();
  if (!entry) return;

  bannerController.setButtonsBusy(true);
  try {
    const savedEntry = await LodWrapperStore.toggleList(entry, listName);
    bannerController.clearRenderKey();
    applyState(savedEntry, entry);
    notifyPopup(entry, savedEntry);
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      handleInvalidatedContext();
      return;
    }

    const banner = ensureBanner();
    if (banner) {
      banner.querySelector(".lodw-banner__status").textContent = "Could not save this word";
    }
  } finally {
    if (!contextInvalidated) {
      bannerController.setButtonsBusy(false);
    }
  }
}

function installDomObserver() {
  if (domObserver || typeof MutationObserver === "undefined") return;

  domObserver = new MutationObserver(() => {
    if (LodWrapperArticleReader.getHeadingElement()) scheduleRefresh(80);
  });

  domObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

function installLocationHooks() {
  if (locationHooksInstalled) return;
  locationHooksInstalled = true;

  const notifyLocationChange = () => window.dispatchEvent(new Event("lod-wrapper:locationchange"));

  for (const methodName of ["pushState", "replaceState"]) {
    const original = history[methodName];
    history[methodName] = function (...args) {
      const result = original.apply(this, args);
      notifyLocationChange();
      return result;
    };
  }

  window.addEventListener("popstate", notifyLocationChange);
  window.addEventListener("hashchange", notifyLocationChange);
  window.addEventListener("lod-wrapper:locationchange", () => {
    bannerController.clearRenderKey();
    lastAutoRecordKey = "";
    scheduleRefresh(0);
  });
}

document.addEventListener("click", (event) => {
  const button = event.target.closest(`#${BANNER_ID} button[data-list]`);
  if (!button) return;
  handleListToggle(button.dataset.list);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "lod-wrapper:get-current-entry") {
    sendResponse({ entry: extractCurrentEntry() });
    return;
  }

  if (message?.type === "lod-wrapper:sync-state") {
    bannerController.clearRenderKey();
    applyState(message.entry || null, extractCurrentEntry());
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "lod-wrapper:refresh-ui") {
    bannerController.clearRenderKey();
    if (typeof message.autoRecordKey === "string") {
      lastAutoRecordKey = message.autoRecordKey;
    } else if (message.resetAutoCapture) {
      lastAutoRecordKey = "";
    }
    scheduleRefresh(0);
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "lod-wrapper:toggle-list") {
    const entry = extractCurrentEntry();
    if (!entry) {
      sendResponse({ entry: null, sourceEntry: null });
      return;
    }

    LodWrapperStore.toggleList(entry, message.listName)
      .then((savedEntry) => {
        bannerController.clearRenderKey();
        applyState(savedEntry, entry);
        notifyPopup(entry, savedEntry);
        sendResponse({ entry: savedEntry, sourceEntry: entry });
      })
      .catch((error) => {
        if (isExtensionContextInvalidated(error)) {
          handleInvalidatedContext();
        }
        sendResponse({ entry: null, sourceEntry: entry, error: String(error) });
      });

    return true;
  }
});

installDomObserver();
installLocationHooks();
refreshUI();
window.addEventListener("load", () => scheduleRefresh(0), { once: true });
