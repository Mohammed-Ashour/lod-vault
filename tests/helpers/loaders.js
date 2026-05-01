const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const repoRoot = path.resolve(__dirname, "..", "..");

function runScripts(context, scriptPaths) {
  for (const scriptPath of scriptPaths) {
    const absolutePath = path.isAbsolute(scriptPath) ? scriptPath : path.join(repoRoot, scriptPath);
    const source = fs.readFileSync(absolutePath, "utf8");
    vm.runInNewContext(source, context, { filename: absolutePath });
  }
}

function createChromeEvent() {
  const listeners = new Set();
  return {
    addListener(listener) {
      listeners.add(listener);
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
    dispatch(...args) {
      for (const listener of [...listeners]) {
        listener(...args);
      }
    },
    getListeners() {
      return [...listeners];
    }
  };
}

async function flushAsync(dom, rounds = 3) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  }
}

function createChromeStorage(initialData = {}) {
  const hasAreas = Boolean(initialData && ("local" in initialData || "sync" in initialData));
  const data = {
    local: structuredClone(hasAreas ? (initialData.local || {}) : initialData),
    sync: structuredClone(hasAreas ? (initialData.sync || {}) : {})
  };
  const onChanged = createChromeEvent();

  function cloneForStore(value) {
    return value === undefined ? undefined : structuredClone(value);
  }

  function buildGetResult(areaData, keys) {
    if (keys == null) {
      return { ...areaData };
    }

    if (Array.isArray(keys)) {
      return keys.reduce((result, key) => {
        if (key in areaData) {
          result[key] = areaData[key];
        }
        return result;
      }, {});
    }

    if (typeof keys === "string") {
      return keys in areaData ? { [keys]: areaData[keys] } : {};
    }

    if (typeof keys === "object") {
      return Object.entries(keys).reduce((result, [key, fallback]) => {
        result[key] = key in areaData ? areaData[key] : fallback;
        return result;
      }, {});
    }

    return { ...areaData };
  }

  function createAreaStore(areaName) {
    const areaData = data[areaName];

    return {
      async get(keys) {
        return buildGetResult(areaData, keys);
      },
      async set(values) {
        const changes = {};

        for (const [key, value] of Object.entries(values || {})) {
          const oldValue = key in areaData ? cloneForStore(areaData[key]) : undefined;
          const newValue = cloneForStore(value);
          areaData[key] = newValue;
          changes[key] = { oldValue, newValue: cloneForStore(newValue) };
        }

        if (Object.keys(changes).length) {
          onChanged.dispatch(changes, areaName);
        }
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        const changes = {};

        for (const key of list) {
          if (!(key in areaData)) continue;
          changes[key] = { oldValue: cloneForStore(areaData[key]), newValue: undefined };
          delete areaData[key];
        }

        if (Object.keys(changes).length) {
          onChanged.dispatch(changes, areaName);
        }
      }
    };
  }

  return {
    data,
    chrome: {
      storage: {
        local: createAreaStore("local"),
        sync: createAreaStore("sync"),
        onChanged
      },
      runtime: {
        onMessage: {
          addListener() {}
        }
      }
    }
  };
}

function loadSharedStore(initialStorage = {}) {
  const { chrome, data } = createChromeStorage(initialStorage);
  const context = {
    chrome,
    console,
    Intl,
    Date,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Promise,
    Blob,
    URL,
    TextEncoder,
    __LOD_SYNC_REPUSH_DELAY_MS__: 0,
    setTimeout,
    clearTimeout,
    globalThis: null
  };

  context.globalThis = context;
  runScripts(context, [
    "scripts/store-core.js",
    "scripts/note-autosave.js",
    "scripts/entry-presenter.js",
    "scripts/shared.js"
  ]);

  return {
    store: context.LodWrapperStore,
    chrome,
    storageData: data.local,
    syncStorageData: data.sync,
    fullStorageData: data,
    context
  };
}

function loadSyncScript(initialStorage = {}) {
  const { chrome, data } = createChromeStorage(initialStorage);
  const context = {
    chrome,
    console,
    Intl,
    Date,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Promise,
    Blob,
    URL,
    TextEncoder,
    __LOD_SYNC_REPUSH_DELAY_MS__: 0,
    setTimeout,
    clearTimeout,
    globalThis: null
  };

  context.globalThis = context;
  runScripts(context, [
    "scripts/store-core.js",
    "scripts/note-autosave.js",
    "scripts/entry-presenter.js",
    "scripts/shared.js",
    "scripts/sync.js"
  ]);

  return {
    store: context.LodWrapperStore,
    sync: context.LodWrapperSync,
    chrome,
    storageData: data.local,
    syncStorageData: data.sync,
    fullStorageData: data,
    context
  };
}

function loadContentScript({
  html,
  url = "https://lod.lu/artikel/HAUS1",
  title = '„Haus" - LOD',
  storeOverrides = {}
} = {}) {
  const dom = new JSDOM(html, { url });
  dom.window.document.title = title;

  let messageListener = null;
  const chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      }
    }
  };

  const LodWrapperStore = {
    getIdFromUrl(value) {
      const match = String(value || "").match(/\/artikel\/([^/?#]+)/i);
      return match ? decodeURIComponent(match[1]) : "";
    },
    createNoteAutosaveController() {
      return {
        clear() {},
        clearAll() {},
        schedule() {},
        markDirty() {},
        commit() {},
        destroy() {}
      };
    },
    getEntry: async () => null,
    getAutoMode: async () => false,
    recordAutoVisit: async (entry) => ({ ...entry, study: true, history: true, visitCount: 1 }),
    refreshEntryData: async (entry) => entry,
    toggleList: async (entry, listName) => ({ ...entry, [listName]: true }),
    ...storeOverrides
  };

  const source = `${fs.readFileSync(path.join(repoRoot, "scripts/lod-article.js"), "utf8")}
${fs.readFileSync(path.join(repoRoot, "scripts/page-banner.js"), "utf8")}
${fs.readFileSync(path.join(repoRoot, "scripts/content.js"), "utf8")}
;globalThis.__contentTest = {
  cleanWord: LodWrapperArticleReader.cleanWord,
  stitchTokens: LodWrapperArticleReader.stitchTokens,
  collectText: LodWrapperArticleReader.collectText,
  sanitizeHeading: LodWrapperArticleReader.sanitizeHeading,
  extractTranslations: LodWrapperArticleReader.extractTranslations,
  extractCurrentEntry: LodWrapperArticleReader.extractCurrentEntry,
  statusText: bannerController.statusText,
  infoText: LodWrapperArticleReader.infoText,
  buttonLabel: bannerController.buttonLabel,
  ensureBanner: bannerController.ensureBanner,
  applyState: bannerController.applyState
};`;

  const context = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    history: dom.window.history,
    navigator: dom.window.navigator,
    MutationObserver: dom.window.MutationObserver,
    Event: dom.window.Event,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    chrome,
    LodWrapperStore,
    console,
    URL: dom.window.URL,
    setTimeout: dom.window.setTimeout.bind(dom.window),
    clearTimeout: dom.window.clearTimeout.bind(dom.window),
    globalThis: null
  };

  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "scripts/content.js" });

  return {
    dom,
    api: context.__contentTest,
    chrome,
    LodWrapperStore,
    getMessageListener: () => messageListener,
    context
  };
}

async function loadPopupScript({
  entries = [],
  currentEntry = null,
  autoMode = false,
  syncLanguages = ["en", "fr", "de"],
  popupHtml,
  storeOverrides = {}
} = {}) {
  const shared = loadSharedStore();
  const html = popupHtml || fs.readFileSync(path.join(repoRoot, "pages/popup.html"), "utf8");
  const dom = new JSDOM(html, {
    url: "https://extension.test/pages/popup.html",
    pretendToBeVisual: true
  });

  const tabsOnActivated = createChromeEvent();
  const tabsOnUpdated = createChromeEvent();
  const runtimeOnMessage = createChromeEvent();
  const createdTabs = [];

  const LodWrapperStore = {
    STORAGE_KEY: "lodVault.entries",
    LEGACY_STORAGE_KEY: "lodWrapper.entries",
    DEFAULT_SETTINGS: structuredClone(shared.store.DEFAULT_SETTINGS),
    MAX_SYNC_LANGUAGES: shared.store.MAX_SYNC_LANGUAGES,
    TRANSLATION_LANGUAGE_ORDER: [...shared.store.TRANSLATION_LANGUAGE_ORDER],
    TRANSLATION_LANGUAGE_LABELS: { ...shared.store.TRANSLATION_LANGUAGE_LABELS },
    TRANSLATION_LANGUAGE_CHIP_LABELS: { ...shared.store.TRANSLATION_LANGUAGE_CHIP_LABELS },
    createNoteAutosaveController: shared.store.createNoteAutosaveController,
    escapeHtml: shared.store.escapeHtml,
    formatWhen: (value) => value || "",
    buildSearchText: shared.store.buildSearchText,
    buildMeaningText: shared.store.buildMeaningText,
    buildMeaningChipsMarkup: shared.store.buildMeaningChipsMarkup,
    async getAutoMode() {
      return autoMode;
    },
    async getSyncLanguages() {
      return [...syncLanguages];
    },
    async getEntries() {
      return entries.map((entry) => structuredClone(entry));
    },
    async getEntry(id) {
      const entry = entries.find((item) => item.id === id);
      return entry ? structuredClone(entry) : null;
    },
    async setAutoMode(nextValue) {
      autoMode = Boolean(nextValue);
      return autoMode;
    },
    async setSyncLanguages(nextLanguages) {
      syncLanguages = shared.store.normalizeSyncLanguages(nextLanguages);
      return [...syncLanguages];
    },
    async recordAutoVisit(entry) {
      return { ...entry, study: true, history: true, visitCount: 1 };
    },
    async toggleList(entry, listName) {
      return { ...entry, [listName]: !entry?.[listName] };
    },
    async removeEntry() {},
    async saveNote(id, note) {
      return { id, note: shared.store.normalizeNoteValue(note) };
    },
    async importJson() {},
    async getSettings() {
      return { autoMode, syncLanguages: [...syncLanguages] };
    },
    buildJsonExport(entriesToExport, options) {
      return shared.store.buildJsonExport(entriesToExport, options);
    },
    buildExportHtml(entriesToExport, options) {
      return shared.store.buildExportHtml(entriesToExport, options);
    },
    downloadTextFile() {},
    ...storeOverrides
  };

  const chrome = {
    tabs: {
      onActivated: tabsOnActivated,
      onUpdated: tabsOnUpdated,
      async query() {
        return currentEntry
          ? [{ id: 1, active: true, url: currentEntry.url || "https://lod.lu/artikel/HAUS1" }]
          : [];
      },
      async sendMessage(_tabId, message) {
        if (message?.type === "lod-wrapper:get-current-entry") {
          return { entry: currentEntry };
        }
        if (message?.type === "lod-wrapper:toggle-list") {
          return { entry: currentEntry ? { ...currentEntry, [message.listName]: true } : null, sourceEntry: currentEntry };
        }
        return { ok: true };
      },
      async create({ url }) {
        createdTabs.push(url);
      }
    },
    runtime: {
      getURL(relativePath) {
        return `chrome-extension://test/${relativePath}`;
      },
      onMessage: runtimeOnMessage
    }
  };

  const source = `${fs.readFileSync(path.join(repoRoot, "scripts/popup-app.js"), "utf8")}
${fs.readFileSync(path.join(repoRoot, "scripts/popup.js"), "utf8")}
;globalThis.__popupTest = {
  state: popupApp.state,
  elements: popupApp.elements,
  renderList: popupApp.renderList,
  renderSavedList: popupApp.renderSavedList,
  refreshCurrentPage: popupApp.refreshCurrentPage,
  formatSearchStatus: popupApp.formatSearchStatus
};`;

  const context = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    navigator: dom.window.navigator,
    Event: dom.window.Event,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    chrome,
    LodWrapperStore,
    console,
    URL: dom.window.URL,
    Blob,
    setTimeout: dom.window.setTimeout.bind(dom.window),
    clearTimeout: dom.window.clearTimeout.bind(dom.window),
    globalThis: null
  };

  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "scripts/popup.js" });

  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded", { bubbles: true }));
  await flushAsync(dom);

  return {
    dom,
    api: context.__popupTest,
    chrome,
    createdTabs,
    context,
    LodWrapperStore,
    runtimeOnMessage,
    tabsOnActivated,
    tabsOnUpdated
  };
}

async function loadFlashcardsScript({ entries = [], storeOverrides = {} } = {}) {
  const shared = loadSharedStore();
  const html = fs.readFileSync(path.join(repoRoot, "pages/flashcards.html"), "utf8");
  const dom = new JSDOM(html, {
    url: "https://extension.test/pages/flashcards.html",
    pretendToBeVisual: true
  });

  let currentEntries = entries.map((entry) => structuredClone(entry));
  const storageOnChanged = createChromeEvent();

  const LodWrapperStore = {
    STORAGE_KEY: "lodVault.entries",
    LEGACY_STORAGE_KEY: "lodWrapper.entries",
    TRANSLATION_LANGUAGE_LABELS: { ...shared.store.TRANSLATION_LANGUAGE_LABELS },
    escapeHtml: shared.store.escapeHtml,
    buildMeaningRowsMarkup: shared.store.buildMeaningRowsMarkup,
    async getEntries() {
      return currentEntries.map((entry) => structuredClone(entry));
    },
    ...storeOverrides
  };

  const chrome = {
    storage: {
      onChanged: storageOnChanged
    }
  };

  const source = `${fs.readFileSync(path.join(repoRoot, "scripts/flashcards.js"), "utf8")}
;globalThis.__flashcardsTest = { state, elements, loadEntries, renderDeck, handleStorageChange };`;

  const context = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    navigator: dom.window.navigator,
    Event: dom.window.Event,
    KeyboardEvent: dom.window.KeyboardEvent,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    chrome,
    LodWrapperStore,
    console,
    URL: dom.window.URL,
    setTimeout: dom.window.setTimeout.bind(dom.window),
    clearTimeout: dom.window.clearTimeout.bind(dom.window),
    globalThis: null
  };

  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "scripts/flashcards.js" });

  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded", { bubbles: true }));
  await flushAsync(dom);

  return {
    dom,
    api: context.__flashcardsTest,
    chrome,
    storageOnChanged,
    setEntries(nextEntries) {
      currentEntries = nextEntries.map((entry) => structuredClone(entry));
    },
    context,
    LodWrapperStore
  };
}

function loadBackgroundScript(initialStorage = {}) {
  const { chrome, data } = createChromeStorage(initialStorage);
  const runtimeOnInstalled = createChromeEvent();
  const runtimeOnStartup = createChromeEvent();
  const runtimeOnMessage = createChromeEvent();
  const reloadedTabIds = [];

  chrome.runtime.getURL = (relativePath) => path.join(repoRoot, relativePath);
  chrome.runtime.onInstalled = runtimeOnInstalled;
  chrome.runtime.onStartup = runtimeOnStartup;
  chrome.runtime.onMessage = runtimeOnMessage;
  chrome.tabs = {
    async query() {
      return [];
    },
    async reload(tabId) {
      reloadedTabIds.push(tabId);
    }
  };

  let context = null;
  function importScripts(...scriptPaths) {
    for (const scriptPath of scriptPaths) {
      const absolutePath = path.isAbsolute(scriptPath) ? scriptPath : path.join(repoRoot, scriptPath);
      const scriptSource = fs.readFileSync(absolutePath, "utf8");
      vm.runInNewContext(scriptSource, context, { filename: absolutePath });
    }
  }

  context = {
    chrome,
    importScripts,
    console,
    Intl,
    Date,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Promise,
    Blob,
    URL,
    TextEncoder,
    __LOD_SYNC_PUSH_DEBOUNCE_MS__: 10,
    __LOD_SYNC_REPUSH_DELAY_MS__: 0,
    setTimeout,
    clearTimeout,
    globalThis: null
  };

  context.globalThis = context;
  const source = fs.readFileSync(path.join(repoRoot, "scripts/background.js"), "utf8");
  vm.runInNewContext(source, context, { filename: "scripts/background.js" });

  function dispatchStoreMutation(message) {
    return new Promise((resolve) => {
      const listener = runtimeOnMessage.getListeners()[0];
      listener(message, null, resolve);
    });
  }

  return {
    chrome,
    storageData: data.local,
    syncStorageData: data.sync,
    fullStorageData: data,
    context,
    runtimeOnInstalled,
    runtimeOnStartup,
    runtimeOnMessage,
    reloadedTabIds,
    dispatchStoreMutation
  };
}

module.exports = {
  loadSharedStore,
  loadSyncScript,
  loadContentScript,
  loadPopupScript,
  loadFlashcardsScript,
  loadBackgroundScript
};
