#!/usr/bin/env node
// Builds scripts/background-bundle.js by concatenating all IIFE dependencies
// followed by the background service-worker logic. This avoids importScripts(),
// which is unreliable in Manifest V3 service workers (crbug.com/1271154).

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptsDir = resolve(__dirname);

const IIFE_SCRIPTS = [
  "store-core.js",
  "note-autosave.js",
  "entry-presenter.js",
  "shared.js",
  "lod-article.js",
  "compress.js",
  "sync.js",
  "sync-coordinator.js",
];

const BANNER = `// Auto-generated bundle — DO NOT EDIT.
// Run: node scripts/build-background.mjs
// Policy: this file is a generated packaging artifact checked in for extension loading/release builds.
// Source of truth: scripts/build-background.mjs + scripts/background-impl.js + listed dependencies below.
// Source files (in order):
${IIFE_SCRIPTS.map((f) => `//   ${f}`).join("\n")}
//   background-impl.js
`;

const parts = [BANNER, "\nglobalThis.__LOD_VAULT_DIRECT_STORE__ = true;\n"];

for (const name of IIFE_SCRIPTS) {
  const path = resolve(scriptsDir, name);
  const contents = readFileSync(path, "utf8");
  parts.push(`\n// ── ${name} ──────────────────────────────────────────────\n`);
  parts.push(contents);
  parts.push("\n");
}

const implPath = resolve(scriptsDir, "background-impl.js");
parts.push(`\n// ── background-impl.js ───────────────────────────────────\n`);
parts.push(readFileSync(implPath, "utf8"));
parts.push("\n");

const outPath = resolve(scriptsDir, "background-bundle.js");
writeFileSync(outPath, parts.join(""), "utf8");
console.log(`Built ${outPath}`);