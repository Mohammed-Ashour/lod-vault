// dev-screenshots.mjs — capture README screenshots of the Blue Night redesign.
//
// Launches headless Chrome, injects a chrome.* stub with seeded vault data,
// loads the REAL extension pages (popup / flashcards / vault), and captures
// dark + light screenshots into docs/screenshots/.
//
// Usage: node scripts/dev-screenshots.mjs
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "docs", "screenshots");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9333;
const httpPort = 9444;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── tiny static file server (http origin so blob iframes stay same-origin) ──
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".mjs": "text/javascript" };
async function startServer(port) {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const rel = urlPath === "/" ? "README.md" : urlPath.replace(/^\/+/, "");
      const file = path.join(root, rel);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      const body = await readFile(file);
      const headers = { "content-type": MIME[path.extname(file)] || "application/octet-stream" };
      if (path.extname(file) === ".html") headers["content-security-policy"] = "script-src 'self'";
      res.writeHead(200, headers);
      res.end(body);
    } catch {
      res.writeHead(404); res.end("not found");
    }
  });
  await new Promise((r) => server.listen(port, r));
  return server;
}


function getJSON(url, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve(JSON.parse(d)));
    });
    req.on("error", reject);
    req.end();
  });
}

const now = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const hoursFromNow = (h) => new Date(Date.now() + h * 36e5).toISOString();

import { stubSource } from "./screenshot-stub.mjs";

// ── CDP plumbing ────────────────────────────────────────────────
let msgId = 0;
function makeSender(ws) {
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    const handler = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) {
        ws.removeEventListener("message", handler);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function shoot(send, file, viewport) {
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  writeFileSync(path.join(outDir, file), Buffer.from(shot.data, "base64"));
  console.log("  saved", file);
}

async function capturePage(tab, pageUrl, shots) {
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const send = makeSender(ws);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: stubSource });
  await send("Emulation.setDeviceMetricsOverride", {
    width: shots.width, height: shots.height, deviceScaleFactor: 2, mobile: false
  });
  await send("Page.navigate", { url: pageUrl });
  await sleep(2600);
  for (const [name, theme] of [["dark", "dark"], ["light", "light"]]) {
    if (theme === "light") {
      await send("Runtime.evaluate", { expression: `document.querySelector(".theme-btn")?.click()` });
      await sleep(600);
    }
    if (shots.reveal) {
      await send("Runtime.evaluate", { expression: `if (!document.getElementById('flashcard')?.classList.contains('is-revealed')) document.getElementById('flip-card')?.click()` });
      await sleep(600);
    }
    await shoot(send, shots[name], shots);
    // popup also captures the Stats & data tab (dark + light)
    if (shots.stats) {
      await send("Runtime.evaluate", { expression: `document.querySelector('.popup-tab[data-pane="stats"]')?.click()` });
      await sleep(400);
      await shoot(send, shots.stats[name], shots);
      await send("Runtime.evaluate", { expression: `document.querySelector('.popup-tab[data-pane="words"]')?.click()` });
      await sleep(300);
    }
  }
  await send("Emulation.clearDeviceMetricsOverride").catch(() => {});
  ws.close();
}

(async () => {
  mkdirSync(outDir, { recursive: true });
  const fileServer = await startServer(httpPort);
  const chrome = spawn(chromePath, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars",
    `--remote-debugging-port=${port}`, "--user-data-dir=/tmp/lodvault-shot-profile", "about:blank"
  ]);
  await sleep(1600);

  const targets = [
    ["popup", `http://127.0.0.1:${httpPort}/pages/popup.html`, { width: 420, height: 680, stats: true }],
    ["flashcards", `http://127.0.0.1:${httpPort}/pages/flashcards.html`, { width: 1280, height: 860, reveal: true }],
    ["vault", `http://127.0.0.1:${httpPort}/pages/preview.html`, { width: 1280, height: 860 }]
  ];

  for (const [name, url, size] of targets) {
    console.log(`capturing ${name}…`);
    const tab = await getJSON(`http://127.0.0.1:${port}/json/new?about:blank`, "PUT").catch(() => null);
    const target = tab || (await getJSON(`http://127.0.0.1:${port}/json/list`))[0];
    await capturePage(target, url, {
      width: size.width, height: size.height,
      dark: `${name}-blue-night.png`, light: `${name}-blue-night-light.png`,
      stats: size.stats ? { dark: `${name}-stats-blue-night.png`, light: `${name}-stats-blue-night-light.png` } : null,
      reveal: size.reveal || false
    });
  }
  fileServer.close();
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
