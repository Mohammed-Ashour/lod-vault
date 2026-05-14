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

test("settings default to auto mode off with default sync languages and can be updated", async () => {
  const { store, storageData } = loadSharedStore();

  assert.equal(await store.getAutoMode(), false);
  assert.deepEqual(Array.from(await store.getSyncLanguages()), ["en", "fr", "de"]);

  assert.equal(await store.setAutoMode(true), true);
  assert.deepEqual(Array.from(await store.setSyncLanguages(["pt", "nl", "pt", "en", "fr"])), ["pt", "nl", "en"]);

  assert.equal(await store.getAutoMode(), true);
  assert.deepEqual(Array.from(await store.getSyncLanguages()), ["pt", "nl", "en"]);
  assert.equal(storageData[store.SETTINGS_KEY].autoMode, true);
  assert.deepEqual(storageData[store.SETTINGS_KEY].syncLanguages, ["pt", "nl", "en"]);
});

test("setSyncLanguages rewrites existing saved translations to the selected languages", async () => {
  const { store, storageData } = loadSharedStore({
    ["lodVault.entries"]: {
      HAUS1: {
        id: "HAUS1",
        word: "Haus",
        url: "https://lod.lu/artikel/HAUS1",
        study: true,
        translations: {
          en: "house",
          fr: "maison",
          de: "Haus",
          pt: "casa"
        }
      }
    }
  });

  assert.deepEqual(Array.from(await store.setSyncLanguages(["en", "de"])), ["en", "de"]);
  assert.deepEqual(storageData[store.STORAGE_KEY].HAUS1.translations, { en: "house", de: "Haus" });
});

test("setAutoMode updates cached settings immediately even when storage change events are delayed", async () => {
  const { store, flushStorageEvents } = loadSharedStore({}, { asyncStorageEvents: true });

  assert.equal((await store.getSettings()).autoMode, false);
  await store.setAutoMode(true);
  assert.equal((await store.getSettings()).autoMode, true);

  await flushStorageEvents();
  assert.equal((await store.getSettings()).autoMode, true);
});

test("setSyncLanguages updates cached settings immediately even when storage change events are delayed", async () => {
  const { store, flushStorageEvents } = loadSharedStore({}, { asyncStorageEvents: true });

  assert.deepEqual(Array.from((await store.getSettings()).syncLanguages), ["en", "fr", "de"]);
  await store.setSyncLanguages(["pt", "nl"]);
  assert.deepEqual(Array.from((await store.getSettings()).syncLanguages), ["pt", "nl"]);

  await flushStorageEvents();
  assert.deepEqual(Array.from((await store.getSettings()).syncLanguages), ["pt", "nl"]);
});

test("importJson updates cached settings immediately even when storage change events are delayed", async () => {
  const { store, flushStorageEvents } = loadSharedStore({}, { asyncStorageEvents: true });

  await store.getSettings();
  await store.importJson(JSON.stringify({
    app: "lodvault",
    version: 2,
    settings: {
      autoMode: true,
      syncLanguages: ["nl"]
    },
    entries: []
  }));

  const immediateSettings = await store.getSettings();
  assert.equal(immediateSettings.autoMode, true);
  assert.deepEqual(Array.from(immediateSettings.syncLanguages), ["nl"]);

  await flushStorageEvents();
  const settledSettings = await store.getSettings();
  assert.equal(settledSettings.autoMode, true);
  assert.deepEqual(Array.from(settledSettings.syncLanguages), ["nl"]);
});

test("toggleList saves a new entry and removes it when the last active list is toggled off", async () => {
  const { store, storageData } = loadSharedStore({
    ["lodVault.settings"]: {
      syncLanguages: ["en", "de"]
    }
  });
  const entry = {
    id: "HAUS1",
    word: "Haus",
    url: "https://lod.lu/artikel/HAUS1",
    translations: { en: "house", fr: "maison", pt: "casa", de: "Haus" }
  };

  const saved = await store.toggleList(entry, "favorite");
  assert.equal(saved.favorite, true);
  assert.equal(saved.study, false);
  assert.equal(storageData[store.STORAGE_KEY].HAUS1.word, "Haus");
  assert.deepEqual(storageData[store.STORAGE_KEY].HAUS1.translations, { en: "house", de: "Haus" });

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

test("importBrowserHistory adds only missing words from lod article history", async () => {
  const { store, storageData, chrome } = loadSharedStore({
    ["lodVault.entries"]: {
      HAUS1: {
        id: "HAUS1",
        word: "Haus",
        url: "https://lod.lu/artikel/HAUS1",
        favorite: true
      }
    }
  });

  chrome.history = {
    async search() {
      return [
        {
          url: "https://lod.lu/artikel/HAUS1",
          title: "Haus - LOD",
          visitCount: 10,
          lastVisitTime: Date.parse("2025-04-01T09:00:00.000Z")
        },
        {
          url: "https://www.lod.lu/artikel/BEEM1",
          title: "Beem - LOD",
          visitCount: 3,
          lastVisitTime: Date.parse("2025-04-02T09:00:00.000Z")
        },
        {
          url: "https://example.com/not-lod",
          title: "Ignore me"
        },
        {
          url: "https://lod.lu/artikel/M%C3%84NNCHEN1",
          title: "",
          visitCount: 0,
          lastVisitTime: Date.parse("2025-04-03T09:00:00.000Z")
        }
      ];
    }
  };

  const result = await store.importBrowserHistory({ maxResults: 200 });

  assert.equal(result.imported, 2);
  assert.equal(result.scanned, 4);
  assert.equal(result.skippedExisting, 1);
  assert.equal(result.ignored, 1);
  assert.equal(result.total, 3);

  assert.equal(storageData[store.STORAGE_KEY].HAUS1.favorite, true);
  assert.equal(storageData[store.STORAGE_KEY].BEEM1.study, true);
  assert.equal(storageData[store.STORAGE_KEY].BEEM1.history, true);
  assert.equal(storageData[store.STORAGE_KEY].BEEM1.visitCount, 3);
  assert.equal(storageData[store.STORAGE_KEY]["MÄNNCHEN1"].word, "MÄNNCHEN");
  assert.equal(storageData[store.STORAGE_KEY]["MÄNNCHEN1"].visitCount, 1);
});

test("importBrowserHistory can re-import entries that were manually deleted", async () => {
  const { store, storageData, chrome } = loadSharedStore({
    local: {
      "lodVault.deleted": {
        BEEM1: "2025-04-05T09:00:00.000Z"
      }
    }
  });

  chrome.history = {
    async search() {
      return [
        {
          url: "https://lod.lu/artikel/BEEM1",
          title: "Beem - LOD",
          visitCount: 2,
          lastVisitTime: Date.parse("2025-04-06T09:00:00.000Z")
        }
      ];
    }
  };

  const result = await store.importBrowserHistory({ maxResults: 20 });

  assert.equal(result.imported, 1);
  assert.equal(result.skippedExisting, 0);
  assert.equal(storageData[store.STORAGE_KEY].BEEM1.word, "Beem");
  assert.equal(storageData[store.STORAGE_KEY].BEEM1.history, true);
  assert.equal(storageData[store.DELETED_KEY], undefined);
});

test("importBrowserHistory queues safe hydration and records visible progress", async () => {
  const { store, storageData, chrome, context } = loadSharedStore();

  chrome.history = {
    async search() {
      return [
        {
          url: "https://lod.lu/artikel/BEEM1",
          title: "Beem - LOD",
          visitCount: 2,
          lastVisitTime: Date.parse("2025-04-02T09:00:00.000Z")
        }
      ];
    }
  };

  context.fetch = async () => ({
    ok: true,
    async text() {
      return `
        <!doctype html>
        <html lang="en">
          <head>
            <meta name="description" content="noun">
            <meta property="og:title" content="Beem - LOD">
          </head>
          <body>
            <main>
              <h1>Beem kopéiert</h1>
              <section class="microstructures">
                <div class="targetLanguages">
                  <div class="en"><span class="content">tree</span></div>
                  <div class="fr"><span class="content">arbre</span></div>
                </div>
              </section>
            </main>
          </body>
        </html>
      `;
    }
  });

  const result = await store.importBrowserHistory({ maxResults: 20 });
  assert.equal(result.imported, 1);
  assert.ok(result.hydrationQueued >= 1);

  await store.resumeHistoryImportHydration();

  assert.deepEqual(storageData[store.STORAGE_KEY].BEEM1.translations, {
    en: "tree",
    fr: "arbre"
  });
  assert.equal(storageData[store.STORAGE_KEY].BEEM1.pos, "noun");

  const importState = await store.getHistoryImportState();
  assert.equal(importState.hydrated, 1);
  assert.equal(importState.failed, 0);
  assert.equal(importState.queue.length, 0);
  assert.equal(importState.status, "complete");
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

test("getEntries merges legacy storage into the current key before removing it", async () => {
  const { store, storageData } = loadSharedStore({
    ["lodVault.entries"]: {},
    ["lodWrapper.entries"]: {
      HAUS1: {
        id: "HAUS1",
        word: "Haus",
        url: "https://lod.lu/artikel/HAUS1",
        favorite: true
      }
    }
  });

  const entries = await store.getEntries();

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "HAUS1");
  assert.equal(storageData[store.STORAGE_KEY].HAUS1.word, "Haus");
  assert.equal("lodWrapper.entries" in storageData, false);
});

test("getEntries recovers legacy entries with no list flags and persists them", async () => {
  const { store, storageData } = loadSharedStore({
    ["lodVault.entries"]: {
      HAUS1: {
        id: "HAUS1",
        word: "Haus",
        url: "https://lod.lu/artikel/HAUS1",
        visitCount: 2,
        lastVisitedAt: "2025-01-03T00:00:00.000Z"
      },
      BEEM1: {
        id: "BEEM1",
        word: "Beem",
        url: "https://lod.lu/artikel/BEEM1",
        saved: true
      }
    }
  });

  const entries = await store.getEntries();

  assert.equal(entries.length, 2);
  assert.equal(entries.find((entry) => entry.id === "HAUS1").study, true);
  assert.equal(entries.find((entry) => entry.id === "HAUS1").history, true);
  assert.equal(entries.find((entry) => entry.id === "HAUS1").visitCount, 2);
  assert.equal(entries.find((entry) => entry.id === "BEEM1").study, true);
  assert.equal(storageData[store.STORAGE_KEY].HAUS1.study, true);
  assert.equal(storageData[store.STORAGE_KEY].HAUS1.history, true);
  assert.equal(storageData[store.STORAGE_KEY].BEEM1.study, true);
});

test("saveEntryMap writes entries without touching backup snapshots", async () => {
  const { store, storageData, chrome } = loadSharedStore();

  const originalSet = chrome.storage.local.set;
  let backupWrites = 0;

  chrome.storage.local.set = async (values) => {
    if (Object.prototype.hasOwnProperty.call(values || {}, store.BACKUP_KEY)) {
      backupWrites += 1;
    }
    return originalSet(values);
  };

  const saved = await store.toggleList({
    id: "HAUS1",
    word: "Haus",
    url: "https://lod.lu/artikel/HAUS1"
  }, "study");

  assert.equal(backupWrites, 0);
  assert.equal(saved.study, true);
  assert.equal(storageData[store.STORAGE_KEY].HAUS1.study, true);
  assert.equal(storageData[store.BACKUP_KEY], undefined);
});

test("local backups keep recoverable snapshots and can be restored", async () => {
  const { store } = loadSharedStore();

  await store.toggleList({
    id: "HAUS1",
    word: "Haus",
    url: "https://lod.lu/artikel/HAUS1"
  }, "study");

  await store.toggleList({
    id: "BEEM1",
    word: "Beem",
    url: "https://lod.lu/artikel/BEEM1"
  }, "study");

  const created = await store.createVaultBackup("manual-test");
  assert.equal(created.created, true);

  const backups = await store.getVaultBackups();
  assert.ok(backups.length >= 1);

  const targetBackup = backups[0];
  await store.removeEntry("HAUS1");
  await store.removeEntry("BEEM1");

  const restore = await store.restoreVaultBackup(targetBackup.id);
  const restoredEntries = await store.getEntries();

  assert.equal(restore.restored, true);
  assert.ok(restoredEntries.length >= 2);
});

test("local backups can be deleted", async () => {
  const { store } = loadSharedStore();

  await store.toggleList({
    id: "HAUS1",
    word: "Haus",
    url: "https://lod.lu/artikel/HAUS1"
  }, "study");

  await store.toggleList({
    id: "BEEM1",
    word: "Beem",
    url: "https://lod.lu/artikel/BEEM1"
  }, "study");

  await store.createVaultBackup("manual-test");
  const backups = await store.getVaultBackups();
  assert.ok(backups.length >= 1);

  const deleted = await store.deleteVaultBackup(backups[0].id);
  const remaining = await store.getVaultBackups();

  assert.equal(deleted.deleted, true);
  assert.equal(remaining.some((item) => item.id === backups[0].id), false);
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

test("refreshEntryData enriches an existing saved entry without changing its list membership", async () => {
  const { store, storageData } = loadSharedStore({
    ["lodVault.entries"]: {
      HAUS1: {
        id: "HAUS1",
        word: "Haus",
        url: "https://lod.lu/artikel/HAUS1",
        study: true,
        history: true,
        visitCount: 2,
        lastVisitedAt: "2025-01-01T00:00:00.000Z",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z"
      }
    },
    ["lodVault.settings"]: {
      syncLanguages: ["en"]
    }
  });

  const refreshed = await store.refreshEntryData({
    id: "HAUS1",
    word: "Haus",
    url: "https://lod.lu/artikel/HAUS1",
    pos: "noun",
    translations: { en: "house", fr: "maison" },
    example: "Dëst ass en Haus."
  });

  assert.equal(refreshed.study, true);
  assert.equal(refreshed.history, true);
  assert.equal(refreshed.visitCount, 2);
  assert.equal(refreshed.pos, "noun");
  assert.deepEqual(storageData[store.STORAGE_KEY].HAUS1.translations, { en: "house" });
  assert.equal(storageData[store.STORAGE_KEY].HAUS1.example, "Dëst ass en Haus.");
});

test("importJson merges flags, keeps valid entries only, prefers the imported note, and restores supported settings", async () => {
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
    },
    ["lodVault.settings"]: {
      autoMode: false
    }
  });

  const result = await store.importJson(JSON.stringify({
    app: "lodvault",
    version: 2,
    settings: {
      autoMode: true
    },
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
  assert.deepEqual(storageData[store.STORAGE_KEY].BEEM1.translations, { en: "tree" });
  assert.equal(storageData[store.STORAGE_KEY].GANG1.history, true);
  assert.equal(storageData[store.STORAGE_KEY].GANG1.visitCount, 4);
  assert.equal(storageData[store.STORAGE_KEY].INVALID1, undefined);
  assert.equal(storageData[store.SETTINGS_KEY].autoMode, true);
  assert.deepEqual(storageData[store.SETTINGS_KEY].syncLanguages, ["en", "fr", "de"]);
});

test("buildJsonExport uses the lodvault app identifier and includes normalized settings", () => {
  const { store } = loadSharedStore();

  const json = store.buildJsonExport([
    {
      id: "HAUS1",
      word: "Haus",
      url: "https://lod.lu/artikel/HAUS1",
      favorite: true
    }
  ], {
    settings: {
      autoMode: 1
    }
  });

  const parsed = JSON.parse(json);
  assert.equal(parsed.app, "lodvault");
  assert.equal(parsed.version, store.EXPORT_VERSION);
  assert.deepEqual(parsed.settings, { autoMode: true, syncLanguages: ["en", "fr", "de"] });
  assert.equal(parsed.entries[0].id, "HAUS1");
});

test("importJson rejects exports from other apps", async () => {
  const { store } = loadSharedStore();

  await assert.rejects(
    () => store.importJson(JSON.stringify({ app: "someone-else", version: 2, entries: [] })),
    /not a LODVault export/
  );
});

test("createNoteAutosaveController trims, saves, and updates textarea dataset state", async () => {
  const { store } = loadSharedStore();
  const statusUpdates = [];
  const textarea = {
    value: "  remember this  ",
    disabled: false,
    isConnected: true,
    dataset: {
      noteId: "HAUS1",
      savedValue: "",
      dirty: "true"
    }
  };

  const controller = store.createNoteAutosaveController({
    setStatus: (_textarea, message, tone) => statusUpdates.push({ message, tone }),
    saveNote: async (noteId, value) => ({ id: noteId, note: store.normalizeNoteValue(value) })
  });

  await controller.commit(textarea);

  assert.equal(textarea.dataset.savedValue, "remember this");
  assert.equal(textarea.dataset.dirty, "");
  assert.equal(textarea.dataset.saving, "");
  assert.equal(textarea.value, "remember this");
  assert.deepEqual(statusUpdates, [
    { message: "Saving note…", tone: "saving" },
    { message: "Note saved.", tone: "success" }
  ]);
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
      translations: { en: "house", fr: "maison" }
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
  assert.match(html, /data-langs="en,fr"/);
  assert.doesNotMatch(html, /input.addEventListener\('input', applySearch\)/);
});

test("buildAnkiExport produces tab-separated file with Anki headers and entry data", () => {
  const { store } = loadSharedStore();
  const text = store.buildAnkiExport([
    {
      id: "HAUS1",
      word: "Haus",
      pos: "NOUN",
      url: "https://lod.lu/artikel/HAUS1",
      favorite: true,
      inflection: "Haiser",
      example: "Eis Haus ass grouss.",
      note: "important word",
      translations: { en: "house", fr: "maison", de: "Haus" }
    },
    {
      id: "BEEM1",
      word: "Beem",
      pos: "NOUN",
      translations: { en: "trees" }
    }
  ]);

  const lines = text.split("\n");
  assert.equal(lines[0], "#separator:Tab");
  assert.equal(lines[1], "#html:true");
  assert.equal(lines[2], "#deck:LODVault");
  assert.equal(lines[3], "#columns:Word\tPOS\tTranslations\tInflection\tExample\tNote\tURL");
  assert.match(lines[4], /^Haus\tNOUN\t/);
  assert.match(lines[4], /house/);
  assert.match(lines[4], /maison/);
  assert.match(lines[4], /Haiser/);
  assert.match(lines[4], /Eis Haus ass grouss\./);
  assert.match(lines[4], /important word/);
  assert.match(lines[4], /lod\.lu\/artikel\/HAUS1/);
  assert.match(lines[5], /^Beem\tNOUN\t/);
  assert.match(lines[5], /trees/);
  assert.equal(lines.length, 6);
});

test("buildAnkiExport escapes HTML in fields", () => {
  const { store } = loadSharedStore();
  const text = store.buildAnkiExport([
    {
      id: "TEST1",
      word: "Test<word>",
      pos: "NOUN",
      translations: { en: 'a "quoted" thing' }
    }
  ]);

  assert.doesNotMatch(text, /Test<word>/);
  assert.match(text, /Test&lt;word&gt;/);
  assert.match(text, /&quot;quoted&quot;/);
});

test("buildAnkiExport skips entries without a word", () => {
  const { store } = loadSharedStore();
  const text = store.buildAnkiExport([
    { id: "EMPTY1", word: "" },
    { id: "HAUS1", word: "Haus", translations: { en: "house" } }
  ]);

  const lines = text.split("\n");
  assert.equal(lines.length, 5); // 4 header lines + 1 data line
  assert.match(lines[4], /^Haus\t/);
});
