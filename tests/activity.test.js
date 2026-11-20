const test = require("node:test");
const assert = require("node:assert/strict");
const {
  runScripts,
  loadSharedStore,
  loadSyncScript,
  loadBackgroundScript
} = require("./helpers/loaders");

function loadActivity(initialStorage = {}) {
  const loaded = loadSharedStore(initialStorage);
  runScripts(loaded.context, ["scripts/activity.js"]);
  return { ...loaded, activity: loaded.context.LodVaultActivity };
}

function loadSyncWithActivity(initialStorage = {}) {
  const loaded = loadSyncScript(initialStorage);
  runScripts(loaded.context, ["scripts/activity.js"]);
  return { ...loaded, activity: loaded.context.LodVaultActivity };
}

const NOW = new Date(2026, 10, 20, 15, 0, 0);
// Values from another vm context compare by shape, not prototype.
const plain = (value) => JSON.parse(JSON.stringify(value));
const { activity } = loadActivity();
const TODAY = activity.toDayNumber(NOW);

test("equal-clock rest masks and equal-streak anchors converge", () => {
  const a = { w: [[TODAY, 1, 100]], b: [TODAY - 1, 10, 1, 2] };
  const b = { w: [[TODAY, 2, 100]], b: [TODAY - 1, 10, 2, 1] };
  const ab = plain(activity.mergeActivity(a, b));
  assert.deepEqual(ab, plain(activity.mergeActivity(b, a)));
  assert.deepEqual(ab, plain(activity.mergeActivity(ab, a)));
  assert.deepEqual(ab, plain(activity.mergeActivity(ab, b)));
  assert.equal(ab.w[0][1], 2);
  assert.equal(ab.b[2], 2);
});

// Builds a record where the stricter rule applies to every listed day.
function record(days, extra = {}) {
  return { d: days, s: TODAY - 1000, ...extra };
}

function streakOf(days, extra = {}) {
  return activity.computeStreak(record(days, extra), { now: NOW });
}

test("day numbers follow the learner's local calendar", () => {
  const late = new Date(2026, 10, 20, 23, 59);
  const early = new Date(2026, 10, 21, 0, 1);
  assert.equal(activity.toDayNumber(late), TODAY);
  assert.equal(activity.toDayNumber(early), TODAY + 1);
  assert.equal(activity.toDayNumber("2026-11-20"), TODAY);
  assert.equal(activity.dayToKey(TODAY), "2026-11-20");
  assert.equal(activity.toDayNumber(activity.dayToDate(TODAY)), TODAY);
  assert.equal(activity.weekdayOf(TODAY), NOW.getDay());
});

test("day totals count every review and a word as new on its first review day", () => {
  const today = new Date(2026, 10, 20, 9).toISOString();
  const yesterday = new Date(2026, 10, 19, 9).toISOString();
  const days = activity.computeDailyFromMeta({
    NEW1: { totalReviews: 2, reviews: [{ date: today }, { date: today }] },
    OLD1: { totalReviews: 2, reviews: [{ date: yesterday }, { date: today }] },
    // The log lost its first reviews, so the word can't count as new today.
    TRIM1: { totalReviews: 140, reviews: [{ date: today }] },
    BAD: { totalReviews: 1, reviews: [{ date: "nope" }] }
  });
  assert.deepEqual(plain(days[TODAY]), [4, 1, 0]);
  assert.deepEqual(plain(days[TODAY - 1]), [1, 1, 0]);
});

test("a day counts with ten reviews or a cleared queue, and today stays open", () => {
  assert.equal(streakOf({ [TODAY - 1]: [10, 0, 0], [TODAY - 2]: [12, 2, 0] }).streak, 2);
  // Three reviews that didn't clear the queue break it.
  assert.equal(streakOf({ [TODAY - 1]: [3, 0, 0], [TODAY - 2]: [12, 2, 0] }).streak, 0);
  // Clearing the queue counts, even with few reviews.
  assert.equal(streakOf({ [TODAY - 1]: [3, 0, 1], [TODAY - 2]: [12, 2, 0] }).streak, 2);
  // Unfinished today doesn't break the streak and isn't counted yet.
  const open = streakOf({ [TODAY]: [2, 0, 0], [TODAY - 1]: [10, 0, 0] });
  assert.equal(open.streak, 1);
  assert.equal(open.todayDone, false);
  const done = streakOf({ [TODAY]: [10, 0, 0], [TODAY - 1]: [10, 0, 0] });
  assert.equal(done.streak, 2);
  assert.equal(done.todayDone, true);
});

test("days before strict recording keep the old any-review rule", () => {
  const days = { [TODAY - 1]: [1, 0, 0], [TODAY - 2]: [2, 0, 0] };
  assert.equal(activity.computeStreak({ d: days }, { now: NOW }).streak, 2);
  assert.equal(activity.computeStreak({ d: days, s: TODAY - 1 }, { now: NOW }).streak, 0);
});

test("seven counted days earn a freeze that covers a missed day", () => {
  const days = {};
  for (let day = TODAY - 9; day <= TODAY - 3; day += 1) days[day] = [10, 0, 0];
  days[TODAY - 1] = [10, 0, 0];
  // TODAY - 2 was missed.
  const result = activity.computeStreak(record(days), { now: NOW, withStatuses: true });
  assert.equal(result.streak, 8);
  assert.equal(result.freezes, 0);
  assert.equal(result.statuses[TODAY - 2], "frozen");

  // Two missed days with one freeze end the streak.
  delete days[TODAY - 1];
  assert.equal(streakOf(days).streak, 0);
});

test("at most two freezes are banked", () => {
  const days = {};
  for (let day = TODAY - 40; day <= TODAY - 5; day += 1) days[day] = [10, 0, 0];
  days[TODAY - 2] = [10, 0, 0];
  days[TODAY - 1] = [10, 0, 0];
  // 36 counted days earn five freezes, but only two are kept: they cover the
  // two missed days and leave none.
  const kept = streakOf(days);
  assert.equal(kept.streak, 38);
  assert.equal(kept.freezes, 0);

  // A third missed day ends the streak.
  delete days[TODAY - 2];
  assert.equal(streakOf(days).streak, 1);
});

test("rest days neither count nor break the streak", () => {
  const restDay = TODAY - 2;
  const mask = 1 << activity.weekdayOf(restDay);
  const days = { [TODAY - 1]: [10, 0, 0], [TODAY - 3]: [10, 0, 0] };
  assert.equal(streakOf(days).streak, 1);
  const result = activity.computeStreak(record(days, { w: [[TODAY - 30, mask, 1]] }), { now: NOW, withStatuses: true });
  assert.equal(result.streak, 2);
  assert.equal(result.statuses[restDay], "rest");
  assert.equal(result.restMask, mask);
});

test("rest days only apply from the day they were chosen", () => {
  const restDay = TODAY - 2;
  const mask = 1 << activity.weekdayOf(restDay);
  const days = { [TODAY - 1]: [10, 0, 0], [TODAY - 3]: [10, 0, 0] };
  // Chosen yesterday: the missed day before that still breaks the streak.
  assert.equal(activity.computeStreak(record(days, { w: [[TODAY - 1, mask, 5]] }), { now: NOW }).streak, 1);
  // Switching rest days later keeps the earlier choice for earlier days.
  const switched = record(days, { w: [[TODAY - 30, mask, 1], [TODAY - 1, 0, 9]] });
  const result = activity.computeStreak(switched, { now: NOW });
  assert.equal(result.streak, 2);
  assert.equal(result.restMask, 0);
});

test("merging keeps the larger total per day and converges in any order", () => {
  const a = { d: { 100: [5, 1, 0], 101: [10, 0, 1] }, s: 90, w: [[95, 1, 10], [99, 4, 30]] };
  const b = { d: { 100: [7, 0, 0], 102: [3, 3, 0] }, s: 95, w: [[95, 2, 20]] };
  const ab = activity.mergeActivity(a, b);
  const ba = activity.mergeActivity(b, a);
  assert.deepEqual(ab, ba);
  assert.deepEqual(plain(ab.d), { 100: [7, 1, 0], 101: [10, 0, 1], 102: [3, 3, 0] });
  assert.equal(ab.s, 90);
  assert.deepEqual(plain(ab.w), [[95, 2, 20], [99, 4, 30]]);
  assert.deepEqual(activity.mergeActivity(ab, b), ab);
});

test("a streak longer than the synced window survives through the anchor", () => {
  const days = {};
  for (let day = TODAY - 120; day <= TODAY - 1; day += 1) days[day] = [10, 0, 0];
  const full = record(days);
  assert.equal(activity.computeStreak(full, { now: NOW }).streak, 120);

  const synced = activity.buildSyncValue(full, { now: NOW });
  assert.ok(Object.keys(synced.d).length <= activity.SYNC_DAYS);
  assert.equal(synced.b[0], TODAY - activity.SYNC_DAYS);
  assert.equal(activity.computeStreak(synced, { now: NOW }).streak, 120);
  assert.ok(JSON.stringify(synced).length < 1500, "sync value stays small");

  // A device that only has the synced copy merges to the same streak.
  const other = activity.mergeActivity({ d: { [TODAY - 1]: [11, 0, 0] } }, synced);
  assert.equal(activity.computeStreak(other, { now: NOW }).streak, 120);
});

test("recordFromLocal folds the review log in and marks a cleared queue", async () => {
  const now = new Date();
  const reviewedAt = now.toISOString();
  const { activity: localActivity, storageData } = loadActivity({
    "lodVault.entries": {
      W1: { id: "W1", word: "Haus", url: "https://lod.lu/artikel/W1", study: true, history: true }
    },
    "lodVault.flashcardMeta": {
      W1: {
        totalReviews: 1,
        reviews: [{ date: reviewedAt, rating: 2, direction: "fwd" }],
        lastReviewedAt: reviewedAt,
        dueAt: new Date(Date.now() + 86400e3 * 2).toISOString(),
        interval: 1
      }
    }
  });

  const result = await localActivity.recordFromLocal({ now });
  assert.equal(result.changed, true);
  const stored = storageData["lodVault.activity"];
  const today = localActivity.toDayNumber(now);
  assert.deepEqual(plain(stored.d[today]), [1, 1, 1]);
  assert.equal(stored.s, today);
  // A cleared queue counts as a streak day even with one review.
  assert.equal(localActivity.computeStreak(stored, { now }).todayDone, true);

  const again = await localActivity.recordFromLocal({ now });
  assert.equal(again.changed, false);
});

test("the queue isn't cleared while words are still due", async () => {
  const now = new Date();
  const reviewedAt = now.toISOString();
  const { activity: localActivity, storageData } = loadActivity({
    "lodVault.entries": {
      W1: { id: "W1", word: "Haus", url: "https://lod.lu/artikel/W1", study: true, history: true },
      W2: { id: "W2", word: "Fra", url: "https://lod.lu/artikel/W2", study: true, history: true }
    },
    "lodVault.flashcardMeta": {
      W1: { totalReviews: 1, reviews: [{ date: reviewedAt, rating: 2 }], dueAt: new Date(Date.now() + 3 * 86400e3).toISOString(), interval: 2 }
    }
  });
  await localActivity.recordFromLocal({ now });
  assert.deepEqual(plain(storageData["lodVault.activity"].d[localActivity.toDayNumber(now)]), [1, 1, 0]);
});

test("the background worker records activity when review progress changes", async () => {
  const background = loadBackgroundScript({
    local: {
      "lodVault.entries": {
        W1: { id: "W1", word: "Haus", url: "https://lod.lu/artikel/W1", study: true, history: true }
      }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const reviewedAt = new Date().toISOString();
  await background.chrome.storage.local.set({
    "lodVault.flashcardMeta": {
      W1: { totalReviews: 1, reviews: [{ date: reviewedAt, rating: 2 }], lastReviewedAt: reviewedAt, dueAt: new Date(Date.now() + 2 * 86400e3).toISOString(), interval: 1 }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const stored = background.storageData["lodVault.activity"];
  assert.ok(stored, "activity written");
  const today = background.context.LodVaultActivity.toDayNumber(new Date());
  assert.equal(stored.d[today][0], 1);
});

test("activity syncs in its own key and gives two devices the same streak", async () => {
  const now = new Date();
  const today = activity.toDayNumber(now);
  const days = {};
  for (let day = today - 5; day <= today - 1; day += 1) days[day] = [10, 2, 0];
  const deviceA = loadSyncWithActivity({
    local: {
      "lodVault.entries": {
        W1: { id: "W1", word: "Haus", url: "https://lod.lu/artikel/W1", favorite: true }
      },
      "lodVault.activity": { d: days, s: today - 30 }
    }
  });
  await deviceA.sync.SyncAdapter.pushAll();
  const syncedValue = deviceA.syncStorageData["lodVault.a"];
  assert.ok(syncedValue, "activity pushed");
  assert.deepEqual(plain(syncedValue.d[today - 1]), [10, 2, 0]);

  // Another device with only its own short history pulls the same streak.
  const deviceB = loadSyncWithActivity({
    local: {
      "lodVault.entries": {
        W1: { id: "W1", word: "Haus", url: "https://lod.lu/artikel/W1", favorite: true }
      },
      "lodVault.activity": { d: { [today - 1]: [4, 0, 0] }, s: today - 2 }
    },
    sync: structuredClone(deviceA.syncStorageData)
  });
  await deviceB.sync.SyncAdapter.pullAll({ repush: false });
  const bLocal = deviceB.storageData["lodVault.activity"];
  assert.deepEqual(plain(bLocal.d[today - 1]), [10, 2, 0]);
  assert.equal(
    deviceB.activity.computeStreak(bLocal, { now }).streak,
    deviceA.activity.computeStreak(deviceA.storageData["lodVault.activity"], { now }).streak
  );
  assert.equal(deviceB.activity.computeStreak(bLocal, { now }).streak, 5);

  const stats = await deviceA.sync.inspectSyncStorage();
  assert.ok(stats.bytesUsedActivity > 0);
  assert.ok(stats.bytesUsedVault >= stats.bytesUsedActivity);
});

test("pushProgress writes activity next to review progress", async () => {
  const now = new Date();
  const today = activity.toDayNumber(now);
  const device = loadSyncWithActivity({
    local: {
      "lodVault.entries": {
        W1: { id: "W1", word: "Haus", url: "https://lod.lu/artikel/W1", favorite: true }
      }
    }
  });
  await device.sync.SyncAdapter.pushAll();
  assert.equal(device.syncStorageData["lodVault.a"], undefined, "nothing to sync yet");
  device.storageData["lodVault.activity"] = { d: { [today]: [3, 1, 0] }, s: today };
  await device.sync.SyncAdapter.pushProgress();
  assert.deepEqual(plain(device.syncStorageData["lodVault.a"].d[today]), [3, 1, 0]);
});

test("JSON backups carry daily activity and restore merges it", async () => {
  const TODAY_REAL = activity.toDayNumber(new Date());
  const { store, activity: localActivity, storageData } = loadActivity({
    "lodVault.activity": { d: { [TODAY_REAL - 10]: [10, 1, 0] }, s: TODAY_REAL - 20 }
  });
  const sections = await store.collectBackupSections();
  const json = store.buildJsonExport([], { sections });
  const parsed = JSON.parse(json);
  assert.deepEqual(plain(parsed.sections.activity.d), { [TODAY_REAL - 10]: [10, 1, 0] });

  // Backups without sections keep their old shape.
  assert.equal("sections" in JSON.parse(store.buildJsonExport([], {})), false);

  storageData["lodVault.activity"] = { d: { [TODAY_REAL - 9]: [2, 0, 0] } };
  parsed.entries = [{ id: "W1", word: "Haus", url: "https://lod.lu/artikel/W1", favorite: true }];
  const result = await store.importJson(JSON.stringify(parsed));
  assert.deepEqual(plain(result.sections), ["activity"]);
  const restored = await localActivity.readLocal();
  assert.deepEqual(plain(restored.d), { [TODAY_REAL - 10]: [10, 1, 0], [TODAY_REAL - 9]: [2, 0, 0] });
});

test("the popup Today card shows the synced streak", async () => {
  const { loadPopupScript } = require("./helpers/loaders");
  const now = new Date().toISOString();
  const flashcardMeta = {
    W1: { totalReviews: 1, reviews: [{ date: now, rating: 2 }], interval: 2, dueAt: new Date(Date.now() + 2 * 86400e3).toISOString() }
  };
  const entries = [{ id: "W1", word: "Haus", url: "https://lod.lu/artikel/W1", study: true, history: true }];
  const requested = [];
  const { dom } = await loadPopupScript({
    entries,
    flashcardMeta,
    globals: {
      LodVaultActivity: {
        async getStreakInfo(options) {
          requested.push(options);
          return { streak: 42 };
        }
      }
    }
  });
  assert.equal(dom.window.document.getElementById("study-activity").textContent, "42-day streak · 1 reviewed today");
  assert.ok(requested.length >= 1 && requested[0].meta.W1, "streak uses this device's log too");
});

test("the flashcards header shows the synced streak and follows updates", async () => {
  const { loadFlashcardsScript } = require("./helpers/loaders");
  let push = null;
  const { dom } = await loadFlashcardsScript({
    entries: [{ id: "W1", word: "Haus", url: "https://lod.lu/artikel/W1", study: true }],
    globals: {
      LodVaultActivity: {
        watchStreak(callback) {
          push = callback;
          callback({ streak: 12 });
          return () => {};
        }
      }
    }
  });
  const streak = dom.window.document.getElementById("stat-streak");
  assert.equal(streak.textContent, "12");
  push({ streak: 13 });
  assert.equal(streak.textContent, "13");
});
