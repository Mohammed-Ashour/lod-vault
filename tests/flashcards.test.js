const test = require("node:test");
const assert = require("node:assert/strict");

const { loadFlashcardsScript } = require("./helpers/loaders");

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

  const ratingGood = dom.window.document.querySelector('[data-rating="2"]');

  // Rate 9 cards
  for (let i = 0; i < 9; i += 1) {
    dom.window.document.getElementById("flip-card").click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    ratingGood.click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  }

  assert.match(dom.window.document.getElementById("progress").textContent, /Session 10 \/ 10/);

  // Rate the final card to trigger summary
  dom.window.document.getElementById("flip-card").click();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  ratingGood.click();
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

  const good = first.dom.window.document.querySelector('[data-rating="2"]');
  for (let index = 0; index < 2; index += 1) {
    first.dom.window.document.getElementById("flip-card").click();
    good.click();
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

test("daily target reports completion and can be turned off", async () => {
  const today = new Date().toISOString();
  const reviews = Array.from({ length: 10 }, () => ({ date: today, rating: 2, direction: "fwd" }));
  const { dom, storageData } = await loadFlashcardsScript({
    entries: [makeEntry()],
    storeOverrides: {
      async getFlashcardMeta() {
        return { HAUS1: { totalReviews: 10, reviews, goodCount: 10 } };
      }
    }
  });

  assert.match(dom.window.document.getElementById("daily-progress").textContent, /Daily target complete · 10 \/ 10 today/);
  const target = dom.window.document.getElementById("daily-target");
  target.value = "off";
  target.dispatchEvent(new dom.window.Event("change"));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

  assert.equal(dom.window.document.getElementById("daily-progress").textContent, "Daily target off");
  assert.deepEqual(storageData["lodVault.flashcardSettings"], { dailyTarget: null, mode: "self" });
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
  assert.deepEqual(reviews, [{ entryId: "A1", rating: 2 }]);

  options().find((button) => button.dataset.correct === "0").click();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 900));
  assert.deepEqual(reviews, [
    { entryId: "A1", rating: 2 },
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
  dom.window.document.querySelector(`[data-rating="${rating}"]`).click();
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

test("the daily target limits how many new words Today introduces", async () => {
  const entries = Array.from({ length: 12 }, (_, i) => makeEntry({ id: `W${i}`, word: `W${i}` }));
  const { dom } = await loadWithReviews({
    entries,
    localStorage: { "lodVault.flashcardSettings": { dailyTarget: 5, mode: "self" } }
  });
  const doc = dom.window.document;
  assert.match(doc.getElementById("progress").textContent, /Session 1 \/ 5/);

  const target = doc.getElementById("daily-target");
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
  await revealAndRate(dom, 2);
  assert.equal(doc.getElementById("card-word").textContent, "Eent");
  await revealAndRate(dom, 1);

  assert.deepEqual(reviews.map((review) => review.entryId), ["A", "B", "A"]);
  assert.equal(doc.getElementById("summary-overlay").classList.contains("is-hidden"), false);
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

test("Today is not offered as a resumable session on the next visit", async () => {
  const entries = [makeEntry({ id: "A" }), makeEntry({ id: "B", word: "Bam" })];
  const { dom, storageData } = await loadWithReviews({ entries });
  await revealAndRate(dom, 2);
  assert.equal(storageData["lodVault.flashcardSession"], undefined);
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
  await revealAndRate(dom, 2);
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
  assert.equal(hint.textContent, "Space reveal · ← → navigate · 1 / 2 / 3 rate · R flip direction");

  const modeSelect = doc.getElementById("mode-select");
  modeSelect.value = "mc";
  modeSelect.dispatchEvent(new dom.window.Event("change"));
  await wait(dom);
  assert.equal(hint.textContent, "1–4 choose · ← → navigate · R flip direction");
});
