const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const manifestPath = path.join(__dirname, "..", "manifest.json");
const backgroundBundlePath = path.join(__dirname, "..", "scripts", "background-bundle.js");

test("manifest points to the generated background bundle artifact", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const bundleSource = fs.readFileSync(backgroundBundlePath, "utf8");

  assert.equal(manifest.background?.service_worker, "scripts/background-bundle.js");
  assert.match(bundleSource, /Auto-generated bundle/);
  assert.match(bundleSource, /DO NOT EDIT/);
  assert.match(bundleSource, /generated packaging artifact/);
  assert.match(bundleSource, /Source of truth/);
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
  assert.ok(manifest.optional_host_permissions.includes("http://*/*"));
  assert.ok(manifest.optional_host_permissions.includes("https://*/*"));
  assert.ok(manifest.commands?.["open-lod-lens"]);
});

test("manifest leaves regular web pages free of content scripts until site access is granted", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assert.equal(manifest.content_scripts.length, 1, "only the lod.lu content script should be statically registered");
  assert.deepEqual(manifest.content_scripts[0].matches, [
    "https://lod.lu/*",
    "https://www.lod.lu/*"
  ]);
  assert.ok(manifest.optional_host_permissions.includes("http://*/*"));
  assert.ok(manifest.optional_host_permissions.includes("https://*/*"));
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

test("manifest declares Firefox data-collection and background compatibility", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const gecko = manifest.browser_specific_settings?.gecko;

  assert.ok(gecko?.id, "gecko id is required for Firefox MV3");
  assert.deepEqual(gecko?.data_collection_permissions?.required, ["none"], "local-first policy: no data is collected");
  assert.deepEqual(gecko?.data_collection_permissions?.optional, []);
  assert.deepEqual(manifest.background?.scripts, ["scripts/background-bundle.js"], "Firefox background fallback");
});
