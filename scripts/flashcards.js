const state = {
  entries: [],
  deck: [],
  filter: "study",
  revealed: false,
  index: 0,
  shuffled: false
};

const elements = {};

document.addEventListener("DOMContentLoaded", async () => {
  elements.deckStatus = document.getElementById("deck-status");
  elements.deckFilter = document.getElementById("deck-filter");
  elements.shuffleDeck = document.getElementById("shuffle-deck");
  elements.emptyState = document.getElementById("empty-state");
  elements.cardShell = document.getElementById("card-shell");
  elements.progress = document.getElementById("progress");
  elements.flashcard = document.getElementById("flashcard");
  elements.cardWord = document.getElementById("card-word");
  elements.cardType = document.getElementById("card-type");
  elements.cardAnswer = document.getElementById("card-answer");
  elements.prevCard = document.getElementById("prev-card");
  elements.flipCard = document.getElementById("flip-card");
  elements.nextCard = document.getElementById("next-card");

  elements.deckFilter.addEventListener("change", onDeckFilterChange);
  elements.shuffleDeck.addEventListener("click", toggleShuffle);
  elements.flashcard.addEventListener("click", toggleReveal);
  elements.flipCard.addEventListener("click", toggleReveal);
  elements.prevCard.addEventListener("click", showPrevious);
  elements.nextCard.addEventListener("click", showNext);
  document.addEventListener("keydown", onKeyDown);
  chrome.storage?.onChanged?.addListener?.(handleStorageChange);

  await loadEntries();
});

window.addEventListener("unload", () => {
  document.removeEventListener("keydown", onKeyDown);
  chrome.storage?.onChanged?.removeListener?.(handleStorageChange);
});

async function loadEntries() {
  state.entries = await LodWrapperStore.getEntries();

  if (!state.entries.some((entry) => entry.study)) {
    state.filter = state.entries.some((entry) => entry.favorite) ? "favorites" : "all";
  }

  elements.deckFilter.value = state.filter;
  rebuildDeck();
}

function onDeckFilterChange(event) {
  state.filter = event.target.value;
  state.index = 0;
  state.revealed = false;
  rebuildDeck();
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "local") return;
  if (!changes?.[LodWrapperStore.STORAGE_KEY] && !changes?.[LodWrapperStore.LEGACY_STORAGE_KEY]) return;
  loadEntries();
}

function toggleShuffle() {
  state.shuffled = !state.shuffled;
  elements.shuffleDeck.textContent = state.shuffled ? "Unshuffle" : "Shuffle";
  rebuildDeck();
}

function onKeyDown(event) {
  if (event.key === "ArrowRight") {
    showNext();
  } else if (event.key === "ArrowLeft") {
    showPrevious();
  } else if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    toggleReveal();
  }
}

function makeDeck(entries) {
  if (state.filter === "study") {
    return entries.filter((entry) => entry.study);
  }
  if (state.filter === "favorites") {
    return entries.filter((entry) => entry.favorite);
  }
  return [...entries];
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
  state.deck = state.shuffled ? shuffle(baseDeck) : baseDeck;
  state.index = Math.min(state.index, Math.max(state.deck.length - 1, 0));
  state.revealed = false;
  renderDeck();
}

function currentEntry() {
  return state.deck[state.index] || null;
}

function renderDeck() {
  const entry = currentEntry();
  const count = state.deck.length;

  elements.deckStatus.textContent = count
    ? `${count} card${count === 1 ? "" : "s"} in this deck`
    : "No cards in this deck yet.";

  if (!entry) {
    elements.emptyState.classList.remove("is-hidden");
    elements.cardShell.classList.add("is-hidden");
    return;
  }

  elements.emptyState.classList.add("is-hidden");
  elements.cardShell.classList.remove("is-hidden");
  elements.progress.textContent = `${state.index + 1} / ${count}`;
  elements.cardWord.textContent = entry.word;
  elements.cardType.textContent = entry.pos || "";
  elements.cardAnswer.innerHTML = buildAnswerMarkup(entry);
  elements.flashcard.classList.toggle("is-revealed", state.revealed);
  elements.flipCard.textContent = state.revealed ? "Hide" : "Reveal";
  elements.prevCard.disabled = count <= 1;
  elements.nextCard.disabled = count <= 1;
}

function buildMeaningMarkup(entry) {
  const rows = Object.entries(LodWrapperStore.TRANSLATION_LANGUAGE_LABELS)
    .filter(([lang]) => entry.translations?.[lang])
    .map(
      ([lang, label]) => `
        <div class="meaning-row">
          <span class="meaning-label">${label}</span>
          <span class="meaning-value">${LodWrapperStore.escapeHtml(entry.translations[lang])}</span>
        </div>
      `
    )
    .join("");

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

function buildAnswerMarkup(entry) {
  const chips = [];
  if (entry.pos) {
    chips.push(`<span class="chip">Type: ${LodWrapperStore.escapeHtml(entry.pos)}</span>`);
  }

  return `
    <h3>${LodWrapperStore.escapeHtml(entry.word)}</h3>
    ${chips.length ? `<div class="chip-row">${chips.join("")}</div>` : ""}
    ${buildMeaningMarkup(entry)}
    ${entry.inflection ? `<p><strong>Inflection:</strong> ${LodWrapperStore.escapeHtml(entry.inflection)}</p>` : ""}
    ${entry.example ? `<blockquote>${LodWrapperStore.escapeHtml(entry.example)}</blockquote>` : ""}
    ${entry.note ? `<div class="note"><strong>Note:</strong> ${LodWrapperStore.escapeHtml(entry.note)}</div>` : ""}
    <p><a href="${LodWrapperStore.escapeHtml(entry.url)}" target="_blank" rel="noreferrer">Open on LOD</a></p>
  `;
}

function toggleReveal() {
  if (!state.deck.length) return;
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
