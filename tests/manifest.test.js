const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const manifestPath = path.join(__dirname, "..", "manifest.json");

test("manifest injects content scripts on all lod.lu pages for SPA navigation", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const contentScript = manifest.content_scripts?.[0];

  assert.ok(contentScript, "first content script block should exist");
  assert.deepEqual(contentScript.matches, [
    "https://lod.lu/*",
    "https://www.lod.lu/*"
  ]);
});
