const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.join(__dirname, "..");
const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "fsrs", "ts-fsrs-4.7.1-vectors.json"), "utf8"));

function loadSrs() {
  const context = { Date, Math, Number, String, Object, Array, globalThis: null };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(repoRoot, "scripts/srs.js"), "utf8"), context, { filename: "scripts/srs.js" });
  return context.LodVaultSrs;
}

const Srs = loadSrs();
const DAY = 86400000;

test("weights are FSRS-5's defaults, as pinned by ts-fsrs 4.7.1", () => {
  assert.match(vectors.generator, /4\.7\.1.*FSRS-5/);
  assert.deepEqual([...Srs.WEIGHTS], vectors.weights);
});

test("memory updates match ts-fsrs next_state", () => {
  for (const [d, s, t, g, expectedD, expectedS] of vectors.memory) {
    const next = Srs.nextMemory(d || s ? { d, s } : null, t, g);
    assert.equal(next.d, expectedD, `D for ${[d, s, t, g]}`);
    assert.equal(next.s, expectedS, `S for ${[d, s, t, g]}`);
  }
});

test("intervals match ts-fsrs for each desired retention", () => {
  for (const [retention, stability, days] of vectors.intervals) {
    assert.equal(Srs.nextInterval(stability, retention, 36500), days, `${retention} ${stability}`);
  }
});

test("review sequences with lapses and relearning match ts-fsrs", () => {
  for (const sequence of vectors.reviews) {
    let time = sequence.start;
    let card = {
      s: Srs.initStability(sequence.first),
      d: Srs.initDifficulty(sequence.first),
      st: Srs.STATES.REVIEW,
      reps: 1,
      last: new Date(time).toISOString()
    };
    for (const step of sequence.steps) {
      time += step.gap * DAY;
      const result = Srs.review(card, step.g, time, { fuzz: false, maxInterval: 36500, cardId: "X" });
      assert.equal(result.card.s, step.s, JSON.stringify(step));
      assert.equal(result.card.d, step.d, JSON.stringify(step));
      assert.equal(result.days, step.days, JSON.stringify(step));
      assert.equal(result.card.st, step.state, JSON.stringify(step));
      assert.equal(result.card.lapses, step.lapses, JSON.stringify(step));
      card = result.card;
    }
  }
});

test("a new word graduates after two correct answers, with S0 of its last grade", () => {
  const now = Date.UTC(2026, 5, 10, 9);
  const first = Srs.review(Srs.initCard(), 3, now, { cardId: "HAUS1" });
  assert.equal(first.card.st, Srs.STATES.LEARNING);
  assert.equal(first.days, 0);
  assert.equal(first.dueTime, now + 10 * 60000);

  const missed = Srs.review(first.card, 1, now + 60000, { cardId: "HAUS1" });
  assert.equal(missed.card.st, Srs.STATES.LEARNING);
  assert.equal(missed.card.step, 0);

  const again = Srs.review(missed.card, 3, now + 120000, { cardId: "HAUS1" });
  assert.equal(again.card.st, Srs.STATES.LEARNING);
  const graduated = Srs.review(again.card, 3, now + 180000, { cardId: "HAUS1" });
  assert.equal(graduated.card.st, Srs.STATES.REVIEW);
  assert.equal(graduated.card.s, Srs.initStability(3));
  assert.equal(graduated.days, 3);

  // Easy skips the steps.
  const easy = Srs.review(Srs.initCard(), 4, now, { cardId: "HAUS1", fuzz: false });
  assert.equal(easy.card.st, Srs.STATES.REVIEW);
  assert.equal(easy.days, 16);
});

test("lateness counts: a word recalled long after its due date grows more", () => {
  const start = Date.UTC(2026, 0, 1, 12);
  const card = { s: 10, d: 5, st: 2, reps: 3, last: new Date(start).toISOString() };
  const onTime = Srs.review(card, 3, start + 10 * DAY, { fuzz: false });
  const late = Srs.review(card, 3, start + 60 * DAY, { fuzz: false });
  assert.ok(late.card.s > onTime.card.s * 1.5, `${late.card.s} vs ${onTime.card.s}`);
});

test("Hard < Good < Easy, and the buttons preview what each grade does", () => {
  const now = Date.UTC(2026, 5, 10, 9);
  const card = { s: 8, d: 6, st: 2, reps: 4, last: new Date(now - 8 * DAY).toISOString() };
  const preview = Srs.previewIntervals(card, now, { cardId: "MANN1" });
  assert.equal(preview[1].minutes, 10);
  assert.ok(preview[2].days < preview[3].days && preview[3].days < preview[4].days);
  for (const grade of [1, 2, 3, 4]) {
    const result = Srs.review(card, grade, now, { cardId: "MANN1" });
    assert.equal(result.days, preview[grade].days);
  }
});

test("fuzz is deterministic, stays in range and spreads load", () => {
  for (const days of [1, 2, 3, 5, 10, 25, 100, 300]) {
    const delta = Srs.fuzzDelta(days);
    for (let reps = 0; reps < 20; reps += 1) {
      const fuzzed = Srs.fuzzInterval("HAUS1", reps, days, 365);
      assert.ok(Math.abs(fuzzed - days) <= delta, `${days} → ${fuzzed}`);
      assert.equal(fuzzed, Srs.fuzzInterval("HAUS1", reps, days, 365));
    }
  }
  assert.equal(Srs.fuzzDelta(2), 0);
  assert.equal(Srs.fuzzDelta(20), 2);
  assert.equal(Srs.fuzzDelta(200), 10);

  // The least loaded day in range wins.
  const load = (day) => (day === 20 ? 0 : 50);
  assert.equal(Srs.scheduleDays("X", 1, 19, { load }), 20);
  assert.ok(Srs.scheduleDays("X", 1, 300, { maxInterval: 365 }) <= 315);
  assert.equal(Srs.scheduleDays("X", 1, 400, { maxInterval: 365, fuzz: false }), 365);
});

test("retrievability falls from 1 to the desired retention at the interval", () => {
  const now = Date.UTC(2026, 5, 10, 9);
  const card = { s: 10, d: 5, st: 2, last: new Date(now).toISOString() };
  assert.equal(Srs.retrievability(card, now), 1);
  assert.ok(Math.abs(Srs.retrievability(card, now + 10 * DAY) - 0.9) < 1e-6);
  assert.equal(Srs.retrievability(Srs.initCard(), now), null);
});

test("legacy cards migrate by replaying a complete log, else from interval and counts", () => {
  const day = (n) => new Date(Date.UTC(2026, 0, 1 + n, 12)).toISOString();
  const replayed = Srs.migrateLegacy({
    totalReviews: 4,
    reviews: [{ date: day(0), rating: 2 }, { date: day(1), rating: 2 }, { date: day(3), rating: 1 }, { date: day(4), rating: 3 }]
  });
  let memory = Srs.nextMemory(null, 0, 3);
  memory = Srs.nextMemory(memory, 1, 3);
  assert.equal(replayed.st, Srs.STATES.REVIEW);
  assert.equal(replayed.lapses, 1);
  assert.equal(replayed.reps, 4);
  assert.equal(replayed.last, day(4));
  assert.ok(replayed.s > 0 && replayed.d >= 1 && replayed.d <= 10);
  assert.ok(memory.s > Srs.initStability(3));

  const seeded = Srs.migrateLegacy({
    totalReviews: 40,
    reviews: [{ date: day(30), rating: 3 }],
    hardCount: 4,
    easyCount: 20,
    interval: 25,
    lastReviewedAt: day(30)
  });
  assert.equal(seeded.s, 25);
  assert.equal(seeded.d, 5 + 1.5 * 4 / 40 - 1.5 * 20 / 40);
  assert.equal(seeded.lapses, 0);
  assert.equal(seeded.st, Srs.STATES.REVIEW);
});

test("I already know this: straight to review with about a week", () => {
  const now = Date.UTC(2026, 5, 10, 9);
  const result = Srs.markKnown(Srs.initCard(), now, { fuzz: false });
  assert.equal(result.card.st, Srs.STATES.REVIEW);
  assert.equal(result.card.s, 7);
  assert.equal(result.days, 7);
});
