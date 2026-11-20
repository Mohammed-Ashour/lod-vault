const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSharedStore } = require('./helpers/loaders');

async function fixture() {
  const env = loadSharedStore();
  await env.store.addToList({ id: 'HAUS1', word: 'Haus' }, 'study');
  return env;
}

test('committed review with lost reply is not replayed locally', async () => {
  const { store, chrome } = await fixture();
  chrome.runtime.sendMessage = async ({ method, args }) => {
    delete chrome.runtime.sendMessage;
    await store[method](...args);
    throw new Error('The message port closed before a response was received.');
  };
  await assert.rejects(store.recordFlashcardReview('HAUS1', 3, 'fwd'), /port closed/);
  const meta = await store.getFlashcardMeta();
  assert.equal(meta.HAUS1.totalReviews, 1);
  assert.equal(meta.HAUS1.reviews.length, 1);
});

test('missing receiver permits fallback but worker error response does not', async () => {
  const { store, chrome } = await fixture();
  chrome.runtime.sendMessage = async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); };
  await store.recordFlashcardReview('HAUS1', 3, 'fwd');
  chrome.runtime.sendMessage = async () => ({ ok: false, error: 'Receiving end does not exist' });
  await assert.rejects(store.recordFlashcardReview('HAUS1', 3, 'fwd'), /Receiving end/);
  assert.equal((await store.getFlashcardMeta()).HAUS1.totalReviews, 1);
});

test('captureReview receives pre-review metadata and commits extras atomically', async () => {
  const { store, chrome, context, storageData } = await fixture();
  const writes = [];
  const set = chrome.storage.local.set;
  chrome.storage.local.set = async (values) => { writes.push(values); return set(values); };
  context.LodVaultActivity = {
    async captureReview({ date, isNew, meta }, persist) {
      assert.ok(date);
      assert.equal(isNew, true);
      assert.equal(meta.HAUS1, undefined);
      return persist({ 'lodVault.activity': { count: 1 } });
    }
  };
  await store.recordFlashcardReview('HAUS1', 3, 'fwd');
  assert.equal(writes.length, 1);
  assert.equal(writes[0]['lodVault.activity'].count, 1);
  assert.equal(storageData['lodVault.activity'].count, 1);
  assert.equal((await store.getFlashcardMeta()).HAUS1.totalReviews, 1);
});

// Opt-in cross-phase contract check; Phase 3 source is supplied, never copied.
test('Phase 3 activity stays at one review when the worker reply is lost', { skip: !process.env.PHASE3_ACTIVITY_SOURCE }, async () => {
  const { store, chrome, context, storageData } = await fixture();
  context.crypto = require('node:crypto').webcrypto;
  require('node:vm').runInNewContext(require('node:fs').readFileSync(process.env.PHASE3_ACTIVITY_SOURCE, 'utf8'), context);
  chrome.runtime.sendMessage = async ({ method, args }) => {
    delete chrome.runtime.sendMessage;
    await store[method](...args);
    throw new Error('message port closed');
  };
  await assert.rejects(store.recordFlashcardReview('HAUS1', 3, 'fwd'), /port closed/);
  assert.equal((await store.getFlashcardMeta()).HAUS1.totalReviews, 1);
  assert.deepEqual(Object.values(storageData['lodVault.activity'].d), [[1, 1, 0]]);
});
