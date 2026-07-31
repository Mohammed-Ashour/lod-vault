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
