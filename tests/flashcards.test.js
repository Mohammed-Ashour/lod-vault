const test = require("node:test");
const assert = require("node:assert/strict");

const { loadFlashcardsScript, loadSharedStore } = require("./helpers/loaders");

function makeEntry(overrides = {}) {
  return {
    id: "HAUS1",
    word: "Haus",
    url: "https://lod.lu/artikel/HAUS1",
    translations: { en: "house" },
    study: true,
    favorite: false,
    ...overrides
  };
}

test("flashcards reload their deck when extension storage changes", async () => {
  const { dom, storageOnChanged, setEntries } = await loadFlashcardsScript({ entries: [] });

  assert.match(dom.window.document.getElementById("deck-status").textContent, /No cards in this deck yet/);
  assert.equal(dom.window.document.getElementById("card-shell").classList.contains("is-hidden"), true);

  setEntries([makeEntry()]);
  storageOnChanged.dispatch({
    "lodVault.entries": {
      oldValue: {},
      newValue: { HAUS1: makeEntry() }
    }
  }, "local");

  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

  assert.match(dom.window.document.getElementById("deck-status").textContent, /1 card in this deck/);
  assert.equal(dom.window.document.getElementById("card-shell").classList.contains("is-hidden"), false);
  assert.equal(dom.window.document.getElementById("card-word").textContent, "Haus");
});

test("Due today deck contains only due cards and shows their count", async () => {
  const { dom } = await loadFlashcardsScript({
    entries: [
      makeEntry({ id: "DUE1", word: "Due word" }),
      makeEntry({ id: "LATER1", word: "Later word" })
    ],
    storeOverrides: {
      async getFlashcardMeta() {
        return {
          DUE1: { totalReviews: 1, reviews: [], dueAt: new Date(Date.now() - 60000).toISOString() },
          LATER1: { totalReviews: 1, reviews: [], dueAt: new Date(Date.now() + 86400000).toISOString() },
          REMOVED1: { totalReviews: 1, reviews: [], dueAt: new Date(Date.now() - 60000).toISOString() }
        };
      }
    }
  });

  const deckFilter = dom.window.document.getElementById("deck-filter");
  deckFilter.value = "due";
  deckFilter.dispatchEvent(new dom.window.Event("change"));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

  assert.match(dom.window.document.getElementById("deck-status").textContent, /1 card in this deck/);
  assert.equal(dom.window.document.getElementById("card-word").textContent, "Due word");
  assert.equal(dom.window.document.getElementById("stat-due").textContent, "1");
});

test("reverse direction shows translation on the front", async () => {
  const { dom } = await loadFlashcardsScript({
    entries: [makeEntry({ translations: { en: "house" } })]
  });

  const directionToggle = dom.window.document.getElementById("direction-toggle");
  directionToggle.click();

  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

  assert.equal(dom.window.document.getElementById("card-word").textContent, "house");
  assert.match(dom.window.document.getElementById("card-type").textContent, /Recall the Luxembourgish word/);
});

test("session mode shows bounded deck and summary after ratings", async () => {
  const entries = Array.from({ length: 12 }, (_, i) =>
    makeEntry({ id: `WORD${i}`, word: `Word${i}` })
  );
  const { dom } = await loadFlashcardsScript({ entries });

  const sessionSize = dom.window.document.getElementById("session-size");
  sessionSize.value = "10";
  sessionSize.dispatchEvent(new dom.window.Event("change"));

  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

  assert.match(dom.window.document.getElementById("progress").textContent, /Session 1 \/ 10/);

  const ratingGood = () => dom.window.document.querySelector('[data-grade="3"]');

  // Rate 9 cards
  for (let i = 0; i < 9; i += 1) {
    dom.window.document.getElementById("flip-card").click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    ratingGood().click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  }

  assert.match(dom.window.document.getElementById("progress").textContent, /Session 10 \/ 10/);

  // Rate the final card to trigger summary
  dom.window.document.getElementById("flip-card").click();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  ratingGood().click();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

  // Summary should be visible
  assert.equal(dom.window.document.getElementById("summary-overlay").classList.contains("is-hidden"), false);
  assert.equal(dom.window.document.getElementById("summary-total").textContent, "10");
  assert.equal(dom.window.document.getElementById("summary-good").textContent, "10");
});

test("flashcard sessions resume at the first unrated card", async () => {
  const entries = Array.from({ length: 12 }, (_, i) => makeEntry({ id: `WORD${i}`, word: `Word${i}` }));
  const url = "https://extension.test/pages/flashcards.html?deck=study";
  const first = await loadFlashcardsScript({ entries, url });
  const size = first.dom.window.document.getElementById("session-size");
  size.value = "10";
  size.dispatchEvent(new first.dom.window.Event("change"));
  await new Promise((resolve) => first.dom.window.setTimeout(resolve, 0));

  for (let index = 0; index < 2; index += 1) {
    first.dom.window.document.getElementById("flip-card").click();
    first.dom.window.document.querySelector('[data-grade="3"]').click();
    await new Promise((resolve) => first.dom.window.setTimeout(resolve, 0));
  }

  assert.equal(first.storageData["lodVault.flashcardSession"].index, 2);

  const resumed = await loadFlashcardsScript({ entries, url, localStorage: first.storageData });
  const resume = resumed.dom.window.document.getElementById("resume-session");
  assert.equal(resume.classList.contains("is-hidden"), false);
  assert.match(resume.textContent, /8 cards remaining/);

  resumed.dom.window.document.getElementById("resume-session-button").click();
  await new Promise((resolve) => resumed.dom.window.setTimeout(resolve, 0));
  assert.equal(resumed.dom.window.document.getElementById("card-word").textContent, "Word2");
});

test("daily progress counts cards, not presses, and the new-word limit can be lifted", async () => {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  // Missed once, retried and passed: three presses, one new card.
  const reviews = [1, 1, 2].map((rating) => ({ date: now.toISOString(), rating, direction: "fwd" }));
  const { dom, storageData } = await loadFlashcardsScript({
    entries: [makeEntry({ study: true })],
    storeOverrides: {
      async getFlashcardMeta() {
        return { HAUS1: { totalReviews: 3, reviews, goodCount: 1, hardCount: 2, dueAt: tomorrow, interval: 1 } };
      }
    }
  });

  const doc = dom.window.document;
  assert.equal(doc.getElementById("stat-today").textContent, "1");
  assert.equal(doc.getElementById("daily-progress").textContent, "Done for today: 0/0 reviews · 1/1 new");
  const target = doc.getElementById("new-per-day");
  target.value = "none";
  target.dispatchEvent(new dom.window.Event("change"));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

  assert.equal(doc.getElementById("daily-progress").textContent, "Done for today: 0/0 reviews · 1 new · no new-word limit");
  assert.equal(storageData["lodVault.flashcardSettings"].newPerDay, null);
  assert.equal(storageData["lodVault.flashcardSettings"].mode, "self");
});

test("keyboard shortcuts trigger rating and direction toggle", async () => {
  const { dom } = await loadFlashcardsScript({
    entries: [makeEntry()]
  });

  const doc = dom.window.document;

  // R key toggles direction
  doc.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "R" }));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(doc.getElementById("direction-toggle").classList.contains("is-active"), true);

  // Reveal card
  doc.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: " " }));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(doc.getElementById("flashcard").classList.contains("is-revealed"), true);
  assert.equal(doc.getElementById("rating-bar").classList.contains("is-hidden"), false);
});

test("keyboard shortcuts ignore editable controls", async () => {
  let reviewCount = 0;
  const { dom } = await loadFlashcardsScript({
    entries: [makeEntry()],
    storeOverrides: {
      async recordFlashcardReview() {
        reviewCount += 1;
        return {};
      }
    }
  });
  const doc = dom.window.document;
  const targets = [
    doc.getElementById("deck-filter"),
    doc.createElement("input"),
    doc.createElement("textarea"),
    doc.createElement("div")
  ];
  Object.defineProperty(targets[3], "isContentEditable", { value: true });

  for (const target of targets) {
    doc.body.append(target);
    target.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "R", bubbles: true }));
  }
  assert.equal(doc.getElementById("direction-toggle").classList.contains("is-active"), false);

  targets[0].dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: " ", bubbles: true }));
  assert.equal(doc.getElementById("flashcard").classList.contains("is-revealed"), false);

  doc.getElementById("flip-card").click();
  targets[0].dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "1", bubbles: true }));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(reviewCount, 0);
});

test("Escape closes the session summary", async () => {
  const { dom } = await loadFlashcardsScript({ entries: [makeEntry()] });
  const summary = dom.window.document.getElementById("summary-overlay");
  summary.classList.remove("is-hidden");

  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

  assert.equal(summary.classList.contains("is-hidden"), true);
});

test("stats bar renders computed values", async () => {
  const { dom } = await loadFlashcardsScript({
    entries: [makeEntry(), makeEntry({ id: "DACH1", word: "Dach" })]
  });

  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

  assert.equal(dom.window.document.getElementById("stat-new").textContent, "2");
});

test("?deck=due deep link opens the Due today deck even when study cards exist", async () => {
  const now = Date.now();
  const entries = [
    { id: "DUE1", word: "Due Word", url: "https://lod.lu/artikel/DUE1", study: true, updatedAt: new Date(now).toISOString() },
    { id: "LATER1", word: "Later Word", url: "https://lod.lu/artikel/LATER1", study: true, updatedAt: new Date(now).toISOString() },
    { id: "FAV1", word: "Fav Word", url: "https://lod.lu/artikel/FAV1", favorite: true, study: false, updatedAt: new Date(now).toISOString() }
  ];
  const { dom } = await loadFlashcardsScript({
    entries,
    url: "https://extension.test/pages/flashcards.html?deck=due",
    storeOverrides: {
      async getFlashcardMeta() {
        return {
          DUE1: { totalReviews: 3, dueAt: new Date(now - 3600e3).toISOString(), reviews: [{ date: new Date().toISOString(), rating: 2 }] },
          LATER1: { totalReviews: 2, dueAt: new Date(now + 86400e3).toISOString(), reviews: [{ date: new Date().toISOString(), rating: 2 }] }
        };
      }
    }
  });
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

  assert.equal(dom.window.document.getElementById("deck-filter").value, "due");
  const word = dom.window.document.getElementById("card-word");
  assert.equal(word.textContent, "Due Word");
});

test("multiple choice mode maps correct answers to Good and wrong answers to Hard", async () => {
  const reviews = [];
  const { dom } = await loadFlashcardsScript({
    entries: [
      makeEntry({ id: "A1", word: "Haus", translations: { en: "house" } }),
      makeEntry({ id: "A2", word: "Waasser", translations: { en: "water" } }),
      makeEntry({ id: "A3", word: "Bam", translations: { en: "tree" } }),
      makeEntry({ id: "A4", word: "Sonn", translations: { en: "sun" } })
    ],
    storeOverrides: {
      async recordFlashcardReview(entryId, rating) {
        reviews.push({ entryId, rating });
      }
    }
  });

  const modeSelect = dom.window.document.getElementById("mode-select");
  modeSelect.value = "mc";
  modeSelect.dispatchEvent(new dom.window.Event("change"));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

  const options = () => [...dom.window.document.querySelectorAll("#mc-options button")];
  assert.equal(options().length, 4);

  options().find((button) => button.dataset.correct === "1").click();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 900));
  assert.deepEqual(reviews, [{ entryId: "A1", rating: 3 }]);

  options().find((button) => button.dataset.correct === "0").click();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 900));
  assert.deepEqual(reviews, [
    { entryId: "A1", rating: 3 },
    { entryId: "A2", rating: 1 }
  ]);
});

test("multiple choice drops a pick when the card changes before the delay elapses", async () => {
  const reviews = [];
  const { dom } = await loadFlashcardsScript({
    url: "https://extension.test/pages/flashcards.html?deck=study",
    entries: [
      makeEntry({ id: "A1", word: "Haus", translations: { en: "house" } }),
      makeEntry({ id: "A2", word: "Waasser", translations: { en: "water" } }),
      makeEntry({ id: "A3", word: "Bam", translations: { en: "tree" } }),
      makeEntry({ id: "A4", word: "Sonn", translations: { en: "sun" } })
    ],
    storeOverrides: {
      async recordFlashcardReview(entryId, rating) {
        reviews.push({ entryId, rating });
      }
    }
  });

  const modeSelect = dom.window.document.getElementById("mode-select");
  modeSelect.value = "mc";
  modeSelect.dispatchEvent(new dom.window.Event("change"));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

  const options = () => [...dom.window.document.querySelectorAll("#mc-options button")];
  options()[0].click();
  dom.window.document.getElementById("next-card").click();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 900));

  assert.deepEqual(reviews, []);
});

const wait = (dom, ms = 0) => new Promise((resolve) => dom.window.setTimeout(resolve, ms));

async function loadWithReviews({ entries, meta = {}, url, localStorage } = {}) {
  const reviews = [];
  const loaded = await loadFlashcardsScript({
    entries,
    url,
    localStorage,
    storeOverrides: {
      async getFlashcardMeta() {
        return meta;
      },
      async recordFlashcardReview(entryId, rating) {
        reviews.push({ entryId, rating });
      }
    }
  });
  return { ...loaded, reviews };
}

async function revealAndRate(dom, rating) {
  dom.window.document.getElementById("flip-card").click();
  dom.window.document.querySelector(`[data-grade="${rating}"]`).click();
  await wait(dom);
}

test("flashcards open on Today: due cards first, then new words up to the target", async () => {
  const past = new Date(Date.now() - 3 * 86400e3).toISOString();
  const entries = [
    makeEntry({ id: "NEW1", word: "Neit" }),
    makeEntry({ id: "HISTORY1", word: "Vergaangen", study: false, history: true }),
    makeEntry({ id: "DUE1", word: "Faelleg" })
  ];
  const { dom } = await loadWithReviews({
    entries,
    meta: { DUE1: { totalReviews: 2, reviews: [], interval: 2, dueAt: past } }
  });
  const doc = dom.window.document;

  assert.equal(doc.getElementById("deck-filter").value, "today");
  assert.equal(doc.getElementById("card-word").textContent, "Faelleg");
  assert.match(doc.getElementById("progress").textContent, /Session 1 \/ 2/);
});

test("learning and mastered counts leave out words that were deleted", async () => {
  const reviewed = { totalReviews: 1, reviews: [{ date: "2026-01-02T00:00:00.000Z", rating: 2 }], interval: 1, dueAt: "2099-01-01T00:00:00.000Z" };
  const { dom } = await loadWithReviews({
    entries: [makeEntry({ id: "KEPT1", word: "Bleift" })],
    meta: { KEPT1: reviewed, GONE1: reviewed }
  });

  assert.equal(dom.window.document.getElementById("stat-learning").textContent, "1");
});

test("the daily target limits how many new words Today introduces", async () => {
  const entries = Array.from({ length: 12 }, (_, i) => makeEntry({ id: `W${i}`, word: `W${i}` }));
  const { dom } = await loadWithReviews({
    entries,
    localStorage: { "lodVault.flashcardSettings": { dailyTarget: 5, mode: "self" } }
  });
  const doc = dom.window.document;
  assert.match(doc.getElementById("progress").textContent, /Session 1 \/ 5/);

  const target = doc.getElementById("new-per-day");
  target.value = "20";
  target.dispatchEvent(new dom.window.Event("change"));
  await wait(dom);
  assert.match(doc.getElementById("progress").textContent, /Session 1 \/ 12/);
});

test("a Hard card comes back once before the session ends", async () => {
  const entries = [makeEntry({ id: "A", word: "Eent" }), makeEntry({ id: "B", word: "Zwee" })];
  const { dom, reviews } = await loadWithReviews({ entries });
  const doc = dom.window.document;

  await revealAndRate(dom, 1);
  assert.match(doc.getElementById("progress").textContent, /Session 2 \/ 3/);
  await revealAndRate(dom, 3);
  assert.equal(doc.getElementById("card-word").textContent, "Eent");
  await revealAndRate(dom, 1);

  assert.deepEqual(reviews.map((review) => review.entryId), ["A", "B", "A"]);
  assert.equal(doc.getElementById("summary-overlay").classList.contains("is-hidden"), false);
  // The retry is not a third card: each card counts once, by its first try.
  assert.equal(doc.getElementById("summary-total").textContent, "2");
  assert.equal(doc.getElementById("summary-again").textContent, "1");
  assert.equal(doc.getElementById("summary-good").textContent, "1");
});

test("a retried multiple-choice card gets fresh options when it follows itself", async () => {
  const entries = [
    makeEntry({ id: "A", word: "Eent", translations: { en: "one" } }),
    makeEntry({ id: "B", word: "Zwee", translations: { en: "two" }, study: false, favorite: true })
  ];
  const { dom, reviews } = await loadWithReviews({ entries });
  const doc = dom.window.document;
  const modeSelect = doc.getElementById("mode-select");
  modeSelect.value = "mc";
  modeSelect.dispatchEvent(new dom.window.Event("change"));
  await wait(dom);

  doc.querySelector('#mc-options [data-correct="0"]').click();
  await wait(dom, 800);

  assert.deepEqual(reviews, [{ entryId: "A", rating: 1 }]);
  const options = [...doc.querySelectorAll("#mc-options button")];
  assert.ok(options.length > 1);
  assert.ok(options.every((option) => !option.disabled));
});

test("Today resumes where it stopped, retries included, without asking", async () => {
  const entries = [makeEntry({ id: "A", word: "Eent" }), makeEntry({ id: "B", word: "Zwee" })];
  const { dom, storageData } = await loadWithReviews({ entries });
  await revealAndRate(dom, 1);
  const saved = storageData["lodVault.flashcardSession"];
  assert.equal(saved.filter, "today");
  assert.deepEqual(Array.from(saved.cardIds), ["A", "B", "A"]);

  const reopened = await loadWithReviews({ entries, localStorage: storageData });
  const doc = reopened.dom.window.document;
  assert.equal(doc.getElementById("resume-session").classList.contains("is-hidden"), true);
  assert.equal(doc.getElementById("card-word").textContent, "Zwee");
  assert.match(doc.getElementById("progress").textContent, /Session 2 \/ 3/);

  // A Today session from another day is dropped.
  const stale = await loadWithReviews({ entries, localStorage: { "lodVault.flashcardSession": { ...saved, day: "2001-01-01" } } });
  assert.equal(stale.dom.window.document.getElementById("card-word").textContent, "Eent");
  assert.match(stale.dom.window.document.getElementById("progress").textContent, /Session 1 \/ 2/);
});

test("finishing Today shows a done state with a way to keep practising", async () => {
  const future = new Date(Date.now() + 3 * 86400e3).toISOString();
  const { dom } = await loadWithReviews({
    entries: [makeEntry()],
    meta: { HAUS1: { totalReviews: 1, reviews: [], interval: 3, dueAt: future } }
  });
  const doc = dom.window.document;
  assert.equal(doc.getElementById("empty-title").textContent, "All done for today.");

  const button = doc.getElementById("empty-study-list");
  assert.equal(button.classList.contains("is-hidden"), false);
  button.click();
  await wait(dom);
  assert.equal(doc.getElementById("deck-filter").value, "study");
  assert.equal(doc.getElementById("card-word").textContent, "Haus");
});

test("a word list with no Study words falls back to a deck that has cards", async () => {
  const { dom } = await loadWithReviews({
    entries: [makeEntry({ study: false, favorite: true })]
  });
  assert.equal(dom.window.document.getElementById("deck-filter").value, "favorites");
});

test("a storage change neither resets the chosen deck nor closes the summary", async () => {
  const entries = [makeEntry()];
  const { dom, storageOnChanged } = await loadWithReviews({
    entries,
    url: "https://extension.test/pages/flashcards.html?deck=study"
  });
  const doc = dom.window.document;
  const deck = doc.getElementById("deck-filter");
  deck.value = "all";
  deck.dispatchEvent(new dom.window.Event("change"));
  await wait(dom);

  storageOnChanged.dispatch({ "lodVault.flashcardMeta": {} }, "local");
  await wait(dom, 5);
  assert.match(doc.getElementById("deck-status").textContent, /All saved/);

  deck.value = "today";
  deck.dispatchEvent(new dom.window.Event("change"));
  await wait(dom);
  await revealAndRate(dom, 3);
  const summary = doc.getElementById("summary-overlay");
  assert.equal(summary.classList.contains("is-hidden"), false);

  storageOnChanged.dispatch({ "lodVault.flashcardMeta": {} }, "local");
  await wait(dom, 5);
  assert.equal(summary.classList.contains("is-hidden"), false);
});

test("the flashcard page lists the keyboard shortcuts for the current mode", async () => {
  const entries = [makeEntry(), makeEntry({ id: "B", word: "Bam" })];
  const { dom } = await loadWithReviews({
    entries,
    url: "https://extension.test/pages/flashcards.html?deck=study"
  });
  const doc = dom.window.document;
  const hint = doc.getElementById("shortcut-hint");
  assert.equal(hint.textContent, "Space reveal · ← → navigate · 1 Again · 2 Good · 3 Easy · R flip direction");

  const modeSelect = doc.getElementById("mode-select");
  modeSelect.value = "mc";
  modeSelect.dispatchEvent(new dom.window.Event("change"));
  await wait(dom);
  assert.equal(hint.textContent, "1–4 choose · ← → navigate · R flip direction");
});

test("Prev and Next move through the unrated cards of a session", async () => {
  const entries = ["A", "B", "C"].map((id) => makeEntry({ id, word: id }));
  const { dom, reviews } = await loadWithReviews({ entries });
  const doc = dom.window.document;
  const word = () => doc.getElementById("card-word").textContent;
  const next = doc.getElementById("next-card");
  const prev = doc.getElementById("prev-card");

  assert.equal(next.disabled, false);
  assert.equal(prev.disabled, false);

  next.click();
  assert.equal(word(), "B");
  next.click();
  assert.equal(word(), "C");
  next.click();
  assert.equal(word(), "A");
  prev.click();
  assert.equal(word(), "C");

  // Skipping isn't rating, and every card still gets rated exactly once.
  assert.deepEqual(reviews, []);
  assert.match(doc.getElementById("session-progress").textContent, /0 done · 3 left/);

  await revealAndRate(dom, 3);
  assert.equal(word(), "A");
  next.click();
  assert.equal(word(), "B");
  await revealAndRate(dom, 3);
  assert.equal(word(), "A");

  // One card left: there is nowhere to move to.
  assert.equal(next.disabled, true);
  assert.equal(prev.disabled, true);
  await revealAndRate(dom, 3);

  assert.deepEqual(reviews.map((review) => review.entryId), ["C", "B", "A"]);
  assert.equal(doc.getElementById("summary-overlay").classList.contains("is-hidden"), false);
  assert.equal(doc.getElementById("summary-total").textContent, "3");
});

test("keyboard arrows follow Prev and Next, and skipped order survives a resume", async () => {
  const entries = Array.from({ length: 12 }, (_, i) => makeEntry({ id: `W${i}`, word: `W${i}` }));
  const url = "https://extension.test/pages/flashcards.html?deck=study";
  const first = await loadWithReviews({ entries, url });
  const doc = first.dom.window.document;
  const size = doc.getElementById("session-size");
  size.value = "10";
  size.dispatchEvent(new first.dom.window.Event("change"));
  await wait(first.dom);

  const startWord = doc.getElementById("card-word").textContent;
  doc.dispatchEvent(new first.dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  const skippedTo = doc.getElementById("card-word").textContent;
  assert.notEqual(skippedTo, startWord);
  await wait(first.dom);

  const resumed = await loadWithReviews({ entries, url, localStorage: first.storageData });
  resumed.dom.window.document.getElementById("resume-session-button").click();
  await wait(resumed.dom);
  assert.equal(resumed.dom.window.document.getElementById("card-word").textContent, skippedTo);
});

test("a new session starts on its first card and rates each card once", async () => {
  const entries = Array.from({ length: 25 }, (_, i) => makeEntry({
    id: `W${String(i).padStart(2, "0")}`,
    word: `W${String(i).padStart(2, "0")}`
  }));
  const { dom, reviews } = await loadWithReviews({
    entries,
    localStorage: { "lodVault.flashcardSettings": { dailyTarget: null, mode: "self" } }
  });
  const doc = dom.window.document;
  const size = doc.getElementById("session-size");
  size.value = "10";
  size.dispatchEvent(new dom.window.Event("change"));
  await wait(dom);

  for (let index = 0; index < 10; index += 1) await revealAndRate(dom, 3);
  doc.getElementById("close-summary").click();
  await wait(dom);

  const secondStart = reviews.length;
  assert.equal(doc.getElementById("card-word").textContent, "W00");
  for (let index = 0; index < 10; index += 1) await revealAndRate(dom, 3);

  const second = reviews.slice(secondStart).map((review) => review.entryId);
  assert.equal(new Set(second).size, 10);
});

test("rating a Today card clears an older saved session, but opening Today doesn't", async () => {
  const entries = ["A", "B", "C", "D"].map((id) => makeEntry({ id, word: id }));
  const saved = { filter: "study", orderMode: "smart", direction: "fwd", mode: "self", sessionSize: "10", cardIds: ["A", "B", "C", "D"], index: 1, results: [] };
  const { dom, storageData } = await loadWithReviews({
    entries,
    localStorage: { "lodVault.flashcardSession": saved }
  });
  const doc = dom.window.document;
  const resume = doc.getElementById("resume-session");
  assert.equal(resume.classList.contains("is-hidden"), false);
  assert.ok(storageData["lodVault.flashcardSession"]);

  await revealAndRate(dom, 3);

  assert.equal(resume.classList.contains("is-hidden"), true);
  // What is saved now is Today's own session.
  assert.equal(storageData["lodVault.flashcardSession"].filter, "today");
});

test("Today doesn't claim you finished when there was nothing to study", async () => {
  const { dom } = await loadWithReviews({
    entries: [makeEntry({ study: false, history: true })],
    url: "https://extension.test/pages/flashcards.html?deck=today"
  });
  const doc = dom.window.document;
  assert.equal(doc.getElementById("empty-title").textContent, "Nothing due here.");
  assert.equal(doc.getElementById("empty-study-list").classList.contains("is-hidden"), true);
});

test("number keys rate after Reveal was clicked with the mouse", async () => {
  const entries = [makeEntry({ id: "A", word: "Eent" }), makeEntry({ id: "B", word: "Zwee" })];
  const { dom, reviews } = await loadWithReviews({ entries });
  const doc = dom.window.document;
  const flip = doc.getElementById("flip-card");
  flip.click();
  flip.focus();
  flip.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "2", bubbles: true }));
  await wait(dom);
  assert.deepEqual(reviews, [{ entryId: "A", rating: 3 }]);

  // Space and Enter on a focused button stay with the button.
  doc.getElementById("flip-card").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: " ", bubbles: true }));
  await wait(dom);
  assert.equal(doc.getElementById("flashcard").classList.contains("is-revealed"), false);

  // Controls outside the card, like the Session menu, keep their keys.
  doc.getElementById("session-trigger").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "R", bubbles: true }));
  await wait(dom);
  assert.equal(doc.getElementById("direction-toggle").classList.contains("is-active"), false);
});

test("reverse and multiple choice never put the answer on the front of a word without translations", async () => {
  const bare = makeEntry({ id: "BARE", word: "Bare", pos: "SUBST+N", translations: {} });
  const recorded = [];
  const { dom } = await loadFlashcardsScript({
    entries: [bare, makeEntry({ id: "B", word: "Zwee", translations: { en: "two" } }), makeEntry({ id: "C", word: "Dräi", translations: { en: "three" } })],
    storeOverrides: {
      async recordFlashcardReview(entryId, rating, direction) {
        recorded.push({ entryId, direction });
      }
    },
    url: "https://extension.test/pages/flashcards.html?deck=all"
  });
  const doc = dom.window.document;
  doc.getElementById("order-mode").value = "sequential";
  doc.getElementById("order-mode").dispatchEvent(new dom.window.Event("change"));
  await wait(dom);
  doc.getElementById("direction-toggle").click();
  await wait(dom);

  assert.equal(doc.getElementById("card-word").textContent, "Bare");
  assert.match(doc.getElementById("card-hint").textContent, /No saved translation/);
  doc.getElementById("flip-card").click();
  doc.querySelector('[data-grade="3"]').click();
  await wait(dom);
  assert.deepEqual(recorded, [{ entryId: "BARE", direction: "fwd" }]);

  const mode = doc.getElementById("mode-select");
  mode.value = "mc";
  mode.dispatchEvent(new dom.window.Event("change"));
  await wait(dom);
  // A fresh session starts at Bare again.
  doc.getElementById("order-mode").dispatchEvent(new dom.window.Event("change"));
  await wait(dom);
  assert.equal(doc.getElementById("card-word").textContent, "Bare");
  assert.equal(doc.getElementById("mc-options").classList.contains("is-hidden"), true);
  assert.equal(doc.getElementById("flip-card").classList.contains("is-hidden"), false);
  assert.equal([...doc.querySelectorAll("#mc-options button")].some((button) => button.textContent === "Bare"), false);
});

test("a word deleted mid-session leaves the session and is never rated", async () => {
  const entries = [makeEntry({ id: "A", word: "Eent" }), makeEntry({ id: "B", word: "Zwee" }), makeEntry({ id: "C", word: "Dräi" })];
  const { dom, reviews, setEntries, storageOnChanged } = await loadWithReviews({ entries });
  const doc = dom.window.document;
  await revealAndRate(dom, 3);
  assert.equal(doc.getElementById("card-word").textContent, "Zwee");

  doc.getElementById("flip-card").click();
  setEntries([entries[0], { ...entries[2], word: "Dräi (edited)" }]);
  storageOnChanged.dispatch({ "lodVault.entries": { newValue: {} } }, "local");
  await wait(dom);

  assert.equal(doc.getElementById("card-word").textContent, "Dräi (edited)");
  assert.match(doc.getElementById("progress").textContent, /Session 2 \/ 2/);
  assert.equal(doc.getElementById("flashcard").classList.contains("is-revealed"), false);
  await revealAndRate(dom, 3);
  assert.deepEqual(reviews.map((review) => review.entryId), ["A", "C"]);
  assert.equal(doc.getElementById("summary-total").textContent, "2");
});

test("the rating bar shows Again / Good / Easy with their next intervals, and Hard on request", async () => {
  const recorded = [];
  const { dom } = await loadFlashcardsScript({
    entries: [makeEntry(), makeEntry({ id: "B", word: "Bam" })],
    storeOverrides: {
      async recordFlashcardReview(...args) {
        recorded.push(args);
      }
    }
  });
  const doc = dom.window.document;
  doc.getElementById("flip-card").click();
  await wait(dom);
  const labels = () => [...doc.querySelectorAll("#rating-bar button")].map((button) => button.textContent.replace(/\s+/g, " ").trim());
  assert.deepEqual(labels(), ["Again1 · <10m", "Good2 · <10m", "Easy3 · 16d"]);

  doc.getElementById("flashcard").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "2", bubbles: true }));
  await wait(dom);
  assert.equal(recorded[0][1], 3);
  assert.equal(recorded[0][3].kind, "r");

  const showHard = doc.getElementById("show-hard");
  showHard.checked = true;
  showHard.dispatchEvent(new dom.window.Event("change"));
  await wait(dom);
  doc.getElementById("flip-card").click();
  await wait(dom);
  assert.deepEqual(labels().map((label) => label.split(/\d/)[0]), ["Again", "Hard", "Good", "Easy"]);
  doc.getElementById("flashcard").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "2", bubbles: true }));
  await wait(dom);
  assert.equal(recorded[1][1], 2);
});

test("practice decks log practice reviews and show no intervals for words that aren't due", async () => {
  const now = new Date();
  const later = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 9).toISOString();
  const recorded = [];
  const { dom } = await loadFlashcardsScript({
    entries: [makeEntry()],
    url: "https://extension.test/pages/flashcards.html?deck=favorites",
    storeOverrides: {
      async getFlashcardMeta() {
        return { HAUS1: { totalReviews: 4, reviews: [], dueAt: later, interval: 9, lastReviewedAt: now.toISOString(), srs: 1, s: 9, d: 5, st: 2 } };
      },
      async recordFlashcardReview(...args) {
        recorded.push(args);
      }
    }
  });
  const doc = dom.window.document;
  doc.getElementById("deck-filter").value = "study";
  doc.getElementById("deck-filter").dispatchEvent(new dom.window.Event("change"));
  await wait(dom);
  doc.getElementById("flip-card").click();
  await wait(dom);
  assert.deepEqual([...doc.querySelectorAll("#rating-bar small")].map((small) => small.textContent), ["1", "2", "3"]);
  doc.querySelector('[data-grade="1"]').click();
  await wait(dom);
  assert.equal(recorded[0][3].kind, "p");
});

// The page wired to the real store and scheduler, with in-memory storage.
async function loadWithRealStore({ entries, url, localStorage, meta = {} } = {}) {
  const shared = loadSharedStore({ "lodVault.flashcardMeta": meta });
  const calls = [];
  const undos = [];
  const loaded = await loadFlashcardsScript({
    entries,
    url,
    localStorage,
    storeOverrides: {
      getFlashcardMeta: () => shared.store.getFlashcardMeta(),
      async recordFlashcardReview(...args) {
        calls.push(args);
        return shared.store.recordFlashcardReview(...args);
      },
      async undoFlashcardReview(...args) {
        undos.push(args);
        return shared.store.undoFlashcardReview(...args);
      }
    }
  });
  return { ...loaded, shared, calls, undos };
}

const ids = (entries) => Array.from(entries, (entry) => entry.id);

test("a new word comes back as learning steps: after about three cards, then about eight", async () => {
  const entries = "ABCDEFGHIJKL".split("").map((id) => makeEntry({ id, word: id }));
  const { dom, calls, api } = await loadWithRealStore({ entries, localStorage: { "lodVault.flashcardSettings": { newPerDay: 20 } } });
  const word = () => dom.window.document.getElementById("card-word").textContent;
  assert.equal(word(), "A");
  await revealAndRate(dom, 3);
  // A is in its first step: it returns after three other cards.
  assert.deepEqual(ids(api.state.sessionCards).slice(0, 6), ["A", "B", "C", "D", "A", "E"]);
  for (let index = 0; index < 3; index += 1) await revealAndRate(dom, 3);
  assert.equal(word(), "A");
  await revealAndRate(dom, 3);
  // Second step graduates A, so it doesn't come back; B, C, D are back after eight.
  const rest = ids(api.state.sessionCards).slice(api.state.sessionIndex);
  assert.equal(rest.filter((id) => id === "A").length, 0);
  assert.equal(calls.filter((call) => call[0] === "A").length, 2);
  const stored = await api.state.flashcardMeta.A;
  assert.equal(stored.st, 2);
});

test("U and Ctrl+Z undo the last review: schedule, session place and learning step", async () => {
  const entries = ["A", "B", "C"].map((id) => makeEntry({ id, word: id }));
  const { dom, api, shared, undos } = await loadWithRealStore({ entries });
  const doc = dom.window.document;
  await revealAndRate(dom, 1);
  assert.deepEqual(ids(api.state.sessionCards), ["A", "B", "C", "A"]);
  assert.equal(doc.getElementById("undo-toast").classList.contains("is-hidden"), false);
  assert.match(doc.getElementById("undo-toast-text").textContent, /Again · A/);

  doc.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "u", bubbles: true }));
  await wait(dom, 5);
  assert.equal(undos.length, 1);
  assert.deepEqual(ids(api.state.sessionCards), ["A", "B", "C"]);
  assert.equal(doc.getElementById("card-word").textContent, "A");
  assert.equal(doc.getElementById("flashcard").classList.contains("is-revealed"), false);
  assert.equal((await shared.store.getFlashcardMeta()).A, undefined);

  // The last card's review can be undone from the summary, which then closes.
  for (const grade of [3, 3, 3]) await revealAndRate(dom, grade);
  await revealAndRate(dom, 3);
  await revealAndRate(dom, 3);
  await revealAndRate(dom, 3);
  assert.equal(doc.getElementById("summary-overlay").classList.contains("is-hidden"), false);
  doc.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
  await wait(dom, 5);
  assert.equal(doc.getElementById("summary-overlay").classList.contains("is-hidden"), true);
  assert.equal(doc.getElementById("card-shell").classList.contains("is-hidden"), false);
});

test("Esc or End session ends early with a summary dialog that holds focus and returns it", async () => {
  const entries = ["A", "B", "C"].map((id) => makeEntry({ id, word: `${id}word` }));
  const { dom } = await loadWithRealStore({ entries });
  const doc = dom.window.document;
  await revealAndRate(dom, 1);
  await revealAndRate(dom, 3);
  doc.getElementById("flip-card").focus();
  doc.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(dom, 5);

  const overlay = doc.getElementById("summary-overlay");
  const dialog = overlay.querySelector('[role="dialog"]');
  assert.equal(overlay.classList.contains("is-hidden"), false);
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(doc.getElementById("summary-title").textContent, "Session ended");
  assert.equal(doc.activeElement.id, "close-summary");
  assert.equal(doc.querySelector(".statline").inert, true);
  assert.match(doc.getElementById("summary-lede").textContent, /^2 cards .*50% right first time/);
  assert.equal(doc.getElementById("summary-total").textContent, "2");
  assert.equal(doc.getElementById("summary-new").textContent, "2");
  assert.equal(doc.getElementById("summary-watch-list").textContent, "Aword");

  doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  assert.equal(doc.activeElement.id, "close-summary");
  doc.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(dom);
  assert.equal(overlay.classList.contains("is-hidden"), true);
  assert.equal(doc.querySelector(".statline").inert, false);

  const button = doc.getElementById("end-session");
  assert.ok(button);
});

test("practice decks end with a summary instead of looping over rated cards", async () => {
  const entries = ["A", "B"].map((id) => makeEntry({ id, word: id, favorite: true }));
  const { dom, reviews } = await loadWithReviews({ entries, url: "https://extension.test/pages/flashcards.html?deck=favorites" });
  const doc = dom.window.document;
  await revealAndRate(dom, 3);
  await revealAndRate(dom, 3);
  assert.deepEqual(reviews.map((review) => review.entryId), ["A", "B"]);
  assert.equal(doc.getElementById("summary-overlay").classList.contains("is-hidden"), false);
});

test("revealing announces the answer and the grade keys, and moves focus to Good", async () => {
  const { dom } = await loadWithRealStore({ entries: [makeEntry(), makeEntry({ id: "B", word: "Bam" })] });
  const doc = dom.window.document;
  doc.getElementById("flip-card").focus();
  doc.getElementById("flip-card").click();
  await wait(dom);
  assert.equal(doc.getElementById("card-status").textContent, `Answer: ${doc.getElementById("card-word").textContent}. Grade it: 1 Again, 2 Good, 3 Easy.`);
  assert.equal(doc.activeElement.dataset.grade, "3");
  doc.activeElement.click();
  await wait(dom, 5);
  assert.equal(doc.activeElement.id, "flip-card");
});
