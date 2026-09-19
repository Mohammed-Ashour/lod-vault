const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const repoRoot = path.resolve(__dirname, "..");

function loadTheme({ savedTheme = null, bodyBackground = "#0b1520" } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><body style="background:${bodyBackground}"><button type="button" class="theme-btn">☀</button></body></html>`,
    { url: "https://extension.test/pages/popup.html", pretendToBeVisual: true }
  );

  if (savedTheme) dom.window.localStorage.setItem("blueNightTheme", savedTheme);

  const context = {
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    customElements: dom.window.customElements,
    console,
    setTimeout: dom.window.setTimeout.bind(dom.window),
    globalThis: null
  };
  context.globalThis = context;

  vm.runInNewContext(
    fs.readFileSync(path.join(repoRoot, "scripts/theme-init.js"), "utf8"),
    context,
    { filename: "scripts/theme-init.js" }
  );
  vm.runInNewContext(
    fs.readFileSync(path.join(repoRoot, "scripts/theme.js"), "utf8"),
    context,
    { filename: "scripts/theme.js" }
  );

  const nextFrame = () =>
    new Promise((resolve) => dom.window.requestAnimationFrame(() => dom.window.requestAnimationFrame(resolve)));

  return { dom, nextFrame };
}

test("theme swap suppresses transitions for one paint and fades with the old palette", async () => {
  const { dom, nextFrame } = loadTheme();
  const { document, localStorage } = dom.window;
  const root = document.documentElement;

  assert.equal(root.classList.contains("light"), false, "defaults to dark");
  assert.equal(document.querySelector(".theme-btn").textContent, "☀");

  document.querySelector(".theme-btn").click();

  // Synchronous swap: palette flipped, transitions guarded off, fade in place.
  assert.equal(root.classList.contains("theme-switching"), true, "transitions are suppressed during the swap");
  assert.equal(root.classList.contains("light"), true, "palette flipped in the same task");
  const overlay = document.querySelector(".theme-fade");
  assert.ok(overlay, "old palette is painted on a fading overlay");
  assert.equal(overlay.style.background, "rgb(11, 21, 32)");
  assert.equal(localStorage.getItem("blueNightTheme"), "light");
  assert.equal(document.querySelector(".theme-btn").textContent, "☾");
  assert.equal(document.querySelector(".theme-btn").getAttribute("aria-label"), "Switch to dark");

  await nextFrame();
  assert.equal(root.classList.contains("theme-switching"), false, "guard is lifted after the swap paint");

  overlay.dispatchEvent(new dom.window.Event("animationend"));
  assert.equal(document.querySelector(".theme-fade"), null, "overlay is removed when the fade ends");
});

test("restoring the saved theme on load does not flash a transition guard", () => {
  const { dom } = loadTheme({ savedTheme: "light" });
  const root = dom.window.document.documentElement;

  assert.equal(root.classList.contains("light"), true);
  assert.equal(root.classList.contains("theme-switching"), false);
  assert.equal(dom.window.document.querySelector(".theme-fade"), null);
  assert.equal(dom.window.document.querySelector(".theme-btn").getAttribute("aria-label"), "Switch to dark");
});

test("toggling back to dark reuses the swap and replaces a pending fade", async () => {
  const { dom, nextFrame } = loadTheme();
  const { document } = dom.window;
  const button = document.querySelector(".theme-btn");

  button.click();
  const firstFade = document.querySelector(".theme-fade");
  await nextFrame();

  button.click();
  assert.equal(document.documentElement.classList.contains("light"), false);
  const secondFade = document.querySelector(".theme-fade");
  assert.ok(secondFade && secondFade !== firstFade, "a fresh overlay covers the previous one");
  assert.equal(firstFade.isConnected, false, "the previous overlay is detached");
  assert.equal(dom.window.localStorage.getItem("blueNightTheme"), "dark");

  await nextFrame();
  assert.equal(document.documentElement.classList.contains("theme-switching"), false);
});
