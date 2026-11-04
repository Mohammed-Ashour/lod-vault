// Real-page geometry checks, optionally with before/after captures for local review.
// No user profile or live LOD requests.
// CHROME_PATH=/path/to/chrome node scripts/verify-ui-layout.mjs [--capture]
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubSource, seed } from './screenshot-stub.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.UI_SCREENSHOT_DIR || path.join(root, 'docs/screenshots/ui-consolidation');
const baseline = '93621c6';
const capture = process.argv.includes('--capture');
const chromePath = process.env.CHROME_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'chromium');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(path.join(tmpdir(), 'lod-layout-'));
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const before = url.pathname.startsWith('/before/');
    const relative = decodeURIComponent(url.pathname.slice(before ? 8 : 1));
    if (!/^(pages|styles|scripts)\//.test(relative) || relative.split('/').includes('..')) { res.writeHead(400); res.end(); return; }
    const body = before ? execFileSync('git', ['show', `${baseline}:${relative}`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8e6 })
      : await readFile(path.join(root, relative));
    res.setHeader('Content-Type', mime[path.extname(relative)] || 'text/plain');
    if (relative.endsWith('.html')) res.setHeader('Content-Security-Policy', "script-src 'self'");
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
let chrome, ws;
const checks = [], runtimeErrors = [], comparison = {};
const fixtures = Object.values(seed.local['lodVault.entries']);
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let log = '';
    const timeout = setTimeout(() => reject(Error('Chrome did not start within 15 seconds')), 15000);
    chrome.once('error', error => { clearTimeout(timeout); reject(error); });
    chrome.once('exit', code => { clearTimeout(timeout); reject(Error(`Chrome exited during startup: ${code}`)); });
    chrome.stderr.on('data', data => {
      log += data;
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(new URL(match[1])); }
    });
  });
  const tabs = await (await fetch(`http://${endpoint.host}/json/list`)).json();
  ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const call = pending.get(message.id); if (!call) return;
      pending.delete(message.id); clearTimeout(call.timeout);
      message.error ? call.reject(Error(JSON.stringify(message.error))) : call.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id;
    const timeout = setTimeout(() => { pending.delete(next); reject(Error(`CDP timed out: ${method}`)); }, 15000);
    pending.set(next, { resolve, reject, timeout }); ws.send(JSON.stringify({ id: next, method, params }));
  });
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  const check = (condition, name) => { assert.ok(condition, name); checks.push(name); };
  const rect = selector => evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; })()`);
  const same = (a, b) => a.every((n, i) => Math.abs(n - b[i]) < .1);
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  async function type(value) {
    await evaluate(`(() => {const i=document.getElementById('search-input');i.value=${JSON.stringify(value)};i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
    await sleep(70);
  }
  async function navigate(page, width = 420, height = 600, before = false) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${origin}/${before ? 'before/' : ''}pages/${page}.html` });
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await evaluate(`location.pathname.endsWith('/${page}.html') && document.readyState === 'complete'`)) break;
      await sleep(50);
    }
    await sleep(200);
    if (page === 'popup') {
      await evaluate(`Object.assign(LodVaultLensLookup,{search:async q=>({candidates:${JSON.stringify(fixtures)}.filter(e=>[e.word,...Object.values(e.translations)].join(' ').toLowerCase().includes(q.toLowerCase()))}),fetchEntry:async id=>${JSON.stringify(fixtures)}.find(e=>e.id===id)})`);
    }
  }
  async function shot(name) {
    if (!capture) return;
    await mkdir(outDir, { recursive: true });
    const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(path.join(outDir, `${name}.png`), Buffer.from(result.data, 'base64'));
  }
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: stubSource + '\ntry { localStorage.setItem("blueNightTheme", "dark"); } catch {}' });

  if (capture) {
    for (const before of [true, false]) {
      const label = before ? 'before' : 'after';
      await navigate('popup', 420, 600, before); await shot(`${label}-popup-vault`);
      const originalSearch = await rect('.search-box');
      const originalWidth = await evaluate('document.body.clientWidth');
      await type('Haus'); const filteredSearch = await rect('.search-box'); await type('');
      await click('#search-source-lod'); await sleep(50);
      const lookupSearch = await rect('.search-box');
      comparison[label] = { searchShift: Math.abs(originalSearch[1]-lookupSearch[1]), widthShift: Math.abs(originalWidth-await evaluate('document.body.clientWidth')), countResize: Math.abs(originalSearch[2]-filteredSearch[2]) };
      await type('house'); await shot(`${label}-popup-lod`);
      await navigate('flashcards', 375, 740, before); await click('#flip-card'); await sleep(500); await shot(`${label}-flashcards`);
      comparison[label].flashcardsOverflow = await evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth');
      await navigate('preview', 375, 740, before); await shot(`${label}-vault`);
      comparison[label].vaultFrameOverhang = await evaluate("document.getElementById('preview-frame').getBoundingClientRect().bottom-innerHeight");
    }
    await writeFile(path.join(outDir, 'measurements.json'), JSON.stringify({ baseline, ...comparison }, null, 2)+'\n');
  }

  await navigate('popup');
  const inputRect = await rect('.search-box'), sourceRect = await rect('.search-source-switch');
  check(await evaluate(`document.body.clientWidth===420 && document.body.clientHeight===600 && document.documentElement.scrollHeight===600`), 'Popup is 420 × 600 with no root scrollbar');
  await type('Haus'); check(same(inputRect, await rect('.search-box')), 'Filtered count does not resize input');
  await click('#search-source-lod'); await sleep(80);
  check(same(inputRect, await rect('.search-box')) && same(sourceRect, await rect('.search-source-switch')), 'Source switch keeps search geometry');
  const firstAction = await rect('.lookup-save-area');
  const footerTop = await evaluate(`(() => {const f=document.querySelector('.popup-feedback');return getComputedStyle(f).display==='none' ? innerHeight : f.getBoundingClientRect().top;})()`);
  check(firstAction[1]+firstAction[3]<=footerTop, 'First lookup actions are visible without expanding or scrolling');
  await click('.lookup-details > summary'); await sleep(70);
  await evaluate(`window.retainedNote=document.querySelector('.lookup-result textarea');retainedNote.value='Draft retained';retainedNote.dispatchEvent(new Event('input',{bubbles:true}));`);
  await click('#search-source-vault'); await click('#search-source-lod'); await sleep(80);
  check(await evaluate(`document.querySelector('.lookup-result textarea')===retainedNote && retainedNote.value==='Draft retained' && document.querySelector('.lookup-details').open`), 'Source round trip retains real editor, draft and details');
  await click('#current-page-card > summary');
  check(same(inputRect, await rect('.search-box')), 'Current-word disclosure cannot move search');
  await type('no-fixture-matches');
  check(same(inputRect, await rect('.search-box')), 'Empty state cannot move search');
  await evaluate(`LodVaultLensLookup.search=async()=>{throw Error('offline')}`); await type('offline');
  check(await evaluate(`!!document.querySelector('[data-action="retry"]') && !!document.querySelector('[data-action="local"]')`), 'Offline state offers Retry and local fallback');
  check(same(inputRect, await rect('.search-box')), 'Error state cannot move search');
  await click('[data-action="local"]');
  await evaluate(`document.getElementById('search-source-vault').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`);
  check(await evaluate(`document.activeElement.id==='search-source-lod' && document.querySelectorAll('[role="radio"][tabindex="0"]').length===1`), 'Arrow-group navigation moves selection and focus');
  await click('#stats-tab'); await click('#data-settings > summary');
  check(await evaluate(`document.body.clientHeight===600 && document.documentElement.scrollHeight===600`), 'Expanded settings do not resize frame');
  await click('#words-tab'); await click('.theme-btn'); await sleep(220);
  check(same(inputRect, await rect('.search-box')), 'Light theme preserves search geometry');
  await evaluate(`popupApp.elements.actionFeedback.textContent='Another action completed.';popupApp.elements.actionFeedback.classList.remove('is-hidden');popupApp.elements.deleteUndo.classList.remove('is-hidden');popupApp.syncFeedbackFooter();`);
  check(await evaluate(`document.querySelector('.popup-feedback').classList.contains('is-active')`), 'Feedback row appears while active');
  const feedbackRect = await rect('#action-feedback'), undoRect = await rect('#delete-undo');
  check(feedbackRect[1] + feedbackRect[3] <= undoRect[1] + .1, 'Feedback and Undo have separate rows');
  check(same(inputRect, await rect('.search-box')), 'Feedback appearance does not move search');
  await evaluate(`popupApp.elements.actionFeedback.classList.add('is-hidden');popupApp.elements.deleteUndo.classList.add('is-hidden');popupApp.syncFeedbackFooter();`);
  check(await evaluate(`!document.querySelector('.popup-feedback').classList.contains('is-active') && document.getElementById('words-scroll').clientHeight>${await evaluate("document.getElementById('words-scroll').clientHeight") - 4}`), 'Idle footer collapses and returns the space to results');
  for (const height of [480, 360]) {
    await send('Emulation.setDeviceMetricsOverride', { width: 420, height, deviceScaleFactor: 1, mobile: false });
    check(await evaluate(`(document.querySelector('.popup-feedback').getBoundingClientRect().bottom<=innerHeight+.1 || getComputedStyle(document.querySelector('.popup-feedback')).display==='none') && document.getElementById('words-scroll').clientHeight>=90`), `Popup status stays reachable at ${height}px height`);
  }
  await navigate('popup');
  await evaluate(`LodVaultLensLookup.search=()=>new Promise(()=>{})`); await click('#search-source-lod'); await type('loading');
  check(same(inputRect, await rect('.search-box')), 'Loading state cannot move search');
  await navigate('popup');
  const long = { ...fixtures[0], word: 'A'.repeat(150), translations: { en: 'Long translation '.repeat(45) } };
  await evaluate(`LodVaultLensLookup.search=async()=>({candidates:[${JSON.stringify(long)}]})`); await click('#search-source-lod'); await type('long');
  check(await evaluate(`document.getElementById('words-scroll').scrollWidth<=document.getElementById('words-scroll').clientWidth`), 'Long lookup content wraps inside scroller');

  for (const width of [360, 375, 1280]) {
    await navigate('flashcards', width, 740); await click('#flip-card'); await sleep(500);
    check(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), `Flashcards has no horizontal overflow at ${width}px`);
    await evaluate("document.getElementById('session-trigger').focus()");
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    check(await evaluate("document.getElementById('session-trigger').getAttribute('aria-expanded')==='true'"), `Native Enter opens Session at ${width}px`);
    const menu = await rect('#session-menu');
    check(menu[0] >= 0 && menu[0] + menu[2] <= width + .1, `Session menu fits at ${width}px`);
    await evaluate(`document.getElementById('deck-filter').focus();document.getElementById('deck-filter').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    check(await evaluate(`document.getElementById('session-trigger').getAttribute('aria-expanded')==='false' && document.activeElement.id==='session-trigger'`), 'Escape closes Session and restores focus');
    await navigate('preview', width, 740);
    check(await evaluate(`document.documentElement.scrollWidth<=innerWidth && Math.abs(document.getElementById('preview-frame').getBoundingClientRect().bottom-innerHeight)<1`), `Vault iframe fills actual remaining height at ${width}px`);
    await click('#export-trigger'); const exportRect = await rect('#export-menu');
    check(exportRect[0] >= 0 && exportRect[0] + exportRect[2] <= width + .1, `Export menu fits at ${width}px`);
    await evaluate(`document.getElementById('download-html').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    check(await evaluate(`document.getElementById('export-trigger').getAttribute('aria-expanded')==='false' && document.activeElement.id==='export-trigger'`), 'Escape closes Export and restores focus');
  }
  assert.deepEqual(runtimeErrors, [], 'No uncaught browser errors');
  console.log(`${checks.length} real-page layout checks passed against Chrome. Baseline: ${baseline}.`);
  console.log(checks.map(name => `  ${name}`).join('\n'));
  if (capture) console.log(`Screenshots: ${path.relative(root, outDir)}`);
} finally {
  ws?.close();
  if (chrome && chrome.exitCode === null && !chrome.killed) {
    await new Promise(resolve => { chrome.once('exit', resolve); chrome.kill(); });
  }
  server.close();
  await rm(profile, { recursive: true, force: true });
}
