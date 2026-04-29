const test = require("node:test");
const assert = require("node:assert/strict");

const { loadPopupScript } = require("./helpers/loaders");

function makeEntries(count) {
  return Array.from({ length: count }, (_value, index) => ({
    id: `WORD${index + 1}`,
    word: `Word ${index + 1}`,
    url: `https://lod.lu/artikel/WORD${index + 1}`,
    note: index === 10 ? "tree note" : "",
    translations: index === 10 ? { en: "tree" } : { en: `meaning ${index + 1}` },
    study: true,
    updatedAt: `2025-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
  }));
}

test("popup shows recent saved words by default without requiring a search", async () => {
  const entries = makeEntries(12);
  const { dom } = await loadPopupScript({ entries });

  const items = Array.from(dom.window.document.querySelectorAll(".saved-item"));
  const overflow = dom.window.document.querySelector(".list-overflow");
  const searchStatus = dom.window.document.getElementById("search-status");
  const emptyState = dom.window.document.getElementById("empty-state");
  const noResults = dom.window.document.getElementById("no-results");

  assert.equal(items.length, 10);
  assert.equal(items[0].querySelector(".word-link").textContent, "Word 1");
  assert.match(searchStatus.textContent, /12 saved words · showing 10 recent/);
  assert.match(overflow.textContent, /Showing 10 recent words/);
  assert.equal(emptyState.classList.contains("is-hidden"), true);
  assert.equal(noResults.classList.contains("is-hidden"), true);
});

test("popup search filters the saved list and shows the no-results state when needed", async () => {
  const entries = makeEntries(12);
  const { dom } = await loadPopupScript({ entries });
  const searchInput = dom.window.document.getElementById("search-input");
  const searchStatus = dom.window.document.getElementById("search-status");
  const noResults = dom.window.document.getElementById("no-results");

  searchInput.value = "tree";
  searchInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

  let items = Array.from(dom.window.document.querySelectorAll(".saved-item"));
  assert.equal(items.length, 1);
  assert.equal(items[0].querySelector(".word-link").textContent, "Word 11");
  assert.match(searchStatus.textContent, /1 match · 12 total/);
  assert.equal(noResults.classList.contains("is-hidden"), true);

  searchInput.value = "missing";
  searchInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

  items = Array.from(dom.window.document.querySelectorAll(".saved-item"));
  assert.equal(items.length, 0);
  assert.equal(noResults.classList.contains("is-hidden"), false);
});
