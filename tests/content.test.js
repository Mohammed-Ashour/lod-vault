const test = require("node:test");
const assert = require("node:assert/strict");

const { loadContentScript } = require("./helpers/loaders");

function samplePageHtml() {
  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta name="description" content="noun">
        <meta property="og:title" content="Haus - LOD">
      </head>
      <body>
        <main>
          <h1>Haus kopéiert</h1>
          <section class="microstructures">
            <div class="inflection">
              <div class="forms">
                <div><span class="content">Plural</span><span class="content">Haiser</span></div>
              </div>
            </div>
            <div class="examples">
              <div><span class="content">Dëst</span><span class="content">ass</span><span class="content">en</span><span class="content">Haus.</span></div>
            </div>
            <div class="targetLanguages">
              <div class="en"><span class="content">house</span></div>
              <div class="fr"><span class="content">maison</span></div>
              <div class="de"><span class="content">Haus</span></div>
            </div>
          </section>
        </main>
      </body>
    </html>
  `;
}

test("extractCurrentEntry reads the current lod.lu article data", async () => {
  const { api } = loadContentScript({ html: samplePageHtml() });

  const entry = api.extractCurrentEntry();

  assert.equal(entry.id, "HAUS1");
  assert.equal(entry.word, "Haus");
  assert.equal(entry.url, "https://lod.lu/artikel/HAUS1");
  assert.equal(entry.pos, "noun");
  assert.equal(entry.inflection, "Plural Haiser");
  assert.equal(entry.example, "Dëst ass en Haus.");
  assert.deepEqual({ ...entry.translations }, {
    en: "house",
    fr: "maison",
    de: "Haus"
  });
});

test("applyState injects the banner under the heading and updates button state", async () => {
  const { api, dom } = loadContentScript({ html: samplePageHtml() });

  const entry = api.extractCurrentEntry();
  api.applyState({ favorite: true, study: false, note: "remember this" }, entry);

  const banner = dom.window.document.getElementById("lod-wrapper-banner");
  assert.ok(banner);
  assert.equal(banner.previousElementSibling.tagName, "H1");
  assert.equal(banner.querySelector(".lodw-word").textContent, "Haus");
  assert.match(banner.querySelector(".lodw-info").textContent, /English: house/);
  assert.ok(banner.querySelector(".lodw-info").title.includes("Français"), "title includes all translations");
  assert.ok(banner.querySelector(".lodw-info").title.includes("Deutsch"), "title includes all translations");

  const favoriteButton = banner.querySelector('button[data-list="favorite"]');
  const studyButton = banner.querySelector('button[data-list="study"]');
  const noteInput = banner.querySelector('.lodw-note-input');
  const noteMeta = banner.querySelector('.lodw-meta');

  assert.equal(favoriteButton.textContent, "★ Favorited");
  assert.equal(favoriteButton.classList.contains("is-active"), true);
  assert.equal(studyButton.textContent, "+ Study");
  assert.equal(studyButton.classList.contains("is-active"), false);
  assert.equal(noteInput.disabled, false);
  assert.equal(noteInput.value, "remember this");
  assert.equal(noteMeta.textContent, "Saved");
});

test("applyState keeps the banner note disabled until the word is saved", async () => {
  const { api, dom } = loadContentScript({ html: samplePageHtml() });

  const entry = api.extractCurrentEntry();
  api.applyState(null, entry);

  const banner = dom.window.document.getElementById("lod-wrapper-banner");
  const noteInput = banner.querySelector('.lodw-note-input');
  const noteMeta = banner.querySelector('.lodw-meta');

  assert.equal(noteInput.disabled, true);
  assert.equal(noteInput.value, "");
  assert.equal(noteMeta.textContent, "Save to enable notes.");
});

test("statusText returns Saved for any saved entry and Not saved for null", () => {
  const { api } = loadContentScript({ html: samplePageHtml() });

  assert.equal(api.statusText(null), "Not saved");
  assert.equal(api.statusText({ study: true, history: true }), "Saved");
  assert.equal(api.statusText({ favorite: true, study: true, history: true }), "Saved");
});

test("applyState updates the status dot based on save state", async () => {
  const { api, dom } = loadContentScript({ html: samplePageHtml() });
  const entry = api.extractCurrentEntry();

  // Not saved → default gray dot
  api.applyState(null, entry);
  const dot = dom.window.document.querySelector("#lod-wrapper-banner .lodw-dot");
  assert.equal(dot.classList.contains("is-saved"), false);
  assert.equal(dot.classList.contains("is-favorited"), false);

  // Saved in study → teal dot
  api.applyState({ study: true, history: true }, entry);
  assert.equal(dot.classList.contains("is-saved"), true);
  assert.equal(dot.classList.contains("is-favorited"), false);

  // Saved in favorites → gold dot
  api.applyState({ favorite: true, study: true }, entry);
  assert.equal(dot.classList.contains("is-favorited"), true);
  assert.equal(dot.classList.contains("is-saved"), false);
});

test("applyState shows the word name and note icon in the banner", async () => {
  const { api, dom } = loadContentScript({ html: samplePageHtml() });

  const entry = api.extractCurrentEntry();
  api.applyState({ favorite: true, study: false }, entry);

  const banner = dom.window.document.getElementById("lod-wrapper-banner");
  const word = banner.querySelector(".lodw-word");
  const noteIcon = banner.querySelector(".lodw-note-icon");

  assert.equal(word.textContent, "Haus");
  assert.ok(noteIcon, "note icon should be present");
  assert.equal(noteIcon.textContent.trim(), "📝");
});

test("message listener returns the extracted entry for popup requests", () => {
  const { getMessageListener } = loadContentScript({ html: samplePageHtml() });
  const listener = getMessageListener();

  let response = null;
  listener({ type: "lod-wrapper:get-current-entry" }, null, (value) => {
    response = value;
  });

  assert.ok(response);
  assert.equal(response.entry.word, "Haus");
  assert.equal(response.entry.id, "HAUS1");
});

test("refreshUI enriches an existing saved entry with later-available translations", async () => {
  let refreshedEntry = null;
  const { context } = loadContentScript({
    html: samplePageHtml(),
    storeOverrides: {
      getEntry: async () => ({
        id: "HAUS1",
        word: "Haus",
        url: "https://lod.lu/artikel/HAUS1",
        study: true,
        history: true,
        translations: {}
      }),
      getAutoMode: async () => false,
      refreshEntryData: async (entry) => {
        refreshedEntry = entry;
        return {
          ...entry,
          study: true,
          history: true
        };
      }
    }
  });

  await context.refreshUI();

  assert.ok(refreshedEntry);
  assert.deepEqual({ ...refreshedEntry.translations }, {
    en: "house",
    fr: "maison",
    de: "Haus"
  });
});
