const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const { loadSharedStore } = require("./loaders");

const repoRoot = path.resolve(__dirname, "..", "..");

// Loads pages/stats.html with the real store over in-memory storage and runs
// the page scripts that follow shared.js in the page's own order.
async function loadStatsPage(localData = {}, { permissionGranted = true } = {}) {
  const shared = loadSharedStore(localData);
  const html = fs.readFileSync(path.join(repoRoot, "pages/stats.html"), "utf8");
  const dom = new JSDOM(html, { url: "chrome-extension://test/pages/stats.html", pretendToBeVisual: true });
  const createdTabs = [];
  const permissionRequests = [];
  const chrome = shared.chrome;
  chrome.tabs = { create: ({ url }) => createdTabs.push(url) };
  chrome.runtime = { ...(chrome.runtime || {}), getURL: (relative) => `chrome-extension://test/${relative}` };
  chrome.permissions = {
    async request(details) {
      permissionRequests.push(details);
      return permissionGranted;
    },
    async contains() {
      return permissionGranted;
    }
  };
  const context = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    chrome,
    console,
    Intl,
    Date,
    setTimeout: dom.window.setTimeout.bind(dom.window),
    clearTimeout: dom.window.clearTimeout.bind(dom.window),
    globalThis: null
  };
  context.globalThis = context;
  context.LodVaultStoreCore = shared.store;
  context.LodVaultStore = shared.store;
  const scripts = [...html.matchAll(/<script src="\.\.\/(scripts\/[\w.-]+\.js)"/g)].map((match) => match[1]);
  for (const script of scripts.slice(scripts.indexOf("scripts/shared.js") + 1)) {
    if (script === "scripts/theme.js") continue;
    vm.runInNewContext(fs.readFileSync(path.join(repoRoot, script), "utf8"), context, { filename: script });
  }
  const view = await context.LodVaultStats.init();
  return { dom, view, context, createdTabs, permissionRequests, storageData: shared.storageData };
}

module.exports = { loadStatsPage };
