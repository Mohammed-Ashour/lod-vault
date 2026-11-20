// record-flow.mjs — screenshots and GIFs of UI flows for pull requests.
//
// Serves the repo over http, starts headless Chromium, injects the chrome.*
// stub from screenshot-stub.mjs (plus any extra seed a flow adds), and runs a
// flow module that drives the page over CDP. Frames become GIFs with ffmpeg.
//
// Usage:
//   CHROME_PATH=/usr/bin/chromium node scripts/record-flow.mjs <flow.mjs> <out-dir>
//
// A flow module exports `default` as a list of scenes:
//   { name, url: "/pages/popup.html", width, height, theme: "dark"|"light",
//     seed: { local: {...} },             // merged over the stub's seed
//     run: async (page) => { ... } }
// `page` offers eval(expr), click(selector), type(selector, text), key(key),
// wait(ms), shot(file, selector?), and gif(file, async (rec) => { rec.hold(ms) ... }).
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { seed as baseSeed } from "./screenshot-stub.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromePath = process.env.CHROME_PATH || "chromium";
const debugPort = Number(process.env.RECORD_DEBUG_PORT) || 9361;
const httpPort = Number(process.env.RECORD_HTTP_PORT) || 9462;
const FRAME_MS = 125;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml"
};

async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const file = path.join(root, urlPath.replace(/^\/+/, ""));
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(httpPort, "127.0.0.1", resolve));
  return server;
}

function getJSON(url, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// The stub from screenshot-stub.mjs, with the flow's seed merged in and a
// storage.onChanged that actually fires, so pages react to their own writes.
function stubFor(seed) {
  const merged = {
    local: { ...baseSeed.local, ...(seed?.local || {}) },
    sync: { ...baseSeed.sync, ...(seed?.sync || {}) }
  };
  return `
(() => {
  const seed = ${JSON.stringify(merged)};
  const store = { local: { ...seed.local }, sync: { ...seed.sync } };
  const listeners = new Set();
  const keyed = (keys, area) => Promise.resolve(keys == null
    ? { ...area }
    : [].concat(keys).reduce((out, k) => { if (k in area) out[k] = area[k]; return out; }, {}));
  const area = (name) => ({
    get: (keys) => keyed(keys, store[name]),
    getBytesInUse: () => Promise.resolve(JSON.stringify(store[name]).length),
    set: (items) => {
      const changes = {};
      for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: store[name][k], newValue: v }; store[name][k] = v; }
      setTimeout(() => listeners.forEach((fn) => fn(changes, name)), 0);
      return Promise.resolve();
    },
    remove: (keys) => { for (const k of [].concat(keys)) delete store[name][k]; return Promise.resolve(); }
  });
  window.__recordStore = store;
  window.chrome = {
    storage: { local: area("local"), sync: area("sync"), onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) } },
    tabs: {
      query: () => Promise.resolve([{ id: 7, url: "https://lod.lu/artikel/HAUS1", active: true, windowId: 1 }]),
      sendMessage: () => Promise.resolve({ entry: { id: "HAUS1", word: "Haus", url: "https://lod.lu/artikel/HAUS1" } }),
      create: () => Promise.resolve({}),
      onActivated: { addListener() {} },
      onUpdated: { addListener() {} }
    },
    runtime: { id: "record", getURL: (p) => p, onMessage: { addListener() {} } }
  };
  // Audio can't play headless; pretend it did.
  HTMLMediaElement.prototype.play = function () { this.dispatchEvent(new Event("play")); return Promise.resolve(); };
})();
`;
}

let messageId = 0;
function makeSender(ws) {
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++messageId;
    const handler = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener("message", handler);
      if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
      else resolve(message.result);
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function makePage(send, outDir, scene) {
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(`${scene.name}: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
    }
    return result.result?.value;
  }

  async function clipFor(selector) {
    if (!selector) return undefined;
    const rect = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: r.height + 16 };
    })()`);
    if (!rect) throw new Error(`${scene.name}: nothing matches ${selector}`);
    return { ...rect, scale: 1 };
  }

  async function capture(clip) {
    const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, ...(clip ? { clip } : {}) });
    return Buffer.from(shot.data, "base64");
  }

  return {
    eval: evaluate,
    wait: sleep,
    async click(selector) {
      const found = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
      if (!found) throw new Error(`${scene.name}: cannot click ${selector}`);
    },
    async type(selector, text) {
      await evaluate(`document.querySelector(${JSON.stringify(selector)})?.focus()`);
      for (const char of text) {
        await send("Input.insertText", { text: char });
        await sleep(70);
      }
    },
    async key(key, code = key) {
      const text = key.length === 1 ? key : key === "Enter" ? "\r" : undefined;
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, text, windowsVirtualKeyCode: key === "Enter" ? 13 : key.toUpperCase().charCodeAt(0) });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: key === "Enter" ? 13 : key.toUpperCase().charCodeAt(0) });
    },
    async shot(file, selector) {
      writeFileSync(path.join(outDir, file), await capture(await clipFor(selector)));
      console.log("  saved", file);
    },
    // Records frames while `script` runs, then encodes a GIF. rec.hold(ms)
    // keeps the current state on screen; every page action in between is
    // captured as it happens.
    async gif(file, script, { selector, width = 800 } = {}) {
      const frameDir = mkdtempSync(path.join(os.tmpdir(), "lodvault-frames-"));
      let count = 0;
      let recording = true;
      const clip = await clipFor(selector);
      const loop = (async () => {
        while (recording) {
          const started = Date.now();
          writeFileSync(path.join(frameDir, `frame-${String(count++).padStart(4, "0")}.png`), await capture(clip));
          await sleep(Math.max(0, FRAME_MS - (Date.now() - started)));
        }
      })();
      await script({ hold: sleep });
      await sleep(FRAME_MS * 2);
      recording = false;
      await loop;
      const out = path.join(outDir, file);
      const result = spawnSync("ffmpeg", [
        "-y", "-loglevel", "error", "-framerate", String(1000 / FRAME_MS), "-i", path.join(frameDir, "frame-%04d.png"),
        "-vf", `scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`,
        out
      ], { stdio: "inherit" });
      rmSync(frameDir, { recursive: true, force: true });
      if (result.status !== 0) throw new Error(`ffmpeg failed for ${file}`);
      const sizeMb = statSync(out).size / 1024 / 1024;
      console.log(`  saved ${file} (${count} frames, ${sizeMb.toFixed(2)} MB)`);
      if (sizeMb > 5) console.warn(`  WARNING: ${file} is over 5 MB`);
    }
  };
}

async function runScene(scene, outDir) {
  const tab = await getJSON(`http://127.0.0.1:${debugPort}/json/new?about:blank`, "PUT");
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve));
  const send = makeSender(ws);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try { localStorage.setItem("blueNightTheme", ${JSON.stringify(scene.theme || "dark")}); } catch {}`
  });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: stubFor(scene.seed) });
  await send("Emulation.setDeviceMetricsOverride", {
    width: scene.width || 1000, height: scene.height || 760, deviceScaleFactor: scene.scale || 1, mobile: false
  });
  await send("Page.navigate", { url: `http://127.0.0.1:${httpPort}${scene.url}` });
  await sleep(scene.settle ?? 1500);
  console.log(`scene ${scene.name}`);
  await scene.run(makePage(send, outDir, scene));
  ws.close();
  await getJSON(`http://127.0.0.1:${debugPort}/json/close/${tab.id}`).catch(() => {});
}

async function main() {
  const [flowPath, outArg] = process.argv.slice(2);
  if (!flowPath || !outArg) {
    console.error("Usage: node scripts/record-flow.mjs <flow.mjs> <out-dir>");
    process.exit(2);
  }
  const outDir = path.resolve(outArg);
  mkdirSync(outDir, { recursive: true });
  const scenes = (await import(pathToFileURL(path.resolve(flowPath)).href)).default;
  const only = process.env.RECORD_ONLY ? new Set(process.env.RECORD_ONLY.split(",")) : null;

  const server = await startServer();
  const profile = mkdtempSync(path.join(os.tmpdir(), "lodvault-record-"));
  const chrome = spawn(chromePath, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--autoplay-policy=no-user-gesture-required",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank"
  ], { stdio: "ignore" });
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { await getJSON(`http://127.0.0.1:${debugPort}/json/version`); break; } catch { await sleep(250); }
    }
    for (const scene of scenes) {
      if (only && !only.has(scene.name)) continue;
      await runScene(scene, outDir);
    }
  } finally {
    server.close();
    chrome.kill();
    await sleep(500);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  console.log(readdirSync(outDir).join("\n"));
  process.exit(0);
}

main().catch((error) => {
  console.error("FAIL:", error.message);
  process.exit(1);
});
