const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const repoRoot = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "scripts/selection-trigger.js"), "utf8");

function loadSelectionTrigger({ html = "<!doctype html><html><body></body></html>", url = "https://example.com/", overlay = null } = {}) {
  const dom = new JSDOM(html, { url });
  const sentMessages = [];
  const chrome = {
    runtime: {
      getURL(relativePath) {
        return `chrome-extension://test/${relativePath}`;
      },
      async sendMessage(message) {
        sentMessages.push(JSON.parse(JSON.stringify(message)));
        return { ok: true };
      }
    }
  };

  const context = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    navigator: dom.window.navigator,
    MutationObserver: dom.window.MutationObserver,
    Event: dom.window.Event,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    URL: dom.window.URL,
    chrome,
    LodVaultLensRuntime: overlay,
    console,
    setTimeout: dom.window.setTimeout.bind(dom.window),
    clearTimeout: dom.window.clearTimeout.bind(dom.window),
    queueMicrotask: dom.window.queueMicrotask.bind(dom.window),
    globalThis: null
  };

  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "scripts/selection-trigger.js" });

  return {
    dom,
    api: context.__LodVaultSelectionTriggerTest,
    sentMessages
  };
}

test("selection trigger language markers match full words instead of english substrings", () => {
  const { api } = loadSelectionTrigger({
    html: "<!doctype html><html><body>This class material explains what engineering firms can watch next.</body></html>"
  });

  assert.equal(api.countLuxembourgishMarkers("This class material explains what engineering firms can watch next."), 0);
  assert.equal(api.pageLooksLuxembourgish(), false);
});

test("selection trigger can recognize Luxembourgish-looking selected text on non-Luxembourgish pages", () => {
  const { api } = loadSelectionTrigger({
    html: "<!doctype html><html><body>An English article with a quoted Luxembourgish phrase.</body></html>"
  });

  assert.equal(api.pageLooksLuxembourgish(), false);
  assert.equal(api.selectionLooksLuxembourgish("Dëst ass gutt"), true);
  assert.equal(api.selectionLooksLuxembourgish("This is fine"), false);
});

test("selection trigger caches the page language heuristic until it is invalidated", () => {
  const { dom, api } = loadSelectionTrigger({
    html: "<!doctype html><html><body>Dëst ass eng Säit déi och mat Lëtzebuergesch Marker gefëllt ass.</body></html>",
    url: "https://example.com/article"
  });

  assert.equal(api.pageLooksLuxembourgish(), true);

  dom.window.document.body.textContent = "Plain English text only.";
  assert.equal(api.pageLooksLuxembourgish(), true);

  api.markLanguageHeuristicDirty();
  assert.equal(api.pageLooksLuxembourgish(), false);
});

test("selection trigger always asks the background to open the lens runtime", async () => {
  const overlayCalls = [];
  const { dom, sentMessages } = loadSelectionTrigger({
    html: "<!doctype html><html><body>Dëst ass eng Säit.</body></html>",
    overlay: {
      async openFromSelection(text) {
        overlayCalls.push(text);
      }
    }
  });

  dom.window.getSelection = () => ({
    rangeCount: 1,
    isCollapsed: false,
    toString: () => "Dëst ass gutt",
    getRangeAt: () => ({
      getBoundingClientRect: () => ({ top: 20, left: 30, bottom: 40, width: 50, height: 16 })
    })
  });

  dom.window.document.dispatchEvent(new dom.window.Event("mouseup", { bubbles: true }));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

  const button = dom.window.document.getElementById("lodvault-selection-trigger");
  assert.ok(button, "expected the floating trigger button to be created");

  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

  assert.deepEqual(overlayCalls, []);
  assert.deepEqual(sentMessages, [{
    type: "lodvault:open-lens-overlay",
    selectionText: "Dëst ass gutt"
  }]);
});
