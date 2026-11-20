#!/usr/bin/env node
// record-flow.mjs — record PR screenshots and GIFs of real extension pages.
//
// Serves the repo over http, opens the page in headless Chromium with a
// chrome.* stub over in-memory storage (onChanged fires like the real thing,
// fixtures only), drives it over CDP, captures frames and builds a GIF with
// ffmpeg. Flows live in scripts/record-flows.mjs.
//
// Usage:
//   CHROME_PATH=/usr/bin/chromium node scripts/record-flow.mjs <flow> [<flow>…] [--out dir] [--root repo]
//   node scripts/record-flow.mjs --list
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { createServer, request } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args.splice(index, 2)[1] : fallback;
};
const root = path.resolve(option("--root", path.resolve(here, "..")));
const outDir = path.resolve(option("--out", path.join(root, "dist", "pr-media")));
const chromePath = process.env.CHROME_PATH || "/usr/bin/chromium";
const debugPort = 9335;
const httpPort = 9446;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
      const file = path.join(root, rel);
      if (!file.startsWith(root)) throw new Error("outside root");
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(httpPort, resolve));
  return server;
}

function http(url, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = request(url, { method }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on("error", reject);
    req.end();
  });
}

// In-memory chrome.* with storage events, tabs and permissions that record
// what the page asked for. `options.permission` decides permission prompts.
export function buildStub(seed, options = {}) {
  return `
(() => {
  const seed = ${JSON.stringify(seed)};
  const options = ${JSON.stringify(options)};
  const areas = { local: structuredClone(seed.local || {}), sync: structuredClone(seed.sync || {}) };
  const listeners = new Set();
  const event = () => ({ addListener() {}, removeListener() {} });
  const keyed = (keys, area) => Promise.resolve(keys == null
    ? structuredClone(area)
    : [].concat(keys).reduce((out, key) => { if (key in area) out[key] = structuredClone(area[key]); return out; }, {}));
  const emit = (changes, name) => setTimeout(() => listeners.forEach((fn) => fn(changes, name)), 0);
  const makeArea = (name) => ({
    get: (keys) => keyed(keys, areas[name]),
    set: (items) => {
      const changes = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: areas[name][key], newValue: structuredClone(value) };
        areas[name][key] = structuredClone(value);
      }
      emit(changes, name);
      return Promise.resolve();
    },
    remove: (keys) => {
      const changes = {};
      for (const key of [].concat(keys)) { changes[key] = { oldValue: areas[name][key] }; delete areas[name][key]; }
      emit(changes, name);
      return Promise.resolve();
    },
    getBytesInUse: () => Promise.resolve(JSON.stringify(areas[name]).length)
  });
  window.__recorder = { areas, opened: [], permissionRequests: [], options };
  window.chrome = {
    storage: { local: makeArea("local"), sync: makeArea("sync"), onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) } },
    tabs: {
      query: () => Promise.resolve([{ id: 7, url: "https://lod.lu/artikel/HAUS1", active: true, windowId: 1 }]),
      sendMessage: () => Promise.resolve({}),
      create: ({ url }) => { window.__recorder.opened.push(url); return Promise.resolve({}); },
      onActivated: event(),
      onUpdated: event()
    },
    runtime: { getURL: (p) => "/" + p, onMessage: event(), id: "recorder" },
    permissions: {
      request: (details) => {
        window.__recorder.permissionRequests.push(details);
        const live = window.__recorder.options;
        return new Promise((resolve) => setTimeout(() => resolve(live.permission !== "deny"), live.permissionDelayMs || 0));
      },
      contains: () => Promise.resolve(window.__recorder.options.permission !== "deny"),
      onAdded: event(),
      onRemoved: event()
    }
  };
  try { localStorage.setItem("blueNightTheme", options.theme === "light" ? "light" : "dark"); } catch {}
})();`;
}

// Marks a click on screen, since headless capture shows no pointer.
const CLICK_MARK = `
window.__markClick = (el) => {
  const rect = el.getBoundingClientRect();
  const dot = document.createElement("div");
  dot.style.cssText = "position:fixed;z-index:99999;pointer-events:none;width:28px;height:28px;border-radius:50%;"
    + "border:3px solid #f7b538;background:rgba(247,181,56,.25);transition:transform .45s,opacity .45s;"
    + "left:" + (rect.left + rect.width / 2 - 14) + "px;top:" + (rect.top + rect.height / 2 - 14) + "px";
  document.body.appendChild(dot);
  requestAnimationFrame(() => { dot.style.transform = "scale(1.6)"; dot.style.opacity = "0"; });
  setTimeout(() => dot.remove(), 600);
};`;

let messageId = 0;
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++messageId;
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener("message", onMessage);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
  return new Promise((resolve) => ws.addEventListener("open", () => resolve({ ws, send })));
}

async function evaluate(send, expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(`${expression}\n${JSON.stringify(result.exceptionDetails)}`);
  return result.result?.value;
}

async function runFlow(name, flow) {
  const dir = path.join(outDir, `.frames-${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tab = await http(`http://127.0.0.1:${debugPort}/json/new?about:blank`, "PUT");
  const { ws, send } = await connect(tab.webSocketDebuggerUrl);
  await send("Page.enable");
  await send("Runtime.enable");
  const width = flow.width || 1100;
  const height = flow.height || 800;
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: buildStub(flow.seed(), flow.stubOptions || {}) });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: CLICK_MARK });
  await send("Page.navigate", { url: `http://127.0.0.1:${httpPort}/${flow.page}` });
  await sleep(flow.loadMs || 1500);

  let recording = Boolean(flow.gif);
  let paused = false;
  let frame = 0;
  const frameMs = 1000 / (flow.fps || 8);
  const capture = (async () => {
    while (recording) {
      const started = Date.now();
      if (paused) {
        await sleep(20);
        continue;
      }
      const shot = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(path.join(dir, `frame-${String(frame++).padStart(4, "0")}.png`), Buffer.from(shot.data, "base64"));
      await sleep(Math.max(0, frameMs - (Date.now() - started)));
    }
  })();

  const api = {
    send,
    sleep,
    eval: (expression) => evaluate(send, expression),
    async click(selector, pauseMs = 700) {
      await evaluate(send, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("missing ${selector}"); el.scrollIntoView({ block: "nearest" }); window.__markClick(el); el.click(); })()`);
      await sleep(pauseMs);
    },
    async key(key, pauseMs = 600) {
      const code = key === " " ? "Space" : key.length === 1 ? (/\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`) : key;
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, text: key.length === 1 ? key : undefined });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
      await sleep(pauseMs);
    },
    async type(selector, text, pauseMs = 500) {
      await evaluate(send, `document.querySelector(${JSON.stringify(selector)}).focus()`);
      for (const char of text) {
        await send("Input.insertText", { text: char });
        await sleep(45);
      }
      await sleep(pauseMs);
    },
    async scrollTo(selector, pauseMs = 700) {
      await evaluate(send, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: "start", behavior: "smooth" })`);
      await sleep(pauseMs);
    },
    async shot(file, selector = null) {
      // Stills don't go into the GIF: a clipped capture briefly changes what
      // the next frame sees.
      paused = true;
      await sleep(frameMs + 20);
      const params = { format: "png" };
      if (selector) {
        // Clip inside the viewport, so the recording underneath isn't resized.
        const box = await evaluate(send, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: Math.min(r.height, innerHeight) }; })()`);
        params.clip = { ...box, scale: 1 };
      }
      const shot = await send("Page.captureScreenshot", params);
      writeFileSync(path.join(outDir, file), Buffer.from(shot.data, "base64"));
      console.log(`  saved ${file}`);
      await send("Page.captureScreenshot", { format: "png" });
      paused = false;
    }
  };

  await flow.run(api);
  recording = false;
  await capture;
  ws.close();
  await http(`http://127.0.0.1:${debugPort}/json/close/${tab.id}`).catch(() => {});

  if (flow.gif && frame) {
    const gif = path.join(outDir, flow.gif);
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error", "-framerate", String(flow.fps || 8), "-i", path.join(dir, "frame-%04d.png"),
      "-vf", `scale=${Math.min(800, width)}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
      gif
    ]);
    console.log(`  saved ${flow.gif} (${frame} frames)`);
  }
  rmSync(dir, { recursive: true, force: true });
}

(async () => {
  const { flows } = await import(pathToFileURL(path.join(here, "record-flows.mjs")).href);
  if (args.includes("--list") || !args.length) {
    console.log(Object.keys(flows).join("\n"));
    return;
  }
  mkdirSync(outDir, { recursive: true });
  const server = await startServer();
  const chrome = spawn(chromePath, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/lodvault-record-${process.pid}`, "about:blank"
  ], { stdio: "ignore" });
  try {
    for (let tries = 0; tries < 40; tries += 1) {
      try { await http(`http://127.0.0.1:${debugPort}/json/version`); break; } catch { await sleep(250); }
    }
    for (const name of args) {
      if (!flows[name]) throw new Error(`Unknown flow ${name}`);
      console.log(`recording ${name}…`);
      await runFlow(name, flows[name]);
    }
  } finally {
    server.close();
    chrome.kill();
  }
  console.log(readdirSync(outDir).filter((file) => !file.startsWith(".")).join("\n"));
})().catch((error) => {
  console.error("FAIL:", error.message);
  process.exit(1);
});
