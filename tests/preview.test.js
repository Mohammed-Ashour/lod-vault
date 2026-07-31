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
