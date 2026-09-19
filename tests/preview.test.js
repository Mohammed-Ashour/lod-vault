const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const repoRoot = path.resolve(__dirname, "..");

test("preview restores its scroll position and expanded meanings after an entry changes", () => {
  const outer = new JSDOM(fs.readFileSync(path.join(repoRoot, "pages/preview.html"), "utf8"), {
    url: "https://extension.test/pages/preview.html"
  });
  const inner = new JSDOM('<article class="entry" data-id="ONE"></article><article class="entry" data-id="TWO"><button class="meaning-toggle" aria-expanded="true"></button><div class="meaning-expand is-open"></div></article>');
  const frame = outer.window.document.getElementById("preview-frame");
  const scrollCalls = [];
  Object.defineProperty(frame, "contentDocument", { configurable: true, value: inner.window.document });
  Object.defineProperty(frame, "contentWindow", {
    configurable: true,
    value: { scrollX: 0, scrollY: 300, scrollTo: (x, y) => scrollCalls.push([x, y]) }
  });

  const source = `${fs.readFileSync(path.join(repoRoot, "scripts/preview.js"), "utf8")}\n;globalThis.previewTest = { capturePreviewView, restorePreviewView };`;
  const context = {
    window: outer.window,
    document: outer.window.document,
    Element: outer.window.Element,
    chrome: { tabs: { create() {} } },
    LodVaultStore: {
      TRANSLATION_LANGUAGE_LABELS: {},
      TRANSLATION_LANGUAGE_ORDER: [],
      createNoteAutosaveController: () => ({ destroy() {} }),
      async getEntries() { return []; },
      buildExportHtml() { return ""; }
    },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    Blob,
    globalThis: null
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "scripts/preview.js" });

  const state = context.previewTest.capturePreviewView();
  inner.window.document.body.innerHTML = '<article class="entry" data-id="TWO"><button class="meaning-toggle" aria-expanded="false"></button><div class="meaning-expand"></div></article>';
  context.previewTest.restorePreviewView(state);

  const toggle = inner.window.document.querySelector(".meaning-toggle");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(toggle.nextElementSibling.classList.contains("is-open"), true);
  assert.deepEqual(scrollCalls, [[0, 300]]);
});

test("preview exports the filtered view and keeps explicit full-vault downloads", async () => {
  const outer = new JSDOM(fs.readFileSync(path.join(repoRoot, "pages/preview.html"), "utf8"), {
    url: "https://extension.test/pages/preview.html"
  });
  const entries = [
    {
      id: "HAUS1",
      word: "Haus",
      translations: { en: "house", fr: "maison" },
      updatedAt: "2025-01-03T00:00:00.000Z"
    },
    {
      id: "BUCH1",
      word: "Buch",
      translations: { en: "book", de: "Buch" },
      updatedAt: "2025-01-02T00:00:00.000Z"
    },
    {
      id: "DOHEEM1",
      word: "Doheem",
      translations: { fr: "chez soi" },
      updatedAt: "2025-01-01T00:00:00.000Z"
    }
  ];
  const htmlExports = [];
  const ankiExports = [];
  const downloads = [];
  const addDocumentListener = outer.window.document.addEventListener.bind(outer.window.document);
  outer.window.document.addEventListener = (type, listener, options) => {
    if (type !== "DOMContentLoaded") addDocumentListener(type, listener, options);
  };
  const source = `${fs.readFileSync(path.join(repoRoot, "scripts/preview.js"), "utf8")}
    ;globalThis.previewTest = {
      downloadHtml,
      downloadAnki,
      getFilteredEntries,
      setState(entries, query, language) {
        currentEntriesById = new Map(entries.map((entry) => [entry.id, entry]));
        currentSearchQuery = query;
        currentLang = language;
        renderExportScope();
      }
    };`;
  const context = {
    window: outer.window,
    document: outer.window.document,
    Element: outer.window.Element,
    chrome: { tabs: { create() {} }, runtime: { getURL: (value) => value } },
    LodVaultStore: {
      TRANSLATION_LANGUAGE_LABELS: { en: "English", fr: "French", de: "German" },
      TRANSLATION_LANGUAGE_ORDER: ["en", "fr", "de"],
      createNoteAutosaveController: () => ({ destroy() {} }),
      async getEntries() { return entries; },
      buildSearchText(entry) {
        return [entry.word, ...Object.values(entry.translations || {})].join(" ").toLowerCase();
      },
      buildExportHtml(exportEntries) {
        htmlExports.push(exportEntries);
        return "html";
      },
      buildAnkiExport(exportEntries) {
        ankiExports.push(exportEntries);
        return "anki";
      },
      downloadTextFile(filename, contents, type) {
        downloads.push({ filename, contents, type });
      }
    },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    Blob,
    globalThis: null
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "scripts/preview.js" });

  context.previewTest.setState(entries, "house", "fr");
  const filtered = context.previewTest.getFilteredEntries(entries);
  assert.deepEqual(
    JSON.parse(JSON.stringify(filtered.map((entry) => ({
      id: entry.id,
      translations: entry.translations
    })))),
    [{ id: "HAUS1", translations: { fr: "maison" } }]
  );
  assert.equal(outer.window.document.getElementById("download-html-label").textContent, "Download filtered HTML");
  assert.equal(outer.window.document.getElementById("download-html-scope").textContent, "Current view, 1 word");
  assert.equal(outer.window.document.getElementById("export-all-actions").hidden, false);

  await context.previewTest.downloadHtml();
  await context.previewTest.downloadAnki();
  assert.equal(htmlExports[0].map((entry) => entry.id).join(","), "HAUS1");
  assert.deepEqual(Object.keys(htmlExports[0][0].translations), ["fr"]);
  assert.equal(ankiExports[0].map((entry) => entry.id).join(","), "HAUS1");
  assert.match(downloads[0].filename, /^lodvault-filtered-export-/);
  assert.match(downloads[1].filename, /^lodvault-anki-filtered-/);

  await context.previewTest.downloadHtml({ all: true });
  await context.previewTest.downloadAnki({ all: true });
  assert.equal(htmlExports[1].map((entry) => entry.id).join(","), "HAUS1,BUCH1,DOHEEM1");
  assert.deepEqual(Object.keys(htmlExports[1][0].translations), ["en", "fr"]);
  assert.equal(ankiExports[1].map((entry) => entry.id).join(","), "HAUS1,BUCH1,DOHEEM1");
  assert.match(downloads[2].filename, /^lodvault-export-/);
  assert.match(downloads[3].filename, /^lodvault-anki-\d{4}-/);
});
