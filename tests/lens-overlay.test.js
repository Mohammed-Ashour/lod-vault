const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const repoRoot = path.join(__dirname, "..");
const overlayScriptPaths = [
  "scripts/lens-session.js",
  "scripts/lens-render.js",
  "scripts/lens-overlay-shell.js",
  "scripts/lens-sentence-mode.js",
  "scripts/lens-overlay-controller.js",
  "scripts/lens-runtime.js"
];

function createDeferred() {
  let resolve = null;
  let reject = null;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function wait(dom, ms = 0) {
  return new Promise((resolve) => dom.window.setTimeout(resolve, ms));
}

function splitSentence(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return [];

  return normalized
    .split(/(\s+)/)
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => ({
      text: chunk,
      isWord: !/^\s+$/.test(chunk)
    }));
}

function loadLensOverlay({ lookupOverrides = {}, storeOverrides = {} } = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://example.com/",
    pretendToBeVisual: true
  });

  dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
  dom.window.getSelection = () => ({
    rangeCount: 1,
    isCollapsed: false,
    toString: () => "selected text",
    getRangeAt: () => ({
      getBoundingClientRect: () => ({ top: 12, left: 18, bottom: 24, width: 60, height: 16 })
    })
  });

  const lookup = {
    normalizeSelection(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    },
    splitSentence,
    isSentence(value) {
      return this.normalizeSelection(value).split(/\s+/).filter(Boolean).length > 1;
    },
    getFetchImplementation() {
      return null;
    },
    async lookup() {
      throw new Error("lookup override required");
    },
    async lookupSentence() {
      throw new Error("lookupSentence override required");
    },
    async fetchEntry() {
      throw new Error("fetchEntry override required");
    },
    ...lookupOverrides
  };

  const store = {
    escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
    },
    buildMeaningCollapsibleMarkup() {
      return "";
    },
    createAudioController() {
      return { play() {}, stopAll() {} };
    },
    playLodAudio() {},
    async getEntry() {
      return null;
    },
    async toggleList(entry, listName) {
      return { ...entry, [listName]: true };
    },
    ...storeOverrides
  };

  const context = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    navigator: dom.window.navigator,
    MutationObserver: dom.window.MutationObserver,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    URL: dom.window.URL,
    LodVaultLensLookup: lookup,
    LodVaultStore: store,
    console,
    setTimeout: dom.window.setTimeout.bind(dom.window),
    clearTimeout: dom.window.clearTimeout.bind(dom.window),
    globalThis: null
  };

  context.globalThis = context;

  for (const relativePath of overlayScriptPaths) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    vm.runInNewContext(source, context, { filename: relativePath });
  }

  return {
    dom,
    overlay: context.LodVaultLensRuntime,
    getRoot() {
      return dom.window.document.getElementById("lodvault-lens-overlay-root");
    }
  };
}

test("lens overlay bulk study keeps going when saved-entry hydration fails for one word", async () => {
  const toggledIds = [];
  const { dom, overlay, getRoot } = loadLensOverlay({
    lookupOverrides: {
      async lookupSentence() {
        return {
          query: "Haus geet",
          tokens: splitSentence("Haus geet"),
          words: [
            {
              word: "Haus",
              status: "resolved",
              entry: { id: "HAUS1", word: "Haus", url: "https://lod.lu/artikel/HAUS1", translations: { en: "house" } }
            },
            {
              word: "geet",
              status: "resolved",
              entry: { id: "GEET1", word: "geet", url: "https://lod.lu/artikel/GEET1", translations: { en: "goes" } }
            }
          ]
        };
      }
    },
    storeOverrides: {
      async getEntry(entryId) {
        if (entryId === "HAUS1") {
          throw new Error("storage unavailable");
        }
        return null;
      },
      async toggleList(entry, listName) {
        toggledIds.push(`${entry.id}:${listName}`);
        return { ...entry, study: true };
      }
    }
  });

  await overlay.openFromSelection("Haus geet");
  await wait(dom, 0);
  await wait(dom, 0);

  const root = getRoot();
  const bulkStudyButton = root.querySelector(".lodvault-lens-bulk-study");
  assert.ok(bulkStudyButton, "expected the sentence bulk study button");

  bulkStudyButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await wait(dom, 0);
  await wait(dom, 0);

  assert.deepEqual(toggledIds, ["HAUS1:study", "GEET1:study"]);
  assert.equal(root.querySelector(".lodvault-lens-status").textContent, "Added 2 words to Study.");
});

test("lens overlay ignores stale sentence lookup completions after the overlay closes", async () => {
  const lookupSentence = createDeferred();
  const { dom, overlay, getRoot } = loadLensOverlay({
    lookupOverrides: {
      async lookupSentence() {
        return lookupSentence.promise;
      }
    }
  });

  const openPromise = overlay.openFromSelection("Haus geet");
  const root = getRoot();
  assert.ok(root.classList.contains("is-visible"));

  overlay.close();

  lookupSentence.resolve({
    query: "Haus geet",
    tokens: splitSentence("Haus geet"),
    words: [
      {
        word: "Haus",
        status: "resolved",
        entry: { id: "HAUS1", word: "Haus", url: "https://lod.lu/artikel/HAUS1", translations: { en: "house" } }
      },
      {
        word: "geet",
        status: "resolved",
        entry: { id: "GEET1", word: "geet", url: "https://lod.lu/artikel/GEET1", translations: { en: "goes" } }
      }
    ]
  });

  await openPromise;
  await wait(dom, 0);

  assert.equal(root.classList.contains("is-visible"), false);
  assert.equal(root.querySelector(".lodvault-lens-sentence").innerHTML, "");
});

test("lens overlay keeps the active session when an older sentence candidate resolves late", async () => {
  const fetchEntry = createDeferred();
  const { dom, overlay, getRoot } = loadLensOverlay({
    lookupOverrides: {
      async lookupSentence() {
        return {
          query: "ginn haut",
          tokens: splitSentence("ginn haut"),
          words: [
            {
              word: "ginn",
              status: "ambiguous",
              candidates: [
                { id: "GINN1", word: "ginn", pos: "VRB" },
                { id: "GINN2", word: "ginn", pos: "VRB" }
              ]
            },
            {
              word: "haut",
              status: "resolved",
              entry: { id: "HAUT1", word: "haut", url: "https://lod.lu/artikel/HAUT1", translations: { en: "today" } }
            }
          ]
        };
      },
      async lookup(query) {
        return {
          query,
          status: "resolved",
          entry: { id: "HAUS1", word: "Haus", url: "https://lod.lu/artikel/HAUS1", translations: { en: "house" } }
        };
      },
      async fetchEntry() {
        return fetchEntry.promise;
      }
    }
  });

  await overlay.openFromSelection("ginn haut");

  const root = getRoot();
  const candidateButton = root.querySelector('.lodvault-lens-sentence-candidate[data-entry-id="GINN1"]');
  assert.ok(candidateButton, "expected an ambiguous sentence candidate button");

  candidateButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await wait(dom, 0);

  await overlay.openFromSelection("Haus");

  fetchEntry.resolve({
    id: "GINN1",
    word: "ginn",
    url: "https://lod.lu/artikel/GINN1",
    translations: { en: "to give" }
  });

  await wait(dom, 0);
  await wait(dom, 0);

  assert.equal(root.querySelector(".lodvault-lens-word").textContent, "Haus");
  assert.equal(root.classList.contains("lodvault-sentence-mode"), false);
  assert.equal(root.querySelector(".lodvault-lens-status").textContent, 'Found "Haus".');
});

test("lens overlay exposes a labelled pronunciation control for the resolved word", async () => {
  const played = [];
  const { dom, overlay, getRoot } = loadLensOverlay({
    lookupOverrides: {
      async lookup() {
        return {
          query: "Haus",
          status: "resolved",
          entry: { id: "HAUS1", word: "Haus", url: "https://lod.lu/artikel/HAUS1", translations: { en: "house" } }
        };
      }
    },
    storeOverrides: {
      playLodAudio(entry, options) {
        played.push({ id: entry.id, controller: Boolean(options?.controller) });
      }
    }
  });

  await overlay.openFromSelection("Haus");
  await wait(dom, 0);
  await wait(dom, 0);

  const root = getRoot();
  const audioBtn = root.querySelector(".lodvault-lens-audio");
  assert.ok(audioBtn, "expected a pronunciation button next to the word");
  assert.equal(audioBtn.dataset.audioId, "HAUS1");
  assert.equal(audioBtn.hidden, false, "expected the pronunciation button to be visible");
  assert.ok(audioBtn.getAttribute("aria-label"), "expected a labelled pronunciation control");

  audioBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

  assert.deepEqual(played, [{ id: "HAUS1", controller: true }]);
});
