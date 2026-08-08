const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const repoRoot = path.join(__dirname, "..");
const { loadSharedStore } = require("./helpers/loaders");
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

function loadLensOverlay({ lookupOverrides = {}, storeOverrides = {}, buildStoreOverrides = null } = {}) {
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
    setHtml: loadSharedStore().store.setHtml,
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
    ...(buildStoreOverrides ? buildStoreOverrides(dom) : storeOverrides)
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
        played.push({
          id: entry.id,
          controller: Boolean(options?.controller),
          buttonIsElement: options?.button instanceof dom.window.Element
        });
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

  assert.deepEqual(played, [{ id: "HAUS1", controller: true, buttonIsElement: true }]);
});

function loadRealEntryPresenter(extraGlobals = {}) {
  const storeCoreStub = {
    TRANSLATION_LANGUAGE_ORDER: [],
    TRANSLATION_LANGUAGE_LABELS: {},
    TRANSLATION_LANGUAGE_CHIP_LABELS: {},
    normalizeEntry: (entry) => entry,
    normalizeVisitCount: (count) => count
  };
  const context = {
    LodVaultStoreCore: storeCoreStub,
    console,
    URL,
    ...extraGlobals,
    globalThis: null
  };
  context.globalThis = context;
  const source = fs.readFileSync(path.join(repoRoot, "scripts/entry-presenter.js"), "utf8");
  vm.runInNewContext(source, context, { filename: "scripts/entry-presenter.js" });
  return context.LodVaultEntryPresenter;
}

test("lens audio playback drives playing/error states on the exact button and announces failure", async () => {
  const audios = [];
  class FakeAudio {
    constructor(url) {
      this.url = url;
      this.paused = true;
      this.listeners = {};
      audios.push(this);
    }
    addEventListener(type, listener) {
      (this.listeners[type] ||= []).push(listener);
    }
    fire(type) {
      (this.listeners[type] || []).forEach((listener) => listener());
    }
    play() {
      this.paused = false;
      this.fire("play");
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  }

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
    buildStoreOverrides(dom) {
      const presenter = loadRealEntryPresenter({
        Audio: FakeAudio,
        Element: dom.window.Element
      });
      return {
        createAudioController(doc, options) {
          return presenter.createAudioController(doc, options);
        },
        playLodAudio(entry, options) {
          presenter.playLodAudio(entry, options);
        }
      };
    }
  });

  await overlay.openFromSelection("Haus");
  await wait(dom, 0);
  await wait(dom, 0);

  const root = getRoot();
  const audioBtn = root.querySelector(".lodvault-lens-audio");

  // Decoy element on the host page sharing the same audio id: state changes
  // must land on the lens button only, never on a page-scoped match.
  const decoy = dom.window.document.createElement("button");
  decoy.className = "audio-btn";
  decoy.dataset.audioId = "HAUS1";
  dom.window.document.body.appendChild(decoy);

  audioBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(audios.length, 1, "expected one audio element");
  assert.equal(audios[0].url, "https://lod.lu/uploads/OGG/haus1.ogg");
  assert.ok(audioBtn.classList.contains("is-playing"), "lens button should show playing state");
  assert.ok(!decoy.classList.contains("is-playing"), "decoy button must not receive playing state");

  audios[0].fire("error");
  assert.ok(audioBtn.classList.contains("is-error"), "lens button should show error state");
  assert.ok(!decoy.classList.contains("is-error"), "decoy button must not receive error state");
  assert.equal(audioBtn.getAttribute("aria-label"), "Pronunciation unavailable", "failure should be announced");

  // A second play after the error restarts cleanly, and ended clears the state.
  audioBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(audios.length, 2);
  assert.ok(audioBtn.classList.contains("is-playing"));
  audios[1].fire("ended");
  assert.ok(!audioBtn.classList.contains("is-playing"));

  // Closing the overlay stops playback and clears states on tracked buttons only.
  audioBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.ok(audioBtn.classList.contains("is-playing"));
  overlay.close();
  assert.ok(!audioBtn.classList.contains("is-playing"));
  assert.ok(!decoy.classList.contains("is-playing"), "decoy must never be touched by stopAll");
});
