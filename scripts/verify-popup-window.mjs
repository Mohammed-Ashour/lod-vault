// Verify Chrome's actual action popup, not an emulated extension page.
// Requires Chrome with Extensions.loadUnpacked support. Uses a disposable profile
// and an unexposed debugging pipe; the unsafe-debugging flag never touches user Chrome.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seed } from './screenshot-stub.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromePath = process.env.CHROME_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'chromium');
const profile = await mkdtemp(path.join(tmpdir(), 'lod-popup-window-'));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let buffer = '', id = 0;
const calls = new Map();
function rejectPending(error) {
  for (const call of calls.values()) { clearTimeout(call.timer); call.reject(error); }
  calls.clear();
}
chrome.once('error', rejectPending);
chrome.once('exit', () => rejectPending(Error('Chrome exited before the popup check completed')));
chrome.stdio[4].on('data', chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const raw = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (!raw) continue;
    const message = JSON.parse(raw), call = calls.get(message.id);
    if (!call) continue;
    calls.delete(message.id); clearTimeout(call.timer);
    message.error ? call.reject(Error(JSON.stringify(message.error))) : call.resolve(message.result);
  }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const next = ++id;
  const timer = setTimeout(() => { calls.delete(next); reject(Error(`CDP timed out: ${method}`)); }, 15000);
  calls.set(next, { resolve, reject, timer });
  chrome.stdio[3].write(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
});
async function evaluate(sessionId, expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try {
  const { id: extensionId } = await send('Extensions.loadUnpacked', { path: root });
  let worker;
  for (let n = 0; n < 60 && !worker; n++) {
    worker = (await send('Target.getTargets')).targetInfos.find(target => target.url === `chrome-extension://${extensionId}/scripts/background-bundle.js`);
    if (!worker) await sleep(50);
  }
  assert.ok(worker, 'Extension background worker started');
  const { sessionId: workerSession } = await send('Target.attachToTarget', { targetId: worker.targetId, flatten: true });
  await send('Runtime.enable', {}, workerSession);
  let ready = false;
  for (let n = 0; n < 60 && !ready; n++) {
    ready = await evaluate(workerSession, "typeof chrome!=='undefined' && !!chrome.storage?.local");
    if (!ready) await sleep(50);
  }
  assert.ok(ready, 'Extension storage bindings are ready');
  await evaluate(workerSession, `chrome.storage.local.set(${JSON.stringify(seed.local)})`);
  await evaluate(workerSession, 'chrome.action.openPopup().then(()=>true)');
  let popup;
  for (let n = 0; n < 60 && !popup; n++) {
    popup = (await send('Target.getTargets')).targetInfos.find(target => target.url === `chrome-extension://${extensionId}/pages/popup.html`);
    if (!popup) await sleep(50);
  }
  assert.ok(popup, 'Chrome opened the actual extension action popup');
  const { sessionId } = await send('Target.attachToTarget', { targetId: popup.targetId, flatten: true });
  for (let n = 0; n < 60; n++) {
    if (await evaluate(sessionId, `document.readyState==='complete' && document.querySelectorAll('.saved-item').length===5`)) break;
    await sleep(50);
  }
  const fixtures = Object.values(seed.local['lodVault.entries']);
  await evaluate(sessionId, `LodVaultLensLookup.search=async()=>({candidates:${JSON.stringify(fixtures)}})`);
  const measure = () => evaluate(sessionId, `(() => {const r=document.querySelector('.search-box').getBoundingClientRect(),f=document.querySelector('.popup-feedback').getBoundingClientRect();return {width:innerWidth,height:innerHeight,contentWidth:document.body.clientWidth,search:[r.x,r.y,r.width,r.height],footerBottom:f.bottom,resultsHeight:document.getElementById('words-scroll').clientHeight};})()`);
  const initial = await measure();
  assert.equal(initial.contentWidth, 420, 'Fixed preferred content width survives native auto-sizing');
  assert.ok(initial.height >= 360 && initial.height <= 600, 'Popup does not collapse to its initial intrinsic height');
  assert.ok(initial.footerBottom <= initial.height + .1 && initial.resultsHeight >= 90, 'Clamped native window keeps footer and results reachable');
  const states = [];
  for (const scenario of ['idle', 'results', 'empty', 'error', 'loading']) {
    await evaluate(sessionId, `document.getElementById('search-source-lod').click()`);
    if (scenario !== 'idle') {
      const fn = scenario === 'empty' ? 'async()=>({candidates:[]})' : scenario === 'error' ? 'async()=>{throw Error("offline")}' : scenario === 'loading' ? '()=>new Promise(()=>{})' : `async()=>({candidates:${JSON.stringify(fixtures)}})`;
      await evaluate(sessionId, `(() => {LodVaultLensLookup.search=${fn};const i=document.getElementById('search-input');i.value=${JSON.stringify(scenario)};i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
    }
    await sleep(100);
    const actual = await measure();
    assert.equal(actual.width, initial.width, `${scenario}: native popup width stays fixed`);
    assert.equal(actual.height, initial.height, `${scenario}: native popup height stays fixed`);
    assert.deepEqual(actual.search, initial.search, `${scenario}: native search geometry stays fixed`);
    states.push(scenario);
    await evaluate(sessionId, `document.getElementById('search-source-vault').click()`);
  }
  await evaluate(sessionId, `document.getElementById('stats-tab').click();document.getElementById('data-settings').open=true`);
  const settings = await evaluate(sessionId, '({width:innerWidth,height:innerHeight})');
  assert.equal(settings.width, initial.width); assert.equal(settings.height, initial.height);
  console.log(`Actual Chrome action popup passed: ${initial.width} × ${initial.height}px host window, ${initial.contentWidth}px content. Stable across ${states.join(', ')} and expanded settings.`);
} finally {
  if (chrome.exitCode === null && !chrome.killed) await new Promise(resolve => { chrome.once('exit', resolve); chrome.kill(); });
  rejectPending(Error('Popup verification finished'));
  await rm(profile, { recursive: true, force: true });
}
