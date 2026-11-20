const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function load({ withStoreCore = false } = {}) {
  const context = { console, Date, Intl, URL, TextEncoder, setTimeout, clearTimeout };
  context.globalThis = context;
  const scripts = [
    ...(withStoreCore ? ["scripts/store-core.js"] : []),
    "scripts/lens-lookup.js",
    "scripts/card-registry.js"
  ];
  for (const script of scripts) {
    vm.runInNewContext(fs.readFileSync(path.join(root, script), "utf8"), context, { filename: script });
  }
  return { cards: context.LodVaultCards, lookup: context.LodVaultLensLookup, context };
}

const { cards, lookup } = load();

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function lexiconOf(id) {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "lod", `${id}.json`), "utf8")).entry;
  return plain(lookup.parseLexicon(raw, { now: 1 }));
}

const LEXICONS = Object.fromEntries(
  ["HAUS1", "MANN1", "FRA1", "GROUSS1", "GROUSS2", "GOEN1", "MAACHEN1"].map((id) => [id, lexiconOf(id)])
);

const NOW = new Date(2026, 10, 20, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function iso(offsetDays, hour = 9) {
  const date = new Date(NOW);
  date.setDate(date.getDate() + offsetDays);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function entry(id, extra = {}) {
  return { id, word: LEXICONS[id]?.lemma || id, pos: LEXICONS[id]?.pos || "", study: true, ...extra };
}

// A core card the learner knows (interval / stability in days).
function known(days, extra = {}) {
  return {
    reviews: [{ date: iso(-days), rating: 2, direction: "fwd" }],
    totalReviews: 1,
    lastReviewedAt: iso(-days),
    dueAt: iso(days),
    interval: days,
    ...extra
  };
}

function skillsOf(list) {
  return plain(list.map((card) => card.skill));
}

test("card ids: core = entry id, skill = entry#skill", () => {
  assert.equal(cards.cardId("HAUS1"), "HAUS1");
  assert.equal(cards.cardId("HAUS1", "pl"), "HAUS1#pl");
  assert.equal(cards.cardId("HAUS1#g", "pl"), "HAUS1#pl");
  assert.deepEqual(plain(cards.parseCardId("HAUS1#pl")), { id: "HAUS1#pl", entryId: "HAUS1", skill: "pl", core: false });
  assert.deepEqual(plain(cards.parseCardId("HAUS1")), { id: "HAUS1", entryId: "HAUS1", skill: "", core: true });
});

test("the registry uses store-core's baseCardId when it is loaded", () => {
  const withCore = load({ withStoreCore: true });
  withCore.context.LodVaultStoreCore.baseCardId = (id) => `core:${id}`;
  assert.equal(withCore.cards.baseCardId("X1#g"), "core:X1#g");
});

test("skills apply only when the lexicon has what the exercise needs", () => {
  const applicable = (id) => plain(cards.SKILL_IDS).filter((skill) => cards.SKILLS[skill].applies(LEXICONS[id]));
  assert.deepEqual(applicable("HAUS1"), ["g", "pl", "cz", "sd", "rev"]);
  assert.deepEqual(applicable("FRA1"), ["g", "pl", "cz", "rev"]);
  assert.deepEqual(applicable("GOEN1"), ["pp", "cz", "sd", "rev"]);
  assert.deepEqual(applicable("GROUSS2"), ["cz", "sd", "rev"]);
  assert.deepEqual(plain(cards.SKILL_IDS.filter((skill) => cards.SKILLS[skill].applies(null))), []);
  const noPlural = { ...LEXICONS.HAUS1, noun: { plurals: [], noPlural: true } };
  assert.equal(cards.SKILLS.pl.applies(noPlural), false);
});

test("settings default to gender, plural, perfect and cloze on; meaning and produce off", () => {
  assert.deepEqual(plain(cards.defaultSettings()), {
    skills: { g: true, pl: true, pp: true, cz: true, sd: false, rev: false },
    skillNewPerDay: 5
  });
  assert.deepEqual(plain(cards.normalizeSettings({ skills: { g: false, sd: true, bogus: true, pl: "yes" }, skillNewPerDay: 7 })), {
    skills: { g: false, pl: true, pp: true, cz: true, sd: true, rev: false },
    skillNewPerDay: 5
  });
  assert.equal(cards.normalizeSettings({ skillNewPerDay: 0 }).skillNewPerDay, 0);
});

test("skill cards unlock once the core card's stability reaches 4 days", () => {
  assert.equal(cards.isSkillUnlocked(undefined), false);
  assert.equal(cards.isSkillUnlocked(known(3)), false);
  assert.equal(cards.isSkillUnlocked(known(4)), true);
  // FSRS stability wins over the legacy interval when present.
  assert.equal(cards.isSkillUnlocked({ ...known(30), srs: 1, s: 2.5 }), false);
  assert.equal(cards.isSkillUnlocked({ ...known(1), srs: 1, s: 4.2 }), true);

  const haus = entry("HAUS1");
  assert.deepEqual(plain(cards.skillCardsFor(haus, LEXICONS.HAUS1, { HAUS1: known(2) })), []);
  assert.deepEqual(skillsOf(cards.skillCardsFor(haus, LEXICONS.HAUS1, { HAUS1: known(5) })), ["g", "pl", "cz"]);
  assert.deepEqual(
    plain(cards.skillCardsFor(haus, LEXICONS.HAUS1, { HAUS1: known(5) }, { skills: { g: false, sd: true } }).map((card) => card.id)),
    ["HAUS1#pl", "HAUS1#cz", "HAUS1#sd"]
  );
});

test("suspended cards are left out, and a suspended core card hides all its skills", () => {
  const haus = entry("HAUS1");
  assert.deepEqual(plain(cards.skillCardsFor(haus, LEXICONS.HAUS1, { HAUS1: known(9, { suspended: true }) })), []);
  assert.deepEqual(
    skillsOf(cards.skillCardsFor(haus, LEXICONS.HAUS1, { HAUS1: known(9), "HAUS1#g": { suspended: true } })),
    ["pl", "cz"]
  );
});

test("today's skill queue: one card per word, new skills capped, due ones first", () => {
  const entries = [entry("HAUS1"), entry("FRA1"), entry("GOEN1"), entry("MANN1"), entry("MAACHEN1", { study: false })];
  const meta = {
    HAUS1: known(10),
    FRA1: known(10),
    GOEN1: known(10),
    MANN1: known(2),
    MAACHEN1: known(10),
    // FRA1's plural card is overdue.
    "FRA1#pl": { ...known(3), dueAt: iso(-2) },
    // GOEN1's perfect card isn't due yet.
    "GOEN1#pp": { ...known(3), dueAt: iso(4) }
  };
  const result = cards.buildSkillQueue(entries, meta, LEXICONS, { now: NOW, settings: { skillNewPerDay: 3 } });
  assert.deepEqual(plain(result.due.map((card) => card.id)), ["FRA1#pl"]);
  assert.deepEqual(plain(result.fresh.map((card) => card.id)), ["HAUS1#g", "GOEN1#cz"]);
  assert.ok(result.buried.includes("HAUS1#pl"));
  assert.ok(result.buried.includes("FRA1#g"));
  assert.equal(result.count, 3);
  assert.equal(result.due[0].entry.id, "FRA1");
});

test("siblings are buried: a word in today's core queue or studied today gives no skill card", () => {
  const entries = [entry("HAUS1"), entry("FRA1"), entry("GOEN1")];
  const meta = {
    HAUS1: known(10),
    FRA1: known(10),
    GOEN1: { ...known(10), reviews: [{ date: iso(0, 8), rating: 2 }], lastReviewedAt: iso(0, 8) },
    "FRA1#pl": { ...known(3), dueAt: iso(-1) }
  };
  const result = cards.buildSkillQueue(entries, meta, LEXICONS, {
    now: NOW,
    coreQueue: { dueEntries: [entries[1]], newEntries: [] }
  });
  assert.deepEqual(plain([...result.due, ...result.fresh].map((card) => card.id)), ["HAUS1#g"]);
  assert.ok(result.buried.includes("FRA1#pl"));
  assert.ok(result.buried.includes("GOEN1#pp"));

  // A skill card reviewed earlier today buries the word's other skills.
  const afterSkill = cards.buildSkillQueue(entries, {
    ...meta,
    "HAUS1#g": { ...known(1), reviews: [{ date: iso(0, 7), rating: 2 }], totalReviews: 1, dueAt: iso(3) }
  }, LEXICONS, { now: NOW });
  assert.equal(afterSkill.fresh.some((card) => card.entryId === "HAUS1"), false);
});

test("a skill card still in learning keeps coming back the same day", () => {
  const meta = {
    HAUS1: known(10),
    "HAUS1#g": { reviews: [{ date: iso(0, 8), rating: 1, grade: 1 }], totalReviews: 1, dueAt: iso(0, 8), st: 1, srs: 1 }
  };
  const result = cards.buildSkillQueue([entry("HAUS1")], meta, LEXICONS, { now: NOW });
  assert.deepEqual(plain(result.learning.map((card) => card.id)), ["HAUS1#g"]);
  assert.deepEqual(plain(result.fresh), []);
});

test("new skill cards first studied today use up the daily skill limit", () => {
  const entries = [entry("HAUS1"), entry("FRA1"), entry("GOEN1")];
  const meta = {
    HAUS1: known(10),
    FRA1: known(10),
    GOEN1: known(10),
    "MANN1#g": { reviews: [{ date: iso(0, 7), rating: 2 }], totalReviews: 1, dueAt: iso(3) },
    "MAACHEN1#pp": { reviews: [{ date: iso(0, 7), rating: 2 }], totalReviews: 1, dueAt: iso(3) }
  };
  const result = cards.buildSkillQueue(entries, meta, LEXICONS, { now: NOW, settings: { skillNewPerDay: 3 } });
  assert.equal(result.newSkillToday, 2);
  assert.equal(result.fresh.length, 1);
  assert.equal(cards.buildSkillQueue(entries, meta, LEXICONS, { now: NOW, settings: { skillNewPerDay: 0 } }).fresh.length, 0);
});

test("words without a lexicon simply have no skill cards", () => {
  const result = cards.buildSkillQueue([entry("HAUS1")], { HAUS1: known(10) }, {}, { now: NOW });
  assert.equal(result.count, 0);
});

test("mergeTodayQueue orders learning, core due, skill due, core new, skill new", () => {
  const core = {
    learning: [entry("MANN1")],
    dueEntries: [entry("HAUS1")],
    newEntries: [entry("FRA1")]
  };
  const skill = {
    learning: [{ id: "GOEN1#pp", entryId: "GOEN1", skill: "pp" }],
    due: [{ id: "GROUSS2#cz", entryId: "GROUSS2", skill: "cz" }],
    fresh: [{ id: "MAACHEN1#pp", entryId: "MAACHEN1", skill: "pp" }]
  };
  assert.deepEqual(plain(cards.mergeTodayQueue(core, skill).map((card) => card.id)), [
    "MANN1", "GOEN1#pp", "HAUS1", "GROUSS2#cz", "FRA1", "MAACHEN1#pp"
  ]);
  assert.deepEqual(plain(cards.mergeTodayQueue({}, {})), []);
});

test("leeches: six lapses, from FSRS counts or the legacy review log", () => {
  assert.equal(cards.lapseCount({ srs: 1, lapses: 4 }), 4);
  assert.equal(cards.isLeech({ srs: 1, lapses: 6 }), true);
  assert.equal(cards.isLeech({ leech: true }), true);
  const flip = (count) => Array.from({ length: count }, (_, index) => ({ rating: index % 2 ? 1 : 2 }));
  assert.equal(cards.lapseCount({ reviews: flip(12) }), 6);
  assert.equal(cards.isLeech({ reviews: flip(11) }), false);
  // An Again on a brand-new card or straight after another Again is not a lapse.
  assert.equal(cards.lapseCount({ reviews: [{ rating: 1 }, { rating: 1 }, { rating: 2 }, { grade: 1, rating: 1 }] }), 1);
  assert.equal(cards.lapseCount(null), 0);
});

test("multiple-choice distractors come from the same part of speech first", () => {
  const pool = [
    entry("MANN1"), entry("FRA1"), entry("GOEN1"), entry("MAACHEN1"), entry("GROUSS2"),
    { id: "DUP1", word: "Mann", pos: "SUBST+M" }, { id: "EMPTY1", word: "", pos: "SUBST+F" }
  ];
  let seed = 0;
  const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const picked = cards.pickDistractors(entry("HAUS1"), pool, { lexicons: LEXICONS, random });
  assert.equal(picked.length, 3);
  assert.deepEqual(plain(picked.slice(0, 2).map((candidate) => candidate.pos.split("+")[0])), ["SUBST", "SUBST"]);
  assert.equal(new Set(picked.map((candidate) => candidate.word)).size, 3);
  assert.ok(!picked.some((candidate) => candidate.id === "EMPTY1"));

  const verbs = cards.pickDistractors(entry("GOEN1"), pool, { count: 1, lexicons: LEXICONS, random });
  assert.deepEqual(plain(verbs.map((candidate) => candidate.id)), ["MAACHEN1"]);
  // The target's own text never appears as a distractor.
  const custom = cards.pickDistractors({ id: "X", word: "Mann", pos: "SUBST+M" }, pool, { count: 5, random });
  assert.ok(!custom.some((candidate) => candidate.word === "Mann"));
});

test("sense focus keeps the chosen senses and falls back to all", () => {
  assert.deepEqual(plain(cards.normalizeSenseFocus([25, "1", 1, -2, 2.5, "x"])), [1, 25]);
  assert.deepEqual(plain(cards.focusedSenses(LEXICONS.HAUS1, [2, 4]).map((sense) => sense.n)), [2, 4]);
  assert.equal(cards.focusedSenses(LEXICONS.HAUS1, [99]).length, 4);
  assert.equal(cards.focusedSenses(LEXICONS.HAUS1, null).length, 4);
});

test("sync priority puts core cards first, then skill cards by recency", () => {
  const meta = {
    A1: { lastReviewedAt: iso(-5) },
    B1: { lastReviewedAt: iso(-1) },
    "A1#g": { lastReviewedAt: iso(0) },
    "B1#pl": { lastReviewedAt: iso(-3) }
  };
  assert.deepEqual(["A1#g", "B1#pl", "A1", "B1"].sort(cards.compareSyncPriority(meta)), ["B1", "A1", "A1#g", "B1#pl"]);
});
