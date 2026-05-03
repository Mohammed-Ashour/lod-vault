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

test("popup renders sync language chips with count and estimated capacity hints", async () => {
  const { dom } = await loadPopupScript({ syncLanguages: ["en", "fr", "de"] });

  const chips = Array.from(dom.window.document.querySelectorAll("#sync-language-chips .sync-language-chip"));
  const count = dom.window.document.getElementById("sync-language-count");
  const capacity = dom.window.document.getElementById("sync-language-capacity");

  assert.equal(chips.length, 5);
  assert.equal(chips.filter((chip) => chip.getAttribute("aria-checked") === "true").length, 3);
  assert.match(count.textContent, /3 of 3 selected/);
  assert.match(capacity.textContent, /Sync: Est\. ~700 words/);
  assert.equal(chips.find((chip) => chip.dataset.language === "pt").getAttribute("aria-disabled"), "true");
});

test("popup sync language selector saves immediately and enforces min/max selection", async () => {
  const calls = [];
  const { dom } = await loadPopupScript({
    syncLanguages: ["en", "fr"],
    storeOverrides: {
      async setSyncLanguages(nextLanguages) {
        calls.push([...nextLanguages]);
        return nextLanguages;
      }
    }
  });

  const ptChip = dom.window.document.querySelector('#sync-language-chips [data-language="pt"]');
  ptChip.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  let chips = Array.from(dom.window.document.querySelectorAll("#sync-language-chips .sync-language-chip"));
  assert.deepEqual(calls[0], ["en", "fr", "pt"]);
  assert.match(dom.window.document.getElementById("sync-language-count").textContent, /3 of 3 selected/);
  assert.equal(chips.find((chip) => chip.dataset.language === "de").getAttribute("aria-disabled"), "true");

  const frChip = dom.window.document.querySelector('#sync-language-chips [data-language="fr"]');
  frChip.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const enChip = dom.window.document.querySelector('#sync-language-chips [data-language="en"]');
  enChip.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const lastSelectedChip = dom.window.document.querySelector('#sync-language-chips [data-language="pt"]');
  lastSelectedChip.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  chips = Array.from(dom.window.document.querySelectorAll("#sync-language-chips .sync-language-chip"));
  assert.deepEqual(calls, [["en", "fr", "pt"], ["en", "pt"], ["pt"]]);
  assert.equal(chips.find((chip) => chip.dataset.language === "pt").getAttribute("aria-disabled"), "true");
  assert.match(dom.window.document.getElementById("sync-language-count").textContent, /1 of 3 selected/);
  assert.match(dom.window.document.getElementById("sync-language-capacity").textContent, /Sync: Est\. ~990 words/);
});
