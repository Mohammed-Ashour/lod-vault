const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

test("the release zip packages every script the pages load", () => {
  const script = fs.readFileSync(path.join(repoRoot, "scripts/build_release_zip.sh"), "utf8");
  const packaged = new Set([...script.matchAll(/scripts\/[\w.-]+\.js/g)].map((match) => match[0]));
  const pages = fs.readdirSync(path.join(repoRoot, "pages")).filter((name) => name.endsWith(".html"));
  const missing = [];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(repoRoot, "pages", page), "utf8");
    for (const match of html.matchAll(/<script src="\.\.\/(scripts\/[\w.-]+\.js)"/g)) {
      if (!packaged.has(match[1])) missing.push(`${page}: ${match[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});
