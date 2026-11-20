// Generates ts-fsrs-4.7.1-vectors.json. Run in a scratch directory, not this repo:
//   npm i ts-fsrs@4.7.1 && node generate-vectors.js > ts-fsrs-4.7.1-vectors.json
// ts-fsrs is not a dependency of LODVault; these vectors pin scripts/srs.js to it.
const { FSRS, fsrs, createEmptyCard, Rating, State, default_w, FSRSVersion } = require("ts-fsrs");
const algo = new FSRS({});
const out = { generator: FSRSVersion, weights: default_w, memory: [], intervals: [], reviews: [] };
for (const [d, s] of [[1, 0.4], [5, 3.173], [7.5, 12], [9.8, 60], [3.2, 200]]) {
  for (const t of [0, 1, 3, 10, 45, 400]) {
    for (const g of [1, 2, 3, 4]) {
      const r = algo.next_state({ difficulty: d, stability: s }, t, g);
      out.memory.push([d, s, t, g, r.difficulty, r.stability]);
    }
  }
}
for (const g of [1, 2, 3, 4]) { const r = algo.next_state(null, 0, g); out.memory.push([0, 0, 0, g, r.difficulty, r.stability]); }
for (const ret of [0.85, 0.9, 0.95]) {
  const f = fsrs({ request_retention: ret, enable_fuzz: false });
  for (const s of [0.4, 1.18, 3.173, 15.69, 33.3, 120.5, 900]) out.intervals.push([ret, s, f.next_interval(s, 0)]);
}
// Review-state sequences: start from a graduated card, then review at given gaps.
const f = fsrs({ enable_fuzz: false, maximum_interval: 36500 });
const seqs = [
  [[3, 0], [3, 4], [3, 12], [3, 30], [1, 70], [3, 1], [4, 5]],
  [[4, 0], [2, 20], [3, 9], [1, 2], [3, 3], [3, 15]],
  [[2, 0], [3, 2], [3, 2], [4, 9], [2, 40], [3, 200]]
];
for (const seq of seqs) {
  let time = Date.UTC(2026, 0, 5, 12);
  // Seed: a review-state card from S0/D0 of the first grade.
  const first = seq[0][0];
  let card = { ...createEmptyCard(new Date(time)), state: State.Review, stability: algo.init_stability(first), difficulty: algo.init_difficulty(first), last_review: new Date(time), reps: 1 };
  const steps = [];
  for (const [g, gap] of seq.slice(1)) {
    time += gap * 86400000;
    const res = f.next(card, new Date(time), g);
    steps.push({ gap, g, s: res.card.stability, d: res.card.difficulty, days: res.card.scheduled_days, state: res.card.state, lapses: res.card.lapses });
    if (res.card.state !== State.Review) {
      // Relearning: one Good step on the same day graduates (ts short-term), record it too.
      const back = f.next(res.card, new Date(time), Rating.Good);
      steps.push({ gap: 0, g: 3, s: back.card.stability, d: back.card.difficulty, days: back.card.scheduled_days, state: back.card.state, lapses: back.card.lapses, relearn: true });
      card = back.card;
    } else card = res.card;
  }
  out.reviews.push({ start: Date.UTC(2026, 0, 5, 12), first, steps });
}
console.log(JSON.stringify(out));
