const state = {
  currentTabId: null,
  currentEntry: null,
  savedEntries: [],
  searchQuery: ""
};

const elements = {};

document.addEventListener("DOMContentLoaded", async () => {
  elements.currentPageCard = document.getElementById("current-page-card");
  elements.currentWord = document.getElementById("current-word");
  elements.currentMeta = document.getElementById("current-meta");
  elements.currentFavorite = document.getElementById("current-favorite");
  elements.currentStudy = document.getElementById("current-study");
  elements.openFlashcards = document.getElementById("open-flashcards");
  elements.openPreview = document.getElementById("open-preview");
  elements.exportHtml = document.getElementById("export-html");
  elements.exportJson = document.getElementById("export-json");
  elements.importJson = document.getElementById("import-json");
  elements.importJsonFile = document.getElementById("import-json-file");
  elements.searchInput = document.getElementById("search-input");
  elements.searchStatus = document.getElementById("search-status");
  elements.savedList = document.getElementById("saved-list");
  elements.emptyState = document.getElementById("empty-state");
  elements.noResults = document.getElementById("no-results");
  elements.favoriteCount = document.getElementById("favorite-count");
  elements.studyCount = document.getElementById("study-count");
  elements.totalCount = document.getElementById("total-count");

  elements.currentFavorite.addEventListener("click", () => toggleCurrentPage("favorite"));
  elements.currentStudy.addEventListener("click", () => toggleCurrentPage("study"));
  elements.openFlashcards.addEventListener("click", openFlashcards);
  elements.openPreview.addEventListener("click", openPreview);
  elements.exportHtml.addEventListener("click", exportHtml);
  elements.exportJson.addEventListener("click", exportJson);
  elements.importJson.addEventListener("click", () => elements.importJsonFile.click());
  elements.importJsonFile.addEventListener("change", importJsonFile);
  elements.searchInput.addEventListener("input", onSearchInput);
  elements.savedList.addEventListener("click", onSavedListClick);
  elements.savedList.addEventListener("change", onSavedListChange);

  await refreshCurrentPage();
  await renderSavedList();
});

function setCurrentButtonState(button, active, kind) {
  if (kind === "favorite") {
    button.textContent = active ? "★ Favorited" : "☆ Favorite";
  } else {
    button.textContent = active ? "✓ Study list" : "+ Study list";
  }
  button.classList.toggle("is-active", active);
}

function meaningParts(entry) {
  const labels = {
    en: "English",
    fr: "Français",
    de: "Deutsch",
    pt: "Português",
    nl: "Nederlands"
  };

  return Object.entries(labels)
    .filter(([lang]) => entry?.translations?.[lang])
    .map(([lang, label]) => `${label}: ${entry.translations[lang]}`);
}

function meaningText(entry) {
  return meaningParts(entry).join(" · ");
}

function meaningMarkup(entry) {
  const parts = meaningParts(entry);
  if (!parts.length) return "";
  return parts.map((part) => `<span class="meaning-chip">${LodWrapperStore.escapeHtml(part)}</span>`).join("");
}

function renderCurrentPageCard(savedEntry) {
  if (!state.currentEntry) {
    elements.currentWord.textContent = "Open a LOD word page";
    elements.currentMeta.textContent = "This works on pages like https://lod.lu/artikel/SOZIALIST1. You can also use the save banner shown directly under the word title.";
    elements.currentFavorite.disabled = true;
    elements.currentStudy.disabled = true;
    setCurrentButtonState(elements.currentFavorite, false, "favorite");
    setCurrentButtonState(elements.currentStudy, false, "study");
    return;
  }

  const entry = savedEntry || state.currentEntry;
  const metaParts = [entry.pos, meaningText(entry)].filter(Boolean);

  elements.currentWord.textContent = state.currentEntry.word;
  elements.currentMeta.textContent = metaParts.join(" · ") || "Save this word for later.";
  elements.currentFavorite.disabled = false;
  elements.currentStudy.disabled = false;
  setCurrentButtonState(elements.currentFavorite, Boolean(savedEntry?.favorite), "favorite");
  setCurrentButtonState(elements.currentStudy, Boolean(savedEntry?.study), "study");
}

async function refreshCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.currentTabId = tab?.id || null;

  if (!tab?.id || !/https:\/\/(www\.)?lod\.lu\/artikel\//i.test(tab.url || "")) {
    state.currentEntry = null;
    renderCurrentPageCard(null);
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "lod-wrapper:get-current-entry" });
    state.currentEntry = response?.entry || null;
  } catch {
    state.currentEntry = null;
  }

  if (!state.currentEntry) {
    renderCurrentPageCard(null);
    return;
  }

  const savedEntry = await LodWrapperStore.getEntry(state.currentEntry.id);
  renderCurrentPageCard(savedEntry);
}

async function toggleCurrentPage(listName) {
  if (!state.currentTabId || !state.currentEntry) return;

  const button = listName === "favorite" ? elements.currentFavorite : elements.currentStudy;
  button.disabled = true;

  try {
    const response = await chrome.tabs.sendMessage(state.currentTabId, {
      type: "lod-wrapper:toggle-list",
      listName
    });

    if (response?.sourceEntry) {
      state.currentEntry = response.sourceEntry;
    }

    renderCurrentPageCard(response?.entry || null);
    await renderSavedList();
  } finally {
    button.disabled = false;
  }
}

function renderSummary(entries) {
  const favoriteCount = entries.filter((entry) => entry.favorite).length;
  const studyCount = entries.filter((entry) => entry.study).length;

  elements.favoriteCount.textContent = String(favoriteCount);
  elements.studyCount.textContent = String(studyCount);
  elements.totalCount.textContent = String(entries.length);
}

function formatSearchStatus(filteredCount, totalCount) {
  if (!state.searchQuery) {
    return `${totalCount} saved word${totalCount === 1 ? "" : "s"}`;
  }
  return `${filteredCount} match${filteredCount === 1 ? "" : "es"} · ${totalCount} total`;
}

function entrySubline(entry) {
  return entry.pos ? LodWrapperStore.escapeHtml(entry.pos) : "";
}

function filteredEntries(entries) {
  const query = state.searchQuery.trim().toLowerCase();
  if (!query) return entries;
  return entries.filter((entry) => LodWrapperStore.buildSearchText(entry).includes(query));
}

function buildSavedItemMarkup(entry) {
  return `
    <article class="saved-item" data-id="${LodWrapperStore.escapeHtml(entry.id)}">
      <div class="saved-item-top">
        <a href="${LodWrapperStore.escapeHtml(entry.url)}" target="_blank" rel="noreferrer" class="word-link">${LodWrapperStore.escapeHtml(entry.word)}</a>
        <div class="badges">
          ${entry.favorite ? '<span class="badge badge-favorite">Favorite</span>' : ""}
          ${entry.study ? '<span class="badge badge-study">Study</span>' : ""}
        </div>
      </div>
      ${entrySubline(entry) ? `<p class="item-meta">${entrySubline(entry)}</p>` : ""}
      ${meaningMarkup(entry) ? `<div class="item-meanings">${meaningMarkup(entry)}</div>` : ""}
      ${entry.example ? `<p class="item-example">${LodWrapperStore.escapeHtml(entry.example)}</p>` : ""}
      <div class="note-section">
        <label class="note-label" for="note-${LodWrapperStore.escapeHtml(entry.id)}">Note</label>
        <textarea id="note-${LodWrapperStore.escapeHtml(entry.id)}" class="note-input" data-note-id="${LodWrapperStore.escapeHtml(entry.id)}" placeholder="Add a note for this word...">${LodWrapperStore.escapeHtml(entry.note || "")}</textarea>
      </div>
      <div class="item-actions">
        <button data-action="toggle-favorite" data-id="${LodWrapperStore.escapeHtml(entry.id)}" class="mini-button ${entry.favorite ? "is-active" : ""}">★</button>
        <button data-action="toggle-study" data-id="${LodWrapperStore.escapeHtml(entry.id)}" class="mini-button ${entry.study ? "is-active" : ""}">📚</button>
        <button data-action="remove" data-id="${LodWrapperStore.escapeHtml(entry.id)}" class="mini-button mini-button-danger">Delete</button>
      </div>
    </article>
  `;
}

async function renderSavedList() {
  const entries = await LodWrapperStore.getEntries();
  state.savedEntries = entries;
  renderSummary(entries);

  const visibleEntries = filteredEntries(entries);
  elements.searchStatus.textContent = formatSearchStatus(visibleEntries.length, entries.length);

  if (!entries.length) {
    elements.savedList.innerHTML = "";
    elements.emptyState.classList.remove("is-hidden");
    elements.noResults.classList.add("is-hidden");
    await syncCurrentCardState();
    return;
  }

  elements.emptyState.classList.add("is-hidden");

  if (!visibleEntries.length) {
    elements.savedList.innerHTML = "";
    elements.noResults.classList.remove("is-hidden");
    await syncCurrentCardState();
    return;
  }

  elements.noResults.classList.add("is-hidden");
  elements.savedList.innerHTML = visibleEntries.map(buildSavedItemMarkup).join("");
  await syncCurrentCardState();
}

async function syncCurrentCardState() {
  if (!state.currentEntry) return;
  const savedEntry = await LodWrapperStore.getEntry(state.currentEntry.id);
  renderCurrentPageCard(savedEntry);

  if (state.currentTabId) {
    try {
      await chrome.tabs.sendMessage(state.currentTabId, {
        type: "lod-wrapper:sync-state",
        entry: savedEntry
      });
    } catch {
      // Ignore if the tab no longer has the content script.
    }
  }
}

function findEntry(id) {
  return state.savedEntries.find((entry) => entry.id === id) || null;
}

async function onSavedListClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const entry = findEntry(button.dataset.id);
  if (!entry) return;

  button.disabled = true;

  try {
    if (button.dataset.action === "remove") {
      await LodWrapperStore.removeEntry(entry.id);
    } else if (button.dataset.action === "toggle-favorite") {
      await LodWrapperStore.toggleList(entry, "favorite");
    } else if (button.dataset.action === "toggle-study") {
      await LodWrapperStore.toggleList(entry, "study");
    }

    await renderSavedList();
  } finally {
    button.disabled = false;
  }
}

async function onSavedListChange(event) {
  const textarea = event.target.closest("textarea[data-note-id]");
  if (!textarea) return;

  textarea.disabled = true;
  try {
    await LodWrapperStore.saveNote(textarea.dataset.noteId, textarea.value);
    await renderSavedList();
  } finally {
    textarea.disabled = false;
  }
}

function onSearchInput(event) {
  state.searchQuery = event.target.value || "";
  renderSavedList();
}

function openFlashcards() {
  chrome.tabs.create({ url: chrome.runtime.getURL("pages/flashcards.html") });
}

function openPreview() {
  chrome.tabs.create({ url: chrome.runtime.getURL("pages/preview.html") });
}

async function exportHtml() {
  const entries = await LodWrapperStore.getEntries();
  const html = LodWrapperStore.buildExportHtml(entries);
  const date = new Date().toISOString().slice(0, 10);
  LodWrapperStore.downloadTextFile(`lodvault-export-${date}.html`, html, "text/html");
}

async function exportJson() {
  const entries = await LodWrapperStore.getEntries();
  const json = LodWrapperStore.buildJsonExport(entries);
  const date = new Date().toISOString().slice(0, 10);
  LodWrapperStore.downloadTextFile(`lodvault-export-${date}.json`, json, "application/json");
}

async function importJsonFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    await LodWrapperStore.importJson(text);
    await renderSavedList();
    await refreshCurrentPage();
  } catch (error) {
    elements.searchStatus.textContent = "Could not import that JSON file.";
  } finally {
    event.target.value = "";
  }
}
