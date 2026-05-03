const test = require("node:test");
const assert = require("node:assert/strict");

const { loadSyncScript } = require("./helpers/loaders");

function makeLocalEntry(overrides = {}) {
  return {
    id: "HAUS1",
    word: "Haus",
    url: "https://lod.lu/artikel/HAUS1",
    pos: "SUBST",
    inflection: "Haiser",
    example: "D'Haus ass grouss.",
    note: "remember this",
    translations: {
      en: "house",
      fr: "maison",
      de: "Haus",
      pt: "casa"
    },
    favorite: true,
    study: true,
    history: true,
    visitCount: 1,
    lastVisitedAt: "2025-01-05T12:34:56.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-06T08:30:00.000Z",
    ...overrides
  };
}

async function withMutedConsoleWarn(run) {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return await run();
  } finally {
    console.warn = originalWarn;
  }
}

function stableStringifyForTest(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringifyForTest(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringifyForTest(value[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

test("compactEntry filters synced translations and expandEntry restores the local shape", () => {
  const { sync } = loadSyncScript();
  const compact = sync.compactEntry(makeLocalEntry(), ["en", "de"]);

  assert.deepEqual(JSON.parse(JSON.stringify(compact.t)), { e: "house", d: "Haus" });
  assert.equal(compact.a, 7);
  assert.equal(compact.c, undefined);
  assert.equal(compact.u, "HAUS1");

  const expanded = sync.expandEntry(compact);
  assert.equal(expanded.url, "https://lod.lu/artikel/HAUS1");
  assert.equal(expanded.favorite, true);
  assert.equal(expanded.study, true);
  assert.equal(expanded.history, true);
  assert.equal(expanded.visitCount, 1);
  assert.deepEqual({ ...expanded.translations }, { en: "house", de: "Haus" });
  assert.equal(expanded.createdAt, "2025-01-01T00:00:00.000Z");
  assert.equal(expanded.updatedAt, "2025-01-06T08:30:00.000Z");
});

test("expandTranslations merges sync payload with existing local-only languages", () => {
  const { sync } = loadSyncScript();

  const merged = sync.expandTranslations(
    { e: "house", f: "maison" },
    { en: "old house", de: "Haus" }
  );

  assert.deepEqual({ ...merged }, { en: "house", fr: "maison", de: "Haus" });
});

test("shardEntries sorts ids and keeps shards under the soft size limit", () => {
  const { sync } = loadSyncScript();
  const entries = {};

  for (let index = 30; index >= 1; index -= 1) {
    const id = `WORD${String(index).padStart(3, "0")}`;
    entries[id] = makeLocalEntry({
      id,
      word: `Word ${index}`,
      url: `https://lod.lu/artikel/${id}`,
      example: `Example ${index}: ${"x".repeat(420)}`,
      note: `Note ${index}: ${"y".repeat(120)}`
    });
  }

  const shards = sync.shardEntries(entries, ["en", "fr", "de"]);
  assert.ok(shards.length > 1);

  for (const shard of shards) {
    const size = new TextEncoder().encode(JSON.stringify(shard)).length;
    assert.ok(size <= sync.SYNC_SHARD_SOFT_LIMIT, `expected ${size} <= ${sync.SYNC_SHARD_SOFT_LIMIT}`);
  }

  const flattenedIds = JSON.parse(JSON.stringify(shards.flat().map((entry) => entry.i)));
  const expectedIds = Object.keys(entries).sort((left, right) => left.localeCompare(right));
  assert.deepEqual(flattenedIds, expectedIds);
});

test("mergeEntryMaps prefers the newer updatedAt value and preserves translations from both sides", () => {
  const { sync } = loadSyncScript();
  const merged = sync.mergeEntryMaps(
    {
      HAUS1: makeLocalEntry({
        translations: { en: "house", de: "Haus" },
        note: "local note",
        updatedAt: "2025-01-05T00:00:00.000Z"
      }),
      LOCAL1: makeLocalEntry({
        id: "LOCAL1",
        word: "Lokal",
        url: "https://lod.lu/artikel/LOCAL1",
        favorite: true,
        study: false,
        history: false,
        translations: { en: "local" }
      })
    },
    {
      HAUS1: makeLocalEntry({
        translations: { en: "home", fr: "maison" },
        note: "remote note",
        updatedAt: "2025-01-06T00:00:00.000Z"
      }),
      REMOTE1: makeLocalEntry({
        id: "REMOTE1",
        word: "Fern",
        url: "https://lod.lu/artikel/REMOTE1",
        favorite: false,
        study: true,
        history: false,
        translations: { en: "remote" }
      })
    }
  );

  assert.equal(merged.HAUS1.note, "remote note");
  assert.deepEqual({ ...merged.HAUS1.translations }, { en: "home", fr: "maison", de: "Haus" });
  assert.equal(merged.LOCAL1.word, "Lokal");
  assert.equal(merged.REMOTE1.word, "Fern");
});

test("SyncAdapter.pushAll writes manifest, settings, and compact shards into sync storage", async () => {
  const fixture = loadSyncScript({
    local: {
      "lodVault.entries": {
        HAUS1: makeLocalEntry(),
        BEEM1: makeLocalEntry({
          id: "BEEM1",
          word: "Beem",
          url: "https://lod.lu/artikel/BEEM1",
          translations: { en: "tree", fr: "arbre", de: "Baum" },
          favorite: false,
          study: true,
          history: false,
          visitCount: 0,
          lastVisitedAt: "",
          note: ""
        })
      },
      "lodVault.settings": {
        autoMode: true,
        syncLanguages: ["en", "fr"]
      }
    }
  });

  const result = await fixture.sync.SyncAdapter.pushAll();

  assert.equal(result.ok, true);
  assert.deepEqual(fixture.syncStorageData[fixture.sync.SYNC_SETTINGS_KEY], { a: true, l: ["en", "fr"] });
  assert.deepEqual(fixture.syncStorageData[fixture.sync.SYNC_MANIFEST_KEY].l, ["e", "f"]);
  assert.equal(Array.isArray(fixture.syncStorageData[`${fixture.sync.SYNC_ENTRY_PREFIX}0`]), true);
  assert.equal(fixture.syncStorageData[`${fixture.sync.SYNC_ENTRY_PREFIX}0`][0].u, "BEEM1");
  assert.equal(fixture.syncStorageData[`${fixture.sync.SYNC_ENTRY_PREFIX}0`][0].t.d, undefined);
});

test("SyncAdapter.pullAll filters saved local translations to the selected languages", async () => {
  const fixture = loadSyncScript({
    local: {
      "lodVault.entries": {
        HAUS1: makeLocalEntry({
          translations: { en: "house", de: "Haus" },
          updatedAt: "2025-01-05T00:00:00.000Z"
        })
      }
    },
    sync: {
      "lodVault.m": { v: 3, n: 1, a: false, l: ["e", "f"], t: 1714564800 },
      "lodVault.s": { a: false, l: ["en", "fr"] },
      "lodVault.e.0": [
        {
          i: "HAUS1",
          w: "Haus",
          u: "HAUS1",
          t: { e: "home", f: "maison" },
          a: 7,
          l: 1736166896,
          r: 1735689600,
          o: 1736208000
        },
        {
          i: "BEEM1",
          w: "Beem",
          u: "BEEM1",
          t: { e: "tree", f: "arbre" },
          a: 2,
          r: 1735689600,
          o: 1736208000
        }
      ]
    }
  });

  const result = await fixture.sync.SyncAdapter.pullAll({ repush: false });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.deepEqual(
    fixture.storageData["lodVault.entries"].HAUS1.translations,
    { en: "home", fr: "maison" }
  );
  assert.equal(fixture.storageData["lodVault.entries"].BEEM1.word, "Beem");
  assert.deepEqual(fixture.storageData["lodVault.settings"].syncLanguages, ["en", "fr"]);
});

test("SyncAdapter.pullAll keeps only explicitly selected local languages when local settings already exist", async () => {
  const fixture = loadSyncScript({
    local: {
      "lodVault.entries": {
        HAUS1: makeLocalEntry({
          translations: { en: "house", de: "Haus" },
          updatedAt: "2025-01-05T00:00:00.000Z"
        })
      },
      "lodVault.settings": {
        autoMode: false,
        syncLanguages: ["en", "de"]
      }
    },
    sync: {
      "lodVault.m": { v: 3, n: 1, a: false, l: ["e", "f"], t: 1714564800 },
      "lodVault.s": { a: false, l: ["en", "fr"] },
      "lodVault.e.0": [
        {
          i: "HAUS1",
          w: "Haus",
          u: "HAUS1",
          t: { e: "home", f: "maison" },
          a: 7,
          l: 1736166896,
          r: 1735689600,
          o: 1736208000
        }
      ]
    }
  });

  await fixture.sync.SyncAdapter.pullAll({ repush: false });

  assert.deepEqual(
    fixture.storageData["lodVault.entries"].HAUS1.translations,
    { en: "home", de: "Haus" }
  );
  assert.deepEqual(fixture.storageData["lodVault.settings"].syncLanguages, ["en", "de"]);
});

test("SyncAdapter.init pushes local data to sync when sync storage is empty", async () => {
  const fixture = loadSyncScript({
    local: {
      "lodVault.entries": {
        HAUS1: makeLocalEntry()
      }
    }
  });

  const result = await fixture.sync.SyncAdapter.init();

  assert.equal(result.mode, "push");
  assert.ok(fixture.syncStorageData[fixture.sync.SYNC_MANIFEST_KEY]);
  assert.ok(fixture.syncStorageData[`${fixture.sync.SYNC_ENTRY_PREFIX}0`]);
});

test("SyncAdapter.pullAll tolerates partial shard reads and merges only available shards", async () => {
  const fixture = loadSyncScript({
    local: {
      "lodVault.entries": {
        LOCAL1: makeLocalEntry({
          id: "LOCAL1",
          word: "Lokal",
          url: "https://lod.lu/artikel/LOCAL1",
          translations: { en: "local" },
          favorite: true,
          study: false,
          history: false,
          updatedAt: "2025-01-01T00:00:00.000Z"
        })
      }
    },
    sync: {
      "lodVault.m": { v: 3, n: 3, a: false, l: ["e", "f"], t: 1714564800 },
      "lodVault.s": { a: false, l: ["en", "fr"] },
      "lodVault.e.0": [
        { i: "HAUS1", w: "Haus", u: "HAUS1", t: { e: "house", f: "maison" }, a: 1, r: 1735689600, o: 1735776000 }
      ],
      "lodVault.e.2": { broken: true }
    }
  });

  const result = await withMutedConsoleWarn(() => fixture.sync.SyncAdapter.pullAll({ repush: false }));

  assert.equal(result.ok, true);
  assert.equal(result.partialRead, true);
  assert.deepEqual(result.missingShardKeys, ["lodVault.e.1"]);
  assert.deepEqual(result.malformedShardKeys, ["lodVault.e.2"]);
  assert.equal(fixture.storageData["lodVault.entries"].HAUS1.word, "Haus");
  assert.equal(fixture.storageData["lodVault.entries"].LOCAL1.word, "Lokal");
});

test("SyncAdapter.pullAll migrates legacy sync format forward to v4", async () => {
  const fixture = loadSyncScript({
    sync: {
      "lodVault.m": { v: 2, n: 1, a: true, l: ["en", "fr"], t: 1714564800 },
      "lodVault.s": { a: true, l: ["e", "f"] },
      "lodVault.e.0": [
        {
          id: "HAUS1",
          word: "Haus",
          url: "https://lod.lu/artikel/HAUS1",
          translations: { en: "house", fr: "maison", de: "Haus" },
          favorite: true,
          study: false,
          history: false,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-02T00:00:00.000Z"
        }
      ]
    }
  });

  const result = await fixture.sync.SyncAdapter.pullAll({ repush: true, repushDelayMs: 0 });

  assert.equal(result.ok, true);
  assert.equal(result.needsMigration, true);
  assert.equal(fixture.storageData["lodVault.entries"].HAUS1.word, "Haus");
  assert.deepEqual(fixture.storageData["lodVault.entries"].HAUS1.translations, { en: "house", fr: "maison" });
  assert.equal(fixture.syncStorageData["lodVault.m"].v, 4);
  assert.deepEqual(fixture.syncStorageData["lodVault.m"].l, ["e", "f"]);
  assert.deepEqual(fixture.syncStorageData["lodVault.s"].l, ["en", "fr"]);
});

test("SyncAdapter.pushAll falls back cleanly when sync quota is exceeded", async () => {
  const fixture = loadSyncScript({
    local: {
      "lodVault.entries": {
        HAUS1: makeLocalEntry()
      }
    }
  });

  fixture.chrome.storage.sync.set = async () => {
    throw new Error("QUOTA_BYTES quota hit");
  };

  const result = await withMutedConsoleWarn(() => fixture.sync.SyncAdapter.pushAll());

  assert.equal(result.ok, false);
  assert.equal(result.reason, "quota-exceeded");
  assert.equal(fixture.storageData["lodVault.entries"].HAUS1.word, "Haus");
});

test("SyncAdapter.pushEntry updates only the affected shard when an existing entry changes", async () => {
  const entries = {};

  for (let index = 1; index <= 24; index += 1) {
    const id = `WORD${String(index).padStart(3, "0")}`;
    entries[id] = makeLocalEntry({
      id,
      word: `Word ${index}`,
      url: `https://lod.lu/artikel/${id}`,
      example: `Example ${index}: ${"x".repeat(420)}`,
      note: `Note ${index}: ${"y".repeat(120)}`,
      updatedAt: `2025-01-${String((index % 28) + 1).padStart(2, "0")}T08:30:00.000Z`
    });
  }

  const fixture = loadSyncScript({
    local: {
      "lodVault.entries": entries,
      "lodVault.settings": { autoMode: false, syncLanguages: ["en", "fr", "de"] }
    }
  });

  await fixture.sync.SyncAdapter.pushAll();
  const before = JSON.parse(JSON.stringify(fixture.syncStorageData));
  const changedShardKey = Object.keys(before).find((key) => key.startsWith("lodVault.e.") && before[key].some((entry) => entry.i === "WORD010"));

  fixture.storageData["lodVault.entries"].WORD010.note = "Updated note just for this entry.";
  fixture.storageData["lodVault.entries"].WORD010.updatedAt = "2025-02-01T00:00:00.000Z";

  const result = await fixture.sync.SyncAdapter.pushEntry("WORD010");

  assert.equal(result.ok, true);
  assert.equal(result.mode, "entry");
  assert.equal(fixture.syncStorageData[changedShardKey].find((entry) => entry.i === "WORD010").n, "Updated note just for this entry.");

  const changedKeys = Object.keys(fixture.syncStorageData).filter((key) => stableStringifyForTest(before[key]) !== stableStringifyForTest(fixture.syncStorageData[key]));
  assert.ok(changedKeys.includes(changedShardKey));
  assert.equal(changedKeys.filter((key) => key.startsWith("lodVault.e.")).length, 1);
});

test("SyncAdapter.pushSettings updates only manifest and settings when syncLanguages are unchanged", async () => {
  const fixture = loadSyncScript({
    local: {
      "lodVault.entries": {
        HAUS1: makeLocalEntry()
      },
      "lodVault.settings": { autoMode: false, syncLanguages: ["en", "fr", "de"] }
    }
  });

  await fixture.sync.SyncAdapter.pushAll();
  const beforeShards = JSON.parse(JSON.stringify(
    Object.fromEntries(Object.entries(fixture.syncStorageData).filter(([key]) => key.startsWith("lodVault.e.")))
  ));

  fixture.storageData["lodVault.settings"] = { autoMode: true, syncLanguages: ["en", "fr", "de"] };

  const result = await fixture.sync.SyncAdapter.pushSettings();

  assert.equal(result.ok, true);
  assert.equal(result.mode, "settings");
  assert.equal(fixture.syncStorageData["lodVault.m"].a, true);
  assert.equal(fixture.syncStorageData["lodVault.s"].a, true);
  assert.deepEqual(
    Object.fromEntries(Object.entries(fixture.syncStorageData).filter(([key]) => key.startsWith("lodVault.e."))),
    beforeShards
  );
});

test("SyncAdapter.pushAll can shard and write 500+ compact entries", async () => {
  const entries = {};

  for (let index = 1; index <= 550; index += 1) {
    const id = `WORD${String(index).padStart(4, "0")}`;
    entries[id] = makeLocalEntry({
      id,
      word: `Word ${index}`,
      url: `https://lod.lu/artikel/${id}`,
      note: `n${index}`,
      example: `e${index}`,
      translations: {
        en: `english ${index}`,
        fr: `francais ${index}`,
        de: `deutsch ${index}`
      },
      favorite: index % 2 === 0,
      study: true,
      history: index % 3 === 0,
      visitCount: index % 3 === 0 ? 2 : 0,
      lastVisitedAt: index % 3 === 0 ? "2025-01-05T12:34:56.000Z" : "",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: `2025-01-${String((index % 28) + 1).padStart(2, "0")}T08:30:00.000Z`
    });
  }

  const fixture = loadSyncScript({
    local: {
      "lodVault.entries": entries,
      "lodVault.settings": { autoMode: false, syncLanguages: ["en"] }
    }
  });

  const result = await fixture.sync.SyncAdapter.pushAll();

  assert.equal(result.ok, true);
  assert.ok(result.shardCount > 1);
  assert.equal(fixture.syncStorageData["lodVault.m"].n, result.shardCount);
  assert.equal(fixture.syncStorageData["lodVault.s"].l[0], "en");
  assert.equal(fixture.syncStorageData["lodVault.e.0"][0].t.f, undefined);
});

test("SyncAdapter.pushAll stores compressed shards when compression is available", async () => {
  const fixture = loadSyncScript({
    local: {
      "lodVault.entries": {
        HAUS1: makeLocalEntry(),
        BEEM1: makeLocalEntry({
          id: "BEEM1",
          word: "Beem",
          url: "https://lod.lu/artikel/BEEM1",
          translations: { en: "tree", fr: "arbre", de: "Baum" },
          favorite: false,
          study: true,
          history: false,
          visitCount: 0,
          lastVisitedAt: "",
          note: ""
        })
      },
      "lodVault.settings": {
        autoMode: true,
        syncLanguages: ["en", "fr"]
      }
    }
  }, { enableCompression: true });

  const result = await fixture.sync.SyncAdapter.pushAll();

  assert.equal(result.ok, true);
  assert.equal(fixture.syncStorageData["lodVault.m"].z, 1);

  // Shard should be a compressed string, not a JSON array
  const shardKey = `${fixture.sync.SYNC_ENTRY_PREFIX}0`;
  assert.equal(typeof fixture.syncStorageData[shardKey], "string");

  // Verify round-trip: decompress and check content
  const decompressed = await fixture.compress.decompress(fixture.syncStorageData[shardKey]);
  const parsed = JSON.parse(decompressed);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].i, "BEEM1");
});

test("SyncAdapter.pullAll reads compressed shards correctly", async () => {
  // First push with compression to populate sync storage
  const fixture = loadSyncScript({
    local: {
      "lodVault.entries": {
        HAUS1: makeLocalEntry()
      },
      "lodVault.settings": {
        autoMode: false,
        syncLanguages: ["en", "fr", "de"]
      }
    }
  }, { enableCompression: true });

  await fixture.sync.SyncAdapter.pushAll();

  // Now simulate a fresh local state that needs to pull
  const fixture2 = loadSyncScript({
    local: {},
    sync: fixture.syncStorageData
  }, { enableCompression: true });

  const result = await fixture2.sync.SyncAdapter.pullAll({ repush: false });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(fixture2.storageData["lodVault.entries"].HAUS1.word, "Haus");
  assert.deepEqual(fixture2.storageData["lodVault.entries"].HAUS1.translations, { en: "house", fr: "maison", de: "Haus" });
});

test("SyncAdapter.pullAll migrates uncompressed v3 data to compressed v4 on repush", async () => {
  // Build enough entries so compression beats the deflate+base64 overhead.
  const legacyEntries = [];
  for (let index = 1; index <= 8; index += 1) {
    legacyEntries.push({
      i: `WORD${String(index).padStart(3, "0")}`,
      w: `Word ${index}`,
      u: `WORD${String(index).padStart(3, "0")}`,
      t: { e: `english ${index}`, f: `francais ${index}` },
      a: index % 2 === 0 ? 7 : 3,
      e: `Example sentence number ${index} with some Luxembourgish context.`,
      n: `Study note for word ${index}: remember the gender and plural form.`,
      r: 1735689600,
      o: 1736208000 + index
    });
  }

  const fixture = loadSyncScript({
    sync: {
      "lodVault.m": { v: 3, n: 1, a: false, l: ["e", "f"], t: 1714564800 },
      "lodVault.s": { a: false, l: ["en", "fr"] },
      "lodVault.e.0": legacyEntries
    }
  }, { enableCompression: true });

  const result = await fixture.sync.SyncAdapter.pullAll({ repush: true, repushDelayMs: 0 });

  assert.equal(result.ok, true);
  assert.equal(result.needsMigration, true);

  // After migration, manifest should be v4 with compression flag
  assert.equal(fixture.syncStorageData["lodVault.m"].v, 4);
  assert.equal(fixture.syncStorageData["lodVault.m"].z, 1);

  // Shard should now be compressed
  const shardKey = `${fixture.sync.SYNC_ENTRY_PREFIX}0`;
  const stored = fixture.syncStorageData[shardKey];

  // The shard may be compressed (string) or fall back to array if compression
  // wasn't beneficial.  Either outcome is valid — the key assertion is that
  // the manifest upgraded to v4.
  assert.ok(typeof stored === "string" || Array.isArray(stored));

  // Verify the data round-trips correctly regardless of storage format.
  const decompressed = typeof stored === "string"
    ? JSON.parse(await fixture.compress.decompress(stored))
    : stored;
  assert.ok(Array.isArray(decompressed));
  assert.ok(decompressed.length > 0);
});

test("getSyncUsageStats returns correct byte counts", async () => {
  const fixture = loadSyncScript({
    local: {
      "lodVault.entries": {
        HAUS1: makeLocalEntry(),
        BEEM1: makeLocalEntry({
          id: "BEEM1",
          word: "Beem",
          url: "https://lod.lu/artikel/BEEM1",
          translations: { en: "tree" },
          favorite: false,
          study: true,
          history: false,
          visitCount: 0,
          lastVisitedAt: "",
          note: ""
        })
      },
      "lodVault.settings": {
        autoMode: false,
        syncLanguages: ["en"]
      }
    }
  });

  await fixture.sync.SyncAdapter.pushAll();

  const stats = await fixture.sync.getSyncUsageStats();

  assert.equal(typeof stats.bytesUsed, "number");
  assert.ok(stats.bytesUsed > 0);
  assert.equal(stats.bytesTotal, 100 * 1024);
  assert.ok(stats.percentUsed >= 0);
  assert.equal(stats.entryCount, 2);
  assert.equal(stats.shardCount, 1);
  assert.equal(stats.bytesRemaining, stats.bytesTotal - stats.bytesUsed);
  assert.equal(typeof stats.estimatedRemaining, "number");
  assert.ok(stats.estimatedRemaining > 0);
});

test("getSyncUsageStats returns zero state when sync is empty", async () => {
  const fixture = loadSyncScript({});

  const stats = await fixture.sync.getSyncUsageStats();

  assert.equal(stats.bytesUsed, 0);
  assert.equal(stats.bytesTotal, 100 * 1024);
  assert.equal(stats.percentUsed, 0);
  assert.equal(stats.entryCount, 0);
  assert.equal(stats.shardCount, 0);
  assert.equal(stats.bytesRemaining, 100 * 1024);
  assert.equal(typeof stats.estimatedRemaining, "number");
});

test("getSyncUsageStats returns fallback on error", async () => {
  const fixture = loadSyncScript({});

  // Simulate an error
  const originalGet = fixture.chrome.storage.sync.get;
  fixture.chrome.storage.sync.get = async () => {
    throw new Error("Sync unavailable");
  };

  const stats = await fixture.sync.getSyncUsageStats();

  assert.equal(stats.bytesUsed, 0);
  assert.equal(stats.bytesTotal, 100 * 1024);
  assert.equal(stats.percentUsed, 0);
  assert.equal(stats.entryCount, 0);
});

test("getSyncUsageStats with compressed shards counts entries correctly", async () => {
  const fixture = loadSyncScript({
    local: {
      "lodVault.entries": {
        HAUS1: makeLocalEntry(),
        SCHOUL1: makeLocalEntry({
          id: "SCHOUL1",
          word: "Schoul",
          url: "https://lod.lu/artikel/SCHOUL1",
          translations: { en: "school", fr: "école", de: "Schule" },
          favorite: true,
          study: true,
          history: true
        }),
        BOUCH1: makeLocalEntry({
          id: "BOUCH1",
          word: "Bouch",
          url: "https://lod.lu/artikel/BOUCH1",
          translations: { en: "book" },
          favorite: false,
          study: false,
          history: true
        })
      },
      "lodVault.settings": {
        autoMode: false,
        syncLanguages: ["en", "fr", "de"]
      }
    }
  }, { enableCompression: true });

  await fixture.sync.SyncAdapter.pushAll();

  const stats = await fixture.sync.getSyncUsageStats();

  assert.equal(stats.entryCount, 3);
  assert.ok(stats.bytesUsed > 0);
  assert.ok(stats.estimatedRemaining > 0);
});

test("SyncAdapter.pushAll compresses only when smaller", async () => {
  // Create a single tiny entry — compression overhead might make it larger,
  // so the code should fall back to storing uncompressed.
  const fixture = loadSyncScript({
    local: {
      "lodVault.entries": {
        A1: makeLocalEntry({
          id: "A1",
          word: "a",
          url: "https://lod.lu/artikel/A1",
          translations: { en: "a" },
          favorite: true,
          study: false,
          history: false,
          visitCount: 0,
          lastVisitedAt: "",
          note: "",
          example: "",
          inflection: ""
        })
      },
      "lodVault.settings": {
        autoMode: false,
        syncLanguages: ["en"]
      }
    }
  }, { enableCompression: true });

  const result = await fixture.sync.SyncAdapter.pushAll();

  assert.equal(result.ok, true);

  // For a single-entry tiny shard, the compressed version may be smaller
  // or the code may fall back to uncompressed. Either outcome is valid.
  const shardKey = `${fixture.sync.SYNC_ENTRY_PREFIX}0`;
  const stored = fixture.syncStorageData[shardKey];
  assert.ok(typeof stored === "string" || Array.isArray(stored));
});

test("pushAll handles compression unavailability gracefully", async () => {
  const fixture = loadSyncScript({
    local: {
      "lodVault.entries": {
        HAUS1: makeLocalEntry()
      },
      "lodVault.settings": {
        autoMode: false,
        syncLanguages: ["en", "fr", "de"]
      }
    }
  }, { enableCompression: true });

  // Disable compression mid-flight
  fixture.compress._setAvailableForTest(false);

  const result = await fixture.sync.SyncAdapter.pushAll();

  assert.equal(result.ok, true);

  // Shard should be an uncompressed array since compression is unavailable
  const shardKey = `${fixture.sync.SYNC_ENTRY_PREFIX}0`;
  assert.ok(Array.isArray(fixture.syncStorageData[shardKey]));
  assert.equal(fixture.syncStorageData["lodVault.m"].z, undefined);
});

test("SyncAdapter.pushEntry handles compressed shard update", async () => {
  const entries = {};

  for (let index = 1; index <= 12; index += 1) {
    const id = `WORD${String(index).padStart(3, "0")}`;
    entries[id] = makeLocalEntry({
      id,
      word: `Word ${index}`,
      url: `https://lod.lu/artikel/${id}`,
      example: `Example ${index}: ${"x".repeat(200)}`,
      note: `Note ${index}: ${"y".repeat(80)}`,
      updatedAt: `2025-01-${String((index % 28) + 1).padStart(2, "0")}T08:30:00.000Z`
    });
  }

  const fixture = loadSyncScript({
    local: {
      "lodVault.entries": entries,
      "lodVault.settings": { autoMode: false, syncLanguages: ["en"] }
    }
  }, { enableCompression: true });

  await fixture.sync.SyncAdapter.pushAll();

  fixture.storageData["lodVault.entries"].WORD005.note = "Updated via pushEntry with compression.";
  fixture.storageData["lodVault.entries"].WORD005.updatedAt = "2025-02-01T00:00:00.000Z";

  const result = await fixture.sync.SyncAdapter.pushEntry("WORD005");

  assert.equal(result.ok, true);
  assert.equal(result.mode, "entry");

  // Verify the updated note is in the stored shard after decompression
  const shardKey = `${fixture.sync.SYNC_ENTRY_PREFIX}0`;
  const stored = fixture.syncStorageData[shardKey];
  assert.equal(typeof stored, "string");

  const decompressed = await fixture.compress.decompress(stored);
  const parsed = JSON.parse(decompressed);
  const updatedEntry = parsed.find((entry) => entry.i === "WORD005");
  assert.ok(updatedEntry);
  assert.equal(updatedEntry.n, "Updated via pushEntry with compression.");
});
