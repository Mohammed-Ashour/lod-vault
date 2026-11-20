const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSharedStore, runScripts } = require('./helpers/loaders');
function device(initial = {}) {
  const loaded = loadSharedStore(initial);
  runScripts(loaded.context, ['scripts/activity.js']);
  return { ...loaded, activity: loaded.context.LodVaultActivity };
}
const plain = (v) => JSON.parse(JSON.stringify(v));

test('concurrent local captures preserve more than 100 reviews and device identity', async () => {
  const a = device();
  const date = new Date().toISOString();
  const day = a.activity.toDayNumber(date);
  await Promise.all(Array.from({length: 150}, (_, i) => a.activity.captureReview({date, isNew: i === 0}, (extra) => a.chrome.storage.local.set(extra))));
  const value = await a.activity.readLocal();
  assert.deepEqual(plain(value.d[day]), [150, 1, 0]);
  assert.equal(Object.keys(value.c).length, 1);
  await a.activity.recordFromLocal();
  assert.equal((await a.activity.readLocal()).d[day][0], 150);
});

test('offline same-card device work converges independently of winning schedule, replay and legacy clients', async () => {
  const a = device(); const b = device();
  const date = new Date().toISOString();
  const day = a.activity.toDayNumber(date);
  for (const d of [a, b]) {
    for (let i = 0; i < 120; i++) await d.activity.captureReview({date}, (extra) => d.chrome.storage.local.set(extra));
  }
  const left = await a.activity.readLocal(); const right = await b.activity.readLocal();
  await a.activity.applyRemote(right); await b.activity.applyRemote(left);
  assert.deepEqual(plain((await a.activity.readLocal()).d), plain((await b.activity.readLocal()).d));
  assert.equal((await a.activity.readLocal()).d[day][0], 240);
  await a.activity.applyRemote(right);
  await a.activity.applyRemote({d: {[day]: [240, 0, 0]}});
  assert.equal((await a.activity.readLocal()).d[day][0], 240);
  const sync = a.activity.buildSyncValue(await a.activity.readLocal());
  assert.ok(Buffer.byteLength(JSON.stringify(sync)) < 8192);
});

test('store review capture survives capped history, deletion and resurrection', async () => {
  const a = device();
  for (let i = 0; i < 125; i++) await a.store.recordFlashcardReview('HOUSE1', 2, 'fwd');
  const meta = await a.store.getFlashcardMeta();
  assert.equal(meta.HOUSE1.reviews.length, 100);
  const day = a.activity.toDayNumber(new Date());
  assert.equal((await a.activity.readLocal()).d[day][0], 125);
  await a.chrome.storage.local.set({'lodVault.flashcardMeta': {}});
  await a.activity.recordFromLocal();
  await a.store.recordFlashcardReview('HOUSE1', 2, 'fwd');
  assert.equal((await a.activity.readLocal()).d[day][0], 126);
});

test('migration retains conservative legacy floor and counts future work once', async () => {
  const date = new Date().toISOString();
  const probe = device(); const day = probe.activity.toDayNumber(date);
  const a = device({'lodVault.activity': {d: {[day]: [80, 3, 0]}}});
  await a.activity.captureReview({date}, (extra) => a.chrome.storage.local.set(extra));
  assert.equal((await a.activity.readLocal()).d[day][0], 81);
  await a.activity.applyRemote({d: {[day]: [81, 3, 0]}});
  assert.equal((await a.activity.readLocal()).d[day][0], 81);
});
