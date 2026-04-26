const test = require("node:test");
const assert = require("node:assert/strict");

const { loadSharedStore } = require("./helpers/loaders");

test("getIdFromUrl extracts and decodes article ids", () => {
  const { store } = loadSharedStore();

  assert.equal(store.getIdFromUrl("https://lod.lu/artikel/HAUS1"), "HAUS1");
  assert.equal(store.getIdFromUrl("https://lod.lu/artikel/M%C3%84NNCHEN1?x=1#y"), "MÄNNCHEN1");
  assert.equal(store.getIdFromUrl("https://lod.lu/"), "");
});

test("normalizeEntry trims values and derives id from the url", () => {
  const { store } = loadSharedStore();

  const entry = store.normalizeEntry({
    url: "https://lod.lu/artikel/HAUS1",
    word: "  Haus kopéiert  ",
    pos: "  noun ",
    note: "  my note  ",
    translations: {
      en: " house ",
      fr: "   ",
      de: "Haus"
    },
    favorite: 1,
    study: 0
  });

  assert.equal(entry.id, "HAUS1");
  assert.equal(entry.word, "Haus");
  assert.equal(entry.pos, "noun");
  assert.equal(entry.note, "my note");
  assert.deepEqual({ ...entry.translations }, { en: "house", de: "Haus" });
  assert.equal(entry.favorite, true);
  assert.equal(entry.study, false);
  assert.equal(entry.history, false);
});


test("auto mode setting defaults to off and can be toggled on", async () => {
  const { store, storageData } = loadSharedStore();

  assert.equal(await store.getAutoMode(), false);
  assert.equal(await store.setAutoMode(true), true);
  assert.equal(await store.getAutoMode(), true);
  assert.equal(storageData[store.SETTINGS_KEY].autoMode, true);
});

test("toggleList saves a new entry and removes it when the last active list is toggled off", async () => {
  const { store, storageData } = loadSharedStore();
  const entry = {
    id: "HAUS1",
    word: "Haus",
    url: "https://lod.lu/artikel/HAUS1",
    translations: { en: "house" }
  };

  const saved = await store.toggleList(entry, "favorite");
  assert.equal(saved.favorite, true);
  assert.equal(saved.study, false);
  assert.equal(storageData[store.STORAGE_KEY].HAUS1.word, "Haus");

  const removed = await store.toggleList(entry, "favorite");
  assert.equal(removed, null);
  assert.deepEqual(storageData[store.STORAGE_KEY], {});
});

test("toggleList preserves existing list membership when adding another list", async () => {
  const { store, storageData } = loadSharedStore({
    ["lodVault.entries"]: {
      HAUS1: {
        id: "HAUS1",
        word: "Haus",
        url: "https://lod.lu/artikel/HAUS1",
        favorite: true,
        study: false,
        note: "old"
      }
    }
  });

  const updated = await store.toggleList({
    id: "HAUS1",
    word: "Haus",
    url: "https://lod.lu/artikel/HAUS1",
    translations: { en: "house" }
  }, "study");

  assert.equal(updated.favorite, true);
  assert.equal(updated.study, true);
  assert.equal(updated.note, "old");
  assert.equal(storageData[store.STORAGE_KEY].HAUS1.study, true);
});

test("recordAutoVisit adds the word to study and history and increments visits", async () => {
  const { store, storageData } = loadSharedStore();

  const first = await store.recordAutoVisit({
    id: "HAUS1",
    word: "Haus",
    url: "https://lod.lu/artikel/HAUS1",
    translations: { en: "house" }
  });

  const second = await store.recordAutoVisit({
    id: "HAUS1",
    word: "Haus",
    url: "https://lod.lu/artikel/HAUS1"
  });

  assert.equal(first.study, true);
  assert.equal(first.history, true);
  assert.equal(second.visitCount, 2);
  assert.equal(storageData[store.STORAGE_KEY].HAUS1.history, true);
  assert.equal(storageData[store.STORAGE_KEY].HAUS1.study, true);
});

test("toggleList keeps history entries when study is turned off", async () => {
  const { store, storageData } = loadSharedStore({
    ["lodVault.entries"]: {
      HAUS1: {
        id: "HAUS1",
        word: "Haus",
        url: "https://lod.lu/artikel/HAUS1",
        study: true,
        history: true,
        visitCount: 3,
        lastVisitedAt: "2025-01-03T00:00:00.000Z"
      }
    }
  });

  const updated = await store.toggleList({
    id: "HAUS1",
    word: "Haus",
    url: "https://lod.lu/artikel/HAUS1"
  }, "study");

  assert.equal(updated.study, false);
  assert.equal(updated.history, true);
  assert.equal(updated.visitCount, 3);
  assert.equal(storageData[store.STORAGE_KEY].HAUS1.history, true);
});


test("getEntries migrates legacy storage automatically", async () => {
  const { store, storageData } = loadSharedStore({
    ["lodWrapper.entries"]: {
      HAUS1: {
        id: "HAUS1",
        word: "Haus",
        url: "https://lod.lu/artikel/HAUS1",
        favorite: true,
        createdAt: "2025-01-01T00:00:00.000Z"
      }
    }
  });

  const entries = await store.getEntries();

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "HAUS1");
  assert.ok(storageData[store.STORAGE_KEY]);
  assert.equal("lodWrapper.entries" in storageData, false);
});

test("saveNote updates the note and removeEntry deletes the item", async () => {
  const { store, storageData } = loadSharedStore({
    ["lodVault.entries"]: {
      HAUS1: {
        id: "HAUS1",
        word: "Haus",
        url: "https://lod.lu/artikel/HAUS1",
        favorite: true
      }
    }
  });

  const updated = await store.saveNote("HAUS1", "  remember this  ");
  assert.equal(updated.note, "remember this");
  assert.equal(storageData[store.STORAGE_KEY].HAUS1.note, "remember this");

  await store.removeEntry("HAUS1");
  assert.deepEqual(storageData[store.STORAGE_KEY], {});
});

test("removeFromHistory clears history and deletes orphaned history-only entries", async () => {
  const { store, storageData } = loadSharedStore({
    ["lodVault.entries"]: {
      HAUS1: {
        id: "HAUS1",
        word: "Haus",
        url: "https://lod.lu/artikel/HAUS1",
        history: true,
        visitCount: 2,
        lastVisitedAt: "2025-01-01T00:00:00.000Z"
      },
      BEEM1: {
        id: "BEEM1",
        word: "Beem",
        url: "https://lod.lu/artikel/BEEM1",
        study: true,
        history: true,
        visitCount: 1
      }
    }
  });

  const deleted = await store.removeFromHistory("HAUS1");
  const kept = await store.removeFromHistory("BEEM1");

  assert.equal(deleted, null);
  assert.equal(storageData[store.STORAGE_KEY].HAUS1, undefined);
  assert.equal(kept.history, false);
  assert.equal(kept.study, true);
  assert.equal(storageData[store.STORAGE_KEY].BEEM1.history, false);
});

test("importJson merges flags, keeps valid entries only, and prefers the imported note", async () => {
  const { store, storageData } = loadSharedStore({
    ["lodVault.entries"]: {
      HAUS1: {
        id: "HAUS1",
        word: "Haus",
        url: "https://lod.lu/artikel/HAUS1",
        favorite: true,
        study: false,
        note: "old note"
      }
    }
  });

  const result = await store.importJson(JSON.stringify({
    entries: [
      {
        id: "HAUS1",
        word: "Haus",
        url: "https://lod.lu/artikel/HAUS1",
        study: true,
        note: "new note"
      },
      {
        id: "BEEM1",
        word: "Beem",
        url: "https://lod.lu/artikel/BEEM1",
        favorite: true,
        translations: { en: "tree" }
      },
      {
        id: "INVALID1",
        word: "Ignored",
        url: "https://lod.lu/artikel/INVALID1",
        favorite: false,
        study: false
      },
      {
        id: "GANG1",
        word: "Gang",
        url: "https://lod.lu/artikel/GANG1",
        history: true,
        visitCount: 4
      },
      {
        id: "",
        word: "No id",
        favorite: true
      }
    ]
  }));

  assert.deepEqual({ ...result }, { imported: 3, total: 3 });
  assert.equal(storageData[store.STORAGE_KEY].HAUS1.favorite, true);
  assert.equal(storageData[store.STORAGE_KEY].HAUS1.study, true);
  assert.equal(storageData[store.STORAGE_KEY].HAUS1.note, "new note");
  assert.equal(storageData[store.STORAGE_KEY].BEEM1.word, "Beem");
  assert.equal(storageData[store.STORAGE_KEY].GANG1.history, true);
  assert.equal(storageData[store.STORAGE_KEY].GANG1.visitCount, 4);
  assert.equal(storageData[store.STORAGE_KEY].INVALID1, undefined);
});

test("buildJsonExport uses the lodvault app identifier", () => {
  const { store } = loadSharedStore();

  const json = store.buildJsonExport([
    {
      id: "HAUS1",
      word: "Haus",
      url: "https://lod.lu/artikel/HAUS1",
      favorite: true
    }
  ]);

  const parsed = JSON.parse(json);
  assert.equal(parsed.app, "lodvault");
  assert.equal(parsed.version, 1);
  assert.equal(parsed.entries[0].id, "HAUS1");
});

test("buildSearchText includes translations and notes in lowercase", () => {
  const { store } = loadSharedStore();

  const text = store.buildSearchText({
    word: "Haus",
    pos: "noun",
    note: "Stone house",
    translations: { en: "House", fr: "Maison" }
  });

  assert.match(text, /haus/);
  assert.match(text, /stone house/);
  assert.match(text, /maison/);
});

test("buildExportHtml renders both sections and can skip the inline search script", () => {
  const { store } = loadSharedStore();
  const html = store.buildExportHtml([
    {
      id: "HAUS1",
      word: "Haus",
      url: "https://lod.lu/artikel/HAUS1",
      favorite: true,
      study: false,
      translations: { en: "house" }
    },
    {
      id: "BEEM1",
      word: "Beem",
      url: "https://lod.lu/artikel/BEEM1",
      favorite: false,
      study: true
    }
  ], { includeInlineScript: false });

  assert.match(html, /Saved words \(2\)/);
  assert.match(html, /HAUS1/);
  assert.match(html, /chip-list-favorite/);
  assert.match(html, /chip-list-study/);
  assert.doesNotMatch(html, /input.addEventListener\('input', applySearch\)/);
});
