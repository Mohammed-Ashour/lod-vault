const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFlashcardsScript, loadSharedStore } = require("./helpers/loaders");

const entries = [
  { id: "HAUS1", word: "Haus", url: "https://lod.lu/artikel/HAUS1", translations: { en: "house" }, pos: "noun", study: true, createdAt: "2026-01-01T00:00:00Z" },
  { id: "BAM1", word: "Bam", url: "https://lod.lu/artikel/BAM1", translations: { en: "tree" }, study: true, createdAt: "2026-01-02T00:00:00Z" }
];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function setup(options = {}) {
  const plays = [];
  const ratings = [];
  let stops = 0;
  let audioOptions;
  const controller = { stopAll() { stops += 1; } };
  const loaded = await loadFlashcardsScript({
    entries,
    ...options,
    storeOverrides: {
      getAudioUrl(entry) { return entry.id ? `https://lod.lu/uploads/OGG/${entry.id.toLowerCase()}.ogg` : null; },
      createAudioController(doc, opts) { audioOptions = opts; return controller; },
      playLodAudio(entry, opts) { plays.push({ id: entry.id, ...opts }); },
      async recordFlashcardReview(...args) { ratings.push(args); },
      ...options.storeOverrides
    }
  });
  const doc = loaded.dom.window.document;
  function mode(value) {
    doc.getElementById("mode-select").value = value;
    doc.getElementById("mode-select").dispatchEvent(new loaded.dom.window.Event("change"));
  }
  return { ...loaded, doc, mode, plays, ratings, controller, get stops() { return stops; }, failAudio() { audioOptions.onError(); } };
}

test("listening plays on entry, hides all answer text, and reveals the word and translation", async () => {
  const s = await setup();
  s.doc.getElementById("direction-toggle").click();
  s.mode("listening");
  assert.equal(s.doc.getElementById("card-word").textContent, "Listen");
  assert.doesNotMatch(s.doc.querySelector(".card-front").textContent, /Haus|house|noun/);
  assert.equal(s.doc.getElementById("card-answer").textContent, "");
  assert.equal(s.doc.querySelector(".card-back").getAttribute("aria-hidden"), "true");
  assert.equal(s.doc.querySelector(".card-back").hasAttribute("inert"), true);
  assert.equal(s.doc.getElementById("direction-toggle").disabled, true);
  assert.equal(s.plays.length, 1);
  assert.equal(s.plays[0].id, "HAUS1");
  assert.equal(s.plays[0].controller, s.controller);
  assert.match(s.doc.getElementById("shortcut-hint").textContent, /P replay/);
  assert.doesNotMatch(s.doc.getElementById("shortcut-hint").textContent, /R flip/);

  s.doc.getElementById("flip-card").click();
  assert.match(s.doc.getElementById("card-answer").textContent, /Haus/);
  assert.match(s.doc.getElementById("card-answer").textContent, /house/);
  assert.doesNotMatch(s.doc.getElementById("card-answer").textContent, /Reverse mode/);
  assert.equal(s.doc.querySelector(".card-back").hasAttribute("inert"), false);
  assert.equal(s.doc.querySelector(".card-front").hasAttribute("inert"), true);
  assert.equal(s.plays.length, 1, "revealing must not restart pronunciation");
  s.doc.getElementById("flip-card").click();
  assert.equal(s.doc.getElementById("card-answer").textContent, "");
  s.mode("self");
  assert.equal(s.doc.getElementById("card-word").textContent, "house", "preserves the previous text direction");
  assert.equal(s.doc.getElementById("direction-toggle").disabled, false);
});

test("replay does not reveal; navigation stops old audio and plays the next word", async () => {
  const s = await setup();
  s.mode("listening");
  s.doc.getElementById("card-audio").click();
  s.doc.dispatchEvent(new s.dom.window.KeyboardEvent("keydown", { key: "p", bubbles: true }));
  assert.equal(s.plays.length, 3);
  assert.equal(s.doc.getElementById("card-answer").textContent, "");
  s.doc.dispatchEvent(new s.dom.window.KeyboardEvent("keydown", { key: "r", bubbles: true }));
  assert.equal(s.api.state.direction, "fwd");
  const before = s.stops;
  s.doc.getElementById("next-card").click();
  assert.ok(s.stops > before);
  assert.equal(s.plays.at(-1).id, "BAM1");
  assert.equal(s.doc.getElementById("card-word").textContent, "Listen");
  assert.equal(s.doc.getElementById("card-answer").textContent, "");
  const total = s.plays.length;
  s.api.renderDeck();
  assert.equal(s.plays.length, total, "storage rerenders must not replay the same card");
  const stops = s.stops;
  s.dom.window.dispatchEvent(new s.dom.window.Event("pagehide"));
  assert.ok(s.stops > stops);
});

test("listening persists, supports keyboard reveal and ratings, and replays a Hard retry", async () => {
  const s = await setup({
    entries: entries.slice(0, 1),
    localStorage: { "lodVault.flashcardSettings": { dailyTarget: 5, mode: "listening" } }
  });
  assert.equal(s.doc.getElementById("mode-select").value, "listening");
  assert.equal(s.plays.length, 1);
  s.doc.dispatchEvent(new s.dom.window.KeyboardEvent("keydown", { key: "1", bubbles: true }));
  await tick();
  assert.equal(s.ratings.length, 0, "must reveal before rating");
  s.doc.dispatchEvent(new s.dom.window.KeyboardEvent("keydown", { key: " ", bubbles: true }));
  s.doc.querySelector('[data-rating="1"]').click();
  await tick();
  assert.deepEqual(s.ratings[0], ["HAUS1", 1, "fwd"]);
  assert.equal(s.plays.length, 2, "same-word retry plays again");
  assert.equal(s.doc.getElementById("card-answer").textContent, "");
  s.doc.getElementById("flip-card").click();
  s.doc.querySelector('[data-rating="2"]').click();
  await tick();
  assert.equal(s.doc.getElementById("summary-overlay").classList.contains("is-hidden"), false);
  s.mode("listening");
  await tick();
  assert.equal(s.storageData["lodVault.flashcardSettings"].mode, "listening");
});

test("unavailable or blocked audio leaves reveal and skip usable without exposing the answer", async () => {
  const s = await setup();
  s.mode("listening");
  s.failAudio();
  assert.match(s.doc.getElementById("card-hint").textContent, /Audio unavailable/);
  assert.equal(s.doc.getElementById("card-answer").textContent, "");
  s.doc.getElementById("flip-card").click();
  assert.match(s.doc.getElementById("card-answer").textContent, /house/);
  s.doc.getElementById("next-card").click();
  assert.match(s.doc.getElementById("card-hint").textContent, /Listen, then Reveal/);

  const missing = await setup({ storeOverrides: { getAudioUrl() { return null; } } });
  missing.mode("listening");
  assert.equal(missing.plays.length, 0);
  assert.match(missing.doc.getElementById("card-hint").textContent, /No pronunciation available/);
  missing.doc.getElementById("flip-card").click();
  assert.match(missing.doc.getElementById("card-answer").textContent, /Haus/);
});

test("audio controller reports rejected playback but ignores failures from stopped cards", async () => {
  const s = await setup();
  const shared = loadSharedStore();
  const audios = [];
  class FakeAudio {
    constructor() { this.paused = true; this.events = {}; audios.push(this); }
    addEventListener(name, callback) { this.events[name] = callback; }
    play() { this.paused = false; return new Promise((resolve, reject) => { this.reject = reject; }); }
    pause() { this.paused = true; }
  }
  shared.context.Audio = FakeAudio;
  shared.context.Element = s.dom.window.Element;
  let errors = 0;
  const controller = shared.store.createAudioController(s.doc, { onError() { errors += 1; } });
  const button = s.doc.getElementById("card-audio");
  controller.play("https://lod.lu/one.ogg", button);
  audios[0].reject(new Error("Autoplay blocked"));
  await tick();
  assert.equal(errors, 1);
  controller.play("https://lod.lu/two.ogg", button);
  controller.stopAll();
  audios[1].reject(new Error("Playback interrupted"));
  audios[1].events.error();
  await tick();
  assert.equal(errors, 1, "stale failures cannot change the current card");
  controller.play("https://lod.lu/three.ogg", button);
  audios[2].events.error();
  assert.equal(errors, 2, "missing audio invokes the same recovery path");
  controller.stopAll();
});

test("bounded listening sessions resume with sound and no answer visible", async () => {
  const first = await setup({ url: "https://extension.test/pages/flashcards.html?deck=study" });
  first.doc.getElementById("session-size").value = "10";
  first.doc.getElementById("session-size").dispatchEvent(new first.dom.window.Event("change"));
  await tick();
  first.mode("listening");
  first.doc.getElementById("next-card").click();
  await tick();
  const resumed = await setup({ localStorage: first.storageData });
  resumed.doc.getElementById("resume-session-button").click();
  await tick();
  assert.equal(resumed.api.state.mode, "listening");
  assert.equal(resumed.plays.at(-1).id, "BAM1");
  assert.equal(resumed.doc.getElementById("card-word").textContent, "Listen");
  assert.equal(resumed.doc.getElementById("card-answer").textContent, "");
});
