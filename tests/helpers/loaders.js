const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const repoRoot = path.resolve(__dirname, "..", "..");

function createChromeStorage(initialData = {}) {
  const data = structuredClone(initialData);

  return {
    data,
    chrome: {
      storage: {
        local: {
          async get(keys) {
            if (Array.isArray(keys)) {
              return keys.reduce((result, key) => {
                if (key in data) {
                  result[key] = data[key];
                }
                return result;
              }, {});
            }

            if (typeof keys === "string") {
              return keys in data ? { [keys]: data[keys] } : {};
            }

            return { ...data };
          },
          async set(values) {
            Object.assign(data, structuredClone(values));
          },
          async remove(keys) {
            const list = Array.isArray(keys) ? keys : [keys];
            for (const key of list) {
              delete data[key];
            }
          }
        }
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
  const source = fs.readFileSync(path.join(repoRoot, "scripts/shared.js"), "utf8");
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
    setTimeout,
    clearTimeout,
    globalThis: null
  };

  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "scripts/shared.js" });

  return {
    store: context.LodWrapperStore,
    chrome,
    storageData: data,
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
    getEntry: async () => null,
    getAutoMode: async () => false,
    recordAutoVisit: async (entry) => ({ ...entry, study: true, history: true, visitCount: 1 }),
    toggleList: async (entry, listName) => ({ ...entry, [listName]: true }),
    ...storeOverrides
  };

  const source = `${fs.readFileSync(path.join(repoRoot, "scripts/content.js"), "utf8")}
;globalThis.__contentTest = {
  cleanWord,
  stitchTokens,
  collectText,
  sanitizeHeading,
  extractTranslations,
  extractCurrentEntry,
  statusText,
  infoText,
  buttonLabel,
  ensureBanner,
  applyState
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

module.exports = {
  loadSharedStore,
  loadContentScript
};
