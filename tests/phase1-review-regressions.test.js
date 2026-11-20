const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSharedStore, loadSyncScript } = require('./helpers/loaders');
const entry = { id: 'HAUS1', word: 'Haus', study: true };

test('serialized deletion rejects core and skill reviews without orphan metadata', async () => {
  const { store } = loadSharedStore();
  await store.addToList(entry, 'study');
  const deletion = store.removeEntry('HAUS1');
  const racingReview = store.recordFlashcardReview('HAUS1', 3, 'fwd');
  await deletion;
  assert.equal((await racingReview).reason, 'missing-entry');
  for (const id of ['HAUS1', 'HAUS1#pl']) {
    const result = await store.recordFlashcardReview(id, 3, 'fwd');
    assert.equal(result.reason, 'missing-entry');
  }
  assert.equal(Object.keys(await store.getFlashcardMeta()).length, 0);
});

test('undo retains independent pause even when restoring a new card', async () => {
  const { store } = loadSharedStore();
  await store.addToList(entry, 'study');
  const result = await store.recordFlashcardReview('HAUS1', 3, 'fwd');
  await store.setFlashcardSuspended('HAUS1', true);
  const paused = (await store.getFlashcardMeta()).HAUS1.pausedAt;
  await store.undoFlashcardReview('HAUS1', result.previous, result.record.lastReviewedAt);
  const card = (await store.getFlashcardMeta()).HAUS1;
  assert.equal(card.suspended, true);
  assert.equal(card.pausedAt, paused);
  assert.equal(card.totalReviews, 0);
});

test('pause precision and ties converge in either merge direction', async () => {
  for (const times of [['.100Z', '.200Z'], ['.100Z', '.100Z']]) {
    const a = { pausedAt: '2026-06-10T09:00:00' + times[0], suspended: true };
    const b = { pausedAt: '2026-06-10T09:00:00' + times[1], suspended: false };
    const results = [];
    for (const [local, remote] of [[a, b], [b, a]]) {
      const { store } = loadSharedStore({ 'lodVault.flashcardMeta': { HAUS1: local } });
      await store.applyRemoteFlashcardMeta({ HAUS1: remote });
      const card = (await store.getFlashcardMeta()).HAUS1;
      results.push([card.pausedAt, !!card.suspended]);
    }
    assert.deepEqual(results[0], results[1]);
  }
});

test('two devices preserve practice memory clock, kind, learning step and pause precision', async () => {
  const laptop = loadSyncScript();
  await laptop.store.addToList(entry, 'study');
  await laptop.store.recordFlashcardReview('HAUS1', 4, 'fwd', { now: '2026-06-10T09:00:00.000Z' });
  await laptop.store.recordFlashcardReview('HAUS1', 3, 'fwd', { now: '2026-06-10T09:01:00.000Z', kind: 'p' });
  const original = (await laptop.store.getFlashcardMeta()).HAUS1;
  await laptop.sync.SyncAdapter.pushAll();
  const desktop = loadSyncScript({ sync: laptop.syncStorageData });
  await desktop.sync.SyncAdapter.pullAll({ repush: false });
  const card = (await desktop.store.getFlashcardMeta()).HAUS1;
  assert.equal(card.sr, original.sr);
  assert.equal(card.step, original.step);
  assert.equal(card.reviews.at(-1).kind, 'p');
  const queue = desktop.store.buildTodayQueue(await desktop.store.getEntries(), { HAUS1: card }, { now: new Date('2026-06-10T12:00:00Z'), maxReviewsPerDay: 1 });
  assert.equal(queue.reviewedToday, 0);
  await laptop.store.addToList({ id: 'B', word: 'Bam' }, 'study');
  const learning = await laptop.store.recordFlashcardReview('B', 3, 'fwd', { now: '2026-06-10T10:00:00Z' });
  assert.ok(learning.record.step > 0);
  await laptop.sync.SyncAdapter.pushAll();
  const receiver = loadSyncScript({ sync: laptop.syncStorageData });
  await receiver.sync.SyncAdapter.pullAll({ repush: false });
  assert.equal((await receiver.store.getFlashcardMeta()).B.step, learning.record.step);
});
