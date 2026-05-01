const test = require("node:test");
const assert = require("node:assert/strict");

const { loadBackgroundScript } = require("./helpers/loaders");

async function wait(ms = 0) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test("background serializes store mutations through a shared queue", async () => {
  const background = loadBackgroundScript();
  const order = [];
  let releaseFirst = null;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let callCount = 0;

  background.context.LodWrapperStore.saveNote = async () => {
    callCount += 1;
    const label = String(callCount);
    order.push(`start-${label}`);
    if (callCount === 1) {
      await firstGate;
    }
    order.push(`end-${label}`);
    return { call: callCount };
  };

  const first = background.dispatchStoreMutation({
    type: "lod-wrapper:store-mutate",
    method: "saveNote",
    args: ["HAUS1", "one"]
  });
  const second = background.dispatchStoreMutation({
    type: "lod-wrapper:store-mutate",
    method: "saveNote",
    args: ["BEEM1", "two"]
  });

  await wait(0);
  assert.deepEqual(order, ["start-1"]);

  releaseFirst();

  const [firstResponse, secondResponse] = await Promise.all([first, second]);

  assert.deepEqual(order, ["start-1", "end-1", "start-2", "end-2"]);
  assert.deepEqual(JSON.parse(JSON.stringify(firstResponse)), { ok: true, result: { call: 1 } });
  assert.deepEqual(JSON.parse(JSON.stringify(secondResponse)), { ok: true, result: { call: 2 } });
});

test("background reloads LOD article tabs on install", async () => {
  const background = loadBackgroundScript();

  background.chrome.tabs.query = async () => [
    { id: 101 },
    { id: "ignore-me" },
    { id: 202 }
  ];

  background.runtimeOnInstalled.dispatch({ reason: "install" });
  await wait(0);
  await wait(0);

  assert.deepEqual(background.reloadedTabIds, [101, 202]);
});

test("background pushes relevant local storage changes into sync storage", async () => {
  const background = loadBackgroundScript({
    local: {
      "lodVault.entries": {
        HAUS1: {
          id: "HAUS1",
          word: "Haus",
          url: "https://lod.lu/artikel/HAUS1",
          favorite: true,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z"
        }
      },
      "lodVault.settings": {
        autoMode: false,
        syncLanguages: ["en", "fr", "de"]
      }
    }
  });

  await background.chrome.storage.local.set({
    "lodVault.entries": {
      HAUS1: {
        id: "HAUS1",
        word: "Haus",
        url: "https://lod.lu/artikel/HAUS1",
        favorite: true,
        translations: { en: "house", fr: "maison", de: "Haus" },
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-02T00:00:00.000Z"
      }
    }
  });

  await wait(30);

  assert.ok(background.syncStorageData["lodVault.m"]);
  assert.ok(Array.isArray(background.syncStorageData["lodVault.e.0"]));
  assert.deepEqual(background.syncStorageData["lodVault.e.0"][0].t, { e: "house", f: "maison", d: "Haus" });
});

test("background pulls relevant sync storage changes into local storage", async () => {
  const background = loadBackgroundScript();

  await background.chrome.storage.sync.set({
    "lodVault.m": { v: 3, n: 1, a: false, l: ["e", "f"], t: 1714564800 },
    "lodVault.s": { a: false, l: ["en", "fr"] },
    "lodVault.e.0": [
      {
        i: "HAUS1",
        w: "Haus",
        u: "HAUS1",
        t: { e: "house", f: "maison" },
        a: 1,
        r: 1735689600,
        o: 1735776000
      }
    ]
  });

  await wait(30);

  assert.equal(background.storageData["lodVault.entries"].HAUS1.word, "Haus");
  assert.deepEqual(background.storageData["lodVault.entries"].HAUS1.translations, { en: "house", fr: "maison" });
});

test("background uses pushEntry for a single-entry local mutation after sync is initialized", async () => {
  const background = loadBackgroundScript();
  let pushEntryId = null;
  let pushAllCalls = 0;

  background.context.LodWrapperSync.SyncAdapter.init = async () => ({ ok: true, mode: "noop" });
  background.runtimeOnStartup.dispatch();
  await wait(0);
  await wait(0);

  background.context.LodWrapperSync.SyncAdapter.pushEntry = async (id) => {
    pushEntryId = id;
    return { ok: true, mode: "entry" };
  };
  background.context.LodWrapperSync.SyncAdapter.pushAll = async () => {
    pushAllCalls += 1;
    return { ok: true, mode: "full" };
  };

  await background.chrome.storage.local.set({
    "lodVault.entries": {
      HAUS1: {
        id: "HAUS1",
        word: "Haus",
        url: "https://lod.lu/artikel/HAUS1",
        favorite: true,
        updatedAt: "2025-01-02T00:00:00.000Z"
      }
    }
  });

  await wait(30);

  assert.equal(pushEntryId, "HAUS1");
  assert.equal(pushAllCalls, 0);
});

test("background uses pushSettings for an autoMode-only settings mutation", async () => {
  const background = loadBackgroundScript();
  let pushSettingsCalls = 0;
  let pushAllCalls = 0;

  background.context.LodWrapperSync.SyncAdapter.init = async () => ({ ok: true, mode: "noop" });
  background.runtimeOnStartup.dispatch();
  await wait(0);
  await wait(0);

  background.context.LodWrapperSync.SyncAdapter.pushSettings = async () => {
    pushSettingsCalls += 1;
    return { ok: true, mode: "settings" };
  };
  background.context.LodWrapperSync.SyncAdapter.pushAll = async () => {
    pushAllCalls += 1;
    return { ok: true, mode: "full" };
  };

  await background.chrome.storage.local.set({
    "lodVault.settings": {
      autoMode: true,
      syncLanguages: ["en", "fr", "de"]
    }
  });

  await wait(30);

  assert.equal(pushSettingsCalls, 1);
  assert.equal(pushAllCalls, 0);
});
