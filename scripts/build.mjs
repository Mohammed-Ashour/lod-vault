#!/usr/bin/env node
/**
 * LODVault — unified cross-browser build.
 *
 * Produces per-browser packages under dist/:
 *   - dist/chrome/        → Chrome MV3 (service_worker background)
 *   - dist/firefox/       → Firefox MV3 (event-page background + gecko id)
 *   - dist/lodvault-v{version}-chrome.zip
 *   - dist/lodvault-v{version}-firefox.zip
 *
 * The single manifest.json is the source of truth; per-browser manifests are
 * derived from it so version/permissions/content-scripts never drift.
 *
 * Requires the system `zip` binary (present on macOS, Linux, and ubuntu-latest
 * on GitHub Actions). No npm dependencies.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Stable Firefox add-on ID. Generated once; must never change after AMO
// submission (changing it creates a new add-on). Braced UUID form.
const FIREFOX_GECKO_ID = "{6c66d4c8-260a-4a87-20e5-8add8fa39c94}";
// Floor: Firefox 128 (ESR, 2024-06) is the first release with full MV3
// optional_host_permissions support, which the Lens site-access flow relies on.
const FIREFOX_STRICT_MIN_VERSION = "128.0";

// Source scripts that are NOT shipped (they are build inputs, not runtime):
// background.js uses importScripts (Chrome-SW only); background-impl.js is
// concatenated into background-bundle.js by build-background.mjs.
const EXCLUDED_SCRIPTS = new Set(["background.js", "background-impl.js"]);

const STATIC_DIRS = ["icons", "pages", "styles"];

function run(args, opts) {
  return execFileSync(args[0], args.slice(1), { stdio: "inherit", ...opts });
}

/** Ship every scripts/*.js except the build-only sources. */
function listShipScripts() {
  return readdirSync(join(ROOT, "scripts"))
    .filter((name) => name.endsWith(".js") && !EXCLUDED_SCRIPTS.has(name))
    .sort();
}

/** Read + parse the source manifest. */
function readManifest() {
  return JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
}

/** Chrome manifest = source manifest verbatim. */
function manifestForChrome(source) {
  return source;
}

/**
 * Firefox MV3 differences:
 *   - drop `key` (Chrome-Web-Store public key; Firefox rejects it)
 *   - background: event-page `scripts` instead of `service_worker`
 *     (Firefox does not support extension background service workers)
 *   - add browser_specific_settings.gecko (required add-on ID for AMO)
 */
function manifestForFirefox(source) {
  const next = { ...source };
  delete next.key;

  next.background = {
    scripts: [source.background.service_worker]
  };

  next.browser_specific_settings = {
    gecko: {
      id: FIREFOX_GECKO_ID,
      strict_min_version: FIREFOX_STRICT_MIN_VERSION
    }
  };

  return next;
}

function ensureZipAvailable() {
  try {
    // `zip -v` prints version info to stdout and exits 0.
    execFileSync("zip", ["-v"], { stdio: "ignore" });
  } catch {
    throw new Error(
      "The 'zip' binary is required to build release archives but was not found on PATH.\n" +
        "Install it (e.g. `apt-get install zip` on Debian/Ubuntu, or use a macOS/Linux runner)."
    );
  }
}

function stageBrowser({ browser, manifest, version }) {
  const stage = join(ROOT, "dist", browser);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, "scripts"), { recursive: true });

  writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  for (const dir of STATIC_DIRS) {
    cpSync(join(ROOT, dir), join(stage, dir), { recursive: true });
  }

  for (const name of listShipScripts()) {
    cpSync(join(ROOT, "scripts", name), join(stage, "scripts", name));
  }

  const outZip = join(ROOT, "dist", `lodvault-v${version}-${browser}.zip`);
  rmSync(outZip, { force: true });
  // Zip from inside the stage dir so paths are relative (manifest.json at zip root).
  execFileSync("zip", ["-qr", outZip, "."], { cwd: stage, stdio: "ignore" });
  return { browser, stage, outZip, bytes: statSync(outZip).size };
}

function main() {
  ensureZipAvailable();

  // 1. Regenerate the concatenated background bundle from its sources.
  run(["node", "scripts/build-background.mjs"]);

  const sourceManifest = readManifest();
  const version = sourceManifest.version;

  // 2. Reset dist/.
  const dist = join(ROOT, "dist");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  // 3. Stage + zip each browser.
  const results = [
    { browser: "chrome", manifest: manifestForChrome(sourceManifest), version },
    { browser: "firefox", manifest: manifestForFirefox(sourceManifest), version }
  ].map((entry) => stageBrowser(entry));


  for (const { browser, outZip, bytes } of results) {
    console.log(`built ${browser}: ${outZip} (${(bytes / 1024).toFixed(1)} KiB)`);
  }
}

main();
