import { spawn, execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import http from "node:http";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const version = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")).version;
const outputDir = path.join(here, `upload-v${version}`);
const zipPath = path.join(here, `chrome-web-store-assets-v${version}.zip`);
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const debugPort = 9345;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const assets = [
  { html: "01-popup.html", png: "01-popup-1280x800.png", width: 1280, height: 800, kind: "screenshot" },
  { html: "02-lod-banner.html", png: "02-lod-banner-1280x800.png", width: 1280, height: 800, kind: "screenshot" },
  { html: "03-vault.html", png: "03-vault-1280x800.png", width: 1280, height: 800, kind: "screenshot" },
  { html: "04-flashcards.html", png: "04-flashcards-1280x800.png", width: 1280, height: 800, kind: "screenshot" },
  { html: "05-lod-lens.html", png: "05-lod-lens-1280x800.png", width: 1280, height: 800, kind: "screenshot" },
  { html: "promo-small-440x280.html", png: "promo-small-440x280.png", width: 440, height: 280, kind: "small-promo" },
  { html: "promo-marquee-1400x560.html", png: "promo-marquee-1400x560.png", width: 1400, height: 560, kind: "marquee" }
];

function requestJson(url, method = "GET") {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve(JSON.parse(body)));
    });
    request.on("error", reject);
    request.end();
  });
}

function makeSender(socket) {
  let messageId = 0;
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++messageId;
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

function pngDimensions(file) {
  const png = readFileSync(file);
  if (png.toString("ascii", 1, 4) !== "PNG") throw new Error(`${file} is not a PNG`);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function validatePlan() {
  const screenshots = assets.filter((asset) => asset.kind === "screenshot");
  if (screenshots.length < 1 || screenshots.length > 5) {
    throw new Error("Chrome Web Store accepts between one and five screenshots.");
  }
  for (const asset of screenshots) {
    if (asset.width !== 1280 || asset.height !== 800) {
      throw new Error(`${asset.png} must use the preferred 1280×800 screenshot size.`);
    }
  }
}

async function waitForChrome() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await requestJson(`http://127.0.0.1:${debugPort}/json/version`);
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error("Chrome DevTools did not start.");
}

async function renderAssets() {
  validatePlan();
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  const profile = `/tmp/lodvault-webstore-${process.pid}`;
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "about:blank"
  ], { stdio: "ignore" });

  let socket;
  try {
    await waitForChrome();
    const tab = await requestJson(`http://127.0.0.1:${debugPort}/json/new?about:blank`, "PUT");
    socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
    const send = makeSender(socket);
    await send("Page.enable");
    await send("Runtime.enable");

    for (const asset of assets) {
      await send("Emulation.setDeviceMetricsOverride", {
        width: asset.width,
        height: asset.height,
        deviceScaleFactor: 1,
        mobile: false
      });
      await send("Page.navigate", { url: pathToFileURL(path.join(here, asset.html)).href });
      await sleep(300);
      await send("Runtime.evaluate", {
        expression: `Promise.all([document.fonts?.ready, ...Array.from(document.images, image => image.complete ? Promise.resolve() : new Promise(resolve => { image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', resolve, { once: true }); }))])`,
        awaitPromise: true
      });

      const screenshot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
      const target = path.join(outputDir, asset.png);
      writeFileSync(target, Buffer.from(screenshot.data, "base64"));
      const actual = pngDimensions(target);
      if (actual.width !== asset.width || actual.height !== asset.height) {
        throw new Error(`${asset.png}: rendered ${actual.width}×${actual.height}, expected ${asset.width}×${asset.height}`);
      }
      console.log(`✓ ${asset.png} (${actual.width}×${actual.height})`);
    }
  } finally {
    socket?.close();
    chrome.kill("SIGKILL");
    rmSync(profile, { recursive: true, force: true });
  }

  const iconTarget = path.join(outputDir, "icon-128x128.png");
  copyFileSync(path.join(repo, "icons", "icon128.png"), iconTarget);
  const icon = pngDimensions(iconTarget);
  if (icon.width !== 128 || icon.height !== 128) throw new Error("Store icon must be 128×128.");
  console.log("✓ icon-128x128.png (128×128)");

  const screenshotNames = assets.filter((asset) => asset.kind === "screenshot").map((asset) => `- ${asset.png}`).join("\n");
  const uploadOrder = `Chrome Web Store upload set — LODVault v${version}\n\nScreenshots (upload in this order; Chrome accepts up to five):\n${screenshotNames}\n\nListing graphics:\n- promo-small-440x280.png\n- promo-marquee-1400x560.png\n- icon-128x128.png\n`;
  const orderFile = path.join(outputDir, "UPLOAD-ORDER.txt");
  writeFileSync(orderFile, uploadOrder);

  rmSync(zipPath, { force: true });
  execFileSync("zip", ["-q", "-j", zipPath, ...assets.map((asset) => path.join(outputDir, asset.png)), iconTarget, orderFile]);
  console.log(`\nReady: ${path.relative(repo, outputDir)}`);
  console.log(`Bundle: ${path.relative(repo, zipPath)}`);
}

await renderAssets();
