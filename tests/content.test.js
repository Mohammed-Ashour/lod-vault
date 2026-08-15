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

async function wait(ms = 0) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

test("extractCurrentEntry ignores generic dictionary description metadata", async () => {
  const html = samplePageHtml().replace(
    'content="noun"',
    'content="E fënnefsproochegen Dictionnaire vum Zenter fir d\'Lëtzebuerger Sprooch (MENEJ)"'
  );
  const { api } = loadContentScript({ html });

  const entry = api.extractCurrentEntry();

  assert.equal(entry.pos, "");
  assert.equal(api.infoText(entry), "English: house · +2");
});

test("content script stays idle on non-article pages", async () => {
  const { dom, context } = loadContentScript({
    html: samplePageHtml(),
    url: "https://lod.lu/"
  });

  await context.refreshUI();
  assert.equal(dom.window.document.getElementById("lodvault-banner"), null);
});

test("content script can recover when URL changes to article without history events", async () => {
  const { dom } = loadContentScript({
    html: samplePageHtml(),
    url: "https://lod.lu/"
  });

  const initialBanner = dom.window.document.getElementById("lodvault-banner");
  assert.ok(!initialBanner || initialBanner.style.display === "none");

  dom.reconfigure({ url: "https://lod.lu/artikel/HAUS1" });
  dom.window.document.body.appendChild(dom.window.document.createElement("div"));

  await wait(150);

  const banner = dom.window.document.getElementById("lodvault-banner");
  assert.ok(banner);
  assert.equal(banner.querySelector(".lodw-word").textContent, "Haus");
});

test("content script refreshes when article details hydrate after the heading already exists", async () => {
  const html = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta property="og:title" content="Haus - LOD">
      </head>
      <body>
        <main>
          <h1>Haus kopéiert</h1>
          <section class="microstructures"></section>
        </main>
      </body>
    </html>
  `;
  const { dom, sentRuntimeMessages } = loadContentScript({ html });

  await wait(50);

  const initialBanner = dom.window.document.getElementById("lodvault-banner");
  assert.ok(initialBanner);
  assert.equal(initialBanner.querySelector(".lodw-info").textContent.trim(), "");
  const initialMessageCount = sentRuntimeMessages.filter((message) => message.type === "lodvault:page-state-changed").length;

  const meta = dom.window.document.createElement("meta");
  meta.setAttribute("name", "description");
  meta.setAttribute("content", "noun");
  dom.window.document.head.appendChild(meta);

  const targetLanguages = dom.window.document.createElement("div");
  targetLanguages.className = "targetLanguages";
  targetLanguages.innerHTML = `
    <div class="en"><span class="content">house</span></div>
    <div class="fr"><span class="content">maison</span></div>
  `;
  dom.window.document.querySelector(".microstructures").appendChild(targetLanguages);

  await wait(180);

  const banner = dom.window.document.getElementById("lodvault-banner");
  assert.match(banner.querySelector(".lodw-info").textContent, /English: house/);

  const pageStateMessages = sentRuntimeMessages.filter((message) => message.type === "lodvault:page-state-changed");
  assert.ok(pageStateMessages.length > initialMessageCount);
  assert.equal(pageStateMessages.at(-1).entry.pos, "noun");
  assert.deepEqual({ ...pageStateMessages.at(-1).entry.translations }, {
    en: "house",
    fr: "maison"
  });
});

test("content script ignores unrelated mutations inside the main article shell", async () => {
  let entryReads = 0;
  const { dom } = loadContentScript({
    html: samplePageHtml(),
    storeOverrides: {
      async getEntry() {
        entryReads += 1;
        return null;
      }
    }
  });

  await wait(50);
  entryReads = 0;
  const unrelated = dom.window.document.createElement("div");
  unrelated.className = "unrelated-widget";
  dom.window.document.querySelector("main").appendChild(unrelated);
  await wait(150);

  assert.equal(entryReads, 0);
});

test("infoText does not count the primary language in +N for non-default languages", () => {
  const { api } = loadContentScript({
    html: samplePageHtml(),
    entryPresenterOverrides: {
      getPrimaryMeaning() {
        return { lang: "pt", label: "Português", value: "casa" };
      }
    }
  });

  const info = api.infoText({
    pos: "SUBST",
    translations: { pt: "casa" }
  });

  assert.equal(info, "SUBST · Português: casa");
});

test("applyState injects the banner under the heading and updates button state", async () => {
  const { api, dom } = loadContentScript({ html: samplePageHtml() });

  const entry = api.extractCurrentEntry();
  api.applyState({ favorite: true, study: false, note: "remember this" }, entry);

  const banner = dom.window.document.getElementById("lodvault-banner");
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

  const banner = dom.window.document.getElementById("lodvault-banner");
  const noteInput = banner.querySelector('.lodw-note-input');
  const noteMeta = banner.querySelector('.lodw-meta');

  assert.equal(noteInput.disabled, true);
  assert.equal(noteInput.value, "");
  assert.equal(noteMeta.textContent, "Save to enable notes.");
});

test("applyState keeps the banner note toggle aria-expanded in sync with visibility", () => {
  const { api, dom } = loadContentScript({ html: samplePageHtml() });
  const entry = api.extractCurrentEntry();

  api.applyState({ study: true, history: true }, entry);
  const banner = dom.window.document.getElementById("lodvault-banner");
  const noteToggle = banner.querySelector(".lodw-note-toggle");
  const noteBody = banner.querySelector(".lodw-note-body");

  assert.equal(noteToggle.getAttribute("aria-expanded"), "false");
  assert.equal(noteToggle.classList.contains("is-hidden"), false);
  assert.equal(noteBody.classList.contains("is-hidden"), true);

  api.applyState({ study: true, history: true, note: "Stone house" }, entry);
  assert.equal(noteToggle.getAttribute("aria-expanded"), "true");
  assert.equal(noteToggle.classList.contains("is-hidden"), true);
  assert.equal(noteBody.classList.contains("is-hidden"), false);

  const nextEntry = {
    ...entry,
    id: "BEEM1",
    word: "Beem",
    url: "https://lod.lu/artikel/BEEM1"
  };
  api.applyState({ study: true, history: true, note: "" }, nextEntry);
  assert.equal(noteToggle.getAttribute("aria-expanded"), "false");
  assert.equal(noteToggle.classList.contains("is-hidden"), false);
  assert.equal(noteBody.classList.contains("is-hidden"), true);
});

test("applyState updates the status dot based on save state", async () => {
  const { api, dom } = loadContentScript({ html: samplePageHtml() });
  const entry = api.extractCurrentEntry();

  // Not saved → default gray dot
  api.applyState(null, entry);
  const dot = dom.window.document.querySelector("#lodvault-banner .lodw-dot");
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

test("applyState shows the word name and note toggle in the banner", async () => {
  const { api, dom } = loadContentScript({ html: samplePageHtml() });

  const entry = api.extractCurrentEntry();
  api.applyState({ favorite: true, study: false }, entry);

  const banner = dom.window.document.getElementById("lodvault-banner");
  const word = banner.querySelector(".lodw-word");
  const noteToggle = banner.querySelector(".lodw-note-toggle");

  assert.equal(word.textContent, "Haus");
  assert.ok(noteToggle, "note toggle should be present");
  assert.ok(banner.querySelector(".lodw-note-icon"), "note icon should be present");
});

test("message listener returns the extracted entry for popup requests", () => {
  const { getMessageListener } = loadContentScript({ html: samplePageHtml() });
  const listener = getMessageListener();

  let response = null;
  listener({ type: "lodvault:get-current-entry" }, null, (value) => {
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
