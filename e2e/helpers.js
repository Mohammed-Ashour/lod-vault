// Playwright fixtures for loading LODVault into Chrome.
//
// Chrome has native Playwright extension support: launchPersistentContext with
// --load-extension and channel:'chromium' (headless-capable). The extension id
// is read from the service worker URL.
//
// Firefox has NO native Playwright extension loading; the workaround libraries
// (playwright-webextext via Firefox's remote-debug protocol) proved flaky in
// practice (about:debugging navigation hangs). Firefox is instead gated by
// `web-ext lint` (see package.json `lint` + .github/workflows). The shared JS
// these tests exercise (import.js, the content script) is browser-agnostic, so
// the Chrome suite guards the logic that broke twice in Firefox too.

const path = require("node:path");
const fs = require("node:fs");
const { test: base, chromium } = require("@playwright/test");
const { expect } = require("@playwright/test");

const REPO_ROOT = path.resolve(__dirname, "..");
const CHROME_BUILD = path.join(REPO_ROOT, "dist", "chrome");
const EXPORT_FIXTURE = path.join(__dirname, "fixtures", "lodvault-export.json");
const LOD_ARTICLE_FIXTURE = fs.readFileSync(
  path.join(__dirname, "fixtures", "lod-article.html"),
  "utf8"
);

function assertBuilt() {
  if (!fs.existsSync(path.join(CHROME_BUILD, "manifest.json"))) {
    throw new Error(
      `Extension build not found at ${CHROME_BUILD}. Run "npm run build" before "npm run test:e2e".`
    );
  }
}

/** Intercept https://lod.lu/artikel/<id> and fulfill with the fixture article. */
async function routeLodArticle(page) {
  await page.route("**/artikel/*", (route) => {
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: LOD_ARTICLE_FIXTURE
    });
  });
}

async function launchChrome() {
  assertBuilt();
  const userDataDir = path.join(REPO_ROOT, ".playwright", "chrome-profile");
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${CHROME_BUILD}`,
      `--load-extension=${CHROME_BUILD}`,
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });

  // Extract the extension id from the service worker URL:
  // chrome-extension://<id>/scripts/background-bundle.js
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  }
  const baseUrl = serviceWorker.url().split("/").slice(0, 3).join("/");

  return { context, baseUrl };
}

const test = base.extend({
  context: async ({}, use) => {
    const { context, baseUrl } = await launchChrome();
    context._lodvaultBaseUrl = baseUrl;
    await use(context);
    await context.close();
  },
  extensionBaseUrl: async ({ context }, use) => {
    await use(context._lodvaultBaseUrl);
  }
});

module.exports = {
  test,
  expect,
  routeLodArticle,
  EXPORT_FIXTURE,
  REPO_ROOT
};
