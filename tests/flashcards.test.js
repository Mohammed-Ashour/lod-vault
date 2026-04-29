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
