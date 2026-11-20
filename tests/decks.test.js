const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const {
  runScripts,
  loadSharedStore,
  loadSyncScript,
  loadFlashcardsScript
} = require("./helpers/loaders");

const DAY = 86400e3;
const plain = (value) => JSON.parse(JSON.stringify(value));
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

function loadDecks(initialStorage = {}) {
  const loaded = loadSharedStore(initialStorage);
  runScripts(loaded.context, ["scripts/activity.js", "scripts/decks.js"]);
  return { ...loaded, decks: loaded.context.LodVaultDecks };
}

function entry(id, extra = {}) {
  return { id, word: id.toLowerCase(), url: `https://lod.lu/artikel/${id}`, history: true, ...extra };
}

test("tags merge per tag and decks per deck, the later write winning", () => {
  const { decks } = loadDecks();
  const local = { t: { food: [["BROUT1", "KAFFI1"], 10], travel: [["ZUG1"], 50] }, k: { d1: [{ name: "Food", f: { tag: "food" } }, 10] } };
  const remote = { t: { food: [["BROUT1"], 20], home: [["HAUS1"], 5] }, k: { d1: [null, 30], d2: [{ name: "Verbs", f: { pos: "verb" } }, 5] } };
  const merged = decks.mergeOrg(local, remote);
  assert.deepEqual(plain(merged.t), {
    food: [["BROUT1"], 20],
    travel: [["ZUG1"], 50],
    home: [["HAUS1"], 5]
  });
  assert.equal(merged.k.d1[0], null, "a later deletion wins");
  assert.equal(merged.k.d2[0].name, "Verbs");
  assert.deepEqual(plain(decks.mergeOrg(remote, local)), plain(merged));
  assert.equal(decks.listDecks(merged).length, 1);
});

test("reserved property names are safe tags and entry IDs", async () => {
  const { decks } = loadDecks();
  for (const tag of ["constructor", "__proto__", "toString"]) {
    await decks.setEntryTags("constructor", [tag], 100);
    await decks.addTagToEntries(tag, ["__proto__"], 101);
    const org = await decks.readOrg();
    assert.deepEqual(plain(org.t[tag][0]), ["__proto__", "constructor"]);
    assert.ok(decks.tagsById(org).__proto__.includes(tag));
    assert.ok(decks.buildSyncValue(org).t[tag]);
    await decks.deleteTag(tag, 102);
    assert.deepEqual(plain((await decks.readOrg()).t[tag][0]), []);
  }
});

test("equal-timestamp tag and deck conflicts converge in either merge order", () => {
  const { decks } = loadDecks();
  const a = { t: { home: [["HAUS1"], 100] }, k: { d1: [{ name: "Home", f: {} }, 100] } };
  const b = { t: { home: [[], 100] }, k: { d1: [null, 100] } };
  const ab = decks.mergeOrg(a, b);
  const ba = decks.mergeOrg(b, a);
  assert.deepEqual(plain(ab), plain(ba));
  assert.deepEqual(plain(decks.mergeOrg(ab, a)), plain(ab));
  assert.deepEqual(plain(decks.mergeOrg(ab, b)), plain(ab));
});

test("tag names are cleaned and tagging is per word", async () => {
  const { decks, storageData } = loadDecks();
  await decks.setEntryTags("HAUS1", ["  home ", "home", "A1\u0007"]);
  await decks.setEntryTags("FRA1", ["home"]);
  let org = await decks.readOrg();
  assert.deepEqual(plain(org.t.home[0]), ["FRA1", "HAUS1"]);
  assert.deepEqual(plain(decks.tagsById(org).HAUS1), ["A1", "home"]);

  await decks.setEntryTags("HAUS1", ["A1"]);
  org = await decks.readOrg();
  assert.deepEqual(plain(org.t.home[0]), ["FRA1"]);
  // Counts only cover words that are still saved.
  assert.deepEqual(plain(decks.listTags(org, [entry("HAUS1")])), [{ tag: "A1", count: 1 }]);
  assert.ok(storageData["lodVault.tags"]);

  await decks.deleteTag("home");
  org = await decks.readOrg();
  assert.deepEqual(plain(org.t.home[0]), [], "a deleted tag stays as an empty tombstone so it syncs");
});

test("the synced copy stays under the item limit, keeping decks and recent tags", () => {
  const { decks } = loadDecks();
  const org = { t: {}, k: { d1: [{ name: "Food", f: { tag: "t0" } }, 1] } };
  for (let index = 0; index < 120; index += 1) {
    org.t[`t${index}`] = [Array.from({ length: 12 }, (_value, item) => `WORD${index}X${item}`), 1000 + index];
  }
  const value = decks.buildSyncValue(org);
  assert.ok(Buffer.byteLength(JSON.stringify(value)) <= 7000);
  assert.ok(value.k.d1, "decks first");
  assert.ok(value.t.t119, "most recent tags next");
  assert.equal(value.t.t0, undefined);
  // Old deletions are dropped; recent ones travel.
  const pruned = decks.buildSyncValue({ t: { gone: [[], Date.now() - 90 * DAY], recent: [[], Date.now()] } });
  assert.deepEqual(Object.keys(pruned.t), ["recent"]);
});

test("deck filters match tag, type, gender, level, list, leeches and due date", () => {
  const { decks } = loadDecks();
  const now = new Date(2026, 10, 20, 12);
  const entries = [
    entry("HAUS1", { pos: "SUBST+N", favorite: true }),
    entry("FRA1", { pos: "SUBST+F", study: true }),
    entry("GOEN1", { pos: "VRB", study: true }),
    entry("GROUSS2", { pos: "ADJ" })
  ];
  const context = {
    now,
    tags: { HAUS1: ["home"], FRA1: ["home", "people"] },
    lexicon: { FRA1: { pos: "SUBST+F", gender: "f", cats: ["GWS A1"] }, GOEN1: { pos: "VRB", cats: [{ code: "GWS A2" }] } },
    meta: {
      GOEN1: { totalReviews: 3, dueAt: new Date(2026, 10, 22).toISOString(), leech: true },
      FRA1: { totalReviews: 1, dueAt: new Date(2026, 11, 20).toISOString() }
    }
  };
  const ids = (filter) => entries.filter((item) => decks.matchesFilter(item, decks.normalizeFilter(filter), context)).map((item) => item.id);
  assert.deepEqual(ids({ tag: "home" }), ["HAUS1", "FRA1"]);
  assert.deepEqual(ids({ pos: "noun" }), ["HAUS1", "FRA1"]);
  assert.deepEqual(ids({ gender: "n" }), ["HAUS1"], "gender from the entry's POS when no word details");
  assert.deepEqual(ids({ gender: "f" }), ["FRA1"]);
  assert.deepEqual(ids({ level: "A2" }), ["GOEN1"]);
  assert.deepEqual(ids({ list: "favorites" }), ["HAUS1"]);
  assert.deepEqual(ids({ leech: true }), ["GOEN1"]);
  assert.deepEqual(ids({ dueWithin: 3 }), ["GOEN1"]);
  assert.deepEqual(ids({ dueWithin: 0 }), []);
  assert.deepEqual(ids({ tag: "home", list: "study" }), ["FRA1"]);
  assert.equal(decks.describeFilter(decks.normalizeFilter({ tag: "home", pos: "noun", dueWithin: 7 })), "#home · nouns · due within 7 days");
});

test("tags and decks sync in their own key and merge on another device", async () => {
  const base = {
    "lodVault.entries": { HAUS1: entry("HAUS1", { favorite: true }), FRA1: entry("FRA1", { favorite: true }) }
  };
  const deviceA = loadSyncScript({ local: { ...base, "lodVault.tags": { t: { home: [["HAUS1"], 100] }, k: { d1: [{ name: "Home", f: { tag: "home" } }, 100] } } } });
  runScripts(deviceA.context, ["scripts/activity.js", "scripts/decks.js"]);
  await deviceA.sync.SyncAdapter.pushAll();
  assert.deepEqual(plain(deviceA.syncStorageData["lodVault.t"].t.home), [["HAUS1"], 100]);

  const deviceB = loadSyncScript({
    local: { ...base, "lodVault.tags": { t: { people: [["FRA1"], 50] } } },
    sync: structuredClone(deviceA.syncStorageData)
  });
  runScripts(deviceB.context, ["scripts/activity.js", "scripts/decks.js"]);
  await deviceB.sync.SyncAdapter.pullAll({ repush: false });
  const merged = deviceB.storageData["lodVault.tags"];
  assert.deepEqual(plain(merged.t), { home: [["HAUS1"], 100], people: [["FRA1"], 50] });
  assert.equal(merged.k.d1[0].name, "Home");
  assert.equal(deviceB.context.LodVaultDecks.hasNews(merged, deviceA.syncStorageData["lodVault.t"]), true, "B has a tag A lacks");

  const stats = await deviceA.sync.inspectSyncStorage();
  assert.ok(stats.bytesUsedRecords.tags > 0);
});

test("JSON backups carry tags and decks", async () => {
  const { store, decks } = loadDecks({ "lodVault.tags": { t: { home: [["HAUS1"], 5] } } });
  const sections = await store.collectBackupSections();
  assert.deepEqual(plain(sections.tags.t.home), [["HAUS1"], 5]);
  const json = JSON.parse(store.buildJsonExport([], { sections }));
  const fresh = loadDecks();
  json.entries = [entry("HAUS1", { favorite: true })];
  const result = await fresh.store.importJson(JSON.stringify(json));
  assert.ok(plain(result.sections).includes("tags"));
  assert.deepEqual(plain((await fresh.decks.readOrg()).t.home), [["HAUS1"], 5]);
  assert.ok(decks);
});

async function loadFlashcardsWithDecks({ entries, org, lexicon = {}, url } = {}) {
  const decksHost = loadDecks({ "lodVault.tags": org, ...lexicon });
  const page = await loadFlashcardsScript({
    entries,
    url,
    globals: { LodVaultDecks: decksHost.decks }
  });
  await wait(30);
  return { ...page, decksHost };
}

test("Flashcards lists saved decks and level decks and studies them", async () => {
  const entries = [
    entry("HAUS1", { pos: "SUBST+N", favorite: true }),
    entry("BROUT1", { pos: "SUBST+N", favorite: true }),
    entry("GOEN1", { pos: "VRB", favorite: true })
  ];
  const { dom, api } = await loadFlashcardsWithDecks({
    entries,
    org: { t: { food: [["BROUT1"], 1] }, k: { d1: [{ name: "Food", f: { tag: "food" } }, 1] } },
    lexicon: { "lodVault.lx.GOEN1": { pos: "VRB", cats: ["GWS A1"] }, "lodVault.lx.HAUS1": { pos: "SUBST+N", cats: ["GWS A1"] } }
  });
  const document = dom.window.document;
  const select = document.getElementById("deck-filter");
  const groups = [...select.querySelectorAll("optgroup")].map((group) => [group.label, [...group.children].map((option) => option.textContent)]);
  assert.deepEqual(groups, [["My decks", ["Food (1)"]], ["Levels", ["Level A1 (2)"]]]);
  // The built-in decks are untouched.
  assert.deepEqual([...select.querySelectorAll(":scope > option")].map((option) => option.value), ["today", "due", "study", "favorites", "all"]);

  select.value = "deck:d1";
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await wait(30);
  assert.deepEqual(api.state.deck.map((item) => item.id), ["BROUT1"]);
  assert.match(document.getElementById("deck-status").textContent, /^Food · 1 card/);

  select.value = "level:A1";
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await wait(30);
  assert.deepEqual(api.state.deck.map((item) => item.id).sort(), ["GOEN1", "HAUS1"]);
});

test("a deck link opens Flashcards on that deck", async () => {
  const { api } = await loadFlashcardsWithDecks({
    entries: [entry("BROUT1", { favorite: true }), entry("HAUS1", { favorite: true })],
    org: { t: { food: [["BROUT1"], 1] }, k: { d1: [{ name: "Food", f: { tag: "food" } }, 1] } },
    url: "https://extension.test/pages/flashcards.html?deck=deck:d1"
  });
  assert.equal(api.state.filter, "deck:d1");
  assert.deepEqual(api.state.deck.map((item) => item.id), ["BROUT1"]);
});

function loadVaultDocument(entries, storage = {}) {
  const shared = loadDecks(storage);
  runScripts(shared.context, ["scripts/vault-tags.js"]);
  const html = shared.store.buildExportHtml(entries, { includeInlineScript: false });
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  return { ...shared, dom, vaultTags: shared.context.LodVaultVaultTags };
}

test("the Vault adds, shows and removes tags on a word and filters by tag", async () => {
  const entries = [entry("HAUS1", { favorite: true }), entry("BROUT1", { favorite: true })];
  const { dom, vaultTags, decks, storageData } = loadVaultDocument(entries, { "lodVault.tags": { t: { home: [["HAUS1"], 1] } } });
  const doc = dom.window.document;
  let filtered = 0;
  await vaultTags.attach(doc, { entriesById: new Map(entries.map((item) => [item.id, item])), onFilter: () => { filtered += 1; } });

  const haus = doc.querySelector('.entry[data-id="HAUS1"]');
  assert.deepEqual([...haus.querySelectorAll(".lv-tag")].map((chip) => chip.dataset.tag), ["home"]);
  assert.match(haus.dataset.search, /#home/);
  assert.ok(doc.getElementById("lv-tag-filter"));

  const brout = doc.querySelector('.entry[data-id="BROUT1"]');
  brout.querySelector(".lv-tag-add").click();
  const input = brout.querySelector(".lv-tag-input");
  assert.equal(doc.activeElement, input);
  input.value = "#food";
  input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await wait(30);
  assert.deepEqual(plain((await decks.readOrg()).t.food[0]), ["BROUT1"]);
  assert.deepEqual([...brout.querySelectorAll(".lv-tag")].map((chip) => chip.dataset.tag), ["food"]);
  assert.ok(storageData["lodVault.tags"].t.food);

  // Filter by #food, then save it as a deck.
  const foodPill = [...doc.querySelectorAll("#lv-tag-filter button")].find((button) => button.textContent.startsWith("#food"));
  foodPill.click();
  assert.equal(haus.classList.contains("lv-tag-hidden"), true);
  assert.equal(brout.classList.contains("lv-tag-hidden"), false);
  assert.ok(filtered > 0);
  doc.querySelector(".lv-save-deck").click();
  await wait(30);
  assert.deepEqual(plain(decks.listDecks(await decks.readOrg()).map((deck) => [deck.name, deck.f])), [["food", { tag: "food" }]]);

  // Removing the last word from a tag hides the tag and clears the filter.
  brout.querySelector('.lv-tag[data-tag="food"] button').click();
  await wait(30);
  assert.equal(haus.classList.contains("lv-tag-hidden"), false);
  assert.equal([...doc.querySelectorAll("#lv-tag-filter button")].some((button) => button.textContent.startsWith("#food")), false);
});

test("the Vault deck manager saves a filtered deck", async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "pages/preview.html"), "utf8");
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  const host = loadDecks({
    "lodVault.entries": {
      HAUS1: entry("HAUS1", { pos: "SUBST+N", study: true }),
      GOEN1: entry("GOEN1", { pos: "VRB", study: true })
    },
    "lodVault.tags": { t: { home: [["HAUS1", "GOEN1"], 1] } }
  });
  runScripts(host.context, ["scripts/vault-tags.js"]);
  const doc = dom.window.document;
  host.context.LodVaultVaultTags.attachDeckManager(doc);
  doc.getElementById("open-decks").click();
  await wait(40);
  const dialog = doc.getElementById("deck-dialog");
  assert.ok(dialog.hasAttribute("open"));
  assert.match(dialog.textContent, /No saved decks yet/);
  doc.getElementById("deck-name").value = "Home verbs";
  doc.getElementById("deck-tag").value = "home";
  doc.getElementById("deck-pos").value = "verb";
  doc.getElementById("deck-pos").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await wait(40);
  assert.equal(doc.getElementById("deck-preview").textContent, "1 word · #home · verbs");
  dialog.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(40);
  const saved = host.decks.listDecks(await host.decks.readOrg());
  assert.deepEqual(plain(saved.map((deck) => [deck.name, deck.f])), [["Home verbs", { tag: "home", pos: "verb" }]]);
  assert.match(doc.getElementById("deck-list-saved").textContent, /Home verbs/);

  doc.querySelector('#deck-list-saved button[aria-label="Delete deck Home verbs"]').click();
  await wait(40);
  assert.equal(host.decks.listDecks(await host.decks.readOrg()).length, 0);
});
