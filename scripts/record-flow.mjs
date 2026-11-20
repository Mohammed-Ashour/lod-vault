#!/usr/bin/env node
// record-flow.mjs: screenshots and GIFs of real extension pages for PR descriptions.
//
// Loads the pages from this checkout (or from a git ref, for "before" shots)
// in headless Chrome with the chrome.* stub and seeded sample vault from
// screenshot-stub.mjs, then runs a scenario module that drives the page over
// CDP. No user profile, no network requests to LOD.
//
//   CHROME_PATH=/usr/bin/chromium node scripts/record-flow.mjs \
//     --scenario path/to/scenario.mjs --out /tmp/shots [--ref main]
//
// A scenario exports `default async (api) => {}`. The api offers:
//   navigate(page, { width, height, theme: "dark"|"light", query, seed })
//   evaluate(expression)             run in the page, returns the value
//   click(selector)                  click with a visible pointer ring
//   press(key, { ctrl, selector })   keydown on the focused element (or selector), with a key badge
//   shot(name, { selector, padding }) PNG of the viewport or an element
//   gif(name, async () => {}, { fps })  record the steps as a GIF (needs ffmpeg)
//   sleep(ms)
// Generated images are for PR descriptions; don't commit them to feature branches.
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, rm, copyFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stubSource as defaultStub } from "./screenshot-stub.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const scenarioPath = option("scenario");
const outDir = path.resolve(option("out", path.join(root, "docs/screenshots/flows")));
const ref = option("ref");
const chromePath = process.env.CHROME_PATH || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "chromium");
if (!scenarioPath) {
  console.error("Usage: node scripts/record-flow.mjs --scenario <file> [--out <dir>] [--ref <git ref>]");
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer(async (req, res) => {
  try {
    const relative = decodeURIComponent(new URL(req.url, "http://localhost").pathname.slice(1));
    if (!/^(pages|styles|scripts|icons)\//.test(relative) || relative.split("/").includes("..")) {
      res.writeHead(400); res.end(); return;
    }
    const body = ref
      ? execFileSync("git", ["show", `${ref}:${relative}`], { cwd: root, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16e6 })
      : await readFile(path.join(root, relative));
    res.setHeader("Content-Type", mime[path.extname(relative)] || "text/plain");
    if (relative.endsWith(".html")) res.setHeader("Content-Security-Policy", "script-src 'self'");
    res.end(body);
  } catch {
    res.writeHead(404); res.end();
  }
});

// Visual cues for GIFs: a ring where the pointer clicks, a badge for keys.
const cueSource = `
window.__lodCue = {
  ring(x, y) {
    const ring = document.createElement("div");
    ring.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid #ffb703;background:rgba(255,183,3,.25);transition:opacity .5s,transform .5s;left:" + x + "px;top:" + y + "px";
    document.documentElement.append(ring);
    setTimeout(() => { ring.style.opacity = "0"; ring.style.transform = "scale(1.6)"; }, 350);
    setTimeout(() => ring.remove(), 900);
  },
  key(label) {
    let badge = document.getElementById("__lod-key");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "__lod-key";
      badge.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;right:16px;bottom:16px;padding:8px 14px;border-radius:8px;background:#ffb703;color:#111;font:700 18px/1 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.4)";
      document.documentElement.append(badge);
    }
    badge.textContent = "⌨ " + label;
    badge.style.opacity = "1";
    clearTimeout(window.__lodKeyTimer);
    window.__lodKeyTimer = setTimeout(() => { badge.style.opacity = "0"; }, 900);
  }
};`;

const profile = await mkdtemp(path.join(tmpdir(), "lod-flow-"));
let chrome;
let ws;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const endpoint = await new Promise((resolve, reject) => {
    let log = "";
    const timeout = setTimeout(() => reject(Error("Chrome did not start within 15 seconds")), 15000);
    chrome.once("error", (error) => { clearTimeout(timeout); reject(error); });
    chrome.stderr.on("data", (data) => {
      log += data;
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(new URL(match[1])); }
    });
  });
  const tabs = await (await fetch(`http://${endpoint.host}/json/list`)).json();
  ws = new WebSocket(tabs.find((tab) => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve));
  let id = 0;
  const pending = new Map();
  const runtimeErrors = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const call = pending.get(message.id);
      pending.delete(message.id);
      message.error ? call.reject(Error(JSON.stringify(message.error))) : call.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(message.params.exceptionDetails);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id;
    const timeout = setTimeout(() => { pending.delete(next); reject(Error(`CDP timed out: ${method}`)); }, 8000);
    pending.set(next, {
      resolve: (value) => { clearTimeout(timeout); resolve(value); },
      reject: (error) => { clearTimeout(timeout); reject(error); }
    });
    ws.send(JSON.stringify({ id: next, method, params }));
  });
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails).slice(0, 600));
    return result.result.value;
  }

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Page.bringToFront");
  let stubScriptId = null;
  async function navigate(page, { width = 1100, height = 820, theme = "dark", query = "", seed = null } = {}) {
    if (stubScriptId) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: stubScriptId });
    let stub = defaultStub;
    if (seed) stub = stub.replace(/const seed = (\{[\s\S]*?\});\n/, () => `const seed = ${JSON.stringify(seed)};\n`);
    const source = `${stub}\n${cueSource}\ntry { localStorage.setItem("blueNightTheme", ${JSON.stringify(theme)}); } catch {}`;
    ({ identifier: stubScriptId } = await send("Page.addScriptToEvaluateOnNewDocument", { source }));
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `${origin}/pages/${page}${query ? `?${query}` : ""}` });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await evaluate(`location.pathname.endsWith(${JSON.stringify(`/${page}`)}) && document.readyState === "complete"`).catch(() => false)) break;
      await sleep(50);
    }
    await sleep(400);
  }

  async function click(selector) {
    const point = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    if (!point) throw Error(`No element for ${selector}`);
    await evaluate(`window.__lodCue?.ring(${point[0]}, ${point[1]})`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", { type, x: point[0], y: point[1], button: "left", clickCount: 1 });
    }
    await sleep(120);
  }

  async function press(key, { ctrl = false, selector = "" } = {}) {
    const label = `${ctrl ? "Ctrl+" : ""}${key === " " ? "Space" : key}`;
    await evaluate(`(() => {
      window.__lodCue?.key(${JSON.stringify(label)});
      const target = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : "document.activeElement || document.body"};
      target.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, ctrlKey: ${ctrl}, bubbles: true, cancelable: true }));
    })()`);
    await sleep(120);
  }

  async function capture(params = {}) {
    // A capture can stall in headless Chrome; retry once on a fresh frame.
    let result;
    try {
      result = await send("Page.captureScreenshot", { format: "png", ...params });
    } catch {
      await send("Page.bringToFront");
      await sleep(200);
      result = await send("Page.captureScreenshot", { format: "png", ...params });
    }
    return Buffer.from(result.data, "base64");
  }

  async function shot(name, { selector = "", padding = 12, full = false } = {}) {
    await mkdir(outDir, { recursive: true });
    const params = {};
    if (selector) {
      const box = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height]; })()`);
      params.clip = { x: Math.max(0, box[0] - padding), y: Math.max(0, box[1] - padding), width: box[2] + padding * 2, height: box[3] + padding * 2, scale: 1 };
      params.captureBeyondViewport = true;
    } else if (full) {
      const size = await evaluate("[document.documentElement.clientWidth, document.documentElement.scrollHeight]");
      params.clip = { x: 0, y: 0, width: size[0], height: size[1], scale: 1 };
      params.captureBeyondViewport = true;
    }
    const file = path.join(outDir, `${name}.png`);
    await writeFile(file, await capture(params));
    console.log(`  ${path.relative(process.cwd(), file)}`);
  }

  // Frames are captured on a fixed clock; slow captures repeat the previous
  // frame so the GIF keeps real time.
  async function gif(name, steps, { fps = 8, width = 800 } = {}) {
    const frameDir = await mkdtemp(path.join(tmpdir(), "lod-frames-"));
    let recording = true;
    let index = 0;
    const started = Date.now();
    const recorder = (async () => {
      while (recording) {
        const due = Math.floor(((Date.now() - started) / 1000) * fps);
        const png = await capture();
        const file = path.join(frameDir, `frame-${String(index).padStart(4, "0")}.png`);
        await writeFile(file, png);
        index += 1;
        while (index < due) {
          await copyFile(file, path.join(frameDir, `frame-${String(index).padStart(4, "0")}.png`));
          index += 1;
        }
        await sleep(Math.max(0, started + (index * 1000) / fps - Date.now()));
      }
    })();
    try {
      await steps();
      await sleep(700);
    } finally {
      recording = false;
      await recorder;
    }
    await mkdir(outDir, { recursive: true });
    const out = path.join(outDir, `${name}.gif`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", path.join(frameDir, "frame-%04d.png"),
      "-vf", `scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, out]);
    await rm(frameDir, { recursive: true, force: true });
    console.log(`  ${path.relative(process.cwd(), out)} (${(index / fps).toFixed(1)} s)`);
  }

  const scenario = (await import(pathToFileURL(path.resolve(scenarioPath)).href)).default;
  await scenario({ navigate, evaluate, click, press, shot, gif, sleep, send });
  if (runtimeErrors.length) {
    console.error("Page errors:", runtimeErrors.map((error) => error.exception?.description || error.text).join("\n"));
    process.exitCode = 1;
  }
} finally {
  ws?.close();
  chrome?.kill();
  server.close();
  await sleep(300);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
