const state = {
  entries: [],
  deck: [],
  filter: "today",
  revealed: false,
  ratingInProgress: false,
  reviewSaveFailed: false,
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
  settings: null,
  sessionStartedAt: 0,
  sessionDay: "",
  reinserts: {},
  undoStack: [],
  cardShownAt: 0,
  cardShownKey: "",
  flashcardMeta: {},
  today: null,
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
  elements.newPerDay = document.getElementById("new-per-day");
  elements.maxReviews = document.getElementById("max-reviews");
  elements.retention = document.getElementById("retention");
  elements.maxInterval = document.getElementById("max-interval");
  elements.showHard = document.getElementById("show-hard");
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
  elements.summaryAgain = document.getElementById("summary-again");
  elements.summaryTitle = document.getElementById("summary-title");
  elements.summaryLede = document.getElementById("summary-lede");
  elements.summaryNew = document.getElementById("summary-new");
  elements.summaryTomorrow = document.getElementById("summary-tomorrow");
  elements.summaryStreak = document.getElementById("summary-streak");
  elements.summaryWatch = document.getElementById("summary-watch");
  elements.summaryWatchList = document.getElementById("summary-watch-list");
  elements.undoToast = document.getElementById("undo-toast");
  elements.undoToastText = document.getElementById("undo-toast-text");
  elements.undoButton = document.getElementById("undo-button");
  elements.endSession = document.getElementById("end-session");
  elements.cardStatus = document.getElementById("card-status");
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
  for (const control of [elements.newPerDay, elements.maxReviews, elements.retention, elements.maxInterval, elements.showHard]) {
    control?.addEventListener("change", onSchedulingSettingChange);
  }
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
  elements.undoButton?.addEventListener("click", () => void undoLastReview());
  elements.endSession?.addEventListener("click", () => void endSessionEarly());
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
  chooseInitialDeck();
  computeStats();
  renderStats();
  const resumed = await resumeTodaySession();
  renderResumeSession();
  if (!resumed) rebuildDeck();
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
  const settings = currentSettings();
  return LodVaultStore.buildTodayQueue(state.entries, state.flashcardMeta, {
    newPerDay: settings.newPerDay,
    maxReviewsPerDay: settings.maxReviewsPerDay
  });
}

function chooseInitialDeck() {
  // Today is the default; a vault with nothing to feed it falls back to a deck
  // that has cards. Deep links can request a specific deck and win over both.
  if (!state.entries.some((entry) => entry.study) && !todayQueue().queue.length) {
    state.filter = state.entries.some((entry) => entry.favorite) ? "favorites" : "all";
  }

  const urlDeck = new URLSearchParams(location.search).get("deck");
  if (urlDeck && DECK_FILTERS.has(urlDeck)) {
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
  state.settings = LodVaultStore.normalizeFlashcardSettings(saved[FLASHCARD_SETTINGS_KEY]);
  state.resumableSession = saved[FLASHCARD_SESSION_KEY] || null;
  state.mode = STUDY_MODES.has(state.settings.mode) ? state.settings.mode : "self";
  renderSettingControls();
  if (elements.modeSelect) elements.modeSelect.value = state.mode;
}

function currentSettings() {
  if (!state.settings) state.settings = LodVaultStore.normalizeFlashcardSettings({});
  return state.settings;
}

// Select values are strings; "none" stands for a null (no limit) setting.
function settingToValue(value) {
  return value === null ? "none" : String(value);
}

function valueToSetting(value) {
  return value === "none" ? null : Number(value);
}

function renderSettingControls() {
  const settings = currentSettings();
  if (elements.newPerDay) elements.newPerDay.value = settingToValue(settings.newPerDay);
  if (elements.maxReviews) elements.maxReviews.value = settingToValue(settings.maxReviewsPerDay);
  if (elements.retention) elements.retention.value = String(settings.retention);
  if (elements.maxInterval) elements.maxInterval.value = String(settings.maxInterval);
  if (elements.showHard) elements.showHard.checked = settings.showHard;
}

async function saveSettings() {
  const local = chrome.storage?.local;
  state.settings = { ...currentSettings(), mode: state.mode };
  if (local) await local.set({ [FLASHCARD_SETTINGS_KEY]: { ...state.settings } });
}

// The session survives a closed tab, Today included: its order and the
// learning steps still to come are part of it.
async function saveSession() {
  const local = chrome.storage?.local;
  if (!local || !state.sessionActive) return;
  await local.set({
    [FLASHCARD_SESSION_KEY]: {
      filter: state.filter,
      orderMode: state.orderMode,
      direction: state.direction,
      mode: state.mode,
      sessionSize: state.sessionSize,
      cardIds: state.sessionCards.map((entry) => entry.id),
      index: state.sessionIndex,
      results: state.sessionResults,
      reinserts: state.reinserts,
      day: state.sessionDay || LodVaultStore.toLocalDateKey(),
      startedAt: state.sessionStartedAt || Date.now()
    }
  });
}

// Opening Today continues today's session where it stopped. Cards no longer
// due (reviewed on another device, deleted) drop out; a session from an
// earlier day is discarded, since Today is rebuilt from the schedule.
async function resumeTodaySession() {
  const saved = state.resumableSession;
  if (saved?.filter !== "today") return false;
  state.resumableSession = null;
  if (state.filter !== "today" || saved.day !== LodVaultStore.toLocalDateKey() || !Array.isArray(saved.cardIds)) {
    await clearSavedSession();
    return false;
  }
  const byId = new Map(state.entries.map((entry) => [entry.id, entry]));
  const today = todayQueue();
  const stillToday = new Set([...today.learning || [], ...today.queue].map((entry) => entry.id));
  const index = Math.max(0, Number(saved.index) || 0);
  const rated = saved.cardIds.slice(0, index).map((id) => byId.get(id)).filter(Boolean);
  const remaining = saved.cardIds.slice(index).filter((id) => stillToday.has(id)).map((id) => byId.get(id)).filter(Boolean);
  if (!remaining.length) {
    await clearSavedSession();
    return false;
  }
  stopCardAudio();
  state.sessionCards = [...rated, ...remaining];
  state.sessionIndex = rated.length;
  state.sessionResults = Array.isArray(saved.results) ? saved.results : [];
  state.reinserts = saved.reinserts && typeof saved.reinserts === "object" ? saved.reinserts : {};
  state.sessionDay = saved.day;
  state.sessionStartedAt = Number(saved.startedAt) || Date.now();
  state.sessionActive = true;
  state.deck = state.sessionCards;
  state.index = state.sessionIndex;
  state.revealed = false;
  state.undoStack = [];
  renderDeck();
  await saveSession();
  return true;
}

async function clearSavedSession() {
  const local = chrome.storage?.local;
  if (local) await local.remove(FLASHCARD_SESSION_KEY);
}

function renderResumeSession() {
  const saved = state.resumableSession?.filter === "today" ? null : state.resumableSession;
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
  state.filter = DECK_FILTERS.has(saved.filter) ? saved.filter : state.filter;
  state.orderMode = ORDER_MODES.has(saved.orderMode) ? saved.orderMode : state.orderMode;
  state.direction = saved.direction === "rev" ? "rev" : "fwd";
  state.mode = STUDY_MODES.has(saved.mode) ? saved.mode : "self";
  state.sessionSize = String(saved.sessionSize || cards.length);
  state.sessionCards = cards;
  state.sessionIndex = index;
  state.sessionResults = Array.isArray(saved.results) ? saved.results : [];
  state.reinserts = saved.reinserts && typeof saved.reinserts === "object" ? saved.reinserts : {};
  state.sessionDay = saved.day || LodVaultStore.toLocalDateKey();
  state.sessionStartedAt = Number(saved.startedAt) || Date.now();
  state.undoStack = [];
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

// Today, due and the streak come from buildTodayQueue, the same numbers the
// popup and the toolbar badge show. "today" counts cards, not button presses.
function computeStats() {
  const meta = state.flashcardMeta;
  const today = todayQueue();
  let newCount = 0;
  let learningCount = 0;
  let masteredCount = 0;

  // Review data outlives a deleted word (so Undo keeps its progress). Past
  // reviews still count toward today and the streak, but only saved words
  // count as learning or mastered.
  for (const entry of state.entries) {
    const m = meta[entry.id] ? normalizeFlashcardMeta(meta[entry.id]) : null;
    if (!m?.totalReviews) {
      if (entry.study) newCount += 1;
      continue;
    }
    const last = m.reviews[m.reviews.length - 1];
    if (m.easyCount >= 3 && last && last.rating === 3) {
      masteredCount += 1;
    } else {
      learningCount += 1;
    }
  }

  state.today = today;
  state.stats = {
    streak: today.streak,
    todayCount: today.reviewedToday,
    dueCount: today.dueCount,
    newCount,
    learningCount,
    masteredCount
  };
}

function describeDailyProgress(today) {
  if (!today) return { text: "", complete: false };
  const reviewsPart = `${today.reviewsToday}/${today.reviewsToday + today.dueCount} reviews`;
  const limit = currentSettings().newPerDay;
  const newPart = limit === null
    ? `${today.newToday} new · no new-word limit`
    : limit === 0 && !today.newToday ? "new words paused"
      : `${today.newToday}/${today.newToday + today.newCount} new`;
  const complete = today.reviewedToday > 0 && !today.dueCount && !today.newCount;
  const parts = [`${complete ? "Done for today" : "Today"}: ${reviewsPart} · ${newPart}`];
  if (today.newReduced) parts.push("fewer new words while the backlog is large");
  return { text: parts.join(" · "), complete };
}

function renderStats() {
  if (elements.statStreak) elements.statStreak.textContent = state.activityStreak ?? state.stats.streak;
  if (elements.statToday) elements.statToday.textContent = state.stats.todayCount;
  if (elements.dailyProgress) {
    const { text, complete } = describeDailyProgress(state.today);
    elements.dailyProgress.textContent = text;
    elements.dailyProgress.classList.toggle("is-complete", complete);
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

async function onSchedulingSettingChange() {
  const before = currentSettings();
  state.settings = LodVaultStore.normalizeFlashcardSettings({
    ...currentSettings(),
    newPerDay: elements.newPerDay ? valueToSetting(elements.newPerDay.value) : currentSettings().newPerDay,
    maxReviewsPerDay: elements.maxReviews ? valueToSetting(elements.maxReviews.value) : currentSettings().maxReviewsPerDay,
    retention: elements.retention ? Number(elements.retention.value) : currentSettings().retention,
    maxInterval: elements.maxInterval ? Number(elements.maxInterval.value) : currentSettings().maxInterval,
    showHard: elements.showHard ? elements.showHard.checked : currentSettings().showHard
  });
  await saveSettings();
  computeStats();
  renderStats();
  // Only the daily limits change what Today holds; the rest re-labels the card.
  const queueChanged = before.newPerDay !== state.settings.newPerDay
    || before.maxReviewsPerDay !== state.settings.maxReviewsPerDay;
  if (queueChanged && state.filter === "today" && !state.sessionResults.length) rebuildDeck();
  else renderDeck();
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
  computeStats();
  renderStats();
  // A finished session stays on its summary until the learner closes it.
  if (elements.summaryOverlay && !elements.summaryOverlay.classList.contains("is-hidden")) return;
  if (state.sessionActive) {
    await refreshSessionCards();
  } else {
    rebuildDeck({ preserveAudio: true });
  }
}

// Session cards are entry snapshots. After a storage change they take the
// saved version of each word, and words deleted meanwhile leave the session.
async function refreshSessionCards() {
  const byId = new Map(state.entries.map((entry) => [entry.id, entry]));
  const currentId = currentEntry()?.id;
  const cards = [];
  let index = state.sessionIndex;
  state.sessionCards.forEach((card, position) => {
    const fresh = byId.get(card.id);
    if (fresh) cards.push(fresh);
    else if (position < state.sessionIndex) index -= 1;
  });
  const removed = cards.length !== state.sessionCards.length;
  state.sessionCards = cards;
  state.sessionIndex = Math.max(0, index);
  state.deck = cards;
  state.index = state.sessionIndex;
  if (currentEntry()?.id !== currentId) state.revealed = false;

  if (state.sessionIndex >= cards.length) {
    await clearSavedSession();
    if (state.sessionResults.length) {
      showSummary();
    } else {
      endSession();
      rebuildDeck({ preserveAudio: true });
    }
    return;
  }
  if (removed) await saveSession();
  renderDeck();
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
  const target = event.target;
  const typing = target?.tagName === "SELECT"
    || target?.tagName === "INPUT"
    || target?.tagName === "TEXTAREA"
    || target?.isContentEditable;
  const undoKey = !typing && !event.altKey && (
    ((event.ctrlKey || event.metaKey) && (event.key === "z" || event.key === "Z") && !event.shiftKey)
    || (!event.ctrlKey && !event.metaKey && (event.key === "u" || event.key === "U"))
  );
  if (undoKey && state.undoStack.length) {
    event.preventDefault();
    void undoLastReview();
    return;
  }

  if (isSummaryOpen()) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSummary();
    } else if (event.key === "Tab") {
      // The dialog has one control; keep focus on it.
      event.preventDefault();
      elements.closeSummary?.focus?.();
    }
    return;
  }

  if (typing) return;
  if (event.key === "Escape" && state.sessionActive && !document.getElementById("session-menu")?.classList.contains("is-open")) {
    event.preventDefault();
    void endSessionEarly();
    return;
  }
  // A focused control keeps Space and Enter for itself, but study keys still
  // work after clicking Reveal, a rating or the card's own buttons.
  if (target?.closest?.("button, a, summary")) {
    const inCard = elements.cardShell?.contains(target);
    if (!inCard || event.key === " " || event.key === "Enter") return;
  }

  if (!state.deck.length) return;

  if (event.key === "ArrowRight") {
    showNext();
  } else if (event.key === "ArrowLeft") {
    showPrevious();
  } else if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    toggleReveal();
  } else if (cardMode() === "mc" && event.key >= "1" && event.key <= "4") {
    elements.mcOptions?.querySelectorAll("button")[Number(event.key) - 1]?.click();
  } else if (/^[1-4]$/.test(event.key)) {
    const grade = gradeButtons()[Number(event.key) - 1]?.grade;
    if (grade) rateCard(grade);
  } else if (state.mode === "listening" && (event.key === "p" || event.key === "P")) {
    playCardAudio();
  } else if (event.key === "r" || event.key === "R") {
    toggleDirection();
  }
}

// A card can only be asked the way its saved data allows. Without a saved
// translation, reverse and multiple choice would show the answer on the front,
// so such a word is asked as a regular forward card.
function cardMode(entry = currentEntry()) {
  if (state.mode === "mc" && entry && !hasMeaning(entry)) return "self";
  return state.mode;
}

function cardDirection(entry = currentEntry()) {
  if (state.mode === "listening") return "fwd";
  if (state.direction === "rev" && entry && !hasMeaning(entry)) return "fwd";
  return state.direction;
}

function hasMeaning(entry) {
  return Boolean(mcAnswerText(entry));
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
  // Every deck is a session: rated cards don't come round again, and the
  // end of the deck brings the summary.
  state.sessionActive = state.sessionCards.length > 0;
  state.sessionIndex = 0;
  state.sessionResults = [];
  state.reinserts = {};
  state.undoStack = [];
  state.sessionStartedAt = Date.now();
  state.sessionDay = LodVaultStore.toLocalDateKey();
  state.deck = state.sessionCards;
  if (state.sessionActive) void saveSession();
  state.index = 0;
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
  const mode = cardMode(entry);
  const direction = cardDirection(entry);
  const fallback = Boolean(entry) && (mode !== state.mode || direction !== state.direction) && !listening;
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
    const deckLabel = DECK_LABELS[state.filter] || "Deck";
    elements.deckStatus.textContent = count
      ? `${deckLabel} · ${count} card${count === 1 ? "" : "s"} in this deck`
      : `${deckLabel} · No cards in this deck yet.`;
  }

  if (!entry) {
    renderEmptyState();
    elements.emptyState?.classList.remove("is-hidden");
    elements.cardShell?.classList.add("is-hidden");
    closeSummaryDialog();
    elements.mcOptions?.classList.add("is-hidden");
    state.mcKey = null;
    return;
  }

  elements.emptyState?.classList.add("is-hidden");
  elements.cardShell?.classList.remove("is-hidden");
  closeSummaryDialog();

  // Learning steps add cards as the session goes, so "left" counts what is
  // still ahead, retries included.
  const left = state.sessionCards.length - state.sessionIndex;
  if (elements.progress) {
    elements.progress.textContent = `Session ${state.sessionIndex + 1} / ${state.sessionCards.length}`;
  }
  if (elements.sessionProgress) {
    elements.sessionProgress.textContent = `${state.sessionIndex} done · ${left} left`;
    elements.sessionProgress.classList.remove("is-hidden");
  }

  if (listening) {
    if (elements.cardWord) elements.cardWord.textContent = "";
    if (elements.cardType) elements.cardType.textContent = "";
  } else if (direction === "rev") {
    const meaning = LodVaultStore.getPrimaryMeaning(entry);
    if (elements.cardWord) elements.cardWord.textContent = meaning.value;
    if (elements.cardType) elements.cardType.textContent = `${meaning.label} · Recall the Luxembourgish word`;
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
    const mcKey = mode === "mc" ? `${entry.id}:${direction}:${state.sessionActive ? state.sessionIndex : ""}` : "";
    if (state.mcKey !== mcKey) {
      state.mcKey = mcKey;
      state.mcLocked = false;
      const options = mode === "mc" ? buildMcOptions(entry) : [];
      LodVaultStore.setHtml(elements.mcOptions, options.map((option) =>
        `<button type="button" class="mc-option" data-correct="${option.correct ? "1" : "0"}">${LodVaultStore.escapeHtml(option.text)}</button>`
      ).join(""));
    }
    elements.mcOptions.classList.toggle("is-hidden", mode !== "mc");
  }
  elements.flashcard?.classList.toggle("is-revealed", state.revealed);
  for (const face of elements.flashcard?.querySelectorAll(".card-face") || []) {
    const hidden = face.classList.contains("card-back") !== state.revealed;
    face.setAttribute("aria-hidden", String(hidden));
    face.toggleAttribute("inert", hidden);
  }
  if (elements.flipCard) {
    elements.flipCard.textContent = state.revealed ? "Hide" : "Reveal";
    elements.flipCard.classList.toggle("is-hidden", mode === "mc");
  }
  if (elements.cardHint) {
    elements.cardHint.textContent = listening
      ? audioFailed
        ? "Audio unavailable. Try Play pronunciation again, reveal the answer, or skip this card."
        : "Listen, then Reveal to see the word and translation. Press P to replay."
      : fallback ? "No saved translation for this word, so it is asked the usual way. Reveal to check."
        : mode === "mc" ? "Choose the correct answer." : "Click Reveal to show the answer.";
  }

  if (elements.prevCard) elements.prevCard.disabled = !canNavigate();
  if (elements.nextCard) elements.nextCard.disabled = !canNavigate();

  if (state.revealed && count > 0) {
    renderRatingBar(entry);
    elements.ratingBar?.classList.remove("is-hidden");
  } else {
    elements.ratingBar?.classList.add("is-hidden");
  }
  const shownKey = `${entry.id}:${state.sessionActive ? state.sessionIndex : state.index}`;
  if (shownKey !== state.cardShownKey) {
    state.cardShownKey = shownKey;
    state.cardShownAt = Date.now();
  }

  if (elements.shortcutHint) {
    const shortcuts = [
      mode === "mc" ? "1–4 choose" : "Space reveal",
      canNavigate() ? "← → navigate" : "",
      mode === "mc" ? "" : gradeButtons().map((button, index) => `${index + 1} ${button.label}`).join(" · "),
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

const GRADE_LABELS = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

// Again / Good / Easy by default; "Show Hard" adds Hard between them.
function gradeButtons() {
  const grades = currentSettings().showHard ? [1, 2, 3, 4] : [1, 3, 4];
  return grades.map((grade) => ({ grade, label: GRADE_LABELS[grade] }));
}

function formatInterval(preview) {
  if (!preview) return "";
  if (!preview.days) return `<${preview.minutes || 10}m`;
  const days = preview.days;
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 3.04) / 10}mo`;
  return `${Math.round(days / 36.5) / 10}y`;
}

// Practice decks only log reviews of words that aren't due, so they show no
// intervals: the schedule stays as it is.
function reviewKind(entry) {
  if (state.filter === "today" || state.filter === "due") return "r";
  return "p";
}

function renderRatingBar(entry) {
  if (!elements.ratingBar) return;
  let preview = null;
  try {
    preview = LodVaultStore.previewFlashcardIntervals?.(state.flashcardMeta[entry.id], {
      settings: currentSettings(),
      cardId: entry.id,
      kind: reviewKind(entry),
      meta: state.flashcardMeta
    }) || null;
  } catch {
    preview = null;
  }
  const buttons = gradeButtons();
  const key = `${buttons.map((button) => button.grade).join("")}:${JSON.stringify(preview)}`;
  if (elements.ratingBar.dataset.key === key) return;
  elements.ratingBar.dataset.key = key;
  elements.ratingBar.style.setProperty("--grades", String(buttons.length));
  LodVaultStore.setHtml(elements.ratingBar, buttons.map(({ grade, label }, index) => {
    const interval = formatInterval(preview?.[grade]);
    const title = `${label} (${index + 1})${interval ? `, next in ${interval}` : ""}`;
    return `<button type="button" class="btn-ghost rating-button rating-${label.toLowerCase()}" data-grade="${grade}" title="${LodVaultStore.escapeHtml(title)}">${label}<small>${index + 1}${interval ? ` · ${LodVaultStore.escapeHtml(interval)}` : ""}</small></button>`;
  }).join(""));
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
  const direction = cardDirection(entry);
  const answerText = direction === "rev" ? entry.word : mcAnswerText(entry);
  const options = [{ text: answerText, correct: true }];
  const seen = new Set([answerText]);
  const pool = state.deck.length >= 4
    ? state.deck.filter((candidate) => candidate.id !== entry.id)
    : state.entries.filter((candidate) => candidate.id !== entry.id);
  for (const other of shuffle(pool)) {
    if (options.length >= 4) break;
    const text = direction === "rev" ? other.word : mcAnswerText(other);
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

  const directionBadge = cardDirection(entry) === "rev"
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
  if (cardMode() === "mc" || !state.deck.length) return;
  state.revealed = !state.revealed;
  renderDeck();
  announceReveal();
}

// Screen readers hear the answer and the grading keys; focus moves to Good,
// so Space or Enter grades Good and Tab reaches the other grades.
function announceReveal() {
  const entry = currentEntry();
  if (!entry || !elements.cardStatus) return;
  if (!state.revealed) {
    elements.cardStatus.textContent = "";
    return;
  }
  const keys = gradeButtons().map((button, index) => `${index + 1} ${button.label}`).join(", ");
  elements.cardStatus.textContent = `Answer: ${entry.word}. Grade it: ${keys}.`;
  const active = document.activeElement;
  if (!active || active === document.body || active === elements.flipCard || elements.flashcard?.contains(active)) {
    elements.ratingBar?.querySelector('[data-grade="3"]')?.focus?.({ preventScroll: true });
  }
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
  const button = event.target.closest("[data-grade]");
  if (!button) return;
  rateCard(Number(button.dataset.grade));
}

function onMcOptionClick(event) {
  const button = event.target.closest("[data-correct]");
  if (!button || state.mode !== "mc" || !state.deck.length || state.mcLocked) return;
  const entry = currentEntry();
  if (!entry || cardMode(entry) !== "mc") return;

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
    void rateCard(correct ? 3 : 1);
  }, 700);
}

async function rateCard(grade) {
  // The review is saved asynchronously, so a double click or repeated key would
  // otherwise record it twice and skip the next card.
  if (state.ratingInProgress || state.reviewSaveFailed || !state.revealed || !state.deck.length) return;
  const entry = currentEntry();
  if (!entry) return;
  // A word deleted in another tab must not get review data for a missing entry.
  if (!state.entries.some((saved) => saved.id === entry.id)) {
    await refreshSessionCards();
    return;
  }

  state.ratingInProgress = true;
  try {
    await recordRating(entry, grade);
  } catch (error) {
    // The worker may have committed before its reply was lost. Do not offer
    // another rating in this page or count an unconfirmed result in the session.
    state.reviewSaveFailed = true;
    elements.ratingBar?.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    elements.mcOptions?.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    if (elements.cardStatus) elements.cardStatus.textContent = "Review save could not be confirmed. It may already be saved. Reload and check progress before reviewing again.";
    console.error("Review save could not be confirmed", error);
  } finally {
    state.ratingInProgress = false;
  }
}

async function recordRating(entry, grade) {
  // Studying Today moves on from an older saved session, whose cards may now
  // have been reviewed here.
  if (state.filter === "today" && state.resumableSession) {
    await dismissResumableSession();
  }

  const direction = cardDirection(entry);
  const wasNew = !state.flashcardMeta[entry.id]?.totalReviews;
  const ms = state.cardShownAt ? Math.min(Date.now() - state.cardShownAt, 600000) : 0;
  const snapshot = {
    cardIds: state.sessionCards.map((card) => card.id),
    index: state.sessionIndex,
    results: state.sessionResults.length,
    reinserts: { ...state.reinserts }
  };
  let result = null;
  if (typeof LodVaultStore.recordFlashcardReview === "function") {
    result = await LodVaultStore.recordFlashcardReview(entry.id, grade, direction, { kind: reviewKind(entry), ms });
    if (result?.ok === false) return;
    await loadFlashcardMeta();
    computeStats();
    renderStats();
  }

  state.sessionResults.push({ entryId: entry.id, grade, direction, ms, wasNew });
  const reviewDate = result?.record?.reviews?.[result.record.reviews.length - 1]?.date;
  if (reviewDate) {
    state.undoStack.push({ entryId: entry.id, word: entry.word, grade, previous: result.previous ?? null, reviewDate, snapshot });
    if (state.undoStack.length > 20) state.undoStack.shift();
    showUndoToast(`${GRADE_LABELS[grade]} · ${entry.word}`);
  }

  scheduleRetry(entry, grade, result?.record);
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
  focusCardControl();
}

// Learning steps are positions in the session: a new word comes back after
// about three cards, then about eight, and a forgotten one after about four.
// Without a learning record (a practice deck, an older store) a miss comes
// back once.
const LEARNING_GAP = 3;
const SECOND_STEP_GAP = 8;
const RELEARNING_GAP = 4;
const MAX_RETRIES_PER_CARD = 6;

function scheduleRetry(entry, grade, record) {
  const count = state.reinserts[entry.id] || 0;
  if (count >= MAX_RETRIES_PER_CARD) return;
  let gap = null;
  if (record && (record.st === 1 || record.st === 3)) {
    gap = record.st === 3 ? RELEARNING_GAP : count === 0 ? LEARNING_GAP : SECOND_STEP_GAP;
  } else if (grade === 1 && count === 0) {
    gap = LEARNING_GAP;
  }
  if (gap === null) return;
  if (state.sessionCards.slice(state.sessionIndex + 1).some((card) => card.id === entry.id)) return;
  const position = Math.min(state.sessionCards.length, state.sessionIndex + 1 + gap);
  state.sessionCards.splice(position, 0, entry);
  state.reinserts[entry.id] = count + 1;
}

function focusCardControl() {
  const active = document.activeElement;
  if (!active || active === document.body || !active.isConnected || active.closest?.("#rating-bar, #mc-options")) {
    elements.flipCard?.focus?.({ preventScroll: true });
  }
}

let undoToastTimer = null;
function showUndoToast(text) {
  if (!elements.undoToast) return;
  if (elements.undoToastText) elements.undoToastText.textContent = text;
  elements.undoToast.classList.remove("is-hidden");
  clearTimeout(undoToastTimer);
  undoToastTimer = setTimeout(() => elements.undoToast?.classList.add("is-hidden"), 5000);
}

// Undo takes back the last review: its schedule, its place in the session and
// any learning step it added. The card shows again, unrevealed.
async function undoLastReview() {
  if (state.ratingInProgress || typeof LodVaultStore.undoFlashcardReview !== "function") return;
  const item = state.undoStack.pop();
  if (!item) return;
  state.ratingInProgress = true;
  try {
    const outcome = await LodVaultStore.undoFlashcardReview(item.entryId, item.previous, item.reviewDate);
    if (!outcome?.ok) {
      state.undoStack = [];
      showUndoToast(`Can't undo: ${item.word} was reviewed again since.`);
      return;
    }
    const byId = new Map(state.entries.map((entry) => [entry.id, entry]));
    state.sessionCards = item.snapshot.cardIds.map((id) => byId.get(id)).filter(Boolean);
    state.sessionIndex = Math.min(item.snapshot.index, Math.max(0, state.sessionCards.length - 1));
    state.sessionResults = state.sessionResults.slice(0, item.snapshot.results);
    state.reinserts = item.snapshot.reinserts;
    state.sessionActive = state.sessionCards.length > 0;
    state.deck = state.sessionCards;
    state.index = state.sessionIndex;
    state.revealed = false;
    closeSummaryDialog();
    await loadFlashcardMeta();
    computeStats();
    renderStats();
    await saveSession();
    renderDeck();
    elements.flipCard?.focus?.({ preventScroll: true });
    showUndoToast(`Undone · ${item.word}`);
  } finally {
    state.ratingInProgress = false;
  }
}

// Ending early keeps every review so far and shows what was done.
async function endSessionEarly() {
  if (!state.sessionActive) return;
  stopCardAudio();
  await clearSavedSession();
  showSummary({ early: state.sessionIndex < state.sessionCards.length });
}

// Sessions saved by older builds recorded rating 1..3 (Hard, Good, Easy).
function resultGrade(result) {
  if (result.grade) return result.grade;
  return { 1: 1, 2: 3, 3: 4 }[result.rating] || 3;
}

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.round(seconds / 60)} min`;
}

function tomorrowForecast() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const saved = new Set(state.entries.map((entry) => entry.id));
  return Object.entries(state.flashcardMeta).filter(([id, card]) => (
    saved.has(id) && card?.totalReviews && !card.suspended && LodVaultStore.isFlashcardDue(card, tomorrow)
  )).length;
}

function showSummary({ early = false } = {}) {
  stopCardAudio();
  // A missed card comes back in the session; the summary counts each card
  // once, by how it went the first time.
  const firstTry = new Map();
  const missed = new Map();
  let newWords = 0;
  let activeMs = 0;
  for (const result of state.sessionResults) {
    if (!firstTry.has(result.entryId)) {
      firstTry.set(result.entryId, resultGrade(result));
      if (result.wasNew) newWords += 1;
    }
    if (resultGrade(result) === 1) missed.set(result.entryId, true);
    activeMs += Number(result.ms) || 0;
  }
  const grades = [...firstTry.values()];
  const again = grades.filter((grade) => grade === 1).length;
  const good = grades.filter((grade) => grade === 2 || grade === 3).length;
  const easy = grades.filter((grade) => grade === 4).length;
  const cards = firstTry.size;

  if (elements.summaryTitle) elements.summaryTitle.textContent = early ? "Session ended" : "Session complete";
  if (elements.summaryLede) {
    const accuracy = cards ? Math.round(((cards - again) / cards) * 100) : 0;
    elements.summaryLede.textContent = cards
      ? `${cards} card${cards === 1 ? "" : "s"}${activeMs ? ` in ${formatDuration(activeMs)}` : ""} · ${accuracy}% right first time`
      : "No cards rated this time.";
  }
  if (elements.summaryTotal) elements.summaryTotal.textContent = cards;
  if (elements.summaryAgain) elements.summaryAgain.textContent = again;
  if (elements.summaryGood) elements.summaryGood.textContent = good;
  if (elements.summaryEasy) elements.summaryEasy.textContent = easy;
  if (elements.summaryNew) elements.summaryNew.textContent = String(newWords);
  if (elements.summaryTomorrow) elements.summaryTomorrow.textContent = String(tomorrowForecast());
  if (elements.summaryStreak) {
    const streak = state.stats.streak;
    elements.summaryStreak.textContent = `${streak} day${streak === 1 ? "" : "s"}`;
  }
  if (elements.summaryWatch) {
    const byId = new Map(state.entries.map((entry) => [entry.id, entry]));
    const words = [...missed.keys()].map((id) => byId.get(id)?.word).filter(Boolean);
    elements.summaryWatch.classList.toggle("is-hidden", !words.length);
    if (elements.summaryWatchList) elements.summaryWatchList.textContent = words.slice(0, 8).join(" · ");
  }

  elements.cardShell?.classList.add("is-hidden");
  openSummaryDialog();
}

// The summary is a modal dialog: focus moves into it, the page behind is
// inert, Tab stays inside, and closing returns focus.
let summaryReturnFocus = null;
function openSummaryDialog() {
  if (!elements.summaryOverlay) return;
  if (elements.summaryOverlay.classList.contains("is-hidden")) {
    summaryReturnFocus = document.activeElement;
  }
  elements.summaryOverlay.classList.remove("is-hidden");
  for (const region of document.querySelectorAll("main > :not(#summary-overlay)")) region.inert = true;
  elements.closeSummary?.focus?.();
}

function closeSummaryDialog() {
  if (!elements.summaryOverlay || elements.summaryOverlay.classList.contains("is-hidden")) return false;
  elements.summaryOverlay.classList.add("is-hidden");
  for (const region of document.querySelectorAll("main > :not(#summary-overlay)")) region.inert = false;
  return true;
}

function isSummaryOpen() {
  return Boolean(elements.summaryOverlay && !elements.summaryOverlay.classList.contains("is-hidden"));
}

function closeSummary() {
  closeSummaryDialog();
  endSession();
  rebuildDeck();
  const target = summaryReturnFocus?.isConnected && !summaryReturnFocus.closest?.(".is-hidden")
    ? summaryReturnFocus
    : elements.cardShell?.classList.contains("is-hidden") ? elements.emptyTitle : elements.flipCard;
  target?.focus?.({ preventScroll: true });
  summaryReturnFocus = null;
}

function endSession() {
  state.sessionActive = false;
  state.sessionCards = [];
  state.sessionIndex = 0;
  state.sessionResults = [];
  state.reinserts = {};
  state.undoStack = [];
  elements.undoToast?.classList.add("is-hidden");
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
