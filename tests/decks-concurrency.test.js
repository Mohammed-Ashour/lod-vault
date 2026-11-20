const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { loadSharedStore, runScripts } = require('./helpers/loaders');
function load() {
  const host = loadSharedStore();
  runScripts(host.context, ['scripts/activity.js', 'scripts/decks.js']);
  return host;
}
test('separate page and worker contexts serialize different tags and remote merges', async () => {
  const a = load(), b = load();
  b.context.chrome.storage.local = a.context.chrome.storage.local;
  b.context.navigator.locks = a.context.navigator.locks;
  const A = a.context.LodVaultDecks, B = b.context.LodVaultDecks;
  for (let i = 0; i < 10; i++) {
    await Promise.all([
      A.setEntryTags(`A${i}`, [`left${i}`], 100),
      B.setEntryTags(`B${i}`, [`right${i}`], 100),
      B.applyRemote({ t: { [`remote${i}`]: [[`R${i}`], 100] } })
    ]);
  }
  const org = await A.readOrg();
  assert.equal(Object.keys(org.t).length, 30);
});
test('missing Web Locks refuses writes rather than claiming cross-context safety', async () => {
  const host = load();
  delete host.context.navigator.locks;
  await assert.rejects(host.context.LodVaultDecks.setEntryTags('A', ['home']), /requires Web Locks/);
  assert.equal(Object.keys((await host.context.LodVaultDecks.readOrg()).t).length, 0);
});
test('quota boundary reports live omissions and deferred deletions, with persistent warning', async () => {
  const host = load(), decks = host.context.LodVaultDecks;
  const now = Date.now();
  const org = { t: { home: [['A'], now] }, k: { deleted: [null, now] } };
  const bytes = Buffer.byteLength(JSON.stringify(decks.buildSyncValue(org)));
  assert.equal(decks.syncStatus(org, { maxBytes: bytes }).localOnly, false);
  assert.equal(decks.syncStatus(org, { maxBytes: bytes - 1 }).localOnly, true);
  const tiny = decks.syncStatus(org, { maxBytes: 25 });
  assert.equal(tiny.omitted.tags, 1);
  assert.equal(tiny.omitted.deletions, 1);
  org.k = {};
  for (let i = 0; i < 150; i++) org.k[`deck${i}`] = [{ name: 'Long deck name for quota testing', f: {} }, now];
  await host.context.chrome.storage.local.set({ 'lodVault.tags': org });
  runScripts(host.context, ['scripts/vault-tags.js']);
  const dom = new JSDOM('<body><input id="search-input"></body>');
  const attach = () => host.context.LodVaultVaultTags.attach(dom.window.document);
  await attach();
  const warning = dom.window.document.getElementById('lv-tag-sync-warning');
  assert.equal(warning.hidden, false);
  assert.match(warning.textContent, /decks stay on this device/);
  assert.match(warning.textContent, /deletions are deferred/);
  await attach();
  assert.equal(warning.hidden, false);
  assert.equal(dom.window.document.querySelectorAll('#lv-tag-sync-warning').length, 1);
});
