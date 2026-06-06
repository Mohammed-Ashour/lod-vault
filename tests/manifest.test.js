const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const manifestPath = path.join(__dirname, "..", "manifest.json");
const backgroundBundlePath = path.join(__dirname, "..", "scripts", "background-bundle.js");

test("manifest points to a checked-in background bundle", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const bundleSource = fs.readFileSync(backgroundBundlePath, "utf8");

  assert.equal(manifest.background?.service_worker, "scripts/background-bundle.js");
  assert.match(bundleSource, /background-impl\.js/);
});

test("manifest injects content scripts on all lod.lu pages for SPA navigation", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const contentScript = manifest.content_scripts?.[0];

  assert.ok(contentScript, "first content script block should exist");
  assert.deepEqual(contentScript.matches, [
    "https://lod.lu/*",
    "https://www.lod.lu/*"
  ]);
});

test("manifest exposes permissions needed for LOD Lens MVP", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assert.ok(manifest.permissions.includes("contextMenus"));
  assert.ok(manifest.permissions.includes("activeTab"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.host_permissions.includes("https://lod.lu/api/*"));
  assert.ok(manifest.commands?.["open-lod-lens"]);
});

test("manifest injects the lightweight selection trigger on regular web pages", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const contentScript = manifest.content_scripts?.[1];

  assert.ok(contentScript, "second content script block should exist");
  assert.deepEqual(contentScript.matches, [
    "http://*/*",
    "https://*/*"
  ]);
  assert.deepEqual(contentScript.exclude_matches, [
    "https://lod.lu/*",
    "https://www.lod.lu/*"
  ]);
  assert.ok(contentScript.js.includes("scripts/store-core.js"));
  assert.ok(contentScript.js.includes("scripts/entry-presenter.js"));
  assert.ok(contentScript.js.includes("scripts/shared.js"));
  assert.ok(contentScript.js.includes("scripts/lens-lookup.js"));
  assert.ok(contentScript.js.includes("scripts/lens-overlay.js"));
  assert.ok(contentScript.js.includes("scripts/selection-trigger.js"));
  assert.ok(contentScript.css.includes("styles/lens-overlay.css"));
});

test("manifest exposes the floating trigger logo as a web-accessible resource", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const resourceBlock = manifest.web_accessible_resources?.find((entry) => entry.resources?.includes("icons/icon32.png"));

  assert.ok(resourceBlock);
  assert.deepEqual(resourceBlock.matches, [
    "http://*/*",
    "https://*/*"
  ]);
});
