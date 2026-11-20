const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const SCRIPTS = ["scripts/lens-lookup.js", "scripts/answer-grader.js", "scripts/card-registry.js", "scripts/flashcards-exercises.js"]
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"));

function setup() {
  const dom = new JSDOM("<!doctype html><html><body><div id='stage'></div></body></html>", { runScripts: "outside-only" });
  for (const source of SCRIPTS) dom.window.eval(source);
  const { window } = dom;
  return {
    window,
    document: window.document,
    stage: window.document.getElementById("stage"),
    api: window.LodVaultExercises,
    lexicon(id) {
      const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "lod", `${id}.json`), "utf8")).entry;
      return window.LodVaultLensLookup.parseLexicon(raw, { now: 1 });
    }
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// Renders one skill card and collects what it reports.
function play(skill, id, extra = {}) {
  const env = setup();
  const lexicon = env.lexicon(id);
  const graded = [];
  const audio = [];
  const controller = env.api.render(env.document, env.stage, { id: `${id}#${skill}`, entryId: id, skill, entry: { id, word: lexicon.lemma } }, {
    lexicon,
    language: "en",
    random: () => 0,
    playAudio: (url) => audio.push(url),
    onGrade: (grade, detail) => graded.push({ grade, detail: plain(detail) }),
    ...extra
  });
  const $ = (selector) => env.stage.querySelector(selector);
  const $$ = (selector) => [...env.stage.querySelectorAll(selector)];
  return {
    ...env, lexicon, controller, graded, audio, $, $$,
    key(key) {
      return controller.handleKey({ key });
    },
    type(value, input = $(".ex-input")) {
      input.value = value;
    },
    submit() {
      $(".ex-form").dispatchEvent(new env.window.Event("submit", { cancelable: true }));
    },
    feedbackText() {
      return $(".ex-feedback")?.textContent.replace(/\s+/g, " ").trim() || "";
    }
  };
}

test("exercise feedback allows explicit grade overrides once", () => {
  const right = play("g", "HAUS1");
  right.key("l");
  right.$(".ex-easy").click();
  right.$(".ex-continue").click();
  assert.equal(right.graded.length, 1);
  assert.equal(right.graded[0].grade, 4);
  assert.equal(right.graded[0].detail.override, "easy");

  const wrong = play("g", "HAUS1");
  wrong.key("j");
  wrong.$(".ex-override").click();
  wrong.$(".ex-continue").click();
  assert.equal(wrong.graded.length, 1);
  assert.equal(wrong.graded[0].grade, 3);
  assert.equal(wrong.graded[0].detail.override, "correct");
});

test("articles follow gender and the n-rule", () => {
  const { api } = setup();
  assert.deepEqual(plain(api.articles("Mann", "m")), { definite: "de", indefinite: "e", dative: "dem" });
  assert.deepEqual(plain(api.articles("Hond", "m")), { definite: "den", indefinite: "en", dative: "dem" });
  assert.deepEqual(plain(api.articles("Fra", "f")), { definite: "d'", indefinite: "eng", dative: "der" });
  assert.deepEqual(plain(api.articles("Haus", "n")), { definite: "d'", indefinite: "en", dative: "dem" });
  assert.equal(api.articles("Haus", null), null);
  assert.equal(api.articleLine("Fra", "f"), "d'Fra · eng Fra · der Fra (dat.)");
  assert.equal(api.articleLine("Haus", "n"), "d'Haus · en Haus · dem Haus (dat.)");
});

test("senseText joins translations with bracketed clarifiers and falls back across languages", () => {
  const { api, lexicon } = setup();
  const goen = lexicon("GOEN1");
  assert.equal(api.senseText(goen.senses[0], "fr"), "marcher, aller (à pied)");
  assert.equal(api.senseText(lexicon("HAUS1").senses[0], "en"), "house (building)");
  assert.equal(api.senseText({ tr: { de: [["Haus"]] } }, "nl"), "Haus");
  assert.equal(api.senseText({ tr: {} }, "en"), "");
});

test("gender: the right demonstrative is Good, with articles in the feedback", () => {
  const card = play("g", "HAUS1");
  assert.deepEqual(card.$$(".ex-choice").map((button) => button.textContent), ["deenJ / 1", "déiK / 2", "datL / 3"]);
  assert.equal(card.key("l"), true);
  assert.ok(card.$('[data-gender="n"]').classList.contains("is-right"));
  assert.match(card.feedbackText(), /Correct.*dat Haus \(neuter\).*d'Haus · en Haus · dem Haus \(dat\.\)/);
  assert.deepEqual(card.graded, []);
  assert.equal(card.key("Enter"), true);
  assert.deepEqual(card.graded, [{ grade: 3, detail: { skill: "g", answer: "n", correct: true } }]);
  // Answering again does nothing.
  card.key("j");
  assert.equal(card.graded.length, 1);
});

test("gender: a wrong pick is Again and shows the right one", () => {
  const card = play("g", "FRA1");
  card.$('[data-gender="m"]').click();
  assert.ok(card.$('[data-gender="m"]').classList.contains("is-picked-wrong"));
  assert.ok(card.$('[data-gender="f"]').classList.contains("is-right"));
  assert.match(card.feedbackText(), /Not quite.*déi Fra \(feminine\).*d'Fra · eng Fra · der Fra/);
  card.$(".ex-continue").click();
  assert.equal(card.graded[0].grade, 1);
});

test("plural: asks 'eng Fra → zwou ___', accepts the n-rule form, and grades an accent slip Hard", () => {
  const fra = play("pl", "FRA1");
  assert.match(fra.$(".ex-prompt").textContent, /eng Fra\s+→\s+zwou/);
  fra.type("Frae");
  fra.submit();
  assert.match(fra.feedbackText(), /Correct.*n-rule.*zwou Fraen/);
  fra.key("Enter");
  assert.equal(fra.graded[0].grade, 3);
  assert.equal(fra.graded[0].detail.verdict, "nrule");

  const haus = play("pl", "HAUS1");
  assert.match(haus.$(".ex-prompt").textContent, /en Haus\s+→\s+zwee/);
  haus.type("haiser");
  haus.submit();
  assert.match(haus.feedbackText(), /capital.*zwee Haiser.*Also: Haus/);
  haus.key("Enter");
  assert.equal(haus.graded[0].grade, 3);

  const mann = play("pl", "MANN1");
  mann.type("Manner");
  mann.submit();
  assert.match(mann.feedbackText(), /Correct, check the spelling.*Watch the accents/);
  assert.ok(mann.$(".answer-diff-missing"));
  mann.key("Enter");
  assert.equal(mann.graded[0].grade, 2);
});

test("plural: a typo asks to count it or not", () => {
  const card = play("pl", "HAUS1");
  card.type("Hasier");
  card.submit();
  assert.match(card.feedbackText(), /Typo\?/);
  assert.deepEqual(card.$$(".ex-feedback button").map((button) => button.textContent), ["Count it", "It was wrong"]);
  card.$(".ex-feedback .ex-wrong").click();
  assert.equal(card.graded[0].grade, 1);
  assert.equal(card.graded[0].detail.typo, "wrong");

  const counted = play("pl", "HAUS1");
  counted.type("Hasier");
  counted.submit();
  counted.key("Enter");
  assert.deepEqual([counted.graded[0].grade, counted.graded[0].detail.typo], [2, "counted"]);
});

test("accent buttons type into the answer box", () => {
  const card = play("pl", "MANN1");
  const input = card.$(".ex-input");
  input.focus();
  input.value = "Mnner";
  input.setSelectionRange(1, 1);
  card.$$(".accent-key").find((button) => button.textContent === "ä").click();
  assert.equal(input.value, "Männer");
});

test("perfect: aux and participle both right is Good; a wrong aux is Again", () => {
  const right = play("pp", "GOEN1");
  assert.match(right.$(".ex-prompt").textContent, /hien\s*huet\s*ass/);
  right.submit();
  assert.ok(right.$(".ex-aux").classList.contains("needs-answer"));
  assert.equal(right.$(".ex-feedback"), null);
  right.$('[data-aux="sinn"]').click();
  right.type("gaang");
  right.submit();
  assert.match(right.feedbackText(), /Correct.*hien ass gaangen \/ gaang/);
  right.key("Enter");
  assert.deepEqual(right.graded[0], { grade: 3, detail: { skill: "pp", aux: "sinn", answer: "gaang", auxRight: true, verdict: "exact" } });

  const wrongAux = play("pp", "GOEN1");
  wrongAux.$('[data-aux="hunn"]').click();
  wrongAux.type("gaangen");
  wrongAux.submit();
  assert.match(wrongAux.feedbackText(), /Not quite.*goen takes sinn/);
  assert.ok(wrongAux.$('[data-aux="hunn"]').classList.contains("is-picked-wrong"));
  wrongAux.key("Enter");
  assert.equal(wrongAux.graded[0].grade, 1);

  const slip = play("pp", "MAACHEN1");
  slip.$('[data-aux="hunn"]').click();
  slip.type("gemächt");
  slip.submit();
  slip.key("Enter");
  assert.equal(slip.graded[0].grade, 2);

  const wrongWord = play("pp", "MAACHEN1");
  wrongWord.$('[data-aux="hunn"]').click();
  wrongWord.type("gemoocht");
  wrongWord.submit();
  wrongWord.key("Enter");
  assert.equal(wrongWord.graded[0].grade, 1);
});

test("perfect: 1 and 2 pick the auxiliary when focus isn't in the text box", () => {
  const card = play("pp", "GOEN1");
  card.document.activeElement.blur();
  assert.equal(card.key("2"), true);
  assert.equal(card.$('[data-aux="sinn"]').getAttribute("aria-checked"), "true");
});

test("cloze: blanks every headword span, grades all gaps and plays the example after", () => {
  const lexicon = setup().lexicon("GOEN1");
  const candidates = setup().api.clozeCandidates(lexicon, []);
  const twoGaps = candidates.find(({ example }) => example.h.length === 2 && example.a);
  assert.ok(twoGaps, "fixture has an example with two headword spans and audio");
  const card = play("cz", "GOEN1", { example: twoGaps, lexicon });
  const inputs = card.$$(".ex-input");
  assert.equal(inputs.length, 2);
  const expected = inputs.map((input) => input.dataset.expected);
  assert.ok(!card.$(".ex-sentence").textContent.includes(expected.join(" ")));
  inputs.forEach((input, index) => { input.value = expected[index]; });
  card.submit();
  assert.match(card.feedbackText(), /Correct/);
  assert.ok(card.$(".ex-feedback .ex-headword"));
  assert.deepEqual(card.audio, [twoGaps.example.a]);
  card.key("Enter");
  assert.equal(card.graded[0].grade, 3);

  const wrong = play("cz", "GOEN1", { example: twoGaps, lexicon });
  const [first, second] = wrong.$$(".ex-input");
  first.value = first.dataset.expected;
  second.value = "xyz";
  wrong.submit();
  assert.ok(second.classList.contains("is-wrong"));
  assert.ok(first.classList.contains("is-right"));
  wrong.key("Enter");
  assert.equal(wrong.graded[0].grade, 1);
});

test("cloze: the hint gives the sense in the learner's language", () => {
  const card = play("cz", "HAUS1", { language: "fr" });
  assert.match(card.$(".ex-hint").textContent, /^Haus · maison/);
});

test("which meaning: options come from the word's own senses; right is Good, wrong is Again", () => {
  const env = setup();
  const lexicon = env.lexicon("HAUS1");
  const target = lexicon.senses[1];
  const card = play("sd", "HAUS1", { lexicon, sense: target, example: target.ex[0] });
  const options = card.$$(".ex-option");
  assert.equal(options.length, 4);
  assert.deepEqual(options.map((option) => option.querySelector(".ex-choice-text").textContent).sort(), [
    "house (building)", "house (business)", "house (dynasty)", "house (household, family)"
  ]);
  assert.ok(card.$(".ex-sentence mark.ex-headword"));
  const rightIndex = options.findIndex((option) => option.dataset.sense === String(target.n));
  card.key(String(rightIndex + 1));
  card.key("Enter");
  assert.deepEqual(card.graded[0], { grade: 3, detail: { skill: "sd", sense: 2, picked: 2, correct: true } });

  const miss = play("sd", "HAUS1", { lexicon, sense: target, example: target.ex[0] });
  miss.$$(".ex-option").find((option) => option.dataset.sense !== "2").click();
  assert.match(miss.feedbackText(), /Not quite.*Meaning 2: house \(household, family\)/);
  miss.key("Enter");
  assert.equal(miss.graded[0].grade, 1);
});

test("produce: a noun needs its article; the word alone is Hard", () => {
  const sense = setup().lexicon("HAUS1").senses[0];
  const full = play("rev", "HAUS1", { sense });
  assert.equal(full.$(".ex-prompt").textContent, "house (building)");
  full.type("d'Haus");
  full.submit();
  full.key("Enter");
  assert.equal(full.graded[0].grade, 3);

  const bare = play("rev", "HAUS1", { sense });
  bare.type("Haus");
  bare.submit();
  assert.match(bare.feedbackText(), /check the article.*Remember the article: d'Haus/);
  bare.key("Enter");
  assert.equal(bare.graded[0].grade, 2);

  const wrongArticle = play("rev", "MANN1");
  wrongArticle.type("d'Mann");
  wrongArticle.submit();
  assert.match(wrongArticle.feedbackText(), /The article is de, not d'/);

  const masculine = play("rev", "MANN1");
  masculine.type("den Mann");
  masculine.submit();
  masculine.key("Enter");
  assert.equal(masculine.graded[0].grade, 3);

  const verb = play("rev", "GOEN1");
  verb.type("goen");
  verb.submit();
  verb.key("Enter");
  assert.equal(verb.graded[0].grade, 3);
});

test("produce: a word starting like an article isn't split", () => {
  const card = play("rev", "HAUS1");
  card.type("Dach");
  card.submit();
  card.key("Enter");
  assert.equal(card.graded[0].grade, 1);
  assert.equal(card.graded[0].detail.articleRight, false);
});

test("meaning card shows article, gender, grammar, numbered senses and a marked example", () => {
  const env = setup();
  const lexicon = env.lexicon("HAUS1");
  const played = [];
  const { front, back } = env.api.buildMeaningCard(env.document, { id: "HAUS1", word: "Haus" }, lexicon, {
    language: "en",
    playAudio: (url) => played.push(url)
  });
  assert.equal(front.querySelector(".meaning-word").textContent, "d'Haus n");
  assert.equal(front.querySelector(".gender-chip").getAttribute("aria-label"), "neuter");
  assert.equal(front.querySelector(".meaning-grammar").textContent, "Plural: Haiser, Haus");
  assert.deepEqual([...back.querySelectorAll(".meaning-sense")].map((item) => [item.value, item.textContent]), [
    [1, "house (building)"], [2, "house (household, family)"], [3, "house (dynasty)"], [4, "house (business)"]
  ]);
  assert.equal(back.querySelector(".meaning-example mark").textContent, "Haus");
  back.querySelector(".ex-audio").click();
  assert.equal(played.length, 1);

  const goen = env.api.buildMeaningCard(env.document, { id: "GOEN1" }, env.lexicon("GOEN1"), { language: "en", focus: [4] });
  assert.equal(goen.front.querySelector(".meaning-grammar").textContent, "Perfect: ass gaangen / gaang");
  assert.equal(goen.back.querySelector(".meaning-sense").textContent, "op den Telefon goen: to answer the phone");
  assert.match(goen.back.querySelector(".meaning-more").textContent, /\+27 more meanings on LOD/);
});

test("leech panel saves a note and narrowed focus, pauses the word and closes on Escape", () => {
  const env = setup();
  const lexicon = env.lexicon("HAUS1");
  const calls = [];
  const dialog = env.api.renderLeechPanel(env.document, env.stage, { entry: { id: "HAUS1" }, lexicon, lapses: 6, note: "old", focus: [] }, {
    language: "en",
    onSave: (value) => calls.push(["save", plain(value)]),
    onSuspend: () => calls.push(["suspend"]),
    onClose: () => calls.push(["close"])
  });
  assert.equal(dialog.getAttribute("role"), "dialog");
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.match(dialog.querySelector(".leech-title").textContent, /⚑ Haus keeps slipping/);
  assert.equal(env.document.activeElement, dialog.querySelector(".leech-note"));
  const boxes = [...dialog.querySelectorAll(".leech-sense input")];
  assert.equal(boxes.length, 4);
  assert.ok(boxes.every((box) => box.checked));

  const buttons = Object.fromEntries([...dialog.querySelectorAll("button")].map((button) => [button.textContent, button]));
  buttons.Save.click();
  boxes[2].checked = false;
  boxes[3].checked = false;
  dialog.querySelector(".leech-note").value = "  dat Haus  ";
  buttons.Save.click();
  buttons["Pause this word"].click();
  dialog.dispatchEvent(new env.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.deepEqual(calls, [
    ["save", { note: "old", focus: [] }],
    ["save", { note: "dat Haus", focus: [1, 2] }],
    ["suspend"],
    ["close"]
  ]);
});

test("render refuses unknown skills and words without a lexicon", () => {
  const env = setup();
  assert.throws(() => env.api.render(env.document, env.stage, { skill: "xx" }, { lexicon: {} }), /No exercise/);
  assert.throws(() => env.api.render(env.document, env.stage, { skill: "g" }, {}), /lexicon/);
});

test("exercise text is set as text, never parsed as HTML", () => {
  const env = setup();
  const lexicon = env.lexicon("HAUS1");
  lexicon.lemma = "<img src=x onerror=alert(1)>";
  env.api.render(env.document, env.stage, { id: "X#g", skill: "g" }, { lexicon });
  assert.equal(env.stage.querySelector("img"), null);
  assert.match(env.stage.querySelector(".ex-word").textContent, /<img/);
});

test("which meaning keeps all options in the learner's language when it can", () => {
  const env = setup();
  const lexicon = env.lexicon("GOEN1");
  assert.ok(lexicon.senses.some((sense) => !sense.tr.en), "fixture has a sense without English");
  for (let seed = 0; seed < 12; seed += 1) {
    let value = seed / 12;
    const card = play("sd", "GOEN1", { lexicon, random: () => (value = (value * 9301 + 0.49297) % 1) });
    const texts = card.$$(".ex-option .ex-choice-text").map((option) => option.textContent);
    const english = lexicon.senses.filter((sense) => sense.tr.en).map((sense) => env.api.senseText(sense, "en"));
    assert.ok(texts.every((text) => english.includes(text)), texts.join(" | "));
  }
});

test("destroy blocks keys and retained feedback buttons", () => {
  const env = play("g", "HAUS1");
  env.key("3");
  const buttons = env.$$(".ex-feedback button");
  env.controller.destroy();
  assert.equal(env.key("Enter"), false);
  for (const button of buttons) button.click();
  assert.equal(env.graded.length, 0);
});

for (const key of ["Enter", " "]) test(`feedback ${key} leaves every focused action to native activation`, () => {
  for (const selector of [".ex-continue", ".ex-easy", ".ex-override", ".ex-wrong"]) {
    const env = selector === ".ex-wrong" ? play("pl", "HAUS1") : play("g", "HAUS1");
    if (selector === ".ex-wrong") { env.type("Haiseq"); env.submit(); }
    else env.key(selector === ".ex-override" ? "1" : "3");
    const target = env.$(selector);
    assert.ok(target, selector);
    assert.equal(env.controller.handleKey({ key, target }), false);
    assert.equal(env.graded.length, 0);
    target.click();
    assert.equal(env.graded.length, 1);
    const expected = { ".ex-continue": 3, ".ex-easy": 4, ".ex-override": 3, ".ex-wrong": 1 };
    assert.equal(env.graded[0].grade, expected[selector]);
  }
});

test("leech panel contains focus, restores it and ignores retained controls", () => {
  const env = setup();
  const opener = env.document.createElement("button");
  env.document.body.append(opener);
  opener.focus();
  let calls = 0;
  const panel = env.api.renderLeechPanel(env.document, env.stage, { lexicon: env.lexicon("HAUS1") }, { onClose: () => calls++ });
  const controls = panel.querySelectorAll("textarea, input, button");
  const first = controls[0], last = controls[controls.length - 1];
  first.dispatchEvent(new env.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
  assert.equal(env.document.activeElement, last);
  last.dispatchEvent(new env.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  assert.equal(env.document.activeElement, first);
  opener.focus();
  assert.equal(env.document.activeElement, first);
  last.click();
  assert.equal(env.document.activeElement, opener);
  last.click();
  assert.equal(calls, 1);
});
