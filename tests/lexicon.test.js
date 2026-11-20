const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadSharedStore, loadBackgroundScript } = require("./helpers/loaders");

const FIXTURE_IDS = ["HAUS1", "MANN1", "FRA1", "GROUSS1", "GROUSS2", "GOEN1", "MAACHEN1"];

function fixture(id) {
  const file = path.join(__dirname, "fixtures", "lod", `${id}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8")).entry;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const NOW = Date.UTC(2026, 10, 20);
const DAY = 24 * 60 * 60 * 1000;

function loadLexicon(initialStorage = {}) {
  const loaded = loadSharedStore(initialStorage);
  return {
    ...loaded,
    lookup: loaded.context.LodVaultLensLookup,
    lexicon: loaded.context.LodVaultLexicon
  };
}

function parse(id, options = {}) {
  const { lookup } = loadLexicon();
  return plain(lookup.parseLexicon(fixture(id), { now: NOW, ...options }));
}

// ── parseLexicon on real LOD responses ────────────────────────────────────

test("parseLexicon reads gender, plurals and clarified translations from a noun", () => {
  const haus = parse("HAUS1");
  assert.equal(haus.v, 1);
  assert.equal(haus.id, "HAUS1");
  assert.equal(haus.lemma, "Haus");
  assert.equal(haus.pos, "SUBST+N");
  assert.equal(haus.gender, "n");
  assert.equal(haus.ipa, "hæːʊs");
  assert.equal(haus.audio, "https://lod.lu/uploads/OGG/haus1.ogg");
  assert.deepEqual(haus.cats, ["GWS A2"]);
  assert.equal(haus.fetchedAt, NOW);
  assert.deepEqual(haus.noun, { plurals: ["Haiser", "Haus"], noPlural: false });
  assert.deepEqual(haus.senses.map((sense) => sense.n), [1, 2, 3, 4]);

  const [house, household] = haus.senses;
  assert.equal(house.id, "HAUS1UNI1");
  assert.deepEqual(house.tr.en, [["house", "building"]]);
  assert.deepEqual(house.tr.de, [["Haus", "Wohngebäude"]]);
  assert.deepEqual(house.plurals, ["Haiser", "Haus"]);
  assert.equal(household.decl, "kee Pluriel");
  assert.equal(household.plurals, undefined);
});

test("parseLexicon finds a plural stored on the microstructure with its n-rule form", () => {
  const fra = parse("FRA1");
  assert.equal(fra.gender, "f");
  assert.deepEqual(fra.noun, { plurals: ["Fraen"], noPlural: false, pluralNRule: { Fraen: "Frae" } });
  assert.deepEqual(fra.senses[0].tr.en, [["woman"], ["lady"]]);

  const mann = parse("MANN1");
  assert.equal(mann.gender, "m");
  assert.deepEqual(mann.noun.plurals, ["Männer", "Mann"]);
});

test("parseLexicon keeps example labels and glosses out of the example text", () => {
  const mann = parse("MANN1");
  const example = mann.senses[0].ex.find((item) => item.l);
  assert.equal(example.t, "hie stellt säi Mann!");
  assert.deepEqual(example.l, ["EGS"]);
  assert.equal(example.g, "et ass Verlooss op hien; hie weess sech ze behaapten");
  assert.ok(!example.t.includes("EGS"));
});

test("parseLexicon marks every inflected headword with exact character spans", () => {
  const { lookup } = loadLexicon();
  let checked = 0;
  for (const id of FIXTURE_IDS) {
    const raw = fixture(id);
    const record = lookup.parseLexicon(raw, { now: NOW, maxSenses: 99 });
    const rawExamples = raw.microStructures
      .flatMap((micro) => micro.grammaticalUnits)
      .flatMap((unit) => unit.meanings)
      .map((meaning) => (meaning.examples || []).slice(0, 3));
    record.senses.forEach((sense, index) => {
      sense.ex.forEach((example, exampleIndex) => {
        const expected = rawExamples[index][exampleIndex].parts
          .filter((part) => part.type === "text")
          .flatMap((part) => part.parts)
          .filter((part) => part.type === "inflectedHeadword")
          .map((part) => part.content);
        assert.deepEqual(plain(example.h.map(([start, end]) => example.t.slice(start, end))), expected, `${id} ${example.t}`);
        checked += 1;
      });
    });
  }
  assert.ok(checked > 40);

  const goen = parse("GOEN1");
  const elided = goen.senses.flatMap((sense) => sense.ex).find((example) => example.t.includes("d'Kiermes"));
  assert.equal(elided.t, "de Mëtteg gi mir op d'Kiermes");
});

test("parseLexicon reads verb auxiliary, participles and conjugation", () => {
  const goen = parse("GOEN1");
  assert.equal(goen.gender, null);
  assert.equal(goen.nRule, "goe");
  assert.deepEqual(goen.verb, {
    aux: "sinn",
    pp: ["gaangen", "gaang"],
    separable: false,
    present: ["ginn", "gees", "geet", "ginn", "gitt", "ginn"],
    pastSimple: ["goung", "goungs", "goung", "goungen", "goungt", "goungen"],
    imperative: ["géi!", "gitt!"]
  });
  assert.equal(goen.noun, undefined);

  const maachen = parse("MAACHEN1");
  assert.equal(maachen.verb.aux, "hunn");
  assert.deepEqual(maachen.verb.pp, ["gemaach", "gemaacht"]);
  assert.deepEqual(maachen.senses[0].gram, ["transitiv"]);
  assert.ok(maachen.senses.some((sense) => sense.gram?.includes("intransitiv")));
});

test("parseLexicon keeps sense ids, phrases and grammar, capped at 12 senses unless focused", () => {
  const goen = parse("GOEN1");
  assert.equal(goen.senses.length, 12);
  assert.equal(goen.moreSenses, 16);
  const phone = goen.senses.find((sense) => sense.n === 4);
  assert.equal(phone.id, "GOEN1UNI28");
  assert.equal(phone.phrase, "op den Telefon goen");
  assert.deepEqual(phone.tr.en, [["to answer the phone"]]);
  assert.deepEqual(phone.tr.de, [["ans Telefon gehen"], ["rangehen"]]);
  assert.deepEqual(goen.senses[0].tr.fr, [["marcher"], ["aller", "à pied"]]);

  const focused = parse("GOEN1", { keepSenses: [25] });
  assert.equal(focused.senses.length, 13);
  assert.equal(focused.senses.at(-1).n, 25);
  assert.equal(focused.moreSenses, 15);
});

test("parseLexicon reads adjective comparison and numbers senses that lack a number", () => {
  const grouss = parse("GROUSS2");
  assert.deepEqual(grouss.adj, { comp: "méi grouss", sup: "am gréissten" });
  assert.equal(grouss.gender, null);

  const greeting = parse("GROUSS1");
  assert.deepEqual(greeting.senses.map((sense) => [sense.id, sense.n]), [["GROUSS1UNI1", 1]]);
  assert.deepEqual(greeting.senses[0].syn, ["Bonjour"]);
  assert.deepEqual(greeting.noun.plurals, ["Gréiss"]);
});

test("parseLexicon keeps every record small", () => {
  for (const id of FIXTURE_IDS) {
    const size = JSON.stringify(parse(id)).length;
    assert.ok(size < 8 * 1024, `${id} is ${size} bytes`);
  }
});

test("parseLexicon tolerates missing fields and unknown part types", () => {
  const { lookup } = loadLexicon();
  assert.equal(lookup.parseLexicon({}), null);
  assert.equal(lookup.parseLexicon(null), null);
  assert.equal(lookup.parseLexicon({ lod_id: "X1" }), null);

  const record = plain(lookup.parseLexicon({
    lod_id: "TEST1",
    lemma: "Test",
    partOfSpeechLabel: "SUBST+F",
    microStructures: [{
      grammaticalUnits: [{
        meanings: [
          null,
          {
            number: 1,
            targetLanguages: {
              en: { parts: [{ type: "mystery", content: "?" }, { type: "translation", content: "test" }] },
              xx: { parts: [{ type: "translation", content: "ignored" }] }
            },
            examples: [
              { parts: [{ type: "text", parts: [{ type: "unknown", content: "zz" }, { type: "word", content: "en" }, { type: "inflectedHeadword", content: "Test" }] }] },
              { parts: [{ type: "gloss", parts: [{ type: "word", content: "only a gloss" }] }] }
            ]
          }
        ]
      }]
    }]
  }, { now: NOW }));
  assert.equal(record.gender, "f");
  assert.deepEqual(record.senses[0].tr, { en: [["test"]] });
  assert.deepEqual(record.senses[0].ex, [{ t: "en Test", h: [[3, 7]] }]);
  assert.deepEqual(record.noun, { plurals: [], noPlural: false });
});

test("parseLexicon leaves the flattened entry parser unchanged", () => {
  const { lookup } = loadLexicon();
  const raw = fixture("HAUS1");
  const before = plain(lookup.normalizeEntryFromApi(raw));
  lookup.parseLexicon(raw);
  assert.deepEqual(plain(lookup.normalizeEntryFromApi(raw)), before);
});

// ── lexicon store ─────────────────────────────────────────────────────────

function record(id, fetchedAt = NOW, extra = {}) {
  return { v: 1, id, fetchedAt, lemma: id.toLowerCase(), pos: "SUBST+N", gender: "n", senses: [], ...extra };
}

test("lexicon records live in per-word local keys with a size index", async () => {
  const { lexicon, storageData, syncStorageData } = loadLexicon();
  assert.equal(await lexicon.saveLexicon(record("HAUS1")), true);
  assert.equal(await lexicon.saveLexicon({ v: 2, id: "BAD1" }), false);

  assert.deepEqual(plain(storageData["lodVault.lx.HAUS1"]), record("HAUS1"));
  assert.deepEqual(Object.keys(storageData["lodVault.lxIndex"]), ["HAUS1"]);
  assert.equal(storageData["lodVault.lxIndex"].HAUS1[0], NOW);
  assert.deepEqual(syncStorageData, {});
  assert.deepEqual(plain(await lexicon.getLexicon("HAUS1")), record("HAUS1"));
  assert.deepEqual(Object.keys(await lexicon.getLexicons(["HAUS1", "NONE1"])), ["HAUS1"]);

  const usage = await lexicon.getUsage();
  assert.equal(usage.count, 1);
  assert.ok(usage.bytes > 50);

  assert.equal(await lexicon.removeLexicons(["HAUS1"]), 1);
  assert.equal(storageData["lodVault.lx.HAUS1"], undefined);
  assert.deepEqual(plain(storageData["lodVault.lxIndex"]), {});
});

test("lexicon index is rebuilt from the records when it is missing", async () => {
  const { lexicon } = loadLexicon({
    "lodVault.lx.HAUS1": record("HAUS1", NOW - DAY),
    "lodVault.lx.FRA1": record("FRA1")
  });
  const usage = await lexicon.getUsage();
  assert.equal(usage.count, 2);
  assert.deepEqual(Object.keys(await lexicon.getAllLexicons()).sort(), ["FRA1", "HAUS1"]);
});

test("concurrent saves keep every word in the index", async () => {
  const { lexicon, storageData } = loadLexicon();
  await Promise.all(["A1", "B1", "C1", "D1"].map((id) => lexicon.saveLexicon(record(id))));
  assert.deepEqual(Object.keys(storageData["lodVault.lxIndex"]).sort(), ["A1", "B1", "C1", "D1"]);
});

test("importLexicons only restores newer records for words in the vault", async () => {
  const { lexicon, storageData } = loadLexicon();
  await lexicon.saveLexicon(record("HAUS1", NOW));
  const count = await lexicon.importLexicons({
    HAUS1: record("HAUS1", NOW - DAY, { lemma: "old" }),
    FRA1: record("FRA1", NOW),
    GONE1: record("GONE1", NOW),
    MISMATCH1: record("OTHER1", NOW),
    JUNK1: { nope: true }
  }, ["HAUS1", "FRA1", "MISMATCH1", "JUNK1"]);
  assert.equal(count, 1);
  assert.equal(storageData["lodVault.lx.HAUS1"].lemma, "haus1");
  assert.ok(storageData["lodVault.lx.FRA1"]);
  assert.equal(storageData["lodVault.lx.GONE1"], undefined);
});

// ── hydrator ──────────────────────────────────────────────────────────────

function createClock(start = NOW) {
  const timers = [];
  const clock = {
    now: start,
    timers,
    setTimeout(fn, ms) {
      timers.push({ fn, at: clock.now + ms });
      return timers.length;
    },
    async advance(ms) {
      clock.now += ms;
      const due = timers.filter((timer) => timer.at <= clock.now);
      for (const timer of due) {
        timers.splice(timers.indexOf(timer), 1);
        timer.fn();
      }
    }
  };
  return clock;
}

function savedEntry(id, flags = { study: true }) {
  return { id, word: id.toLowerCase(), favorite: false, study: false, history: false, ...flags };
}

function createHydrator(lexicon, { entryMap, fetchEntryJson, clock = createClock(), budgetBytes } = {}) {
  return lexicon.createHydrator({
    now: () => clock.now,
    setTimeout: clock.setTimeout,
    getEntryMap: async () => entryMap,
    fetchEntryJson,
    budgetBytes
  });
}

test("hydrator reuses the cached canonical response instead of fetching again", async () => {
  const { lexicon, storageData } = loadLexicon();
  const fetched = [];
  const hydrator = createHydrator(lexicon, {
    entryMap: { HAUS1: savedEntry("HAUS1") },
    fetchEntryJson: async (id) => {
      fetched.push(id);
      return fixture(id);
    }
  });
  hydrator.rememberResponse("HAUS1", fixture("HAUS1"));
  await hydrator.handleEntriesChanged({}, { HAUS1: savedEntry("HAUS1") });
  await hydrator.whenIdle();
  assert.deepEqual(fetched, []);
  assert.equal(storageData["lodVault.lx.HAUS1"].gender, "n");
});

test("hydrator fetches at most two entries at once and skips words that aren't saved", async () => {
  const { lexicon, storageData } = loadLexicon();
  let active = 0;
  let peak = 0;
  const fetched = [];
  const entryMap = {
    HAUS1: savedEntry("HAUS1"),
    MANN1: savedEntry("MANN1", { favorite: true }),
    FRA1: savedEntry("FRA1"),
    GOEN1: savedEntry("GOEN1"),
    VISIT1: savedEntry("VISIT1", { history: true })
  };
  const hydrator = createHydrator(lexicon, {
    entryMap,
    fetchEntryJson: async (id) => {
      fetched.push(id);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return fixture(id);
    }
  });
  const result = await hydrator.reconcile();
  assert.equal(result.queued, 4);
  await hydrator.whenIdle();
  assert.equal(peak, 2);
  assert.deepEqual(fetched.sort(), ["FRA1", "GOEN1", "HAUS1", "MANN1"]);
  assert.ok(storageData["lodVault.lx.GOEN1"]);
  assert.equal(storageData["lodVault.lx.VISIT1"], undefined);
});

test("hydrator backs off on rate limits and retries later", async () => {
  const { lexicon, storageData } = loadLexicon();
  const clock = createClock();
  let calls = 0;
  const hydrator = createHydrator(lexicon, {
    clock,
    entryMap: { HAUS1: savedEntry("HAUS1") },
    fetchEntryJson: async (id) => {
      calls += 1;
      if (calls === 1) {
        const error = new Error("busy");
        error.status = 429;
        throw error;
      }
      return fixture(id);
    }
  });
  hydrator.enqueue(["HAUS1"]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls, 1);
  assert.equal(hydrator.state.pausedUntil, NOW + lexicon.BACKOFF_BASE_MS);
  assert.deepEqual(plain(hydrator.state.queued), ["HAUS1"]);
  assert.equal(storageData["lodVault.lx.HAUS1"], undefined);

  await clock.advance(lexicon.BACKOFF_BASE_MS);
  await hydrator.whenIdle();
  assert.equal(calls, 2);
  assert.ok(storageData["lodVault.lx.HAUS1"]);
  assert.equal(hydrator.state.failures, 0);
});

test("hydrator remembers missing articles and doesn't ask again for 30 days", async () => {
  const { lexicon, storageData } = loadLexicon();
  const clock = createClock();
  let calls = 0;
  const entryMap = { GONE1: savedEntry("GONE1") };
  const hydrator = createHydrator(lexicon, {
    clock,
    entryMap,
    fetchEntryJson: async () => {
      calls += 1;
      const error = new Error("not found");
      error.status = 404;
      throw error;
    }
  });
  await hydrator.reconcile();
  await hydrator.whenIdle();
  assert.equal(calls, 1);
  assert.equal(storageData["lodVault.lxMiss"].GONE1, NOW);

  assert.equal((await hydrator.reconcile()).queued, 0);
  clock.now += lexicon.MISS_RETRY_MS;
  assert.equal((await hydrator.reconcile()).queued, 1);
});

test("reconcile drops lexicons of deleted words and refreshes records older than 90 days", async () => {
  const { lexicon, storageData } = loadLexicon();
  await lexicon.saveLexicon(record("HAUS1", NOW - lexicon.REFRESH_MS));
  await lexicon.saveLexicon(record("FRA1", NOW - DAY));
  await lexicon.saveLexicon(record("DELETED1", NOW));
  const fetched = [];
  const hydrator = createHydrator(lexicon, {
    entryMap: { HAUS1: savedEntry("HAUS1"), FRA1: savedEntry("FRA1") },
    fetchEntryJson: async (id) => {
      fetched.push(id);
      return fixture(id);
    }
  });
  const result = await hydrator.reconcile();
  assert.deepEqual(plain(result), { queued: 1, removed: 1 });
  await hydrator.whenIdle();
  assert.deepEqual(fetched, ["HAUS1"]);
  assert.equal(storageData["lodVault.lx.DELETED1"], undefined);
  assert.equal(storageData["lodVault.lx.HAUS1"].fetchedAt, NOW);
  assert.equal(storageData["lodVault.lx.HAUS1"].lemma, "Haus");
});

test("a deleted word loses its lexicon on the entry change", async () => {
  const { lexicon, storageData } = loadLexicon();
  await lexicon.saveLexicon(record("HAUS1"));
  const hydrator = createHydrator(lexicon, { entryMap: {} });
  const result = await hydrator.handleEntriesChanged({ HAUS1: savedEntry("HAUS1") }, {});
  assert.deepEqual(plain(result.removed), ["HAUS1"]);
  assert.equal(storageData["lodVault.lx.HAUS1"], undefined);
});

test("over budget, favourites-only lexicons are pruned before any word in Study", async () => {
  const { lexicon, storageData } = loadLexicon();
  const padding = "x".repeat(900);
  await lexicon.saveLexicon(record("OLDFAV1", NOW - 3 * DAY, { pad: padding }));
  await lexicon.saveLexicon(record("NEWFAV1", NOW - DAY, { pad: padding }));
  await lexicon.saveLexicon(record("STUDY1", NOW - 9 * DAY, { pad: padding }));
  const entryMap = {
    OLDFAV1: savedEntry("OLDFAV1", { favorite: true }),
    NEWFAV1: savedEntry("NEWFAV1", { favorite: true }),
    STUDY1: savedEntry("STUDY1"),
    HAUS1: savedEntry("HAUS1"),
    FRA1: savedEntry("FRA1", { favorite: true })
  };
  const usage = await lexicon.getUsage();
  const hydrator = createHydrator(lexicon, {
    entryMap,
    budgetBytes: usage.bytes + 1500,
    fetchEntryJson: async (id) => fixture(id)
  });

  hydrator.enqueue(["HAUS1"]);
  await hydrator.whenIdle();
  assert.ok(storageData["lodVault.lx.HAUS1"]);
  assert.equal(storageData["lodVault.lx.OLDFAV1"], undefined);
  assert.ok(storageData["lodVault.lx.STUDY1"]);

  // A favourites-only word that doesn't fit isn't stored once only Study words remain.
  await lexicon.removeLexicons(["NEWFAV1"]);
  const tight = createHydrator(lexicon, {
    entryMap,
    budgetBytes: (await lexicon.getUsage()).bytes + 10,
    fetchEntryJson: async (id) => fixture(id)
  });
  assert.equal(await tight.hydrateOne("FRA1"), "over-budget");
  assert.equal(storageData["lodVault.lx.FRA1"], undefined);
  assert.ok(storageData["lodVault.lx.STUDY1"]);
});

// ── background wiring ─────────────────────────────────────────────────────

async function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("saving a word after a lookup stores its lexicon without a second LOD request", async () => {
  const background = loadBackgroundScript();
  const fetchCalls = [];
  background.context.fetch = async (url) => {
    fetchCalls.push(String(url));
    const body = JSON.stringify({ entry: fixture("HAUS1") });
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };

  const lookup = await background.dispatchRuntimeMessage(
    { type: "lodvault:lens-fetch", url: "https://lod.lu/api/lb/entry/HAUS1" },
    { id: "lodvault-test", url: "https://example.com/", tab: { id: 3 } }
  );
  assert.equal(lookup.ok, true);

  const saved = await background.dispatchStoreMutation({
    type: "lodvault:store-mutate",
    method: "addToList",
    args: [{ id: "HAUS1", word: "Haus", url: "https://lod.lu/artikel/HAUS1", pos: "SUBST+N" }, "study"]
  });
  assert.equal(saved.ok, true, saved.error);

  await waitFor(() => background.storageData["lodVault.lx.HAUS1"]);
  assert.equal(fetchCalls.length, 1);
  assert.equal(background.storageData["lodVault.lx.HAUS1"].gender, "n");
  assert.equal(background.syncStorageData["lodVault.lx.HAUS1"], undefined);

  const removed = await background.dispatchStoreMutation({
    type: "lodvault:store-mutate",
    method: "removeEntry",
    args: ["HAUS1"]
  });
  assert.equal(removed.ok, true, removed.error);
  await waitFor(() => !background.storageData["lodVault.lx.HAUS1"]);
});

test("only extension pages can ask the background to hydrate lexicons", async () => {
  const background = loadBackgroundScript();
  const fromPage = await background.dispatchRuntimeMessage(
    { type: "lodvault:lexicon-hydrate", ids: ["HAUS1"] },
    { id: "lodvault-test", url: "https://example.com/", tab: { id: 3 } }
  );
  assert.equal(fromPage.ok, false);

  const fromExtension = await background.dispatchStoreMutation({
    type: "lodvault:lexicon-hydrate",
    ids: ["HAUS1", "HAUS1#g", "../bad", 4]
  });
  assert.deepEqual(plain(fromExtension), { ok: true, queued: 2 });
});

// ── backup ────────────────────────────────────────────────────────────────

test("JSON backups include the lexicon only when asked, and restore it for saved words", async () => {
  const { store, lexicon, storageData } = loadLexicon();
  const entries = [{ id: "HAUS1", word: "Haus", url: "https://lod.lu/artikel/HAUS1", study: true }];

  const without = JSON.parse(store.buildJsonExport(entries, {}));
  assert.equal("lexicon" in without, false);
  assert.equal("lexicon" in JSON.parse(store.buildJsonExport(entries, { lexicon: {} })), false);

  const haus = record("HAUS1");
  const backup = store.buildJsonExport(entries, { lexicon: { HAUS1: haus, VISIT1: record("VISIT1") } });
  assert.deepEqual(JSON.parse(backup).lexicon.HAUS1, haus);

  const withVisit = JSON.parse(backup);
  withVisit.entries.push({ id: "VISIT1", word: "Visit", url: "https://lod.lu/artikel/VISIT1", history: true });
  const result = await store.importJson(JSON.stringify(withVisit));
  assert.equal(result.lexiconCount, 1);
  assert.deepEqual(plain(storageData["lodVault.lx.HAUS1"]), haus);
  assert.equal(storageData["lodVault.lx.VISIT1"], undefined);
  assert.equal((await lexicon.getUsage()).count, 1);
});

test("every script a page loads is packaged in the release zip", () => {
  const root = path.join(__dirname, "..");
  const releaseScript = fs.readFileSync(path.join(root, "scripts", "build_release_zip.sh"), "utf8");
  const pagesDir = path.join(root, "pages");
  for (const page of fs.readdirSync(pagesDir).filter((name) => name.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(pagesDir, page), "utf8");
    for (const [, src] of html.matchAll(/<script src="\.\.\/(scripts\/[^"]+)"/g)) {
      assert.ok(releaseScript.includes(`  ${src} \\`), `${page} loads ${src}, which the release zip leaves out`);
    }
  }
});

for (const stage of ["fetch", "commit"]) test(`hydration cannot resurrect deletion during ${stage}`, async () => {
  const { lexicon, lookup, storageData } = loadLexicon();
  let map = { HAUS1: { id: "HAUS1", study: true } };
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  let reads = 0;
  const hydrator = lexicon.createHydrator({
    now: () => NOW,
    getEntryMap: async () => {
      if (stage === "commit" && ++reads === 2) { entered(); await gate; }
      return map;
    },
    parse: lookup.parseLexicon,
    fetchEntryJson: async () => { if (stage === "fetch") { entered(); await gate; } return fixture("HAUS1"); }
  });
  const pending = hydrator.hydrateOne("HAUS1");
  // Old implementations may complete without reaching the guarded read.
  // Race completion against the gate so that negative controls fail, not hang.
  await Promise.race([started, pending]);
  if (stage === "commit") assert.ok(reads >= 2, "membership must be checked again at commit");
  const before = map;
  map = {};
  const deletion = hydrator.handleEntriesChanged(before, map);
  release();
  await Promise.all([pending, deletion]);
  assert.equal(storageData["lodVault.lx.HAUS1"], undefined);
});

test("delete and re-save during hydration preserves the replacement request", async () => {
  const { lexicon, lookup, storageData } = loadLexicon();
  let map = { HAUS1: { id: "HAUS1", study: true } };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let fetches = 0;
  const hydrator = lexicon.createHydrator({
    now: () => NOW,
    getEntryMap: async () => map,
    parse: lookup.parseLexicon,
    fetchEntryJson: async () => {
      if (++fetches === 1) await gate;
      return fixture("HAUS1");
    }
  });
  hydrator.enqueue("HAUS1");
  await waitFor(() => fetches === 1);
  const before = map;
  map = {};
  await hydrator.handleEntriesChanged(before, map);
  map = before;
  await hydrator.handleEntriesChanged({}, map);
  release();
  await hydrator.whenIdle();
  assert.equal(fetches, 2);
  assert.ok(storageData["lodVault.lx.HAUS1"]);
});

test("example parser ignores nested unknown, gloss and attribute wrappers in a real fixture", () => {
  const { lookup } = loadLexicon();
  const raw = fixture("HAUS1");
  const example = raw.microStructures[0].grammaticalUnits[0].meanings[0].examples[0];
  const baseline = plain(lookup.parseLexicon(raw, { now: NOW }));
  for (const type of ["unknown", "gloss", "attribute"]) {
    example.parts.find(part => part.type === "text").parts.unshift({ type, parts: [{ type: "word", content: "SECRET" }] });
  }
  assert.deepEqual(plain(lookup.parseLexicon(raw, { now: NOW })), baseline);
});
