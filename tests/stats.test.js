const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const { runScripts, loadSharedStore } = require("./helpers/loaders");

const repoRoot = path.resolve(__dirname, "..");
const DAY = 86400e3;
const plain = (value) => JSON.parse(JSON.stringify(value));

function loadStatsCore() {
  const loaded = loadSharedStore();
  runScripts(loaded.context, ["scripts/activity.js", "scripts/stats.js"]);
  return { stats: loaded.context.LodVaultStats, activity: loaded.context.LodVaultActivity, context: loaded.context };
}

async function loadStatsPage(localData = {}) {
  const shared = loadSharedStore(localData);
  const html = fs.readFileSync(path.join(repoRoot, "pages/stats.html"), "utf8");
  const dom = new JSDOM(html, { url: "chrome-extension://test/pages/stats.html", pretendToBeVisual: true });
  const createdTabs = [];
  const chrome = shared.chrome;
  chrome.tabs = { create: ({ url }) => createdTabs.push(url) };
  chrome.runtime = { ...(chrome.runtime || {}), getURL: (relative) => `chrome-extension://test/${relative}` };
  const context = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    chrome,
    console,
    Intl,
    Date,
    setTimeout: dom.window.setTimeout.bind(dom.window),
    clearTimeout: dom.window.clearTimeout.bind(dom.window),
    globalThis: null
  };
  context.globalThis = context;
  context.LodVaultStoreCore = shared.store;
  context.LodVaultStore = shared.store;
  for (const script of ["scripts/activity.js", "scripts/stats.js"]) {
    vm.runInNewContext(fs.readFileSync(path.join(repoRoot, script), "utf8"), context, { filename: script });
  }
  const view = await context.LodVaultStats.init();
  return { dom, view, context, createdTabs, storageData: shared.storageData };
}

test("words you know uses recall now, estimated from intervals for older cards", () => {
  const { stats } = loadStatsCore();
  const now = new Date();
  const entries = [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }];
  const meta = {
    // Reviewed yesterday with a 10-day interval: recall is high.
    A: { totalReviews: 3, interval: 10, lastReviewedAt: new Date(now - DAY).toISOString() },
    // Reviewed 30 days ago with a 2-day interval: recall has dropped.
    B: { totalReviews: 2, interval: 2, lastReviewedAt: new Date(now - 30 * DAY).toISOString() },
    // FSRS card with stability 50 reviewed 5 days ago.
    C: { totalReviews: 4, srs: 1, s: 50, lastReviewedAt: new Date(now - 5 * DAY).toISOString() }
  };
  const result = stats.computeKnown(entries, meta, now);
  assert.equal(result.studied, 3);
  assert.equal(result.known, 2);
  assert.equal(result.estimated, 2);
  assert.equal(result.exact, false);

  const fsrsOnly = stats.computeKnown([{ id: "C" }], meta, now);
  assert.equal(fsrsOnly.exact, true);
  // Matches the FSRS forgetting curve: (1 + 19/81 · 5/50)^-0.5.
  assert.ok(Math.abs(stats.retrievability(meta.C, now) - Math.pow(1 + (19 / 81) * 0.1, -0.5)) < 1e-6);
});

test("the forecast counts overdue cards today and skips suspended ones", () => {
  const { stats, activity } = loadStatsCore();
  const now = new Date(2026, 10, 20, 12);
  const at = (days) => new Date(2026, 10, 20 + days, 9).toISOString();
  const entries = ["A", "B", "C", "D", "E", "F"].map((id) => ({ id }));
  const meta = {
    A: { totalReviews: 1, dueAt: at(-3) },
    B: { totalReviews: 1, dueAt: at(0) },
    C: { totalReviews: 1, dueAt: at(2) },
    D: { totalReviews: 1, dueAt: at(45) },
    E: { totalReviews: 1, dueAt: at(1), suspended: true },
    F: { totalReviews: 0 }
  };
  const forecast = stats.computeForecast(entries, meta, now);
  assert.equal(forecast.length, 30);
  assert.equal(forecast[0].day, activity.toDayNumber(now));
  assert.deepEqual(plain(forecast.slice(0, 3).map((item) => item.count)), [2, 0, 1]);
  assert.equal(forecast.reduce((sum, item) => sum + item.count, 0), 3);
});

test("retention counts mature reviews and ignores practice", () => {
  const { stats } = loadStatsCore();
  const now = new Date();
  const ago = (days) => new Date(now - days * DAY).toISOString();
  const meta = {
    A: { reviews: [{ date: ago(40), rating: 2 }, { date: ago(10), rating: 2 }] },
    B: { reviews: [{ date: ago(50), rating: 2 }, { date: ago(5), rating: 1 }] },
    // Gap of 3 days: not mature.
    C: { reviews: [{ date: ago(8), rating: 2 }, { date: ago(5), rating: 3 }] },
    // FSRS grades: 1 fails, 2 (Hard) passes; practice doesn't count.
    D: { reviews: [{ date: ago(60), grade: 3 }, { date: ago(2), grade: 2 }, { date: ago(1), grade: 1, kind: "p" }] }
  };
  const result = stats.computeRetention(meta, now);
  assert.equal(result.mature, 3);
  assert.equal(result.maturePassed, 2);
  assert.equal(result.all, 5);
  assert.equal(result.allPassed, 4);
  assert.ok(Math.abs(result.matureRate - 2 / 3) < 1e-9);
});

test("average time only uses reviews that recorded it", () => {
  const { stats } = loadStatsCore();
  const now = new Date();
  assert.equal(stats.computeAverageTime({ A: { reviews: [{ date: now.toISOString(), rating: 2 }] } }, now), null);
  const result = stats.computeAverageTime({
    A: { reviews: [{ date: now.toISOString(), ms: 4000 }, { date: now.toISOString(), ms: 6000 }, { date: now.toISOString(), ms: 3600000 }] }
  }, now);
  assert.equal(result.count, 2);
  assert.equal(result.seconds, 5);
});

test("breakdown groups by part of speech and by GWS level when word details exist", () => {
  const { stats } = loadStatsCore();
  const now = new Date();
  const entries = [
    { id: "HAUS1", pos: "SUBST+N" },
    { id: "GOEN1", pos: "VRB" },
    { id: "GROUSS2", pos: "ADJ" },
    { id: "X1", pos: "" }
  ];
  const meta = { HAUS1: { totalReviews: 2, interval: 30, lastReviewedAt: now.toISOString() } };
  const withoutLexicon = stats.computeBreakdown(entries, meta, {}, now);
  assert.equal(withoutLexicon.withLexicon, 0);
  assert.deepEqual(plain(withoutLexicon.byLevel), {});
  assert.equal(withoutLexicon.byPos.Nouns.known, 1);
  assert.equal(withoutLexicon.byPos.Verbs.fresh, 1);
  assert.equal(withoutLexicon.byPos.Other.total, 1);

  const lexicon = {
    HAUS1: { pos: "SUBST+N", cats: ["GWS A2", "GWS A1", "FAMILL"] },
    GOEN1: { pos: "VRB", cats: [{ code: "GWS B1", label: "…" }] },
    GROUSS2: { pos: "ADJ", cats: [] }
  };
  const result = stats.computeBreakdown(entries, meta, lexicon, now);
  assert.equal(result.withLexicon, 3);
  assert.deepEqual(plain(result.byLevel), {
    A1: { total: 1, known: 1, learning: 0, fresh: 0 },
    B1: { total: 1, known: 0, learning: 0, fresh: 1 },
    "No level": { total: 1, known: 0, learning: 0, fresh: 1 }
  });
});

test("the heatmap covers a year and marks freezes and rest days", () => {
  const { stats, activity } = loadStatsCore();
  const now = new Date(2026, 10, 20, 12);
  const today = activity.toDayNumber(now);
  const days = {};
  for (let day = today - 9; day <= today - 3; day += 1) days[day] = [12, 1, 0];
  days[today - 1] = [30, 0, 0];
  const heatmap = stats.computeHeatmap({ d: days, s: today - 100 }, now);
  assert.equal(heatmap.cells.length, 365);
  assert.equal(heatmap.cells.at(-1).day, today);
  const byDay = Object.fromEntries(heatmap.cells.map((cell) => [cell.day, cell]));
  assert.equal(byDay[today - 2].status, "frozen");
  assert.equal(byDay[today - 1].level, 3);
  assert.equal(byDay[today - 9].level, 2);
  assert.equal(heatmap.info.streak, 8);
  assert.equal(heatmap.activeDays, 8);
});

test("the stats page renders every section from stored data", async () => {
  const now = new Date();
  const reviewedAt = new Date(now - DAY).toISOString();
  const { dom, view, createdTabs } = await loadStatsPage({
    "lodVault.entries": {
      HAUS1: { id: "HAUS1", word: "Haus", url: "https://lod.lu/artikel/HAUS1", pos: "SUBST+N", study: true, history: true },
      GOEN1: { id: "GOEN1", word: "goen", url: "https://lod.lu/artikel/GOEN1", pos: "VRB", study: true, history: true }
    },
    "lodVault.flashcardMeta": {
      HAUS1: { totalReviews: 1, reviews: [{ date: reviewedAt, rating: 2 }], lastReviewedAt: reviewedAt, dueAt: new Date(now.getTime() + 2 * DAY).toISOString(), interval: 3 }
    },
    "lodVault.lx.HAUS1": { v: 1, id: "HAUS1", pos: "SUBST+N", cats: ["GWS A1"] }
  });
  const document = dom.window.document;
  assert.equal(view.known.known, 1);
  assert.equal(document.querySelectorAll("#stats-heatmap .heat-cell[data-day]").length, 365);
  assert.match(document.querySelector("#stats-heatmap .heatmap-grid").getAttribute("aria-label"), /1 active days, 1 reviews/);
  assert.equal(document.querySelectorAll("#stats-forecast .forecast-day").length, 30);
  assert.match(document.getElementById("stats-summary").textContent, /words you know/);
  assert.match(document.getElementById("stats-summary").textContent, /estimated from review intervals/);
  const captions = [...document.querySelectorAll("#stats-breakdown caption")].map((node) => node.textContent);
  assert.equal(captions.length, 2);
  assert.match(document.getElementById("stats-breakdown").textContent, /Levels known for 1 of 2 words/);
  assert.equal(document.querySelectorAll("#stats-rest-days input[type=checkbox]").length, 7);
  assert.equal(document.getElementById("stats-status").textContent, "2 saved words");

  document.getElementById("open-flashcards").click();
  assert.deepEqual(createdTabs, ["chrome-extension://test/pages/flashcards.html"]);
});

test("choosing a rest day on the stats page saves it with the activity", async () => {
  const { dom, storageData, context } = await loadStatsPage({});
  const document = dom.window.document;
  const monday = document.getElementById("rest-day-1");
  monday.checked = true;
  monday.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  for (let tries = 0; tries < 200 && !storageData["lodVault.activity"]?.w; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(storageData["lodVault.activity"].w.at(-1)[1], 2);
  const info = context.LodVaultActivity.computeStreak(storageData["lodVault.activity"]);
  assert.equal(info.restMask, 2);
});

test("the popup and flashcards header link to the stats page", () => {
  const popup = fs.readFileSync(path.join(repoRoot, "pages/popup.html"), "utf8");
  const flashcards = fs.readFileSync(path.join(repoRoot, "pages/flashcards.html"), "utf8");
  assert.match(popup, /id="open-stats"/);
  assert.match(flashcards, /id="open-stats"[^>]*href="stats.html"/);
});
