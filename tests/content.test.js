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
  assert.equal(banner.querySelector(".lodw-banner__status").textContent, "Saved in Favorites");
  assert.match(banner.querySelector(".lodw-banner__info").textContent, /English: house/);

  const favoriteButton = banner.querySelector('button[data-list="favorite"]');
  const studyButton = banner.querySelector('button[data-list="study"]');
  const noteInput = banner.querySelector('.lodw-note__input');
  const noteMeta = banner.querySelector('.lodw-note__meta');

  assert.equal(favoriteButton.textContent, "★ Favorited");
  assert.equal(favoriteButton.classList.contains("is-active"), true);
  assert.equal(studyButton.textContent, "+ Add to Study");
  assert.equal(studyButton.classList.contains("is-active"), false);
  assert.equal(noteInput.disabled, false);
  assert.equal(noteInput.value, "remember this");
  assert.equal(noteMeta.textContent, "Saved with this word.");
});

test("applyState keeps the banner note disabled until the word is saved", async () => {
  const { api, dom } = loadContentScript({ html: samplePageHtml() });

  const entry = api.extractCurrentEntry();
  api.applyState(null, entry);

  const banner = dom.window.document.getElementById("lod-wrapper-banner");
  const noteInput = banner.querySelector('.lodw-note__input');
  const noteMeta = banner.querySelector('.lodw-note__meta');

  assert.equal(noteInput.disabled, true);
  assert.equal(noteInput.value, "");
  assert.equal(noteMeta.textContent, "Save to Favorites or Study to enable notes.");
});

test("statusText includes history when a word was auto-recorded", () => {
  const { api } = loadContentScript({ html: samplePageHtml() });

  assert.equal(api.statusText({ study: true, history: true }), "Saved in Study and History");
  assert.equal(api.statusText({ favorite: true, study: true, history: true }), "Saved in Favorites, Study, and History");
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
