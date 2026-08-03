const state = {
  entries: [],
  deck: [],
  filter: "study",
  revealed: false,
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

const FLASHCARD_SETTINGS_KEY = "lodVault.flashcardSettings";
const FLASHCARD_SESSION_KEY = "lodVault.flashcardSession";
const DAILY_TARGETS = new Set([5, 10, 20]);
const DECK_FILTERS = new Set(["due", "study", "favorites", "all"]);
const ORDER_MODES = new Set(["smart", "shuffle", "sequential"]);
const STUDY_MODES = new Set(["self", "mc"]);
const elements = {};

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
  document.addEventListener("keydown", onKeyDown);
  elements.openPreview?.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("pages/preview.html") });
  });
  chrome.storage?.onChanged?.addListener?.(handleStorageChange);

  await Promise.all([loadEntries(), loadFlashcardMeta(), loadFlashcardState()]);
  computeStats();
  renderStats();
  renderResumeSession();
  rebuildDeck();
});

window.addEventListener("pagehide", () => {
  document.removeEventListener("keydown", onKeyDown);
  chrome.storage?.onChanged?.removeListener?.(handleStorageChange);
});

async function loadEntries() {
  state.entries = await LodVaultStore.getEntries();

  if (!state.entries.some((entry) => entry.study)) {
    state.filter = state.entries.some((entry) => entry.favorite) ? "favorites" : "all";
  }

  // Deep links (e.g. the popup's "Start review" banner) can request a
  // specific deck; it wins over the fallback above.
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
  const target = saved[FLASHCARD_SETTINGS_KEY]?.dailyTarget;
  state.dailyTarget = DAILY_TARGETS.has(Number(target)) ? Number(target) : target === null ? 0 : 10;
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

  state.filter = DECK_FILTERS.has(saved.filter) ? saved.filter : state.filter;
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
  const todayIso = new Date().toISOString().slice(0, 10);
  let todayCount = 0;
  let dueCount = 0;
  let newCount = 0;
  let learningCount = 0;
  let masteredCount = 0;
  const reviewDates = new Set();

  for (const [id, data] of Object.entries(meta)) {
    const m = normalizeFlashcardMeta(data);
    if (!m.totalReviews) continue;

    const dateSet = new Set(m.reviews.map((r) => r.date.slice(0, 10)));
    for (const d of dateSet) reviewDates.add(d);

    const last = m.reviews[m.reviews.length - 1];
    todayCount += m.reviews.filter((review) => review.date.slice(0, 10) === todayIso).length;

    if (m.easyCount >= 3 && last && last.rating === 3) {
      masteredCount += 1;
    } else {
      learningCount += 1;
    }
  }

  const now = Date.now();
  for (const entry of state.entries) {
    const m = meta[entry.id];
    if (!m || !m.totalReviews) {
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
  if (elements.statStreak) elements.statStreak.textContent = state.stats.streak;
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
  state.dailyTarget = DAILY_TARGETS.has(Number(event.target.value)) ? Number(event.target.value) : 0;
  await saveSettings();
  renderStats();
}

function onModeChange(event) {
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
  if (state.sessionActive) {
    renderDeck();
  } else {
    rebuildDeck();
  }
}

function toggleDirection() {
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
    target?.tagName === "SELECT"
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
  } else if (event.key === "1") {
    rateCard(1);
  } else if (event.key === "2") {
    rateCard(2);
  } else if (event.key === "3") {
    rateCard(3);
  } else if (event.key === "r" || event.key === "R") {
    toggleDirection();
  }
}

function isDue(entry, now = Date.now()) {
  const dueAt = state.flashcardMeta[entry?.id]?.dueAt;
  const dueTime = Date.parse(dueAt || "");
  return Number.isFinite(dueTime) && dueTime <= now;
}

function makeDeck(entries) {
  let base = [];
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

function rebuildDeck() {
  const baseDeck = makeDeck(state.entries);
  const size = state.sessionSize === "all" ? baseDeck.length : Number(state.sessionSize);
  state.sessionCards = baseDeck.slice(0, Math.min(size, baseDeck.length));
  state.sessionActive = state.sessionCards.length > 0 && state.sessionSize !== "all";
  state.sessionIndex = 0;
  state.sessionResults = [];
  state.deck = state.sessionActive ? state.sessionCards : baseDeck;
  if (state.sessionActive) void saveSession();
  state.index = Math.min(state.index, Math.max(state.deck.length - 1, 0));
  state.revealed = false;
  renderDeck();
}

function currentEntry() {
  return state.deck[state.index] || null;
}

function onAudioClick(event) {
  event.stopPropagation();
  const entry = currentEntry();
  if (entry) {
    LodVaultStore.playLodAudio(entry);
  }
}

function onFlashcardClick(event) {
  const audioBtn = event.target.closest(".audio-btn");
  if (audioBtn) {
    event.stopPropagation();
    const entry = currentEntry();
    if (entry) {
      LodVaultStore.playLodAudio(entry);
    }
    return;
  }
  toggleReveal();
}

function renderDeck() {
  const entry = currentEntry();
  const count = state.deck.length;

  if (elements.deckStatus) {
    elements.deckStatus.textContent = count
      ? `${count} card${count === 1 ? "" : "s"} in this deck`
      : "No cards in this deck yet.";
  }

  if (!entry) {
    elements.emptyState?.classList.remove("is-hidden");
    elements.cardShell?.classList.add("is-hidden");
    elements.summaryOverlay?.classList.add("is-hidden");
    elements.mcOptions?.classList.add("is-hidden");
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

  if (state.direction === "rev") {
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
    elements.cardAnswer.innerHTML = buildAnswerMarkup(entry);
  }

  if (elements.mcOptions) {
    const options = state.mode === "mc" ? buildMcOptions(entry) : [];
    elements.mcOptions.innerHTML = options.map((option) =>
      `<button type="button" class="mc-option" data-correct="${option.correct ? "1" : "0"}">${LodVaultStore.escapeHtml(option.text)}</button>`
    ).join("");
    elements.mcOptions.classList.toggle("is-hidden", state.mode !== "mc");
  }
  elements.flashcard?.classList.toggle("is-revealed", state.revealed);
  if (elements.flipCard) {
    elements.flipCard.textContent = state.revealed ? "Hide" : "Reveal";
    elements.flipCard.classList.toggle("is-hidden", state.mode === "mc");
  }
  if (elements.cardHint) {
    elements.cardHint.textContent = state.mode === "mc" ? "Choose the correct answer." : "Click Reveal to show the answer.";
  }

  if (elements.prevCard) elements.prevCard.disabled = state.sessionActive || count <= 1;
  if (elements.nextCard) elements.nextCard.disabled = state.sessionActive || count <= 1;

  if (state.revealed && count > 0) {
    elements.ratingBar?.classList.remove("is-hidden");
  } else {
    elements.ratingBar?.classList.add("is-hidden");
  }
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
  const answerText = state.direction === "rev" ? entry.word : mcAnswerText(entry);
  const options = [{ text: answerText, correct: true }];
  const seen = new Set([answerText]);
  for (const other of shuffle(state.deck.filter((candidate) => candidate.id !== entry.id))) {
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
  return (meaning && meaning.value) || entry.word;
}

function buildAnswerMarkup(entry) {
  const chips = [];
  if (entry.pos) {
    chips.push(`<span class="chip">Type: ${LodVaultStore.escapeHtml(entry.pos)}</span>`);
  }

  const directionBadge = state.direction === "rev"
    ? '<span class="chip">Reverse mode</span>'
    : "";

  return `
    <h3>${LodVaultStore.escapeHtml(entry.word)}${LodVaultStore.buildAudioBtnMarkup ? LodVaultStore.buildAudioBtnMarkup(entry) : ""}</h3>
    ${chips.length || directionBadge ? `<div class="chip-row">${chips.join("")}${directionBadge}</div>` : ""}
    ${buildMeaningMarkup(entry)}
    ${entry.inflection ? `<p><strong>Inflection:</strong> ${LodVaultStore.escapeHtml(entry.inflection)}</p>` : ""}
    ${entry.example ? `<blockquote>${LodVaultStore.escapeHtml(entry.example)}</blockquote>` : ""}
    ${entry.note ? `<div class="note"><strong>Note:</strong> ${LodVaultStore.escapeHtml(entry.note)}</div>` : ""}
    <p><a href="${LodVaultStore.escapeHtml(entry.url)}" target="_blank" rel="noreferrer">Open on LOD</a></p>
  `;
}

function toggleReveal() {
  if (state.mode === "mc" || !state.deck.length) return;
  state.revealed = !state.revealed;
  renderDeck();
}

function showPrevious() {
  if (state.deck.length <= 1) return;
  state.index = (state.index - 1 + state.deck.length) % state.deck.length;
  state.revealed = false;
  renderDeck();
}

function showNext() {
  if (state.deck.length <= 1) return;
  state.index = (state.index + 1) % state.deck.length;
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
    state.mcLocked = false;
    state.revealed = true;
    void rateCard(correct ? 2 : 1);
  }, 700);
}

async function rateCard(rating) {
  if (!state.revealed || !state.deck.length) return;
  const entry = currentEntry();
  if (!entry) return;

  if (typeof LodVaultStore.recordFlashcardReview === "function") {
    await LodVaultStore.recordFlashcardReview(entry.id, rating, state.direction);
    await loadFlashcardMeta();
    computeStats();
    renderStats();
  }

  state.sessionResults.push({ entryId: entry.id, rating, direction: state.direction });

  if (state.sessionActive) {
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
