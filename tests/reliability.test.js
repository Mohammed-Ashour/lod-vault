const test = require("node:test");
const assert = require("node:assert/strict");

const {
  loadSharedStore,
  loadSyncScript,
  loadBackgroundScript,
  loadFlashcardsScript,
  loadPopupScript
} = require("./helpers/loaders");

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function makeEntry(overrides = {}) {
  return {
    id: "HAUS1",
    word: "Haus",
    url: "https://lod.lu/artikel/HAUS1",
    pos: "Substantiv",
    translations: { en: "house" },
    favorite: true,
    study: true,
    history: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

const HAUS_API_ENTRY = {
  lod_id: "HAUS1",
  lemma: "Haus",
  partOfSpeechLabel: "Substantiv",
  microStructures: [{
    grammaticalUnits: [{
      meanings: [{
        targetLanguages: {
          en: { parts: [{ type: "translation", content: "house" }] }
        }
      }]
    }]
  }]
};

function stubEntryApi(context) {
  context.fetch = async () => ({
    ok: true,
    async json() {
      return { entry: HAUS_API_ENTRY };
    }
  });
}

test("history repair restores words damaged by the old HTML scraper and keeps the note", async () => {
  const { store, storageData, context } = loadSharedStore({
    "lodVault.entries": {
      HAUS1: makeEntry({
        word: "HAUS1",
        note: "my note",
        favorite: false,
        study: true,
        history: true,
        visitCount: 3,
        translations: {
          en: "Haiser · Haus · house \n \n  building · kee Pluriel",
          nl: "huis \n \n  woning"
        }
      })
    }
  });
  stubEntryApi(context);

  assert.equal(await store.queueDamagedHistoryEntries(), 1);
  await store.resumeHistoryImportHydration();

  const repaired = storageData[store.STORAGE_KEY].HAUS1;
  assert.equal(repaired.word, "Haus");
  assert.deepEqual(repaired.translations, { en: "house" });
  assert.equal(repaired.note, "my note");
  assert.equal(repaired.study, true);
  assert.equal(repaired.visitCount, 3);
});

test("history repair leaves healthy words alone, including all-caps lemmas with data", async () => {
  const { store } = loadSharedStore({
    "lodVault.entries": {
      HAUS1: makeEntry(),
      EU1: makeEntry({ id: "EU1", word: "EU", url: "https://lod.lu/artikel/EU1" })
    }
  });

  assert.equal(store.isDamagedHistoryEntry(makeEntry()), false);
  assert.equal(await store.queueDamagedHistoryEntries(), 0);
});

test("history repair also picks up placeholder words that never hydrated", () => {
  const { store } = loadSharedStore();
  assert.equal(store.isDamagedHistoryEntry(makeEntry({ word: "HAUS", pos: "" })), true);
});

test("sync push keeps working past the deletion item limit and keeps the newest records", async () => {
  const deleted = {};
  for (let index = 0; index < 1500; index += 1) {
    deleted[`WUERD${index}`] = new Date(Date.UTC(2026, 0, 1) + index * 60000).toISOString();
  }
  const { sync, syncStorageData } = loadSyncScript({
    local: { "lodVault.entries": { HAUS1: makeEntry() }, "lodVault.deleted": deleted }
  });

  const result = await sync.SyncAdapter.pushAll();

  assert.equal(result.ok, true);
  const stored = syncStorageData[sync.SYNC_DELETED_KEY];
  assert.ok(JSON.stringify(stored).length + sync.SYNC_DELETED_KEY.length <= 8192);
  assert.ok(stored.WUERD1499, "newest deletion is kept");
  assert.equal(stored.WUERD0, undefined, "oldest deletion is dropped");
  assert.ok(syncStorageData["lodVault.e.0"], "entries are still pushed");
});

test("a list removal beats an older copy, even when that copy changed something else later", () => {
  const { store } = loadSharedStore();
  const merged = store.mergeVaultVersions(
    { HAUS1: makeEntry({ favorite: false, listsUpdatedAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" }) },
    { HAUS1: makeEntry({ favorite: true, listsUpdatedAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" }) }
  ).HAUS1;

  assert.equal(merged.favorite, false);
  assert.equal(merged.study, true);
});

test("a cleared note stays cleared, but an unrelated newer update can't erase a note", () => {
  const { store } = loadSharedStore();
  const cleared = store.mergeVaultVersions(
    { HAUS1: makeEntry({ note: "", noteUpdatedAt: "2026-06-01T00:00:00.000Z" }) },
    { HAUS1: makeEntry({ note: "old note", noteUpdatedAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" }) }
  ).HAUS1;
  assert.equal(cleared.note, "");

  const kept = store.mergeVaultVersions(
    { HAUS1: makeEntry({ note: "keep me", noteUpdatedAt: "2026-02-01T00:00:00.000Z" }) },
    { HAUS1: makeEntry({ note: "", updatedAt: "2026-07-01T00:00:00.000Z" }) }
  ).HAUS1;
  assert.equal(kept.note, "keep me");
});

test("entries without change timestamps still merge as a union, so nothing is lost", () => {
  const { store } = loadSharedStore();
  const merged = store.mergeVaultVersions(
    { HAUS1: makeEntry({ favorite: false, study: true, note: "" }) },
    { HAUS1: makeEntry({ favorite: true, study: false, note: "old", updatedAt: "2026-07-01T00:00:00.000Z" }) }
  ).HAUS1;

  assert.equal(merged.favorite, true);
  assert.equal(merged.study, true);
  assert.equal(merged.note, "old");
});

test("removing a favorite and clearing a note reach another device through sync", async () => {
  const laptop = loadSyncScript({ local: { "lodVault.entries": { HAUS1: makeEntry({ note: "old" }) } } });
  await wait(1100); // Sync timestamps have one-second resolution.
  await laptop.store.toggleList(makeEntry(), "favorite");
  await laptop.store.saveNote("HAUS1", "");
  await laptop.sync.SyncAdapter.pushAll();

  const phone = loadSyncScript({
    local: { "lodVault.entries": { HAUS1: makeEntry({ note: "old" }) } },
    sync: structuredClone(laptop.syncStorageData)
  });
  await phone.sync.SyncAdapter.pullAll({ repush: false });

  const entry = phone.storageData["lodVault.entries"].HAUS1;
  assert.equal(entry.favorite, false);
  assert.equal(entry.study, true);
  assert.equal(entry.note, "");
});

test("a repeat auto visit doesn't outrank a list removal from another device", async () => {
  const { store, storageData } = loadSharedStore({
    "lodVault.entries": { HAUS1: makeEntry({ history: true, visitCount: 1 }) }
  });
  await store.recordAutoVisit(makeEntry());
  assert.equal(storageData[store.STORAGE_KEY].HAUS1.listsUpdatedAt, undefined);
});

test("streak and day keys follow the learner's time zone", () => {
  const previousTimeZone = process.env.TZ;
  const { store } = loadSharedStore();

  try {
    process.env.TZ = "Europe/Luxembourg";
    assert.equal(store.toLocalDateKey("2026-11-04T23:30:00.000Z"), "2026-11-05");

    process.env.TZ = "America/Los_Angeles";
    assert.equal(store.toLocalDateKey("2026-11-04T05:00:00.000Z"), "2026-11-03");
    assert.equal(store.toLocalDateKey("2026-11-04"), "2026-11-04");

    for (const timeZone of ["Europe/Luxembourg", "America/Los_Angeles", "Asia/Tokyo", "UTC"]) {
      process.env.TZ = timeZone;
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      assert.equal(
        store.computeFlashcardStreak([store.toLocalDateKey(today), store.toLocalDateKey(yesterday)]),
        2,
        timeZone
      );
    }
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

test("Anki export keeps one row per word when a note has line breaks or tabs", () => {
  const { context } = loadSharedStore();
  const output = context.LodVaultEntryPresenter.buildAnkiExport([
    makeEntry({ note: "line one\nline two\twith tab" })
  ]);
  const rows = output.split("\n").filter((line) => !line.startsWith("#"));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].split("\t").length, 7);
  assert.match(rows[0], /line one<br>line two with tab/);
});

test("a double click on a rating records one review and doesn't skip a card", async () => {
  const reviews = [];
  const { dom } = await loadFlashcardsScript({
    entries: [
      makeEntry(),
      makeEntry({ id: "BEEM1", word: "Beem", url: "https://lod.lu/artikel/BEEM1" }),
      makeEntry({ id: "KAFFI1", word: "Kaffi", url: "https://lod.lu/artikel/KAFFI1" })
    ],
    storeOverrides: {
      async recordFlashcardReview(id) {
        reviews.push(id);
        await wait(5);
      }
    }
  });
  const { document } = dom.window;
  const wordBefore = document.getElementById("card-word")?.textContent;

  document.getElementById("flip-card").click();
  const ratingGood = document.querySelector('[data-rating="2"]');
  ratingGood.click();
  ratingGood.click();
  await wait(40);

  assert.equal(reviews.length, 1);
  assert.notEqual(document.getElementById("card-word")?.textContent, wordBefore);
});

test("the first edit after a service worker restart is pushed, not just merged", async () => {
  const background = loadBackgroundScript();
  const calls = [];
  const adapter = background.context.LodVaultSync.SyncAdapter;
  adapter.init = async () => { calls.push("init"); return { ok: true, mode: "merge" }; };
  adapter.pushEntry = async (id) => { calls.push(`pushEntry:${id}`); return { ok: true }; };
  adapter.pushAll = async () => { calls.push("pushAll"); return { ok: true }; };

  await background.chrome.storage.local.set({ "lodVault.entries": { HAUS1: makeEntry() } });
  await wait(2200);

  assert.equal(calls[0], "init");
  assert.ok(calls.slice(1).some((call) => call.startsWith("push")), `expected a push after init, got ${calls}`);
});

test("automatic sync failures are stored and shown on the toolbar until a push succeeds", async () => {
  const background = loadBackgroundScript();
  const badges = [];
  background.chrome.action = {
    setBadgeText: (details) => badges.push(details.text),
    setBadgeBackgroundColor() {},
    setTitle() {}
  };
  const adapter = background.context.LodVaultSync.SyncAdapter;
  adapter.init = async () => ({ ok: true });
  let nextResult = { ok: false, reason: "quota-exceeded" };
  adapter.pushEntry = async () => nextResult;
  adapter.pushAll = async () => nextResult;

  await background.chrome.storage.local.set({ "lodVault.entries": { HAUS1: makeEntry() } });
  await wait(2200);

  assert.equal(background.storageData["lodVault.syncIssue"].reason, "quota-exceeded");
  assert.equal(badges.at(-1), "!");

  nextResult = { ok: true };
  await background.chrome.storage.local.set({
    "lodVault.entries": { HAUS1: makeEntry({ favorite: false, updatedAt: "2026-02-01T00:00:00.000Z" }) }
  });
  await wait(2200);

  assert.equal(background.storageData["lodVault.syncIssue"], undefined);
  assert.equal(badges.at(-1), "");
});

test("the Stats pane explains a stored sync failure and reassures about local words", async () => {
  const { dom } = await loadPopupScript({
    entries: [makeEntry()],
    storeOverrides: {
      async getSyncIssue() {
        return { reason: "quota-exceeded" };
      }
    }
  });
  const { document } = dom.window;

  document.getElementById("stats-tab").click();
  await wait(20);

  const health = document.getElementById("sync-health-status");
  assert.equal(health.classList.contains("is-hidden"), false);
  assert.match(health.textContent, /storage quota exceeded/);
  assert.match(health.textContent, /safe on this device/);
});
