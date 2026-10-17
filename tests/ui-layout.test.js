const test = require("node:test");
const assert = require("node:assert/strict");
const { loadPopupScript, loadFlashcardsScript } = require("./helpers/loaders");
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const entry = { id: "HAUS1", word: "Haus", url: "https://lod.lu/artikel/HAUS1", translations: { en: "house" }, favorite: true, note: "old" };

async function popup(t, options = {}) {
  const app = await loadPopupScript({ entries: [entry], ...options });
  t.after(() => { app.api.destroy(); app.dom.window.close(); });
  const doc = app.dom.window.document;
  return { ...app, doc, get: (id) => doc.getElementById(id) };
}
function key(app, target, value) {
  target.dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: value, bubbles: true }));
}

test("popup search sits outside the only Words scroller, including current-page details", async (t) => {
  const app = await popup(t);
  const scroll = app.get("words-scroll");
  for (const id of ["current-page-card", "vault-search-results", "lod-search-results"]) assert.ok(scroll.contains(app.get(id)), id);
  for (const id of ["search-input", "search-status", "search-source-vault"]) assert.equal(scroll.contains(app.get(id)), false, id);
  assert.equal(app.get("search-status").parentElement.className, "search-meta-row");
  assert.equal(app.get("action-feedback").parentElement, app.get("delete-undo").parentElement);
  const footer = app.get("action-feedback").parentElement;
  assert.equal(footer.classList.contains("is-active"), false, "Idle status footer collapses");
  app.get("action-feedback").classList.remove("is-hidden");
  app.api.syncFeedbackFooter();
  assert.equal(footer.classList.contains("is-active"), true, "Active status footer appears");
  app.get("action-feedback").classList.add("is-hidden");
  app.api.syncFeedbackFooter();
  assert.equal(footer.classList.contains("is-active"), false, "Footer returns to collapsed when idle");
  assert.equal(app.get("action-feedback").parentElement.tagName, "FOOTER");
  assert.equal(app.get("current-page-card").tagName, "DETAILS");
});

test("tabs and source controls support arrows, Home, End and one tab stop", async (t) => {
  const app = await popup(t);
  app.get("words-tab").focus();
  key(app, app.get("words-tab"), "ArrowRight");
  assert.equal(app.get("stats-tab").getAttribute("aria-selected"), "true");
  assert.equal(app.doc.activeElement, app.get("stats-tab"));
  assert.equal(app.get("words-tab").tabIndex, -1);
  key(app, app.get("stats-tab"), "Home");
  assert.equal(app.doc.activeElement, app.get("words-tab"));
  key(app, app.get("search-source-vault"), "End");
  assert.equal(app.doc.activeElement, app.get("search-source-lod"));
  assert.equal(app.get("search-source-vault").tabIndex, -1);
  assert.equal(app.get("search-source-lod").getAttribute("aria-checked"), "true");
  key(app, app.get("search-source-lod"), "ArrowRight");
  assert.equal(app.doc.activeElement, app.get("search-source-vault"));
  assert.equal(app.get("search-source-lod").tabIndex, -1);
});

test("source round trips retain dictionary editors, drafts, details and each scroll offset", async (t) => {
  let requests = 0;
  const app = await popup(t, { lookupOverrides: {
    async search() { requests++; return { candidates: [entry] }; },
    async fetchEntry() { return entry; }
  } });
  app.get("words-scroll").scrollTop = 90;
  app.get("search-source-lod").click();
  const input = app.get("search-input"); input.value = "house";
  input.dispatchEvent(new app.dom.window.Event("input", { bubbles: true })); key(app, input, "Enter");
  await wait();
  const details = app.doc.querySelector(".lookup-details"); details.open = true;
  details.dispatchEvent(new app.dom.window.Event("toggle")); await wait();
  const note = details.querySelector("textarea"); note.value = "keep this draft";
  note.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
  app.get("words-scroll").scrollTop = 150;
  app.get("search-source-vault").click(); assert.equal(app.get("words-scroll").scrollTop, 90);
  app.get("search-source-lod").click(); await wait();
  assert.equal(details.querySelector("textarea"), note);
  assert.equal(note.value, "keep this draft"); assert.equal(details.open, true);
  assert.equal(app.get("words-scroll").scrollTop, 150); assert.equal(requests, 1);
});

test("returning to an interrupted lookup reissues it and ignores the stale response", async (t) => {
  const resolves = [];
  const app = await popup(t, { lookupOverrides: { search: () => new Promise((resolve) => resolves.push(resolve)) } });
  app.get("search-input").value = "house";
  app.get("search-input").dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
  app.get("search-source-lod").click(); await wait();
  app.get("search-source-vault").click(); app.get("search-source-lod").click(); await wait();
  assert.equal(resolves.length, 2);
  resolves[1]({ candidates: [entry] }); await wait();
  resolves[0]({ candidates: [{ ...entry, word: "stale" }] }); await wait();
  assert.match(app.get("lod-results-list").textContent, /Haus/);
  assert.doesNotMatch(app.get("lod-results-list").textContent, /stale/);
});

test("a local storage refresh reuses the focused note editor and its open disclosure", async (t) => {
  const app = await popup(t);
  const details = app.doc.querySelector(".saved-details"); details.open = true;
  const note = app.doc.querySelector(".saved-item textarea"); note.focus(); note.value = "in progress";
  note.setSelectionRange(2, 5);
  note.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
  await app.api.renderSavedList();
  assert.equal(app.doc.querySelector(".saved-item textarea"), note);
  assert.equal(app.doc.activeElement, note);
  assert.equal(note.value, "in progress"); assert.equal(note.selectionStart, 2); assert.equal(note.selectionEnd, 5);
  assert.equal(app.doc.querySelector(".saved-details").open, true);
  app.get("search-source-lod").click(); app.get("search-source-vault").click();
  assert.equal(app.doc.querySelector(".saved-item textarea"), note);
});

test("lookup membership controls are visible without loading details and remain independent", async (t) => {
  let record = null, hydrated = 0;
  const app = await popup(t, { entries: [], lookupOverrides: {
    async search() { return { candidates: [entry] }; }, async fetchEntry() { hydrated++; return entry; }
  }, storeOverrides: {
    async getEntries() { return record ? [record] : []; },
    async toggleList(value, list) { record = { ...value, favorite: false, study: false, [list]: true }; return record; }
  } });
  app.get("search-source-lod").click(); const input = app.get("search-input"); input.value = "house";
  input.dispatchEvent(new app.dom.window.Event("input", { bubbles: true })); key(app, input, "Enter"); await wait();
  const study = app.doc.querySelector('[data-list="study"]');
  assert.equal(study.closest("details"), null); assert.equal(hydrated, 0);
  study.focus(); study.click(); await wait();
  assert.equal(record.study, true); assert.equal(record.favorite, false); assert.equal(hydrated, 1);
  assert.equal(app.doc.querySelector('[data-list="study"]'), study);
  assert.equal(app.doc.querySelector('[data-list="favorite"]').getAttribute("aria-pressed"), "false");
  assert.equal(app.doc.querySelector('[data-list="study"]').getAttribute("aria-pressed"), "true");
});

test("Session disclosure reports state and Escape restores its trigger", async (t) => {
  const app = await loadFlashcardsScript({ entries: [{ ...entry, study: true }] });
  t.after(() => app.dom.window.close());
  const doc = app.dom.window.document, trigger = doc.getElementById("session-trigger");
  trigger.click();
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  const select = doc.getElementById("deck-filter"); select.focus();
  select.dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(doc.getElementById("session-menu").classList.contains("is-open"), false);
  assert.equal(doc.activeElement, trigger);
});
