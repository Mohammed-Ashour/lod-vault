// Card registry: which flashcards exist for a word and which are due today.
//
// Every word has one core card (id = entry id, the meaning card). Words with a
// local lexicon (scripts/lexicon-store.js) can also have skill cards, id
// `${entryId}#${skill}`, each with its own schedule in the flashcard meta map.
// Skill cards unlock once the core card is reasonably known, never share a day
// with a sibling card of the same word, and can be switched off per skill.
//
// Pure functions only; the flashcards page and the badge feed it data. It reads
// scheduling fields through small adapters so it works with both the legacy
// interval schedule and the FSRS fields (srs, s, st, lapses, suspended, leech).
(() => {
  const SETTINGS_KEY = "lodVault.cardSkills";
  const UNLOCK_STABILITY_DAYS = 4;
  const LEECH_LAPSES = 6;
  const DEFAULT_SKILL_NEW_PER_DAY = 5;
  const SKILL_NEW_PER_DAY_OPTIONS = Object.freeze([0, 3, 5, 10]);
  const MAX_FOCUS_SENSES = 12;

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function examplesOf(senses) {
    return asArray(senses).flatMap((sense) => asArray(sense?.ex).map((example) => ({ sense, example })));
  }

  function hasTranslation(sense) {
    return Object.values(sense?.tr || {}).some((pairs) => asArray(pairs).some((pair) => pair?.[0]));
  }

  // Skill definitions. `applies` decides from the lexicon alone whether the
  // word has what the exercise needs; `enabled` is the default setting.
  const SKILLS = Object.freeze({
    g: {
      label: "Gender",
      description: "Pick deen, déi or dat for a noun.",
      enabled: true,
      applies: (lexicon) => Boolean(lexicon?.gender && lexicon?.noun)
    },
    pl: {
      label: "Plural",
      description: "Type the plural of a noun.",
      enabled: true,
      applies: (lexicon) => Boolean(lexicon?.noun && !lexicon.noun.noPlural && asArray(lexicon.noun.plurals).length)
    },
    pp: {
      label: "Perfect",
      description: "Choose hunn or sinn and type the past participle.",
      enabled: true,
      applies: (lexicon) => Boolean(["hunn", "sinn"].includes(lexicon?.verb?.aux) && asArray(lexicon?.verb?.pp).length)
    },
    cz: {
      label: "Cloze",
      description: "Fill the word into a LOD example sentence.",
      enabled: true,
      applies: (lexicon) => examplesOf(lexicon?.senses).some(({ example }) => asArray(example?.h).length)
    },
    sd: {
      label: "Which meaning?",
      description: "Match an example to the right meaning (words with 3+ meanings).",
      enabled: false,
      applies: (lexicon) => asArray(lexicon?.senses).filter(hasTranslation).length >= 3
        && asArray(lexicon?.senses).some((sense) => hasTranslation(sense) && asArray(sense.ex).length)
    },
    rev: {
      label: "Produce",
      description: "See a meaning and type the Luxembourgish word.",
      enabled: false,
      applies: (lexicon) => asArray(lexicon?.senses).some(hasTranslation)
    }
  });
  const SKILL_IDS = Object.freeze(Object.keys(SKILLS));

  // ── ids ─────────────────────────────────────────────────────────────────

  // Same as LodVaultStoreCore.baseCardId (study/p1-fixes); kept here so the
  // registry also works before that lands.
  function baseCardId(id) {
    const shared = globalThis.LodVaultStoreCore?.baseCardId;
    if (typeof shared === "function") return shared(id);
    const text = String(id ?? "");
    const hash = text.indexOf("#");
    return hash === -1 ? text : text.slice(0, hash);
  }

  function cardId(entryId, skill = "") {
    const base = baseCardId(entryId);
    return skill ? `${base}#${skill}` : base;
  }

  function parseCardId(id) {
    const text = String(id ?? "");
    const entryId = baseCardId(text);
    const skill = text.length > entryId.length ? text.slice(entryId.length + 1) : "";
    return { id: text, entryId, skill, core: !skill };
  }

  // ── settings ────────────────────────────────────────────────────────────

  function defaultSettings() {
    return {
      skills: Object.fromEntries(SKILL_IDS.map((skill) => [skill, SKILLS[skill].enabled])),
      skillNewPerDay: DEFAULT_SKILL_NEW_PER_DAY
    };
  }

  function normalizeSettings(value = {}) {
    const defaults = defaultSettings();
    const source = value && typeof value === "object" ? value : {};
    const skills = { ...defaults.skills };
    for (const skill of SKILL_IDS) {
      if (typeof source.skills?.[skill] === "boolean") skills[skill] = source.skills[skill];
    }
    const perDay = Number(source.skillNewPerDay);
    return {
      skills,
      skillNewPerDay: SKILL_NEW_PER_DAY_OPTIONS.includes(perDay) ? perDay : defaults.skillNewPerDay
    };
  }

  // ── scheduling adapters ─────────────────────────────────────────────────

  // Stability in days. FSRS cards carry it as `s`; a legacy card's scheduled
  // interval is the closest stand-in.
  function stabilityDays(meta) {
    if (!meta || typeof meta !== "object") return 0;
    const s = Number(meta.s);
    if (meta.srs && Number.isFinite(s)) return Math.max(0, s);
    return Math.max(0, Number(meta.interval) || 0);
  }

  // Lapses: FSRS counts them; for a legacy log, an Again after a passed
  // review is one.
  function lapseCount(meta) {
    if (!meta || typeof meta !== "object") return 0;
    if (meta.lapses !== undefined && Number.isFinite(Number(meta.lapses))) {
      return Math.max(0, Number(meta.lapses) || 0);
    }
    let lapses = 0;
    let passed = false;
    for (const review of asArray(meta.reviews)) {
      const grade = Number(review?.grade);
      const failed = Number.isFinite(grade) ? grade === 1 : Number(review?.rating) === 1;
      if (failed && passed) lapses += 1;
      passed = !failed;
    }
    return lapses;
  }

  function isLeech(meta) {
    return Boolean(meta?.leech) || lapseCount(meta) >= LEECH_LAPSES;
  }

  function isSuspended(meta) {
    return Boolean(meta?.suspended);
  }

  function isSkillUnlocked(coreMeta) {
    return stabilityDays(coreMeta) >= UNLOCK_STABILITY_DAYS;
  }

  function localDayStart(date, offsetDays = 0) {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + offsetDays);
    return day;
  }

  function isDue(meta, now) {
    const shared = globalThis.LodVaultStoreCore?.isFlashcardDue;
    if (typeof shared === "function") return shared(meta, now);
    const dueTime = Date.parse(meta?.dueAt || "");
    if (!Number.isFinite(dueTime)) return Boolean(Number(meta?.totalReviews));
    return dueTime < localDayStart(now, 1).getTime();
  }

  function reviewedOn(meta, now) {
    const start = localDayStart(now).getTime();
    const end = localDayStart(now, 1).getTime();
    return asArray(meta?.reviews).some((review) => {
      const time = Date.parse(review?.date || "");
      return time >= start && time < end;
    });
  }

  function firstReviewedOn(meta, now) {
    const reviews = asArray(meta?.reviews);
    const total = Number(meta?.totalReviews) || reviews.length;
    if (!reviews.length || total > reviews.length) return false;
    const time = Date.parse(reviews[reviews.length - total]?.date || "");
    return time >= localDayStart(now).getTime() && time < localDayStart(now, 1).getTime();
  }

  // In-session learning (FSRS states 1 learning / 3 relearning) keeps its own
  // card going even though the word was studied today.
  function isLearning(meta) {
    return meta?.st === 1 || meta?.st === 3;
  }

  // ── cards ───────────────────────────────────────────────────────────────

  function skillCardsFor(entry, lexicon, meta = {}, settings = defaultSettings()) {
    const normalized = normalizeSettings(settings);
    if (!entry?.id || !lexicon) return [];
    const coreMeta = meta[cardId(entry.id)];
    if (isSuspended(coreMeta) || !isSkillUnlocked(coreMeta)) return [];
    return SKILL_IDS
      .filter((skill) => normalized.skills[skill] && SKILLS[skill].applies(lexicon))
      .map((skill) => ({ id: cardId(entry.id, skill), entryId: entry.id, skill, entry }))
      .filter((card) => !isSuspended(meta[card.id]));
  }

  // Skill cards for today, to follow the core queue from buildTodayQueue.
  //   entries: Study-list entries; lexicons: {entryId: record}; meta: card meta map
  //   options.coreQueue: buildTodayQueue's result (its due/new words take the day)
  // A word gives at most one card a day: if any of its cards was reviewed today
  // or its core card is in today's queue, its other cards are buried until
  // tomorrow. New skill cards are capped by settings.skillNewPerDay.
  function buildSkillQueue(entries = [], meta = {}, lexicons = {}, options = {}) {
    const now = options.now || new Date();
    const settings = normalizeSettings(options.settings);
    const core = options.coreQueue || {};
    const coreToday = new Set([
      ...asArray(core.dueEntries),
      ...asArray(core.newEntries),
      ...asArray(core.learning)
    ].map((item) => baseCardId(item?.id ?? item)));

    const studiedToday = new Set();
    let newSkillToday = 0;
    for (const [id, card] of Object.entries(meta || {})) {
      if (!reviewedOn(card, now)) continue;
      studiedToday.add(baseCardId(id));
      if (!parseCardId(id).core && firstReviewedOn(card, now)) newSkillToday += 1;
    }

    const due = [];
    const fresh = [];
    const learning = [];
    const buried = [];
    for (const entry of entries) {
      if (!entry?.study) continue;
      const cards = skillCardsFor(entry, lexicons[entry.id], meta, settings);
      if (!cards.length) continue;
      const taken = coreToday.has(entry.id) || studiedToday.has(entry.id);
      const candidates = [];
      for (const card of cards) {
        const cardMeta = meta[card.id];
        if (cardMeta && Number(cardMeta.totalReviews)) {
          if (!isDue(cardMeta, now)) continue;
          if (isLearning(cardMeta) && reviewedOn(cardMeta, now)) {
            learning.push(card);
            continue;
          }
          candidates.push({ card, due: Date.parse(cardMeta.dueAt || "") || 0, fresh: false });
        } else {
          candidates.push({ card, due: Infinity, fresh: true });
        }
      }
      if (!candidates.length) continue;
      if (taken) {
        buried.push(...candidates.map(({ card }) => card.id));
        continue;
      }
      // Due cards first, most overdue first; otherwise the first new skill in
      // registry order.
      candidates.sort((left, right) => left.due - right.due);
      const [chosen, ...rest] = candidates;
      buried.push(...rest.map(({ card }) => card.id));
      (chosen.fresh ? fresh : due).push({ ...chosen.card, dueTime: chosen.due });
    }

    due.sort((left, right) => left.dueTime - right.dueTime || left.id.localeCompare(right.id));
    const newSlots = Math.max(0, settings.skillNewPerDay - newSkillToday);
    const newCards = fresh.slice(0, newSlots);
    return {
      learning,
      due: due.map(({ dueTime, ...card }) => card),
      fresh: newCards,
      buried,
      newSkillToday,
      skillNewLimit: settings.skillNewPerDay,
      count: learning.length + due.length + newCards.length
    };
  }

  // Joins the core queue and the skill queue into one ordered list of
  // {id, entryId, skill, entry}: learning, core due, skill due, core new,
  // skill new. Stands in for buildTodayQueue's planned `cards` option.
  function mergeTodayQueue(coreQueue = {}, skillQueue = {}) {
    const asCard = (entry) => ({ id: cardId(entry.id), entryId: entry.id, skill: "", entry });
    const queue = [
      ...asArray(coreQueue.learning).map((item) => (item?.entryId ? item : asCard(item))),
      ...asArray(skillQueue.learning),
      ...asArray(coreQueue.dueEntries).map(asCard),
      ...asArray(skillQueue.due),
      ...asArray(coreQueue.newEntries).map(asCard),
      ...asArray(skillQueue.fresh)
    ];
    const seen = new Set();
    return queue.filter((card) => !seen.has(card.id) && seen.add(card.id));
  }

  // ── multiple choice ─────────────────────────────────────────────────────

  function posGroup(entry, lexicon) {
    const label = String(lexicon?.pos || entry?.pos || "").toUpperCase();
    return label.split(/[+\s]/)[0];
  }

  // Up to `count` distractors from `pool`, same part of speech first so the
  // answer can't be spotted by its form. `textOf` maps a candidate to its
  // option text; empty or duplicate texts are skipped.
  function pickDistractors(target, pool = [], options = {}) {
    const count = Number.isInteger(options.count) ? options.count : 3;
    const lexicons = options.lexicons || {};
    const textOf = typeof options.textOf === "function" ? options.textOf : (candidate) => candidate?.word;
    const random = typeof options.random === "function" ? options.random : Math.random;
    const targetGroup = posGroup(target, lexicons[target?.id]);
    const seen = new Set([String(textOf(target) ?? "")]);
    const shuffled = [...pool]
      .filter((candidate) => candidate && candidate.id !== target?.id)
      .map((candidate) => ({ candidate, key: random() }))
      .sort((left, right) => left.key - right.key)
      .map(({ candidate }) => candidate);
    const same = shuffled.filter((candidate) => targetGroup && posGroup(candidate, lexicons[candidate.id]) === targetGroup);
    const other = shuffled.filter((candidate) => !same.includes(candidate));
    const picked = [];
    for (const candidate of [...same, ...other]) {
      if (picked.length >= count) break;
      const text = String(textOf(candidate) ?? "").trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      picked.push(candidate);
    }
    return picked;
  }

  // ── sense focus ─────────────────────────────────────────────────────────

  // `fs` in a core card's meta: the sense numbers the learner wants to study.
  function normalizeSenseFocus(value) {
    const numbers = asArray(value)
      .map(Number)
      .filter((number) => Number.isInteger(number) && number > 0 && number < 1000);
    return [...new Set(numbers)].sort((left, right) => left - right).slice(0, MAX_FOCUS_SENSES);
  }

  function focusedSenses(lexicon, focus) {
    const senses = asArray(lexicon?.senses);
    const numbers = normalizeSenseFocus(focus);
    if (!numbers.length) return senses;
    const picked = senses.filter((sense) => numbers.includes(sense.n));
    return picked.length ? picked : senses;
  }

  // ── sync priority ───────────────────────────────────────────────────────

  // Order for the sync progress budget: core cards before skill cards, each
  // group most recently reviewed first, so skill cards never crowd out a
  // word's main schedule.
  function compareSyncPriority(meta = {}) {
    const lastTime = (id) => Date.parse(meta[id]?.lastReviewedAt || "") || 0;
    return (left, right) => {
      const leftCore = parseCardId(left).core ? 0 : 1;
      const rightCore = parseCardId(right).core ? 0 : 1;
      return leftCore - rightCore || lastTime(right) - lastTime(left) || String(left).localeCompare(String(right));
    };
  }

  globalThis.LodVaultCards = {
    SETTINGS_KEY,
    SKILLS,
    SKILL_IDS,
    UNLOCK_STABILITY_DAYS,
    LEECH_LAPSES,
    DEFAULT_SKILL_NEW_PER_DAY,
    SKILL_NEW_PER_DAY_OPTIONS,
    baseCardId,
    cardId,
    parseCardId,
    defaultSettings,
    normalizeSettings,
    stabilityDays,
    lapseCount,
    isLeech,
    isSuspended,
    isSkillUnlocked,
    skillCardsFor,
    buildSkillQueue,
    mergeTodayQueue,
    posGroup,
    pickDistractors,
    normalizeSenseFocus,
    focusedSenses,
    compareSyncPriority
  };
})();
