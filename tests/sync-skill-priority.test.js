const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSyncScript } = require('./helpers/loaders');

function fixture() {
  const entries = {};
  const meta = {};
  for (let i = 0; i < 10; i += 1) {
    const id = `WORD${i}`;
    entries[id] = { id, word: id, url: `https://lod.lu/artikel/${id}`, study: true };
    meta[id] = { totalReviews: 1, interval: 7, lastReviewedAt: '2026-01-01T00:00:00Z', dueAt: '2026-01-08T00:00:00Z', reviews: [{ date: '2026-01-01T00:00:00Z', rating: 3 }] };
  }
  return { entries, meta };
}

async function pushed(entries, meta, padding) {
  const device = loadSyncScript({
    local: { 'lodVault.entries': entries, 'lodVault.flashcardMeta': meta },
    sync: { unrelated: 'x'.repeat(padding) }
  });
  device.compress.isAvailable = () => false;
  assert.equal((await device.sync.SyncAdapter.pushProgress()).ok, true);
  const records = Object.entries(device.syncStorageData)
    .filter(([key]) => key.startsWith('lodVault.p.'))
    .flatMap(([, value]) => value);
  return records.map((record) => record.i);
}

test('newer skills cannot displace core progress at the budget boundary', async () => {
  const { entries, meta } = fixture();
  const core = await pushed(entries, meta, 90000);
  assert.equal(core.length, 10);
  const withSkills = { ...meta };
  for (const id of Object.keys(entries)) {
    for (const skill of ['pl', 'pp', 'cz', 'g', 'rev', 'sd']) {
      withSkills[`${id}#${skill}`] = { ...meta[id], lastReviewedAt: '2026-11-20T00:00:00Z' };
    }
  }
  const retained = await pushed(entries, withSkills, 90000);
  for (const id of core) assert.ok(retained.includes(id), `core ${id} was displaced`);
  assert.ok(retained.length < Object.keys(withSkills).length, 'fixture must cross the budget');
  const roomy = await pushed(entries, withSkills, 0);
  assert.equal(roomy.length, Object.keys(withSkills).length);
});

test('skill progress eligibility uses base word membership', async () => {
  const { entries, meta } = fixture();
  meta['WORD0#pl'] = { ...meta.WORD0 };
  meta['DELETED#pl'] = { ...meta.WORD0 };
  const ids = await pushed(entries, meta, 0);
  assert.ok(ids.includes('WORD0#pl'));
  assert.ok(!ids.includes('DELETED#pl'));
});
