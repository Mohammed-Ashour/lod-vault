// Flashcard exercises for skill cards (scripts/card-registry.js) and the
// lexicon-based meaning card. Each exercise renders into a container, takes
// the learner's answer, shows feedback and reports a grade on the 1–4 scale
// through ctx.onGrade(grade, detail). Nothing here touches storage; the
// flashcards page records the review.
//
// render(doc, container, card, ctx) → { handleKey(event) → handled?, destroy() }
//   card: { id, entryId, skill, entry }
//   ctx:  { lexicon, language: "en", focus: [sense numbers], onGrade,
//           playAudio(url), random, others: [{ entry, lexicon }] }
(() => {
  const GRADE = Object.freeze({ AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 });
  const LANGUAGE_ORDER = ["en", "fr", "de", "pt", "nl"];
  const DEMONSTRATIVE = Object.freeze({ m: "deen", f: "déi", n: "dat" });
  const GENDER_LABEL = Object.freeze({ m: "masculine", f: "feminine", n: "neuter" });
  const GENDER_KEYS = Object.freeze([["m", "j", "1"], ["f", "k", "2"], ["n", "l", "3"]]);

  function grader() {
    const api = globalThis.LodVaultAnswerGrader;
    if (!api) throw new Error("LodVaultAnswerGrader is not loaded.");
    return api;
  }

  function cards() {
    return globalThis.LodVaultCards || null;
  }

  // ── Luxembourgish helpers ───────────────────────────────────────────────

  // The n-rule (Eifeler Regel): a final -n is kept before a vowel and before
  // n, d, t, z, h; otherwise it drops. Enough for articles before a noun.
  function keepsFinalN(nextWord) {
    return /^[aeiouäëéèêöüyndtzh]/i.test(String(nextWord || "").trim());
  }

  function articles(lemma, gender) {
    const n = keepsFinalN(lemma);
    switch (gender) {
      case "m": return { definite: n ? "den" : "de", indefinite: n ? "en" : "e", dative: "dem" };
      case "f": return { definite: "d'", indefinite: "eng", dative: "der" };
      case "n": return { definite: "d'", indefinite: n ? "en" : "e", dative: "dem" };
      default: return null;
    }
  }

  function withArticle(article, word) {
    return article.endsWith("'") ? `${article}${word}` : `${article} ${word}`;
  }

  // "d'Haus · en Haus · dem Haus (dat.)"
  function articleLine(lemma, gender) {
    const forms = articles(lemma, gender);
    if (!forms) return "";
    return `${withArticle(forms.definite, lemma)} · ${withArticle(forms.indefinite, lemma)} · ${withArticle(forms.dative, lemma)} (dat.)`;
  }

  // ── lexicon helpers ─────────────────────────────────────────────────────

  function senseList(lexicon, focus) {
    const registry = cards();
    if (registry) return registry.focusedSenses(lexicon, focus);
    return Array.isArray(lexicon?.senses) ? lexicon.senses : [];
  }

  function pickLanguage(sense, preferred) {
    const order = [preferred, ...LANGUAGE_ORDER].filter(Boolean);
    return order.find((language) => sense?.tr?.[language]?.length) || "";
  }

  // "house (building)" / "marcher, aller (à pied)"
  function senseText(sense, preferred) {
    const language = pickLanguage(sense, preferred);
    if (!language) return "";
    return sense.tr[language]
      .map(([translation, clarifier]) => (clarifier ? `${translation} (${clarifier})`.trim() : translation))
      .filter(Boolean)
      .join(", ");
  }

  function pick(list, random = Math.random) {
    if (!list.length) return null;
    return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
  }

  function shuffled(list, random = Math.random) {
    return list
      .map((item) => ({ item, key: random() }))
      .sort((left, right) => left.key - right.key)
      .map(({ item }) => item);
  }

  // ── DOM helpers ─────────────────────────────────────────────────────────

  function el(doc, tag, className = "", text = "") {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function button(doc, className, text, onClick) {
    const node = el(doc, "button", className, text);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }

  // Example text with each headword span in <mark>, or blanked by `blank`.
  function exampleNode(doc, example, { blank = null } = {}) {
    const wrapper = el(doc, "span", "ex-text");
    const text = String(example?.t || "");
    let cursor = 0;
    const spans = [...(example?.h || [])].sort((left, right) => left[0] - right[0]);
    spans.forEach(([start, end], index) => {
      if (start < cursor || end > text.length) return;
      wrapper.append(text.slice(cursor, start));
      wrapper.append(blank ? blank(text.slice(start, end), index) : el(doc, "mark", "ex-headword", text.slice(start, end)));
      cursor = end;
    });
    wrapper.append(text.slice(cursor));
    return wrapper;
  }

  function audioButton(doc, url, label, playAudio) {
    const node = button(doc, "ex-audio", "▶", () => playAudio?.(url));
    node.setAttribute("aria-label", label);
    node.title = label;
    return node;
  }

  function verdictChip(doc, kind, text) {
    return el(doc, "span", `answer-verdict ${kind}`, text);
  }

  // Shared feedback block with Continue (or the typo question).
  function feedback(doc, root, result, { lines = [], diff = null, onDone }) {
    const box = el(doc, "div", "ex-feedback");
    box.setAttribute("role", "status");
    const kind = result.verdict === "typo" ? "is-close"
      : result.correct && result.grade === GRADE.HARD ? "is-close"
        : result.correct ? "is-correct" : "is-wrong";
    const label = result.label || (result.verdict === "typo" ? "Typo?"
      : result.correct ? (result.grade === GRADE.HARD ? "Correct, almost" : "Correct") : "Not quite");
    box.append(verdictChip(doc, kind, label));
    if (diff) box.append(grader().renderDiff(doc, diff));
    const notes = el(doc, "ul", "answer-notes");
    for (const line of [...grader().describeNotes(result.notes || []).filter((note) => note !== "Typo?"), ...lines]) {
      notes.append(el(doc, "li", "", line));
    }
    if (notes.children.length) box.append(notes);
    const actions = el(doc, "div", "ex-actions");
    let finished = false;
    const finish = (grade, extra = {}) => {
      if (finished) return;
      finished = true;
      onDone(grade, extra);
    };
    if (result.verdict === "typo") {
      actions.append(
        button(doc, "btn-primary ex-continue", "Count it", () => finish(result.typoGrade || GRADE.HARD, { typo: "counted" })),
        button(doc, "btn-ghost ex-wrong", "It was wrong", () => finish(GRADE.AGAIN, { typo: "wrong" }))
      );
    } else {
      actions.append(button(doc, "btn-primary ex-continue", "Continue", () => finish(result.grade)));
    }
    if (result.verdict !== "typo") {
      actions.append(result.correct
        ? button(doc, "btn-ghost ex-easy", "Too easy", () => finish(GRADE.EASY, { override: "easy" }))
        : button(doc, "btn-ghost ex-override", "I was right", () => finish(GRADE.GOOD, { override: "correct" })));
    }
    box.append(actions);
    root.append(box);
    actions.querySelector("button")?.focus();
    return {
      destroy() { finished = true; },
      continue() {
        actions.querySelector(".ex-continue")?.click();
      }
    };
  }

  function typedInput(doc, label, { width = 0 } = {}) {
    const input = el(doc, "input", "ex-input");
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("aria-label", label);
    if (width) {
      input.classList.add("ex-gap");
      input.style.width = `calc(${Math.max(4, width + 1)}ch + 22px)`;
    }
    return input;
  }

  function shell(doc, container, card, title) {
    container.replaceChildren();
    const root = el(doc, "section", `exercise exercise-${card.skill || "core"}`);
    root.dataset.cardId = card.id;
    root.append(el(doc, "p", "ex-kind", title));
    container.append(root);
    return root;
  }

  // Minimal controller plumbing: one answer, then feedback, then onGrade.
  function controller(state, extraKeys = () => false) {
    return {
      handleKey(event) {
        if (state.destroyed) return false;
        const key = String(event?.key || "");
        if (state.feedback) {
          if (key === "Enter" || key === " ") {
            if (event?.target?.closest?.("button, a, input, textarea, select, [contenteditable]")) return false;
            state.feedback.continue();
            return true;
          }
          return false;
        }
        return extraKeys(key, event);
      },
      destroy() {
        state.destroyed = true;
        state.feedback?.destroy();
      },
      get answered() {
        return Boolean(state.feedback);
      }
    };
  }

  // ── gender #g ───────────────────────────────────────────────────────────

  function renderGender(doc, container, card, ctx) {
    const lexicon = ctx.lexicon;
    const lemma = lexicon.lemma;
    const root = shell(doc, container, card, "Gender");
    const prompt = el(doc, "p", "ex-prompt");
    prompt.append(el(doc, "span", "ex-blank", "___"), " ", el(doc, "strong", "ex-word", lemma), " ?");
    root.append(prompt);
    root.append(el(doc, "p", "ex-hint", "Which demonstrative goes with it? (d' is both feminine and neuter)"));
    const choices = el(doc, "div", "ex-choices");
    choices.setAttribute("role", "group");
    choices.setAttribute("aria-label", "Gender");
    const state = {};
    for (const [gender, letter, digit] of GENDER_KEYS) {
      const choice = button(doc, "ex-choice", "", () => answer(gender));
      choice.dataset.gender = gender;
      choice.append(el(doc, "span", "ex-choice-text", DEMONSTRATIVE[gender]), el(doc, "kbd", "ex-key", `${letter.toUpperCase()} / ${digit}`));
      choice.setAttribute("aria-label", `${DEMONSTRATIVE[gender]} (${GENDER_LABEL[gender]})`);
      choices.append(choice);
    }
    root.append(choices);

    function answer(gender) {
      if (state.feedback || state.destroyed) return;
      const correct = gender === lexicon.gender;
      for (const choice of choices.querySelectorAll(".ex-choice")) {
        choice.disabled = true;
        choice.classList.toggle("is-right", choice.dataset.gender === lexicon.gender);
        choice.classList.toggle("is-picked-wrong", !correct && choice.dataset.gender === gender);
      }
      const result = { correct, grade: correct ? GRADE.GOOD : GRADE.AGAIN, verdict: correct ? "exact" : "wrong" };
      state.feedback = feedback(doc, root, result, {
        lines: [`${DEMONSTRATIVE[lexicon.gender]} ${lemma} (${GENDER_LABEL[lexicon.gender]})`, articleLine(lemma, lexicon.gender)],
        onDone: (grade, extra) => ctx.onGrade?.(grade, { skill: "g", answer: gender, correct, ...extra })
      });
    }

    return controller(state, (key) => {
      const match = GENDER_KEYS.find(([, letter, digit]) => key.toLowerCase() === letter || key === digit);
      if (!match) return false;
      answer(match[0]);
      return true;
    });
  }

  // ── shared typed-answer flow ────────────────────────────────────────────

  function typedExercise(doc, root, { inputs, submitLabel = "Check", grade, onGrade, extraKeys }) {
    const state = {};
    const form = el(doc, "form", "ex-form");
    form.noValidate = true;
    const row = el(doc, "div", "ex-input-row");
    for (const input of inputs.filter((item) => !item.isConnected)) row.append(input);
    const keys = grader().createAccentButtons(doc, inputs[inputs.length - 1]);
    // The accent buttons type into whichever blank had focus last.
    let lastFocused = inputs[0];
    for (const input of inputs) input.addEventListener("focus", () => { lastFocused = input; });
    for (const key of keys.querySelectorAll("button")) {
      key.replaceWith(key.cloneNode(true));
    }
    for (const key of keys.querySelectorAll("button")) {
      key.addEventListener("mousedown", (event) => event.preventDefault());
      key.addEventListener("click", () => grader().insertAtCursor(lastFocused, key.textContent));
    }
    const submit = el(doc, "button", "btn-primary ex-submit", submitLabel);
    submit.type = "submit";
    if (row.children.length) form.append(row);
    form.append(keys, submit);
    root.append(form);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (state.feedback || state.destroyed) return;
      const outcome = grade();
      if (!outcome) return;
      for (const input of inputs) input.readOnly = true;
      submit.disabled = true;
      for (const key of keys.querySelectorAll("button")) key.disabled = true;
      state.feedback = feedback(doc, root, outcome.result, {
        lines: outcome.lines || [],
        diff: outcome.diff || null,
        onDone: (gradeValue, extra) => onGrade(gradeValue, { ...outcome.detail, ...extra })
      });
      outcome.after?.();
    });
    inputs[0]?.focus();
    return controller(state, extraKeys || (() => false));
  }

  // ── plural #pl ──────────────────────────────────────────────────────────

  function renderPlural(doc, container, card, ctx) {
    const lexicon = ctx.lexicon;
    const lemma = lexicon.lemma;
    const plurals = lexicon.noun?.plurals || [];
    const root = shell(doc, container, card, "Plural");
    const forms = articles(lemma, lexicon.gender);
    const two = lexicon.gender === "f" ? "zwou" : "zwee";
    const input = typedInput(doc, `Plural of ${lemma}`);
    const prompt = el(doc, "p", "ex-prompt");
    prompt.append(forms ? withArticle(forms.indefinite, "") : "", el(doc, "strong", "ex-word", lemma), "  →  ", `${two} `, input);
    root.append(prompt);
    const meaning = senseText(senseList(lexicon, ctx.focus)[0], ctx.language);
    if (meaning) root.append(el(doc, "p", "ex-hint", meaning));

    return typedExercise(doc, root, {
      inputs: [input],
      grade() {
        const result = grader().grade(input.value, plurals, {
          noun: true,
          nRule: lexicon.noun?.pluralNRule || {},
          aliases: Boolean(ctx.aliases)
        });
        const others = plurals.filter((form) => form !== result.matched);
        const lines = [`${two} ${result.matched}`];
        if (others.length) lines.push(`Also: ${others.join(", ")}`);
        return { result, diff: result.verdict === "exact" ? null : result.diff, lines, detail: { skill: "pl", answer: input.value, verdict: result.verdict } };
      },
      onGrade: (grade, detail) => ctx.onGrade?.(grade, detail)
    });
  }

  // ── perfect #pp ─────────────────────────────────────────────────────────

  const AUX_P3 = Object.freeze({ hunn: "huet", sinn: "ass" });

  function renderPerfect(doc, container, card, ctx) {
    const lexicon = ctx.lexicon;
    const verb = lexicon.verb;
    const root = shell(doc, container, card, "Perfect");
    root.append(el(doc, "p", "ex-hint", `${lexicon.lemma}${senseText(senseList(lexicon, ctx.focus)[0], ctx.language) ? ` · ${senseText(senseList(lexicon, ctx.focus)[0], ctx.language)}` : ""}`));
    const prompt = el(doc, "p", "ex-prompt");
    const auxGroup = el(doc, "span", "ex-aux");
    auxGroup.setAttribute("role", "radiogroup");
    auxGroup.setAttribute("aria-label", "Auxiliary");
    let aux = "";
    for (const [infinitive, form] of Object.entries(AUX_P3)) {
      const choice = button(doc, "ex-choice ex-aux-choice", form, () => choose(infinitive));
      choice.dataset.aux = infinitive;
      choice.setAttribute("role", "radio");
      choice.setAttribute("aria-checked", "false");
      auxGroup.append(choice);
    }
    const input = typedInput(doc, `Past participle of ${lexicon.lemma}`);
    prompt.append("hien ", auxGroup, " ", input);
    root.append(prompt);

    function choose(infinitive) {
      aux = infinitive;
      for (const choice of auxGroup.querySelectorAll(".ex-aux-choice")) {
        const picked = choice.dataset.aux === infinitive;
        choice.classList.toggle("is-picked", picked);
        choice.setAttribute("aria-checked", String(picked));
      }
      input.focus();
    }

    return typedExercise(doc, root, {
      inputs: [input],
      grade() {
        if (!aux) {
          auxGroup.classList.add("needs-answer");
          auxGroup.querySelector("button")?.focus();
          return null;
        }
        const participle = grader().grade(input.value, verb.pp, { aliases: Boolean(ctx.aliases) });
        const auxRight = aux === verb.aux;
        for (const choice of auxGroup.querySelectorAll(".ex-aux-choice")) {
          choice.disabled = true;
          choice.classList.toggle("is-right", choice.dataset.aux === verb.aux);
          choice.classList.toggle("is-picked-wrong", !auxRight && choice.dataset.aux === aux);
        }
        let result;
        if (auxRight && (participle.correct || participle.verdict === "typo")) {
          result = participle;
        } else {
          result = { ...participle, verdict: "wrong", correct: false, grade: GRADE.AGAIN, typoGrade: undefined, notes: participle.correct ? participle.notes : [] };
        }
        const lines = [`hien ${AUX_P3[verb.aux]} ${verb.pp.join(" / ")}`];
        if (!auxRight) lines.push(`${lexicon.lemma} takes ${verb.aux}.`);
        return {
          result,
          diff: participle.verdict === "exact" ? null : participle.diff,
          lines,
          detail: { skill: "pp", aux, answer: input.value, auxRight, verdict: participle.verdict }
        };
      },
      onGrade: (grade, detail) => ctx.onGrade?.(grade, detail),
      extraKeys(key) {
        if (key === "1" || key === "2") {
          if (doc.activeElement === input) return false;
          choose(key === "1" ? "hunn" : "sinn");
          return true;
        }
        return false;
      }
    });
  }

  // ── cloze #cz ───────────────────────────────────────────────────────────

  function clozeCandidates(lexicon, focus) {
    return senseList(lexicon, focus)
      .flatMap((sense) => (sense.ex || []).map((example) => ({ sense, example })))
      .filter(({ example }) => Array.isArray(example.h) && example.h.length);
  }

  function renderCloze(doc, container, card, ctx) {
    const lexicon = ctx.lexicon;
    const chosen = ctx.example || pick(clozeCandidates(lexicon, ctx.focus), ctx.random);
    const root = shell(doc, container, card, "Fill the gap");
    if (!chosen) {
      root.append(el(doc, "p", "ex-hint", "No example sentence for this word yet."));
      return controller({});
    }
    const { sense, example } = chosen;
    const inputs = [];
    const sentence = el(doc, "p", "ex-prompt ex-sentence");
    sentence.append(exampleNode(doc, example, {
      blank(text, index) {
        const input = typedInput(doc, `Gap ${index + 1}`, { width: [...text].length });
        input.dataset.expected = text;
        inputs.push(input);
        return input;
      }
    }));
    root.append(sentence);
    const hint = senseText(sense, ctx.language);
    root.append(el(doc, "p", "ex-hint", `${lexicon.lemma}${hint ? ` · ${hint}` : ""}`));

    return typedExercise(doc, root, {
      inputs,
      grade() {
        const results = inputs.map((input) => grader().grade(input.value, input.dataset.expected, { aliases: Boolean(ctx.aliases) }));
        inputs.forEach((input, index) => input.classList.add(results[index].correct ? "is-right" : "is-wrong"));
        let result;
        if (results.every((item) => item.correct)) {
          result = { verdict: "exact", correct: true, grade: Math.min(...results.map((item) => item.grade)), notes: [...new Set(results.flatMap((item) => item.notes))] };
        } else if (results.every((item) => item.correct || item.verdict === "typo")) {
          result = { verdict: "typo", correct: false, grade: GRADE.AGAIN, typoGrade: GRADE.HARD, notes: ["typo"] };
        } else {
          result = { verdict: "wrong", correct: false, grade: GRADE.AGAIN, notes: [] };
        }
        const answerLine = el(doc, "p", "ex-answer");
        answerLine.append(exampleNode(doc, example));
        if (example.a) answerLine.append(" ", audioButton(doc, example.a, "Play the example", ctx.playAudio));
        return {
          result,
          lines: [],
          detail: { skill: "cz", example: example.t, answers: inputs.map((input) => input.value), verdict: result.verdict },
          after() {
            root.querySelector(".ex-feedback")?.prepend(answerLine);
            if (example.a) ctx.playAudio?.(example.a);
          }
        };
      },
      onGrade: (grade, detail) => ctx.onGrade?.(grade, detail)
    });
  }

  // ── which meaning #sd ───────────────────────────────────────────────────

  function renderSenseChoice(doc, container, card, ctx) {
    const lexicon = ctx.lexicon;
    const random = ctx.random || Math.random;
    // Options in one language: when the learner's language covers enough
    // senses, only those are used, so a French fallback can't stand out.
    const inLanguage = (sense) => Boolean(sense?.tr?.[ctx.language]?.length);
    const allTranslated = (lexicon.senses || []).filter((sense) => senseText(sense, ctx.language));
    const preferred = allTranslated.filter(inLanguage);
    const translated = preferred.length >= 3 ? preferred : allTranslated;
    const focused = senseList(lexicon, ctx.focus).filter((sense) => translated.includes(sense) && sense.ex?.length);
    const target = ctx.sense || pick(focused, random);
    const root = shell(doc, container, card, "Which meaning?");
    if (!target) {
      root.append(el(doc, "p", "ex-hint", "Not enough meanings with examples."));
      return controller({});
    }
    const example = ctx.example || pick(target.ex, random);
    const sentence = el(doc, "p", "ex-prompt ex-sentence");
    sentence.append(exampleNode(doc, example));
    if (example.a) sentence.append(" ", audioButton(doc, example.a, "Play the example", ctx.playAudio));
    root.append(sentence);
    root.append(el(doc, "p", "ex-hint", `What does ${lexicon.lemma} mean here?`));

    const seen = new Set([senseText(target, ctx.language)]);
    const distractors = [];
    for (const sense of shuffled(translated.filter((item) => item !== target), random)) {
      const text = senseText(sense, ctx.language);
      if (seen.has(text)) continue;
      seen.add(text);
      distractors.push(sense);
      if (distractors.length >= 3) break;
    }
    const options = shuffled([target, ...distractors], random);
    const list = el(doc, "div", "ex-choices ex-choices-list");
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", "Meanings");
    const state = {};
    options.forEach((sense, index) => {
      const choice = button(doc, "ex-choice ex-option", "", () => answer(sense));
      choice.dataset.sense = String(sense.n);
      choice.append(el(doc, "kbd", "ex-key", String(index + 1)), el(doc, "span", "ex-choice-text", senseText(sense, ctx.language)));
      list.append(choice);
    });
    root.append(list);

    function answer(sense) {
      if (state.feedback || state.destroyed) return;
      const correct = sense === target;
      for (const choice of list.querySelectorAll(".ex-option")) {
        choice.disabled = true;
        choice.classList.toggle("is-right", choice.dataset.sense === String(target.n));
        choice.classList.toggle("is-picked-wrong", !correct && choice.dataset.sense === String(sense.n));
      }
      const result = { correct, grade: correct ? GRADE.GOOD : GRADE.AGAIN, verdict: correct ? "exact" : "wrong" };
      state.feedback = feedback(doc, root, result, {
        lines: [`Meaning ${target.n}: ${senseText(target, ctx.language)}`],
        onDone: (grade, extra) => ctx.onGrade?.(grade, { skill: "sd", sense: target.n, picked: sense.n, correct, ...extra })
      });
    }

    return controller(state, (key) => {
      const index = Number(key) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= options.length) return false;
      answer(options[index]);
      return true;
    });
  }

  // ── produce #rev ────────────────────────────────────────────────────────

  // "d'Haus" or an article followed by a space ("de Mann"); "Deckel" is not "de ckel".
  const ARTICLE_PATTERN = /^(?:(d')|(den|de|déi|dat|deen|en|e|eng)\s+)(?=\S)/i;

  function renderProduce(doc, container, card, ctx) {
    const lexicon = ctx.lexicon;
    const sense = ctx.sense || pick(senseList(lexicon, ctx.focus).filter((item) => senseText(item, ctx.language)), ctx.random);
    const root = shell(doc, container, card, "Say it in Luxembourgish");
    const prompt = el(doc, "p", "ex-prompt");
    prompt.append(el(doc, "strong", "ex-word", senseText(sense, ctx.language)));
    root.append(prompt);
    const isNoun = Boolean(lexicon.gender);
    const forms = articles(lexicon.lemma, lexicon.gender);
    root.append(el(doc, "p", "ex-hint", isNoun ? "Noun: type it with its article (d'…, de/den …)." : String(lexicon.pos || "").toLowerCase()));
    const input = typedInput(doc, "Luxembourgish word");
    const expected = isNoun ? withArticle(forms.definite, lexicon.lemma) : lexicon.lemma;

    return typedExercise(doc, root, {
      inputs: [input],
      grade() {
        const typed = grader().normalizeAnswer(input.value, { aliases: Boolean(ctx.aliases) });
        if (!isNoun) {
          const result = grader().grade(typed, lexicon.lemma, { aliases: Boolean(ctx.aliases), nRule: lexicon.nRule ? { [lexicon.lemma]: lexicon.nRule } : {} });
          return { result, diff: result.verdict === "exact" ? null : result.diff, lines: [lexicon.lemma], detail: { skill: "rev", answer: input.value, verdict: result.verdict } };
        }
        const match = ARTICLE_PATTERN.exec(typed);
        const article = match ? (match[1] || match[2]).toLowerCase() : "";
        const word = match ? typed.slice(match[0].length) : typed;
        const result = grader().grade(word, lexicon.lemma, { noun: true, aliases: Boolean(ctx.aliases) });
        const definite = forms.definite;
        const articleRight = article === definite || (lexicon.gender === "m" && ["de", "den"].includes(article));
        let outcome = result;
        const lines = [`${expected} (${GENDER_LABEL[lexicon.gender]})`];
        if (result.correct && !articleRight) {
          outcome = { ...result, verdict: "accent", grade: GRADE.HARD, label: "Correct, check the article" };
          lines.push(article ? `The article is ${definite}, not ${article}.` : `Remember the article: ${expected}.`);
        }
        return {
          result: outcome,
          diff: result.verdict === "exact" && articleRight ? null : grader().diffChars(typed, expected),
          lines,
          detail: { skill: "rev", answer: input.value, verdict: outcome.verdict, articleRight }
        };
      },
      onGrade: (grade, detail) => ctx.onGrade?.(grade, detail)
    });
  }

  // ── meaning card (core) ─────────────────────────────────────────────────

  // Front and back content for the core card, from the lexicon when there is
  // one: the word with its article and gender, numbered senses with
  // clarifiers in brackets, and an example with the headword marked.
  function buildMeaningCard(doc, entry, lexicon, ctx = {}) {
    const front = el(doc, "div", "meaning-front");
    const back = el(doc, "div", "meaning-back");
    const lemma = lexicon?.lemma || entry?.word || "";
    const heading = el(doc, "h3", "meaning-word");
    if (lexicon?.gender) {
      heading.append(withArticle(articles(lemma, lexicon.gender).definite, lemma), " ");
      const chip = el(doc, "span", `gender-chip gender-${lexicon.gender}`, lexicon.gender);
      chip.title = GENDER_LABEL[lexicon.gender];
      chip.setAttribute("aria-label", GENDER_LABEL[lexicon.gender]);
      heading.append(chip);
    } else {
      heading.append(lemma);
    }
    front.append(heading);
    const grammar = [];
    if (lexicon?.noun?.plurals?.length) grammar.push(`Plural: ${lexicon.noun.plurals.join(", ")}`);
    if (lexicon?.noun?.noPlural) grammar.push("No plural");
    if (lexicon?.verb?.pp?.length) grammar.push(`Perfect: ${AUX_P3[lexicon.verb.aux] || lexicon.verb.aux || "?"} ${lexicon.verb.pp.join(" / ")}`);
    if (lexicon?.adj?.comp) grammar.push(`${lexicon.adj.comp}, ${lexicon.adj.sup}`);
    if (grammar.length) front.append(el(doc, "p", "meaning-grammar", grammar.join(" · ")));

    const senses = lexicon ? senseList(lexicon, ctx.focus).filter((sense) => senseText(sense, ctx.language)) : [];
    if (senses.length) {
      const list = el(doc, "ol", "meaning-senses");
      for (const sense of senses.slice(0, ctx.maxSenses || 4)) {
        const item = el(doc, "li", "meaning-sense");
        item.value = sense.n;
        if (sense.phrase) item.append(el(doc, "span", "meaning-phrase", `${sense.phrase}: `));
        item.append(senseText(sense, ctx.language));
        if (sense.gov) item.append(" ", el(doc, "span", "meaning-gov", sense.gov));
        list.append(item);
      }
      back.append(list);
      const more = (lexicon.senses.length - Math.min(senses.length, ctx.maxSenses || 4)) + (lexicon.moreSenses || 0);
      if (more > 0) back.append(el(doc, "p", "meaning-more", `+${more} more meaning${more === 1 ? "" : "s"} on LOD`));
      const exampleSense = senses.find((sense) => sense.ex?.length);
      if (exampleSense) {
        const example = exampleSense.ex[0];
        const quote = el(doc, "blockquote", "meaning-example");
        quote.append(exampleNode(doc, example));
        if (example.a) quote.append(" ", audioButton(doc, example.a, "Play the example", ctx.playAudio));
        back.append(quote);
      }
    } else if (entry) {
      back.append(el(doc, "p", "meaning-fallback", Object.values(entry.translations || {})[0] || ""));
    }
    return { front, back };
  }

  // ── leech panel ⚑ ───────────────────────────────────────────────────────

  // A dialog for a word that keeps slipping: write a mnemonic, see every
  // meaning and narrow the focus, or pause the word.
  function renderLeechPanel(doc, container, { entry, lexicon, lapses = 0, note = "", focus = [] }, actions = {}) {
    container.querySelector(".leech-panel")?.destroy?.();
    const previousFocus = doc.activeElement;
    container.replaceChildren();
    const dialog = el(doc, "section", "leech-panel");
    let closed = false;
    const finish = (callback, value) => {
      if (closed) return;
      closed = true;
      observer.disconnect();
      doc.removeEventListener("focusin", containFocus);
      dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
      callback?.(value);
    };
    const containFocus = (event) => {
      if (!closed && !dialog.contains(event.target)) noteBox.focus();
    };
    dialog.destroy = () => finish();
    const observer = new doc.defaultView.MutationObserver(() => {
      if (!dialog.isConnected) finish();
    });
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "leech-title");
    const title = el(doc, "h3", "leech-title");
    title.id = "leech-title";
    title.append(el(doc, "span", "leech-flag", "⚑"), ` ${lexicon?.lemma || entry?.word || ""} keeps slipping`);
    dialog.append(title);
    dialog.append(el(doc, "p", "leech-copy", `Forgotten ${lapses} times after you knew it. A fresh hook usually helps more than another review.`));

    const noteLabel = el(doc, "label", "leech-label", "Your mnemonic or note");
    const noteBox = el(doc, "textarea", "leech-note");
    noteBox.rows = 2;
    noteBox.value = note;
    noteBox.placeholder = "A picture, a rhyme or a sentence of your own";
    noteLabel.append(noteBox);
    dialog.append(noteLabel);

    const fieldset = el(doc, "fieldset", "leech-senses");
    fieldset.append(el(doc, "legend", "", "Study these meanings"));
    const chosen = new Set((cards()?.normalizeSenseFocus(focus) || focus).map(Number));
    for (const sense of lexicon?.senses || []) {
      const label = el(doc, "label", "leech-sense");
      const box = el(doc, "input");
      box.type = "checkbox";
      box.value = String(sense.n);
      box.checked = !chosen.size || chosen.has(sense.n);
      label.append(box, ` ${sense.n}. ${senseText(sense, actions.language) || "—"}`);
      fieldset.append(label);
    }
    dialog.append(fieldset);

    const row = el(doc, "div", "ex-actions leech-actions");
    const save = button(doc, "btn-primary", "Save", () => {
      const picked = [...fieldset.querySelectorAll("input:checked")].map((box) => Number(box.value));
      const all = (lexicon?.senses || []).length;
      if (!closed) actions.onSave?.({ note: noteBox.value.trim(), focus: picked.length === all ? [] : picked });
    });
    const suspend = button(doc, "btn-ghost leech-suspend", "Pause this word", () => { if (!closed) actions.onSuspend?.(); });
    const close = button(doc, "btn-ghost", "Close", () => finish(actions.onClose));
    row.append(save, suspend, close);
    dialog.append(row);
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(actions.onClose);
      } else if (event.key === "Tab") {
        const controls = [...dialog.querySelectorAll("button, input, textarea")].filter(node => !node.disabled);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    doc.addEventListener("focusin", containFocus);
    container.append(dialog);
    observer.observe(doc.body, { childList: true, subtree: true });
    noteBox.focus();
    return dialog;
  }

  // ── dispatcher ──────────────────────────────────────────────────────────

  const RENDERERS = Object.freeze({
    g: renderGender,
    pl: renderPlural,
    pp: renderPerfect,
    cz: renderCloze,
    sd: renderSenseChoice,
    rev: renderProduce
  });

  function render(doc, container, card, ctx = {}) {
    const renderer = RENDERERS[card?.skill];
    if (!renderer) throw new Error(`No exercise for skill "${card?.skill}".`);
    if (!ctx.lexicon) throw new Error("Skill cards need the word's lexicon.");
    return renderer(doc, container, card, ctx);
  }

  globalThis.LodVaultExercises = {
    GRADE,
    DEMONSTRATIVE,
    keepsFinalN,
    articles,
    articleLine,
    senseText,
    clozeCandidates,
    exampleNode,
    buildMeaningCard,
    renderLeechPanel,
    render,
    RENDERERS
  };
})();
