// Typed-answer grader shared by the flashcard exercises (plural, participle,
// cloze, reverse production). Pure functions plus two small DOM helpers for
// the ë/é/ä buttons. Grades use the 1–4 scale: 1 Again, 2 Hard, 3 Good.
(() => {
  const GRADE = Object.freeze({ AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 });
  const ACCENT_KEYS = Object.freeze(["ë", "é", "ä"]);
  const TYPO_MIN_LENGTH = 6;
  // Opt-in shortcuts for keyboards without the letters: e: → ë, e' → é, a: → ä.
  const ALIASES = Object.freeze([
    [/e:/g, "ë"], [/E:/g, "Ë"],
    [/e'/g, "é"], [/E'/g, "É"],
    [/a:/g, "ä"], [/A:/g, "Ä"]
  ]);

  function normalizeAnswer(value, options = {}) {
    let text = String(value ?? "").normalize("NFC");
    text = text.replace(/[’‘ʼ`´]/g, "'");
    if (options.aliases) {
      for (const [pattern, replacement] of ALIASES) text = text.replace(pattern, replacement);
    }
    return text
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[\s.!?,;:…]+$/u, "")
      .replace(/^[\s¿¡]+/u, "")
      .trim();
  }

  function stripDiacritics(value) {
    return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC");
  }

  // "Haiser / Haus", "gaangen · gaang" → each alternative on its own.
  function splitAlternatives(value) {
    const list = Array.isArray(value) ? value : [value];
    const result = [];
    for (const item of list) {
      for (const part of String(item ?? "").split(/\s+\/\s+|\s*·\s*/)) {
        const text = normalizeAnswer(part);
        if (text && !result.includes(text)) result.push(text);
      }
    }
    return result;
  }

  // Optimal string alignment distance (Damerau-Levenshtein with adjacent
  // transpositions), enough to tell a slip from a different word.
  function damerauLevenshtein(left, right) {
    const a = [...String(left ?? "")];
    const b = [...String(right ?? "")];
    const rows = a.length + 1;
    const cols = b.length + 1;
    const d = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let i = 0; i < rows; i += 1) d[i][0] = i;
    for (let j = 0; j < cols; j += 1) d[0][j] = j;
    for (let i = 1; i < rows; i += 1) {
      for (let j = 1; j < cols; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[a.length][b.length];
  }

  // Character diff from the learner's answer to the expected one:
  // "same" runs, "extra" (typed but not expected) and "missing" (expected but
  // not typed), from a longest-common-subsequence table.
  function diffChars(typed, expected) {
    const a = [...String(typed ?? "")];
    const b = [...String(expected ?? "")];
    const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    const segments = [];
    const push = (type, char) => {
      const last = segments[segments.length - 1];
      if (last && last.type === type) last.text += char;
      else segments.push({ type, text: char });
    };
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        push("same", a[i]);
        i += 1;
        j += 1;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
        push("extra", a[i]);
        i += 1;
      } else {
        push("missing", b[j]);
        j += 1;
      }
    }
    while (i < a.length) push("extra", a[i++]);
    while (j < b.length) push("missing", b[j++]);
    return segments;
  }

  function startsUppercase(value) {
    const first = [...String(value ?? "")][0] || "";
    return first !== first.toLowerCase() && first === first.toUpperCase();
  }

  function compareOne(typed, expected, options) {
    if (typed === expected) return { kind: "exact", notes: [] };
    // Nouns are written with a capital, so a lowercase noun is accepted with a
    // note. Other case differences (a capital at the start of a typed
    // sentence) don't matter.
    const capitalMissing = Boolean(options.noun) && startsUppercase(expected) && !startsUppercase(typed);
    const lowerTyped = typed.toLowerCase();
    const lowerExpected = expected.toLowerCase();
    if (lowerTyped === lowerExpected) {
      return capitalMissing ? { kind: "case", notes: ["capital"] } : { kind: "exact", notes: [] };
    }
    if (stripDiacritics(lowerTyped) === stripDiacritics(lowerExpected)) {
      return { kind: "accent", notes: capitalMissing ? ["capital", "accent"] : ["accent"] };
    }
    return null;
  }

  // grade(typed, expected, options)
  //   expected: string or list; " / " and "·" separate accepted alternatives.
  //   options.nRule: { full: elided } pairs, e.g. { Fraen: "Frae" }; either
  //     form is accepted, the other one with a note.
  //   options.noun: the answer is a noun, so a missing capital gets a note.
  //   options.aliases: turn e: e' a: into ë é ä before comparing.
  // Returns { verdict, correct, grade, typoGrade?, matched, typed, alternatives, notes, diff }.
  // verdict: "empty" | "exact" | "case" | "accent" | "nrule" | "typo" | "wrong".
  // "typo" asks the learner: count it (typoGrade, Hard) or not (Again).
  function grade(typedValue, expectedValue, options = {}) {
    const typed = normalizeAnswer(typedValue, options);
    const alternatives = splitAlternatives(expectedValue);
    const nRule = options.nRule && typeof options.nRule === "object" ? options.nRule : {};
    const variants = [];
    for (const alternative of alternatives) {
      variants.push({ form: alternative, matched: alternative, nrule: false });
      for (const [full, elided] of Object.entries(nRule)) {
        const fullText = normalizeAnswer(full);
        const elidedText = normalizeAnswer(elided);
        if (fullText === alternative && elidedText) variants.push({ form: elidedText, matched: alternative, nrule: true });
        if (elidedText === alternative && fullText) variants.push({ form: fullText, matched: alternative, nrule: true });
      }
    }
    const primary = alternatives[0] || "";

    if (!typed) {
      return { verdict: "empty", correct: false, grade: GRADE.AGAIN, matched: primary, typed, alternatives, notes: [], diff: diffChars("", primary) };
    }

    let best = null;
    const rank = { exact: 0, case: 1, accent: 2 };
    for (const variant of variants) {
      const result = compareOne(typed, variant.form, options);
      if (!result) continue;
      const kind = variant.nrule && result.kind !== "accent" ? "nrule" : result.kind;
      const notes = variant.nrule ? [...result.notes, "nrule"] : result.notes;
      const score = (rank[result.kind] ?? 3) + (variant.nrule ? 0.5 : 0);
      if (!best || score < best.score) best = { kind, notes, variant, score };
    }

    if (best) {
      const accentSlip = best.notes.includes("accent");
      return {
        verdict: best.kind,
        correct: true,
        grade: accentSlip ? GRADE.HARD : GRADE.GOOD,
        matched: best.variant.matched,
        typed,
        alternatives,
        notes: best.notes,
        diff: diffChars(typed, best.variant.form)
      };
    }

    // Close enough to be a slip? Only for longer words, where one edit
    // rarely turns one real word into another.
    let closest = null;
    for (const variant of variants) {
      const distance = damerauLevenshtein(
        stripDiacritics(typed).toLowerCase(),
        stripDiacritics(variant.form).toLowerCase()
      );
      if (!closest || distance < closest.distance) closest = { distance, variant };
    }
    const target = closest?.variant.form || primary;
    if (closest && closest.distance <= 1 && [...target].length >= TYPO_MIN_LENGTH) {
      return {
        verdict: "typo",
        correct: false,
        grade: GRADE.AGAIN,
        typoGrade: GRADE.HARD,
        matched: closest.variant.matched,
        typed,
        alternatives,
        notes: ["typo"],
        diff: diffChars(typed, target)
      };
    }

    return {
      verdict: "wrong",
      correct: false,
      grade: GRADE.AGAIN,
      matched: primary,
      typed,
      alternatives,
      notes: [],
      diff: diffChars(typed, target)
    };
  }

  const NOTE_TEXT = Object.freeze({
    accent: "Watch the accents.",
    capital: "Nouns start with a capital letter.",
    nrule: "Accepted: the other form follows the n-rule.",
    typo: "Typo?"
  });

  function describeNotes(notes = []) {
    return notes.map((note) => NOTE_TEXT[note]).filter(Boolean);
  }

  // ── DOM helpers ─────────────────────────────────────────────────────────

  function insertAtCursor(input, text) {
    if (!input) return;
    const value = String(input.value ?? "");
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    input.value = `${value.slice(0, start)}${text}${value.slice(end)}`;
    const caret = start + text.length;
    input.setSelectionRange?.(caret, caret);
    input.dispatchEvent?.(new input.ownerDocument.defaultView.Event("input", { bubbles: true }));
    input.focus?.();
  }

  // Adds ë é ä buttons that type into `input`. mousedown is prevented so the
  // input keeps focus and its caret position.
  function createAccentButtons(doc, input, keys = ACCENT_KEYS) {
    const group = doc.createElement("div");
    group.className = "accent-keys";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Insert letter");
    for (const key of keys) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "accent-key";
      button.textContent = key;
      button.setAttribute("aria-label", `Insert ${key}`);
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => insertAtCursor(input, key));
      group.append(button);
    }
    return group;
  }

  // Renders a diff as spans: same text plain, extra struck through, missing
  // underlined. Uses textContent only.
  function renderDiff(doc, segments = []) {
    const wrapper = doc.createElement("span");
    wrapper.className = "answer-diff";
    for (const segment of segments) {
      const span = doc.createElement(segment.type === "extra" ? "del" : segment.type === "missing" ? "ins" : "span");
      span.className = `answer-diff-${segment.type}`;
      span.textContent = segment.text;
      wrapper.append(span);
    }
    return wrapper;
  }

  globalThis.LodVaultAnswerGrader = {
    GRADE,
    ACCENT_KEYS,
    TYPO_MIN_LENGTH,
    normalizeAnswer,
    stripDiacritics,
    splitAlternatives,
    damerauLevenshtein,
    diffChars,
    grade,
    describeNotes,
    insertAtCursor,
    createAccentButtons,
    renderDiff
  };
})();
