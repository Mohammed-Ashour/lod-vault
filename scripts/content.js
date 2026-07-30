const BANNER_ID = "lodvault-banner";
let contextInvalidated = false;
let refreshDebounce = null;
let domObserver = null;
let locationHooksInstalled = false;
let lastAutoRecordKey = "";
let currentAutoMode = false;
let lastPopupStateKey = "";
let observerLastUrl = location.href;
let observerHadHeading = Boolean(LodVaultArticleReader.getHeadingElement());

const { extractCurrentEntry } = LodVaultArticleReader;

let bannerController = null;

function isExtensionContextInvalidated(error) {
  return LodVaultStore.isExtensionContextInvalidated(error) || String(error || "").includes("Extension updated — refresh the page");
}

function serializePopupEntryState(entry) {
  if (!entry) return null;

  return {
    id: entry.id || "",
    word: entry.word || "",
    url: entry.url || "",
    pos: entry.pos || "",
    inflection: entry.inflection || "",
    example: entry.example || "",
    note: entry.note || "",
    favorite: Boolean(entry.favorite),
    study: Boolean(entry.study),
    history: Boolean(entry.history),
    visitCount: Number(entry.visitCount || 0),
    lastVisitedAt: entry.lastVisitedAt || "",
    updatedAt: entry.updatedAt || "",
    translations: Object.fromEntries(
      Object.entries(entry.translations || {})
        .map(([language, value]) => [language, value || ""])
        .sort(([left], [right]) => left.localeCompare(right))
    )
  };
}

function buildPopupStateKey(entry, savedEntry) {
  return JSON.stringify({
    entry: serializePopupEntryState(entry),
    savedEntry: serializePopupEntryState(savedEntry)
  });
}

function notifyPopup(entry, savedEntry) {
  const nextKey = buildPopupStateKey(entry, savedEntry);
  if (nextKey === lastPopupStateKey) return;

  try {
    chrome.runtime.sendMessage({
      type: "lodvault:page-state-changed",
      entry: entry || null,
      savedEntry: savedEntry || null
    });
    lastPopupStateKey = nextKey;
  } catch {
    // Ignore when no extension page is listening.
  }
}

function handleInvalidatedContext() {
  if (contextInvalidated) return;
  contextInvalidated = true;
  lastPopupStateKey = "";

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

bannerController = LodVaultPageBanner.createController({
  bannerId: BANNER_ID,
  store: LodVaultStore,
  articleReader: LodVaultArticleReader,
  getCurrentEntry: () => extractCurrentEntry(),
  getCurrentAutoMode: () => currentAutoMode,
  onPopupStateChange: notifyPopup,
  isContextInvalidated: () => contextInvalidated,
  onInvalidate: handleInvalidatedContext
});

const {
  ensureBanner,
  applyState,
  setActionFeedback
} = bannerController;

function isLikelyArticlePage(url = location.href) {
  return /https?:\/\/(?:www\.)?lod\.lu\/artikel\/[^/?#]+/i.test(String(url || ""));
}

function hideBannerIfPresent() {
  const banner = document.getElementById(BANNER_ID);
  if (banner) {
    banner.style.display = "none";
  }
}

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
  return LodVaultStore.recordAutoVisit(entry);
}

async function refreshUI() {
  if (contextInvalidated) return;

  if (!isLikelyArticlePage()) {
    bannerController.clearRenderKey();
    hideBannerIfPresent();
    notifyPopup(null, null);
    return;
  }

  try {
    const entry = extractCurrentEntry();
    if (!entry) {
      bannerController.clearRenderKey();
      applyState(null, null);
      return;
    }

    let savedEntry = await LodVaultStore.getEntry(entry.id);
    currentAutoMode = await LodVaultStore.getAutoMode();
    savedEntry = await maybeAutoRecord(entry, savedEntry, currentAutoMode);
    if (savedEntry) {
      savedEntry = await LodVaultStore.refreshEntryData(entry) || savedEntry;
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
    const savedEntry = await LodVaultStore.toggleList(entry, listName);
    bannerController.clearRenderKey();
    applyState(savedEntry, entry);
    setActionFeedback(typeof LodVaultStore.describeListAction === "function"
      ? LodVaultStore.describeListAction(entry, listName, savedEntry)
      : `Updated ${entry.word}.`);
    notifyPopup(entry, savedEntry);
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      handleInvalidatedContext();
      return;
    }

    const banner = ensureBanner();
    if (banner) {
      banner.querySelector(".lodw-word").textContent = "Could not save";
      const infoEl = banner.querySelector(".lodw-info");
      if (infoEl) infoEl.title = "";
      setActionFeedback("Could not update your vault.", "error");
    }
  } finally {
    if (!contextInvalidated) {
      bannerController.setButtonsBusy(false);
    }
  }
}

function matchesArticleMutationNode(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;

  return Boolean(
    node.matches?.('h1, .microstructures, .targetLanguages, .examples, .inflection, meta[name="description"]')
    || node.querySelector?.('h1, .microstructures, .targetLanguages, .examples, .inflection, meta[name="description"]')
    || node.closest?.("main")
  );
}

function mutationTouchesArticleContent(mutation) {
  if (matchesArticleMutationNode(mutation?.target)) {
    return true;
  }

  for (const node of mutation?.addedNodes || []) {
    if (matchesArticleMutationNode(node)) return true;
  }

  for (const node of mutation?.removedNodes || []) {
    if (matchesArticleMutationNode(node)) return true;
  }

  return false;
}

function installDomObserver() {
  if (domObserver || typeof MutationObserver === "undefined") return;

  domObserver = new MutationObserver((mutations) => {
    const nextUrl = location.href;
    const hasHeading = Boolean(LodVaultArticleReader.getHeadingElement());
    const urlChanged = nextUrl !== observerLastUrl;
    const headingAppeared = !observerHadHeading && hasHeading;
    const articleContentChanged = hasHeading && mutations.some((mutation) => mutationTouchesArticleContent(mutation));

    observerLastUrl = nextUrl;
    observerHadHeading = hasHeading;

    if (!urlChanged && !headingAppeared && !articleContentChanged) return;
    scheduleRefresh(urlChanged ? 0 : 80);
  });

  domObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

function installLocationHooks() {
  if (locationHooksInstalled) return;
  locationHooksInstalled = true;

  const notifyLocationChange = () => window.dispatchEvent(new Event("lodvault:locationchange"));

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
  window.addEventListener("lodvault:locationchange", () => {
    bannerController.clearRenderKey();
    lastAutoRecordKey = "";
    lastPopupStateKey = "";
    observerLastUrl = location.href;
    observerHadHeading = Boolean(LodVaultArticleReader.getHeadingElement());
    scheduleRefresh(0);
  });
}

document.addEventListener("click", (event) => {
  const button = event.target.closest(`#${BANNER_ID} button[data-list]`);
  if (!button) return;
  handleListToggle(button.dataset.list);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "lodvault:get-current-entry") {
    sendResponse({ entry: extractCurrentEntry() });
    return;
  }

  if (message?.type === "lodvault:sync-state") {
    bannerController.clearRenderKey();
    applyState(message.entry || null, extractCurrentEntry());
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "lodvault:refresh-ui") {
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

  if (message?.type === "lodvault:toggle-list") {
    const entry = extractCurrentEntry();
    if (!entry) {
      sendResponse({ entry: null, sourceEntry: null });
      return;
    }

    LodVaultStore.toggleList(entry, message.listName)
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
