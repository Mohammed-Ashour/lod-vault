const state = {
  entries: [],
  deck: [],
  filter: "today",
  revealed: false,
  ratingInProgress: false,
  index: 0,
  orderMode: "smart",
  direction: "fwd",
  mode: "self",
  sessionSize: "all",
  sessionActive: false,
  sessionCards: [],
  sessionIndex: 0,
  sessionResults: [],
  resumableSession: null,
  dailyTarget: 10,
  flashcardMeta: {},
  stats: { streak: 0, todayCount: 0, dueCount: 0, newCount: 0, learningCount: 0, masteredCount: 0 }
};

const FLASHCARD_SETTINGS_KEY = LodVaultStore.FLASHCARD_SETTINGS_KEY;
const FLASHCARD_SESSION_KEY = "lodVault.flashcardSession";
const DECK_FILTERS = new Set(["today", "due", "study", "favorites", "all"]);
const ORDER_MODES = new Set(["smart", "shuffle", "sequential"]);
const STUDY_MODES = new Set(["self", "mc", "listening"]);
const DECK_LABELS = { today: "Today", due: "Due today", study: "Study list", favorites: "Favorites", all: "All saved" };
const elements = {};
let listeningKey = null;
let audioController;
let audioFailed = false;

function stopCardAudio() {
  audioController?.stopAll();
  listeningKey = null;
  audioFailed = false;
}

function playCardAudio(button = elements.cardAudio) {
  const entry = currentEntry();
  if (!entry) return;
  audioFailed = false;
  button?.classList.remove("is-error");
  if (state.mode === "listening") {
    // Listening promises replay, rather than the shared controller's play/pause toggle.
    audioController?.stopAll();
    if (elements.cardHint) {
      elements.cardHint.textContent = "Listen, then Reveal to see the word and translation. Press P to replay.";
    }
  }
  LodVaultStore.playLodAudio?.(entry, { controller: audioController, button });
}

document.addEventListener("DOMContentLoaded", async () => {
  elements.deckStatus = document.getElementById("deck-status");
  elements.deckFilter = document.getElementById("deck-filter");
  elements.orderMode = document.getElementById("order-mode");
  elements.sessionSize = document.getElementById("session-size");
  elements.dailyTarget = document.getElementById("daily-target");
  elements.directionToggle = document.getElementById("direction-toggle");
  elements.modeSelect = document.getElementById("mode-select");
  elements.mcOptions = document.getElementById("mc-options");
  elements.cardHint = document.getElementById("card-hint");
  elements.emptyState = document.getElementById("empty-state");
  elements.emptyTitle = document.getElementById("empty-title");
  elements.emptyMessage = document.getElementById("empty-message");
  elements.emptyStudyList = document.getElementById("empty-study-list");
  elements.shortcutHint = document.getElementById("shortcut-hint");
  elements.cardShell = document.getElementById("card-shell");
  elements.progress = document.getElementById("progress");
  elements.sessionProgress = document.getElementById("session-progress");
  elements.dailyProgress = document.getElementById("daily-progress");
  elements.resumeSession = document.getElementById("resume-session");
  elements.resumeSessionLabel = document.getElementById("resume-session-label");
  elements.resumeSessionButton = document.getElementById("resume-session-button");
  elements.dismissSessionButton = document.getElementById("dismiss-session-button");
  elements.flashcard = document.getElementById("flashcard");
  elements.cardWord = document.getElementById("card-word");
  elements.cardAudio = document.getElementById("card-audio");
  audioController = LodVaultStore.createAudioController?.(document, {
    onError() {
      audioFailed = true;
      if (state.mode === "listening" && elements.cardHint) {
        elements.cardHint.textContent = "Audio unavailable. Try Play pronunciation again, reveal the answer, or skip this card.";
      }
    }
  });
  elements.cardType = document.getElementById("card-type");
  elements.cardAnswer = document.getElementById("card-answer");
  elements.prevCard = document.getElementById("prev-card");
  elements.flipCard = document.getElementById("flip-card");
  elements.nextCard = document.getElementById("next-card");
  elements.ratingBar = document.getElementById("rating-bar");
  elements.summaryOverlay = document.getElementById("summary-overlay");
  elements.summaryTotal = document.getElementById("summary-total");
  elements.summaryHard = document.getElementById("summary-hard");
  elements.summaryGood = document.getElementById("summary-good");
  elements.summaryEasy = document.getElementById("summary-easy");
  elements.openPreview = document.getElementById("open-preview");
  elements.closeSummary = document.getElementById("close-summary");
  elements.statStreak = document.getElementById("stat-streak");
  elements.statToday = document.getElementById("stat-today");
  elements.statDue = document.getElementById("stat-due");
  elements.statNew = document.getElementById("stat-new");
  elements.statLearning = document.getElementById("stat-learning");
  elements.statMastered = document.getElementById("stat-mastered");

  elements.deckFilter?.addEventListener("change", onDeckFilterChange);
  elements.orderMode?.addEventListener("change", onOrderModeChange);
  elements.sessionSize?.addEventListener("change", onSessionSizeChange);
  elements.dailyTarget?.addEventListener("change", onDailyTargetChange);
  elements.directionToggle?.addEventListener("click", toggleDirection);
  elements.modeSelect?.addEventListener("change", onModeChange);
  elements.mcOptions?.addEventListener("click", onMcOptionClick);
  elements.resumeSessionButton?.addEventListener("click", resumeSession);
  elements.dismissSessionButton?.addEventListener("click", dismissResumableSession);
  elements.flashcard?.addEventListener("click", onFlashcardClick);
  elements.flipCard?.addEventListener("click", toggleReveal);
  elements.cardAudio?.addEventListener("click", onAudioClick);
  elements.prevCard?.addEventListener("click", showPrevious);
  elements.nextCard?.addEventListener("click", showNext);
  elements.ratingBar?.addEventListener("click", onRatingClick);
  elements.closeSummary?.addEventListener("click", closeSummary);
  elements.emptyStudyList?.addEventListener("click", openStudyList);
  document.addEventListener("keydown", onKeyDown);
  elements.openPreview?.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("pages/preview.html") });
  });
  chrome.storage?.onChanged?.addListener?.(handleStorageChange);
  // The synced streak (see activity.js) replaces the one from this device's log.
  globalThis.LodVaultActivity?.watchStreak?.((info) => {
    state.activityStreak = info.streak;
    renderStats();
  });

  await Promise.all([loadEntries(), loadFlashcardMeta(), loadFlashcardState()]);
  await attachCustomDecks();
  chooseInitialDeck();
  computeStats();
  renderStats();
  renderResumeSession();
  rebuildDeck();
}, { once: true });

window.addEventListener("pagehide", () => {
  stopCardAudio();
  document.removeEventListener("keydown", onKeyDown);
  chrome.storage?.onChanged?.removeListener?.(handleStorageChange);
});

async function loadEntries() {
  state.entries = await LodVaultStore.getEntries();
}

function todayQueue() {
  return LodVaultStore.buildTodayQueue(state.entries, state.flashcardMeta, {
    dailyTarget: state.dailyTarget
  });
}

function chooseInitialDeck() {
  // Today is the default; a vault with nothing to feed it falls back to a deck
  // that has cards. Deep links can request a specific deck and win over both.
  if (!state.entries.some((entry) => entry.study) && !todayQueue().queue.length) {
    state.filter = state.entries.some((entry) => entry.favorite) ? "favorites" : "all";
  }

  const urlDeck = new URLSearchParams(location.search).get("deck");
  if (urlDeck && isKnownDeck(urlDeck)) {
    state.filter = urlDeck;
  }

  if (elements.deckFilter) {
    elements.deckFilter.value = state.filter;
  }
}

async function loadFlashcardMeta() {
  if (typeof LodVaultStore.getFlashcardMeta !== "function") {
    state.flashcardMeta = {};
    return;
  }
  state.flashcardMeta = await LodVaultStore.getFlashcardMeta();
}

async function loadFlashcardState() {
  const local = chrome.storage?.local;
  if (!local) return;

  const saved = await local.get([FLASHCARD_SETTINGS_KEY, FLASHCARD_SESSION_KEY]);
  state.dailyTarget = LodVaultStore.normalizeFlashcardDailyTarget(saved[FLASHCARD_SETTINGS_KEY]);
  state.resumableSession = saved[FLASHCARD_SESSION_KEY] || null;
  state.mode = STUDY_MODES.has(saved[FLASHCARD_SETTINGS_KEY]?.mode) ? saved[FLASHCARD_SETTINGS_KEY].mode : "self";
  if (elements.dailyTarget) elements.dailyTarget.value = state.dailyTarget ? String(state.dailyTarget) : "off";
  if (elements.modeSelect) elements.modeSelect.value = state.mode;
}

async function saveSettings() {
  const local = chrome.storage?.local;
  if (local) await local.set({ [FLASHCARD_SETTINGS_KEY]: { dailyTarget: state.dailyTarget || null, mode: state.mode } });
}

async function saveSession() {
  const local = chrome.storage?.local;
  // Today is rebuilt from the schedule on every visit, so it has nothing to resume.
  if (!local || !state.sessionActive || state.filter === "today") return;
  await local.set({
    [FLASHCARD_SESSION_KEY]: {
      filter: state.filter,
      orderMode: state.orderMode,
      direction: state.direction,
      mode: state.mode,
      sessionSize: state.sessionSize,
      cardIds: state.sessionCards.map((entry) => entry.id),
      index: state.sessionIndex,
      results: state.sessionResults
    }
  });
}

async function clearSavedSession() {
  const local = chrome.storage?.local;
  if (local) await local.remove(FLASHCARD_SESSION_KEY);
}

function renderResumeSession() {
  const saved = state.resumableSession;
  const remaining = saved?.cardIds?.length - Number(saved?.index || 0);
  const canResume = Array.isArray(saved?.cardIds) && remaining > 0;
  elements.resumeSession?.classList.toggle("is-hidden", !canResume);
  if (canResume && elements.resumeSessionLabel) {
    elements.resumeSessionLabel.textContent = `Resume: ${remaining} card${remaining === 1 ? "" : "s"} remaining`;
  }
}

async function resumeSession() {
  const saved = state.resumableSession;
  if (!Array.isArray(saved?.cardIds)) return;

  const cards = saved.cardIds.map((id) => state.entries.find((entry) => entry.id === id)).filter(Boolean);
  const index = Math.max(0, Math.min(Number(saved.index) || 0, cards.length - 1));
  if (!cards.length || index >= cards.length) {
    await dismissResumableSession();
    return;
  }

  stopCardAudio();
  state.filter = isKnownDeck(saved.filter) ? saved.filter : state.filter;
  state.orderMode = ORDER_MODES.has(saved.orderMode) ? saved.orderMode : state.orderMode;
  state.direction = saved.direction === "rev" ? "rev" : "fwd";
  state.mode = STUDY_MODES.has(saved.mode) ? saved.mode : "self";
  state.sessionSize = String(saved.sessionSize || cards.length);
  state.sessionCards = cards;
  state.sessionIndex = index;
  state.sessionResults = Array.isArray(saved.results) ? saved.results : [];
  state.sessionActive = true;
  state.deck = cards;
  state.index = index;
  state.revealed = false;
  state.resumableSession = null;

  if (elements.deckFilter) elements.deckFilter.value = state.filter;
  if (elements.orderMode) elements.orderMode.value = state.orderMode;
  if (elements.sessionSize) elements.sessionSize.value = state.sessionSize;
  if (elements.directionToggle) {
    elements.directionToggle.textContent = state.direction === "fwd" ? "Lux → EN" : "EN → Lux";
    elements.directionToggle.classList.toggle("is-active", state.direction === "rev");
  }
  if (elements.modeSelect) elements.modeSelect.value = state.mode;
  renderResumeSession();
  renderDeck();
  await saveSession();
}

async function dismissResumableSession() {
  state.resumableSession = null;
  renderResumeSession();
  await clearSavedSession();
}

const normalizeFlashcardMeta = LodVaultStore.normalizeFlashcardMeta;
const computeStreak = LodVaultStore.computeFlashcardStreak;

function computeStats() {
  const meta = state.flashcardMeta;
  const todayKey = LodVaultStore.toLocalDateKey();
  let todayCount = 0;
  let dueCount = 0;
  let newCount = 0;
  let learningCount = 0;
  let masteredCount = 0;
  const reviewDates = new Set();
  // Review data outlives a deleted word (so Undo keeps its progress). Past
  // reviews still count toward today and the streak, but only saved words
  // count as learning or mastered.
  const savedIds = new Set(state.entries.map((entry) => entry.id));

  for (const [id, data] of Object.entries(meta)) {
    const m = normalizeFlashcardMeta(data);
    if (!m.totalReviews) continue;

    const dateSet = new Set(m.reviews.map((r) => LodVaultStore.toLocalDateKey(r.date)));
    for (const d of dateSet) reviewDates.add(d);

    const last = m.reviews[m.reviews.length - 1];
    todayCount += m.reviews.filter((review) => LodVaultStore.toLocalDateKey(review.date) === todayKey).length;

    if (!savedIds.has(id)) continue;
    if (m.easyCount >= 3 && last && last.rating === 3) {
      masteredCount += 1;
    } else {
      learningCount += 1;
    }
  }

  const now = new Date();
  for (const entry of state.entries) {
    const m = meta[entry.id];
    if (entry.study && (!m || !m.totalReviews)) {
      newCount += 1;
    }
    if (isDue(entry, now)) {
      dueCount += 1;
    }
  }

  const sortedDates = Array.from(reviewDates).sort().reverse();
  const streak = computeStreak(sortedDates);

  state.stats = { streak, todayCount, dueCount, newCount, learningCount, masteredCount };
}

function renderStats() {
  if (elements.statStreak) elements.statStreak.textContent = state.activityStreak ?? state.stats.streak;
  if (elements.statToday) elements.statToday.textContent = state.stats.todayCount;
  if (elements.dailyProgress) {
    const complete = state.dailyTarget && state.stats.todayCount >= state.dailyTarget;
    elements.dailyProgress.textContent = state.dailyTarget
      ? complete
        ? `Daily target complete · ${state.dailyTarget} / ${state.dailyTarget} today`
        : `${state.stats.todayCount} / ${state.dailyTarget} today`
      : "Daily target off";
    elements.dailyProgress.classList.toggle("is-complete", Boolean(complete));
  }
  if (elements.statDue) elements.statDue.textContent = state.stats.dueCount;
  if (elements.statNew) elements.statNew.textContent = state.stats.newCount;
  if (elements.statLearning) elements.statLearning.textContent = state.stats.learningCount;
  if (elements.statMastered) elements.statMastered.textContent = state.stats.masteredCount;
}

async function onDeckFilterChange(event) {
  state.filter = event.target.value;
  state.index = 0;
  state.revealed = false;
  endSession();
  await dismissResumableSession();
  rebuildDeck();
}

async function onOrderModeChange(event) {
  state.orderMode = event.target.value;
  state.index = 0;
  state.revealed = false;
  endSession();
  await dismissResumableSession();
  rebuildDeck();
}

async function onSessionSizeChange(event) {
  state.sessionSize = event.target.value;
  state.index = 0;
  state.revealed = false;
  endSession();
  await dismissResumableSession();
  rebuildDeck();
}

async function onDailyTargetChange(event) {
  const target = Number(event.target.value);
  state.dailyTarget = LodVaultStore.FLASHCARD_DAILY_TARGETS.includes(target) ? target : 0;
  await saveSettings();
  renderStats();
  if (state.filter === "today" && !state.sessionResults.length) rebuildDeck();
}

function onModeChange(event) {
  stopCardAudio();
  state.mode = STUDY_MODES.has(event.target.value) ? event.target.value : "self";
  state.revealed = false;
  void saveSettings();
  renderDeck();
  if (state.sessionActive) void saveSession();
}

async function handleStorageChange(changes, areaName) {
  if (areaName !== "local") return;
  const entryKey = LodVaultStore.STORAGE_KEY;
  const legacyKey = LodVaultStore.LEGACY_STORAGE_KEY;
  const metaKey = LodVaultStore.FLASHCARD_META_KEY;
  if (!changes?.[entryKey] && !changes?.[legacyKey] && !changes?.[metaKey]) return;
  await loadEntries();
  await loadFlashcardMeta();
  await attachCustomDecks();
  computeStats();
  renderStats();
  // A finished session stays on its summary until the learner closes it.
  if (elements.summaryOverlay && !elements.summaryOverlay.classList.contains("is-hidden")) return;
  if (state.sessionActive) {
    renderDeck();
  } else {
    rebuildDeck({ preserveAudio: true });
  }
}

function toggleDirection() {
  if (state.mode === "listening") return;
  state.direction = state.direction === "fwd" ? "rev" : "fwd";
  if (elements.directionToggle) {
    elements.directionToggle.textContent = state.direction === "fwd" ? "Lux → EN" : "EN → Lux";
    elements.directionToggle.classList.toggle("is-active", state.direction === "rev");
  }
  state.revealed = false;
  renderDeck();
  if (state.sessionActive) void saveSession();
}

function onKeyDown(event) {
  if (
    event.key === "Escape"
    && elements.summaryOverlay
    && !elements.summaryOverlay.classList.contains("is-hidden")
  ) {
    event.preventDefault();
    closeSummary();
    return;
  }

  const target = event.target;
  if (
    target?.closest?.("button, a, summary")
    || target?.tagName === "SELECT"
    || target?.tagName === "INPUT"
    || target?.tagName === "TEXTAREA"
    || target?.isContentEditable
  ) {
    return;
  }

  if (!state.deck.length) return;

  if (event.key === "ArrowRight") {
    showNext();
  } else if (event.key === "ArrowLeft") {
    showPrevious();
  } else if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    toggleReveal();
  } else if (state.mode === "mc" && event.key >= "1" && event.key <= "4") {
    elements.mcOptions?.querySelectorAll("button")[Number(event.key) - 1]?.click();
  } else if (event.key === "1") {
    rateCard(1);
  } else if (event.key === "2") {
    rateCard(2);
  } else if (event.key === "3") {
    rateCard(3);
  } else if (state.mode === "listening" && (event.key === "p" || event.key === "P")) {
    playCardAudio();
  } else if (event.key === "r" || event.key === "R") {
    toggleDirection();
  }
}

function isDue(entry, now = new Date()) {
  return LodVaultStore.isFlashcardDue(state.flashcardMeta[entry?.id], now);
}

function makeDeck(entries) {
  let base = [];
  if (state.filter === "today") {
    // The queue is already in study order: due cards before new words.
    const { queue } = todayQueue();
    return state.orderMode === "shuffle" ? shuffle(queue) : queue;
  }
  if (state.filter === "due") {
    base = entries.filter((entry) => isDue(entry));
  } else if (state.filter === "study") {
    base = entries.filter((entry) => entry.study);
  } else if (state.filter === "favorites") {
    base = entries.filter((entry) => entry.favorite);
  } else if (isCustomDeck(state.filter)) {
    base = globalThis.LodVaultDecks.filterEntries(state.filter, entries, state.flashcardMeta);
  } else {
    base = [...entries];
  }

  if (state.orderMode === "smart") {
    return sortSmart(base);
  }
  if (state.orderMode === "shuffle") {
    return shuffle(base);
  }
  return base;
}

function sortSmart(entries) {
  const scored = entries.map((entry) => ({
    entry,
    priority: getCardPriority(entry)
  }));
  scored.sort((a, b) => b.priority - a.priority);
  return scored.map((s) => s.entry);
}

function getCardPriority(entry) {
  const meta = state.flashcardMeta[entry.id];
  if (!meta || !meta.totalReviews) return 100;

  const now = Date.now();
  const lastReviewed = meta.lastReviewedAt ? new Date(meta.lastReviewedAt).getTime() : 0;
  const hoursSince = lastReviewed ? (now - lastReviewed) / 3600000 : 9999;

  const lastRating = meta.reviews.length ? meta.reviews[meta.reviews.length - 1].rating : 2;
  if (lastRating === 1) return 90;

  const dueAt = meta.dueAt ? new Date(meta.dueAt).getTime() : 0;
  if (dueAt && now >= dueAt) {
    return 70 + Math.min(20, (now - dueAt) / 86400000);
  }

  if (hoursSince > 1) {
    return 30 + Math.min(20, hoursSince / 24);
  }

  return -10;
}

function shuffle(entries) {
  const deck = [...entries];
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

function rebuildDeck({ preserveAudio = false } = {}) {
  // Storage echoes must not interrupt the same card. renderDeck still switches
  // playback if the refreshed deck changes the current entry or position.
  if (!preserveAudio) stopCardAudio();
  const baseDeck = makeDeck(state.entries);
  const size = state.sessionSize === "all" ? baseDeck.length : Number(state.sessionSize);
  state.sessionCards = baseDeck.slice(0, Math.min(size, baseDeck.length));
  state.sessionActive = state.sessionCards.length > 0 && (state.sessionSize !== "all" || state.filter === "today");
  state.sessionIndex = 0;
  state.sessionResults = [];
  state.deck = state.sessionActive ? state.sessionCards : baseDeck;
  if (state.sessionActive) void saveSession();
  // A session always starts at its first card, whatever the last one reached.
  state.index = state.sessionActive ? 0 : Math.min(state.index, Math.max(state.deck.length - 1, 0));
  state.revealed = false;
  renderDeck();
}

function currentEntry() {
  return state.deck[state.index] || null;
}

function onAudioClick(event) {
  event.stopPropagation();
  const entry = currentEntry();
  if (entry) playCardAudio(event.currentTarget);
}

function onFlashcardClick(event) {
  const audioBtn = event.target.closest(".audio-btn");
  if (audioBtn) {
    event.stopPropagation();
    const entry = currentEntry();
    if (entry) playCardAudio(audioBtn);
    return;
  }
  toggleReveal();
}

function renderDeck() {
  const entry = currentEntry();
  const count = state.deck.length;
  const listening = state.mode === "listening";
  elements.cardShell?.classList.toggle("is-listening", listening);
  // Keep listening instructions outside the icon-only front face.
  if (elements.cardHint) {
    if (listening) elements.flashcard?.after(elements.cardHint);
    else elements.flashcard?.querySelector(".card-front")?.append(elements.cardHint);
  }
  // Include the session position so a one-card retry also plays afresh.
  const nextListeningKey = listening && entry
    ? `${entry.id}:${state.sessionActive ? state.sessionIndex : state.index}` : null;
  const shouldPlay = nextListeningKey !== null && nextListeningKey !== listeningKey;
  if (nextListeningKey !== listeningKey) stopCardAudio();
  listeningKey = nextListeningKey;
  if (elements.directionToggle) elements.directionToggle.disabled = listening;

  if (elements.deckStatus) {
    const deckLabel = DECK_LABELS[state.filter] || globalThis.LodVaultDecks?.labelFor?.(state.filter) || "Deck";
    elements.deckStatus.textContent = count
      ? `${deckLabel} · ${count} card${count === 1 ? "" : "s"} in this deck`
      : `${deckLabel} · No cards in this deck yet.`;
  }

  if (!entry) {
    renderEmptyState();
    elements.emptyState?.classList.remove("is-hidden");
    elements.cardShell?.classList.add("is-hidden");
    elements.summaryOverlay?.classList.add("is-hidden");
    elements.mcOptions?.classList.add("is-hidden");
    state.mcKey = null;
    return;
  }

  elements.emptyState?.classList.add("is-hidden");
  elements.cardShell?.classList.remove("is-hidden");
  elements.summaryOverlay?.classList.add("is-hidden");

  if (state.sessionActive) {
    if (elements.progress) {
      elements.progress.textContent = `Session ${state.sessionIndex + 1} / ${state.sessionCards.length}`;
    }
    if (elements.sessionProgress) {
      elements.sessionProgress.textContent = `${state.sessionResults.length} rated · ${state.sessionCards.length - state.sessionResults.length} remaining`;
      elements.sessionProgress.classList.remove("is-hidden");
    }
  } else {
    if (elements.progress) {
      elements.progress.textContent = `${state.index + 1} / ${count}`;
    }
    elements.sessionProgress?.classList.add("is-hidden");
  }

  if (listening) {
    if (elements.cardWord) elements.cardWord.textContent = "";
    if (elements.cardType) elements.cardType.textContent = "";
  } else if (state.direction === "rev") {
    const meaning = typeof LodVaultStore.getPrimaryMeaning === "function"
      ? LodVaultStore.getPrimaryMeaning(entry)
      : null;
    if (elements.cardWord) {
      elements.cardWord.textContent = meaning ? meaning.value : entry.word;
    }
    if (elements.cardType) {
      elements.cardType.textContent = meaning
        ? `${meaning.label} · Recall the Luxembourgish word`
        : "";
    }
  } else {
    if (elements.cardWord) {
      elements.cardWord.textContent = entry.word;
    }
    if (elements.cardType) {
      elements.cardType.textContent = entry.pos || "";
    }
  }

  if (elements.cardAudio) {
    const audioUrl = typeof LodVaultStore.getAudioUrl === "function"
      ? LodVaultStore.getAudioUrl(entry)
      : null;
    elements.cardAudio.style.display = audioUrl ? "" : "none";
    elements.cardAudio.dataset.audioId = entry.id || "";
  }

  if (elements.cardAnswer) {
    // Do not expose the answer to assistive technology before a listening reveal.
    LodVaultStore.setHtml(elements.cardAnswer, listening && !state.revealed ? "" : buildAnswerMarkup(entry));
  }

  if (elements.mcOptions) {
    // The session position is part of the key: a retried card can follow itself.
    const mcKey = state.mode === "mc" ? `${entry.id}:${state.direction}:${state.sessionActive ? state.sessionIndex : ""}` : "";
    if (state.mcKey !== mcKey) {
      state.mcKey = mcKey;
      state.mcLocked = false;
      const options = state.mode === "mc" ? buildMcOptions(entry) : [];
      LodVaultStore.setHtml(elements.mcOptions, options.map((option) =>
        `<button type="button" class="mc-option" data-correct="${option.correct ? "1" : "0"}">${LodVaultStore.escapeHtml(option.text)}</button>`
      ).join(""));
    }
    elements.mcOptions.classList.toggle("is-hidden", state.mode !== "mc");
  }
  elements.flashcard?.classList.toggle("is-revealed", state.revealed);
  for (const face of elements.flashcard?.querySelectorAll(".card-face") || []) {
    const hidden = face.classList.contains("card-back") !== state.revealed;
    face.setAttribute("aria-hidden", String(hidden));
    face.toggleAttribute("inert", hidden);
  }
  if (elements.flipCard) {
    elements.flipCard.textContent = state.revealed ? "Hide" : "Reveal";
    elements.flipCard.classList.toggle("is-hidden", state.mode === "mc");
  }
  if (elements.cardHint) {
    elements.cardHint.textContent = listening
      ? audioFailed
        ? "Audio unavailable. Try Play pronunciation again, reveal the answer, or skip this card."
        : "Listen, then Reveal to see the word and translation. Press P to replay."
      : state.mode === "mc" ? "Choose the correct answer." : "Click Reveal to show the answer.";
  }

  if (elements.prevCard) elements.prevCard.disabled = !canNavigate();
  if (elements.nextCard) elements.nextCard.disabled = !canNavigate();

  if (state.revealed && count > 0) {
    elements.ratingBar?.classList.remove("is-hidden");
  } else {
    elements.ratingBar?.classList.add("is-hidden");
  }

  if (elements.shortcutHint) {
    const shortcuts = [
      state.mode === "mc" ? "1–4 choose" : "Space reveal",
      canNavigate() ? "← → navigate" : "",
      state.mode === "mc" ? "" : "1 / 2 / 3 rate",
      listening ? "P replay" : "R flip direction"
    ];
    elements.shortcutHint.textContent = shortcuts.filter(Boolean).join(" · ");
  }
  if (shouldPlay) {
    if (LodVaultStore.getAudioUrl?.(entry)) playCardAudio();
    else {
      audioFailed = true;
      if (elements.cardHint) elements.cardHint.textContent = "No pronunciation available. Reveal the answer or skip this card.";
    }
  }
}

function renderEmptyState() {
  // With no Study words and nothing ever reviewed, Today never had work to finish.
  const finishedToday = state.filter === "today" && state.entries.some((entry) => (
    entry.study || state.flashcardMeta[entry.id]?.totalReviews
  ));
  if (elements.emptyTitle) {
    elements.emptyTitle.textContent = finishedToday ? "All done for today." : "Nothing due here.";
  }
  if (elements.emptyMessage) {
    elements.emptyMessage.textContent = finishedToday
      ? "Come back tomorrow. Extra practice won't push your words further out."
      : "No words available for this flashcard deck yet.";
  }
  elements.emptyStudyList?.classList.toggle(
    "is-hidden",
    !finishedToday || !state.entries.some((entry) => entry.study)
  );
}

function openStudyList() {
  state.filter = "study";
  state.index = 0;
  if (elements.deckFilter) elements.deckFilter.value = "study";
  rebuildDeck();
}

function buildMeaningMarkup(entry) {
  const rows = LodVaultStore.buildMeaningRowsMarkup(entry);

  if (!rows) {
    return '<p class="muted">No saved meanings yet. Re-save this word from lod.lu to capture its translated meanings.</p>';
  }

  return `
    <section class="meaning-panel">
      <h4>Meanings from LOD</h4>
      ${rows}
    </section>
  `;
}

function buildMcOptions(entry) {
  const answerText = state.direction === "rev" ? entry.word : mcAnswerText(entry) || entry.word;
  const options = [{ text: answerText, correct: true }];
  const seen = new Set([answerText]);
  const pool = state.deck.length >= 4
    ? state.deck.filter((candidate) => candidate.id !== entry.id)
    : state.entries.filter((candidate) => candidate.id !== entry.id);
  for (const other of shuffle(pool)) {
    if (options.length >= 4) break;
    const text = state.direction === "rev" ? other.word : mcAnswerText(other);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    options.push({ text, correct: false });
  }
  return shuffle(options);
}

function mcAnswerText(entry) {
  const meaning = typeof LodVaultStore.getPrimaryMeaning === "function"
    ? LodVaultStore.getPrimaryMeaning(entry)
    : null;
  return (meaning && meaning.value) || null;
}

function buildAnswerMarkup(entry) {
  const chips = [];
  if (entry.pos) {
    chips.push(`<span class="chip">Type: ${LodVaultStore.escapeHtml(entry.pos)}</span>`);
  }

  const directionBadge = state.mode !== "listening" && state.direction === "rev"
    ? '<span class="chip">Reverse mode</span>'
    : "";

  return `
    <h3>${LodVaultStore.escapeHtml(entry.word)}${LodVaultStore.buildAudioBtnMarkup ? LodVaultStore.buildAudioBtnMarkup(entry) : ""}</h3>
    ${chips.length || directionBadge ? `<div class="chip-row">${chips.join("")}${directionBadge}</div>` : ""}
    ${buildMeaningMarkup(entry)}
    ${entry.inflection ? `<p><strong>Inflection:</strong> ${LodVaultStore.escapeHtml(entry.inflection)}</p>` : ""}
    ${entry.example ? `<blockquote>${LodVaultStore.escapeHtml(entry.example)}</blockquote>` : ""}
    ${entry.note ? `<div class="note"><strong>Note:</strong> ${LodVaultStore.escapeHtml(entry.note)}</div>` : ""}
    <p class="card-open-row"><a class="card-open-link" href="${LodVaultStore.escapeHtml(entry.url)}" target="_blank" rel="noreferrer">Open on LOD <span class="open-arrow" aria-hidden="true">↗</span></a></p>
  `;
}

function toggleReveal() {
  if (state.mode === "mc" || !state.deck.length) return;
  state.revealed = !state.revealed;
  renderDeck();
}

function canNavigate() {
  return state.sessionActive
    ? state.sessionCards.length - state.sessionIndex > 1
    : state.deck.length > 1;
}

// Rated cards stay before sessionIndex and unrated ones from it onwards, which
// is what progress, resume and the end of a session rely on. So moving through
// a session rotates the unrated cards rather than moving the position.
function rotateSessionCards(step) {
  const cards = state.sessionCards;
  if (step > 0) {
    cards.push(...cards.splice(state.sessionIndex, 1));
  } else {
    cards.splice(state.sessionIndex, 0, cards.pop());
  }
  void saveSession();
}

function showPrevious() {
  if (!canNavigate() || state.ratingInProgress) return;
  if (state.sessionActive) {
    rotateSessionCards(-1);
  } else {
    state.index = (state.index - 1 + state.deck.length) % state.deck.length;
  }
  state.revealed = false;
  renderDeck();
}

function showNext() {
  if (!canNavigate() || (state.sessionActive && state.ratingInProgress)) return;
  if (state.sessionActive) {
    rotateSessionCards(1);
  } else {
    state.index = (state.index + 1) % state.deck.length;
  }
  state.revealed = false;
  renderDeck();
}

function onRatingClick(event) {
  const button = event.target.closest("[data-rating]");
  if (!button) return;
  const rating = Number(button.dataset.rating);
  rateCard(rating);
}

function onMcOptionClick(event) {
  const button = event.target.closest("[data-correct]");
  if (!button || state.mode !== "mc" || !state.deck.length || state.mcLocked) return;
  const entry = currentEntry();
  if (!entry) return;

  state.mcLocked = true;
  const correct = button.dataset.correct === "1";
  button.classList.add(correct ? "is-correct" : "is-wrong");
  if (!correct) {
    elements.mcOptions.querySelector('[data-correct="1"]')?.classList.add("is-correct");
  }
  elements.mcOptions.querySelectorAll("button").forEach((option) => { option.disabled = true; });

  setTimeout(() => {
    if (currentEntry()?.id !== entry.id) return;
    state.mcLocked = false;
    state.revealed = true;
    void rateCard(correct ? 2 : 1);
  }, 700);
}

async function rateCard(rating) {
  // The review is saved asynchronously, so a double click or repeated key would
  // otherwise record it twice and skip the next card.
  if (state.ratingInProgress || !state.revealed || !state.deck.length) return;
  const entry = currentEntry();
  if (!entry) return;

  state.ratingInProgress = true;
  try {
    await recordRating(entry, rating);
  } finally {
    state.ratingInProgress = false;
  }
}

async function recordRating(entry, rating) {
  // Studying Today moves on from an older saved session, whose cards may now
  // have been reviewed here.
  if (state.filter === "today" && state.resumableSession) {
    await dismissResumableSession();
  }

  if (typeof LodVaultStore.recordFlashcardReview === "function") {
    await LodVaultStore.recordFlashcardReview(entry.id, rating, state.mode === "listening" ? "fwd" : state.direction);
    await loadFlashcardMeta();
    computeStats();
    renderStats();
  }

  state.sessionResults.push({ entryId: entry.id, rating, direction: state.mode === "listening" ? "fwd" : state.direction });

  if (state.sessionActive) {
    // A missed word comes back once before the session ends.
    if (rating === 1 && state.sessionCards.filter((card) => card.id === entry.id).length === 1) {
      state.sessionCards.push(entry);
    }
    state.sessionIndex += 1;
    if (state.sessionIndex >= state.sessionCards.length) {
      await clearSavedSession();
      showSummary();
      return;
    }
    state.index = state.sessionIndex;
    state.revealed = false;
    await saveSession();
    renderDeck();
  } else {
    showNext();
  }
}

function showSummary() {
  stopCardAudio();
  const hard = state.sessionResults.filter((r) => r.rating === 1).length;
  const good = state.sessionResults.filter((r) => r.rating === 2).length;
  const easy = state.sessionResults.filter((r) => r.rating === 3).length;

  if (elements.summaryTotal) elements.summaryTotal.textContent = state.sessionResults.length;
  if (elements.summaryHard) elements.summaryHard.textContent = hard;
  if (elements.summaryGood) elements.summaryGood.textContent = good;
  if (elements.summaryEasy) elements.summaryEasy.textContent = easy;

  elements.cardShell?.classList.add("is-hidden");
  elements.summaryOverlay?.classList.remove("is-hidden");
}

function closeSummary() {
  elements.summaryOverlay?.classList.add("is-hidden");
  endSession();
  rebuildDeck();
}

function endSession() {
  state.sessionActive = false;
  state.sessionCards = [];
  state.sessionIndex = 0;
  state.sessionResults = [];
  void clearSavedSession();
}

// Session setup stays behind one menu; extension CSP forbids inline wiring.
(() => {
  const menu = document.getElementById("session-menu");
  const trigger = document.getElementById("session-trigger");
  if (!menu || !trigger) return;

  function setOpen(open) {
    menu.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", String(open));
  }
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(!menu.classList.contains("is-open"));
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".menu-wrap")) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.classList.contains("is-open")) {
      setOpen(false);
      trigger.focus();
    }
  });
})();

// ── Custom decks ─────────────────────────────────────────────
// Saved decks and level decks come from scripts/decks.js, which adds "My
// decks" and "Levels" groups to the deck select. Their values look like
// "deck:<id>" and "level:A1".
function isCustomDeck(value) {
  return Boolean(globalThis.LodVaultDecks?.isDeckValue?.(value));
}

function isKnownDeck(value) {
  return DECK_FILTERS.has(value) || isCustomDeck(value);
}

async function attachCustomDecks() {
  const decks = globalThis.LodVaultDecks;
  if (!decks?.attach || !elements.deckFilter) return;
  try {
    await decks.attach(elements.deckFilter, state.entries, state.flashcardMeta, { onChange: onCustomDecksChanged });
  } catch {
    return;
  }
  // Repopulating the select drops a custom selection; put it back.
  if (isKnownDeck(state.filter)) elements.deckFilter.value = state.filter;
}

async function onCustomDecksChanged() {
  await attachCustomDecks();
  if (!isKnownDeck(state.filter)) {
    state.filter = "today";
    if (elements.deckFilter) elements.deckFilter.value = state.filter;
  }
  if (!state.sessionActive && (isCustomDeck(state.filter) || state.filter === "today")) rebuildDeck({ preserveAudio: true });
}
