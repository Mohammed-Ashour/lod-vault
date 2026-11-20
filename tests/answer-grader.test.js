const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "answer-grader.js"), "utf8");

function loadGrader() {
  const context = { console };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "scripts/answer-grader.js" });
  return context.LodVaultAnswerGrader;
}

function loadGraderInDom() {
  const dom = new JSDOM("<!doctype html><html><body><input id='answer'></body></html>", { runScripts: "outside-only" });
  dom.window.eval(source);
  return { dom, grader: dom.window.LodVaultAnswerGrader, document: dom.window.document };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const grader = loadGrader();
const { GRADE } = grader;

function check(typed, expected, options) {
  return plain(grader.grade(typed, expected, options));
}

test("normalizeAnswer applies NFC, straight apostrophes, single spaces and drops end punctuation", () => {
  assert.equal(grader.normalizeAnswer("  d’Haus   ass  grouss!  "), "d'Haus ass grouss");
  assert.equal(grader.normalizeAnswer("Blëck."), "Blëck");
  assert.equal(grader.normalizeAnswer("gaangen?!…"), "gaangen");
  // A trailing colon is end punctuation unless aliases turn "e:" into "ë" first.
  assert.equal(grader.normalizeAnswer("Kaffe:"), "Kaffe");
  assert.equal(grader.normalizeAnswer("Kaffe:", { aliases: true }), "Kaffë");
  assert.equal(grader.normalizeAnswer("Schwe:ster, cafe'", { aliases: true }), "Schwëster, café");
  assert.equal(grader.normalizeAnswer("A:pel"), "A:pel");
  assert.equal(grader.normalizeAnswer("A:pel", { aliases: true }), "Äpel");
});

test("an exact answer is correct and graded Good", () => {
  const result = check("Haiser", "Haiser");
  assert.equal(result.verdict, "exact");
  assert.equal(result.correct, true);
  assert.equal(result.grade, GRADE.GOOD);
  assert.deepEqual(result.notes, []);
  assert.deepEqual(result.diff, [{ type: "same", text: "Haiser" }]);
});

test("input decomposed differently or with a curly apostrophe still matches exactly", () => {
  assert.equal(check("Schwëster", "Schwëster").verdict, "exact");
  assert.equal(check("d’Fra", "d'Fra").verdict, "exact");
  assert.equal(check("  gaangen. ", "gaangen").verdict, "exact");
});

test("a missing or wrong accent is correct with a note and graded Hard", () => {
  for (const [typed, expected] of [["mechs", "méchs"], ["méchs", "mechs"], ["Schwester", "Schwëster"], ["Apel", "Äpel"]]) {
    const result = check(typed, expected);
    assert.equal(result.verdict, "accent", `${typed} → ${expected}`);
    assert.equal(result.correct, true);
    assert.equal(result.grade, GRADE.HARD);
    assert.deepEqual(result.notes, ["accent"]);
  }
  assert.deepEqual(check("Schwester", "Schwëster").diff, [
    { type: "same", text: "Schw" },
    { type: "extra", text: "e" },
    { type: "missing", text: "ë" },
    { type: "same", text: "ster" }
  ]);
});

test("any listed alternative is accepted, split on ' / ' and '·'", () => {
  assert.equal(check("gaang", "gaangen / gaang").verdict, "exact");
  assert.equal(check("gaang", "gaangen / gaang").matched, "gaang");
  assert.equal(check("gemaacht", "gemaach · gemaacht").verdict, "exact");
  assert.equal(check("Haus", ["Haiser", "Haus"]).verdict, "exact");
  assert.deepEqual(check("Haus", ["Haiser", "Haus"]).alternatives, ["Haiser", "Haus"]);
  assert.deepEqual(plain(grader.splitAlternatives(["a / b", "b·c", " ", null])), ["a", "b", "c"]);
  // A slash inside a word is not a separator.
  assert.deepEqual(plain(grader.splitAlternatives("km/h")), ["km/h"]);
});

test("the n-rule variant is accepted in either direction with a note", () => {
  const elided = check("Frae", "Fraen", { nRule: { Fraen: "Frae" } });
  assert.equal(elided.verdict, "nrule");
  assert.equal(elided.correct, true);
  assert.equal(elided.grade, GRADE.GOOD);
  assert.equal(elided.matched, "Fraen");
  assert.deepEqual(elided.notes, ["nrule"]);

  const full = check("goen", "goe", { nRule: { goen: "goe" } });
  assert.equal(full.verdict, "nrule");

  // Without the n-rule pair the short form is just short.
  assert.equal(check("Frae", "Fraen").correct, false);
  // The exact form wins over the n-rule variant.
  assert.equal(check("Fraen", "Fraen", { nRule: { Fraen: "Frae" } }).verdict, "exact");
});

test("a noun without its capital is accepted with a note; case is ignored otherwise", () => {
  const noun = check("haiser", "Haiser", { noun: true });
  assert.equal(noun.verdict, "case");
  assert.equal(noun.correct, true);
  assert.equal(noun.grade, GRADE.GOOD);
  assert.deepEqual(noun.notes, ["capital"]);

  const both = check("schwester", "Schwëster", { noun: true });
  assert.equal(both.verdict, "accent");
  assert.deepEqual(both.notes, ["capital", "accent"]);
  assert.equal(both.grade, GRADE.HARD);

  assert.equal(check("Gaangen", "gaangen").verdict, "exact");
  assert.equal(check("haiser", "Haiser").verdict, "exact");
});

test("one slip in a word of six or more letters asks whether it was a typo", () => {
  for (const [typed, expected] of [["gaangn", "gaangen"], ["Schwëtser", "Schwëster"], ["gemaachtt", "gemaacht"], ["Hasier", "Haiser"]]) {
    const result = check(typed, expected);
    assert.equal(result.verdict, "typo", `${typed} → ${expected}`);
    assert.equal(result.correct, false);
    assert.equal(result.grade, GRADE.AGAIN);
    assert.equal(result.typoGrade, GRADE.HARD);
    assert.equal(result.matched, expected);
  }
});

test("short words and bigger differences are simply wrong", () => {
  for (const [typed, expected] of [["geet", "gees"], ["Haus", "Hous"], ["Kaz", "Haus"], ["gaang", "gaangenen"]]) {
    const result = check(typed, expected);
    assert.equal(result.verdict, "wrong", `${typed} → ${expected}`);
    assert.equal(result.correct, false);
    assert.equal(result.grade, GRADE.AGAIN);
    assert.equal(result.typoGrade, undefined);
  }
});

test("the typo check ignores accents and compares with the closest alternative", () => {
  const result = check("gemaachtt", "gemaach / gemaacht");
  assert.equal(result.verdict, "typo");
  assert.equal(result.matched, "gemaacht");
  assert.equal(check("Schwästr", "Schwëster").verdict, "wrong");
});

test("an empty answer is graded Again and shows the whole answer as missing", () => {
  const result = check("  ", "Haus");
  assert.equal(result.verdict, "empty");
  assert.equal(result.grade, GRADE.AGAIN);
  assert.deepEqual(result.diff, [{ type: "missing", text: "Haus" }]);
});

test("aliases are opt-in", () => {
  assert.equal(check("Schwe:ster", "Schwëster", { aliases: true }).verdict, "exact");
  assert.equal(check("cafe'", "café", { aliases: true }).verdict, "exact");
  assert.notEqual(check("Schwe:ster", "Schwëster").verdict, "exact");
});

test("Damerau-Levenshtein counts an adjacent swap as one edit", () => {
  assert.equal(grader.damerauLevenshtein("abcd", "acbd"), 1);
  assert.equal(grader.damerauLevenshtein("kitten", "sitting"), 3);
  assert.equal(grader.damerauLevenshtein("", "abc"), 3);
  assert.equal(grader.damerauLevenshtein("ëä", "äë"), 1);
});

test("diffChars marks extra and missing characters", () => {
  assert.deepEqual(plain(grader.diffChars("gaangn", "gaangen")), [
    { type: "same", text: "gaang" },
    { type: "missing", text: "e" },
    { type: "same", text: "n" }
  ]);
  assert.deepEqual(plain(grader.diffChars("Haiserr", "Haiser")), [
    { type: "same", text: "Haiser" },
    { type: "extra", text: "r" }
  ]);
  assert.deepEqual(plain(grader.diffChars("", "")), []);
});

test("describeNotes turns notes into short feedback", () => {
  assert.deepEqual(plain(grader.describeNotes(["capital", "accent", "unknown"])), [
    "Nouns start with a capital letter.",
    "Watch the accents."
  ]);
});

test("accent buttons type at the caret without taking focus from the input", () => {
  const { grader: domGrader, document, dom } = loadGraderInDom();
  const input = document.getElementById("answer");
  const inputs = [];
  input.addEventListener("input", () => inputs.push(input.value));
  const group = domGrader.createAccentButtons(document, input);
  document.body.append(group);
  const buttons = [...group.querySelectorAll("button")];
  assert.deepEqual(buttons.map((button) => button.textContent), ["ë", "é", "ä"]);
  assert.equal(group.getAttribute("role"), "group");
  assert.equal(buttons[0].type, "button");

  input.value = "Schwster";
  input.focus();
  input.setSelectionRange(4, 4);
  const mousedown = new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
  buttons[0].dispatchEvent(mousedown);
  assert.equal(mousedown.defaultPrevented, true);
  buttons[0].click();
  assert.equal(input.value, "Schwëster");
  assert.equal(input.selectionStart, 5);
  assert.deepEqual(inputs, ["Schwëster"]);
  assert.equal(document.activeElement, input);

  input.setSelectionRange(0, 9);
  buttons[2].click();
  assert.equal(input.value, "ä");
});

test("renderDiff builds del/ins spans with text only", () => {
  const { grader: domGrader, document } = loadGraderInDom();
  const node = domGrader.renderDiff(document, [
    { type: "same", text: "Schw" },
    { type: "extra", text: "<b>e</b>" },
    { type: "missing", text: "ë" }
  ]);
  assert.equal(node.className, "answer-diff");
  assert.deepEqual([...node.children].map((child) => child.tagName), ["SPAN", "DEL", "INS"]);
  assert.equal(node.querySelector("del").textContent, "<b>e</b>");
  assert.equal(node.querySelector("b"), null);
});
