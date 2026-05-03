(() => {
  function createApp(options = {}) {
    const store = options.store || globalThis.LodWrapperStore;
    const chromeApi = options.chrome || chrome;

    const state = {
      currentTabId: null,
      currentEntry: null,
      savedEntries: [],
      searchQuery: "",
      autoMode: false,
      syncLanguages: [...(store.DEFAULT_SETTINGS?.syncLanguages || ["en", "fr", "de"])],
      syncLanguagesSaving: false,
      currentPageRequestId: 0
    };

    const elements = {};
    let initialized = false;

    const noteAutosave = store.createNoteAutosaveController({
      getTimerKey: (textarea) => textarea === elements.currentNoteInput
        ? "current-note"
        : `saved-note:${textarea?.dataset?.noteId || ""}`,
      setStatus: (textarea, message) => {
        if (textarea === elements.currentNoteInput) {
          setCurrentNoteStatus(message);
        }
      },
      saveNote: (noteId, requestValue) => store.saveNote(noteId, requestValue),
      onSaved: async ({ textarea, savedEntry, noteId, changedSinceRequest }) => {
        updateSavedEntryState(savedEntry);

        if (savedEntry?.id === state.currentEntry?.id) {
          renderCurrentPageCard(savedEntry);
          await syncCurrentTabSavedEntry(savedEntry);
        }

        if (!changedSinceRequest && state.searchQuery.trim()) {
          if (textarea === elements.currentNoteInput) {
            renderList();
          } else {
            rerenderListPreservingNoteFocus(noteId);
          }
        }
      },
      shouldKeepScheduling: (textarea) => Boolean(textarea?.isConnected)
    });

    async function handleActiveTabChange() {
      await refreshCurrentPage();
      await renderSavedList();
    }

    async function handleTabUpdated(tabId, changeInfo, tab) {
      if (!changeInfo.url && changeInfo.status !== "complete") return;
      if (!tab?.active) return;
      if (state.currentTabId && tabId !== state.currentTabId && !changeInfo.url) return;

      await refreshCurrentPage();
      await renderSavedList();
    }

    async function handlePageStateMessage(message, sender) {
      if (message?.type !== "lod-wrapper:page-state-changed") return;
      if (state.currentTabId && sender?.tab?.id && sender.tab.id !== state.currentTabId) return;

      state.currentEntry = message.entry || null;

      if (!state.currentEntry) {
        renderCurrentPageCard(null);
      } else {
        const savedEntry = message.savedEntry || (await store.getEntry(state.currentEntry.id));
        renderCurrentPageCard(savedEntry);
      }

      await renderSavedList();
    }

    function setCurrentButtonState(button, active, kind) {
      if (kind === "favorite") {
        button.textContent = active ? "★ Favorited" : "☆ Favorite";
      } else {
        button.textContent = active ? "✓ Study list" : "+ Study list";
      }
      button.classList.toggle("is-active", active);
    }

    function setCurrentNoteStatus(message) {
      elements.currentNoteStatus.textContent = message;
    }

    function updateSavedEntryState(updatedEntry) {
      if (!updatedEntry?.id) return;
      const index = state.savedEntries.findIndex((entry) => entry.id === updatedEntry.id);
      if (index === -1) return;
      state.savedEntries[index] = {
        ...state.savedEntries[index],
        ...updatedEntry
      };
    }

    async function syncCurrentTabSavedEntry(savedEntry) {
      if (!state.currentTabId || !savedEntry?.id || savedEntry.id !== state.currentEntry?.id) return;

      try {
        await chromeApi.tabs.sendMessage(state.currentTabId, {
          type: "lod-wrapper:sync-state",
          entry: savedEntry
        });
      } catch {
        // Ignore if the tab no longer has the content script.
      }
    }

    function rerenderListPreservingNoteFocus(noteId) {
      const active = document.activeElement;
      const hadFocus = active?.matches?.('textarea[data-note-id]') && active.dataset.noteId === noteId;
      const selectionStart = hadFocus ? active.selectionStart : null;
      const selectionEnd = hadFocus ? active.selectionEnd : null;
      const selectionDirection = hadFocus ? active.selectionDirection : "none";

      renderList();

      if (!hadFocus) return;

      const next = Array.from(elements.savedList.querySelectorAll('textarea[data-note-id]'))
        .find((textarea) => textarea.dataset.noteId === noteId);
      if (!next) return;

      next.focus();
      if (typeof selectionStart === "number" && typeof selectionEnd === "number") {
        next.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
      }
    }

    function syncCurrentNoteInput(savedEntry) {
      const textarea = elements.currentNoteInput;
      if (!textarea) return;

      if (!state.currentEntry) {
        noteAutosave.clear(textarea);
        textarea.value = "";
        textarea.dataset.noteId = "";
        textarea.dataset.savedValue = "";
        textarea.dataset.dirty = "";
        textarea.disabled = true;
        textarea.placeholder = "Save this word to add a note...";
        setCurrentNoteStatus("Open a word on lod.lu to add a note.");
        return;
      }

      const noteId = state.currentEntry.id || "";
      const savedValue = savedEntry?.note || "";
      const isSameEntry = textarea.dataset.noteId === noteId;
      const isDirty = isSameEntry && textarea.dataset.dirty === "true";
      const isFocused = document.activeElement === textarea;

      textarea.dataset.noteId = noteId;
      textarea.dataset.savedValue = savedValue;
      textarea.disabled = !savedEntry;
      textarea.placeholder = savedEntry ? "Add a note for this word..." : "Save this word to add a note...";

      if (!isDirty && (!isFocused || !isSameEntry)) {
        textarea.value = savedValue;
      }

      if (!savedEntry) {
        noteAutosave.clear(textarea);
        textarea.dataset.dirty = "";
        textarea.value = "";
        setCurrentNoteStatus("Save this word to Favorites or Study to add a note.");
        return;
      }

      if (!isDirty) {
        setCurrentNoteStatus(savedValue ? "Saved with this word." : "Add a short note — it saves automatically.");
      }
    }

    function onCurrentNoteInput(event) {
      noteAutosave.markDirty(event.target);
    }

    function onCurrentNoteCommit() {
      return noteAutosave.commit(elements.currentNoteInput);
    }

    async function refreshSettingsState() {
      const settings = await store.getSettings();
      state.autoMode = Boolean(settings?.autoMode);
      state.syncLanguages = Array.isArray(settings?.syncLanguages) && settings.syncLanguages.length
        ? [...settings.syncLanguages]
        : [...(store.DEFAULT_SETTINGS?.syncLanguages || ["en", "fr", "de"])];
    }

    function getSyncCapacityHint(selectedCount) {
      const capacityByCount = {
        1: 990,
        2: 830,
        3: 700
      };
      return capacityByCount[selectedCount] || capacityByCount[store.MAX_SYNC_LANGUAGES || 3];
    }

    function formatBytes(bytes) {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    async function renderSyncCapacity() {
      const sync = globalThis.LodWrapperSync;
      if (!sync || !sync.getSyncUsageStats) {
        elements.syncLanguageCapacity.textContent = `Sync: Est. ~${getSyncCapacityHint(state.syncLanguages.length)} words`;
        return;
      }

      try {
        const stats = await sync.getSyncUsageStats();
        const percentUsed = Math.min(100, stats.percentUsed || 0);
        const usedLabel = formatBytes(stats.bytesUsed || 0);
        const totalLabel = formatBytes(stats.bytesTotal || sync.SYNC_TOTAL_HARD_LIMIT || 102400);

        elements.syncCapacityFill.style.width = `${percentUsed}%`;
        elements.syncCapacityFill.classList.toggle("is-warning", percentUsed >= 70 && percentUsed < 90);
        elements.syncCapacityFill.classList.toggle("is-danger", percentUsed >= 90);

        if (stats.entryCount > 0) {
          elements.syncLanguageCapacity.textContent = `Sync: ${usedLabel} / ${totalLabel} used · ~${stats.estimatedRemaining} words fit`;
        } else {
          elements.syncLanguageCapacity.textContent = `Sync: 0 / ${totalLabel} used · ~${getSyncCapacityHint(state.syncLanguages.length)} words fit`;
        }
      } catch (_error) {
        elements.syncLanguageCapacity.textContent = `Sync: Est. ~${getSyncCapacityHint(state.syncLanguages.length)} words`;
      }
    }

    function buildSyncLanguageChipMarkup(language, selectedLanguages, maxSelected) {
      const selected = selectedLanguages.includes(language);
      const blockedByLimit = !selected && selectedLanguages.length >= maxSelected;
      const blockedByMinimum = selected && selectedLanguages.length <= 1;
      const disabled = state.syncLanguagesSaving || blockedByLimit || blockedByMinimum;
      const label = store.TRANSLATION_LANGUAGE_LABELS?.[language] || language.toUpperCase();
      const chipLabel = store.TRANSLATION_LANGUAGE_CHIP_LABELS?.[language] || language.toUpperCase();

      return `
        <button
          type="button"
          class="sync-language-chip ${selected ? "is-selected" : ""} ${disabled ? "is-disabled" : ""}"
          data-language="${store.escapeHtml(language)}"
          role="checkbox"
          aria-label="${store.escapeHtml(label)}"
          aria-checked="${selected}"
          aria-disabled="${disabled}"
          title="${store.escapeHtml(label)}"
        >
          <span class="sync-language-chip-code">${store.escapeHtml(chipLabel)}</span>
          <span class="sync-language-chip-label">${store.escapeHtml(label)}</span>
          ${selected ? '<span class="sync-language-chip-check" aria-hidden="true">✓</span>' : ""}
        </button>
      `;
    }

    function renderSyncLanguages() {
      const selectedLanguages = Array.isArray(state.syncLanguages) && state.syncLanguages.length
        ? state.syncLanguages
        : [...(store.DEFAULT_SETTINGS?.syncLanguages || ["en", "fr", "de"])];
      const maxSelected = store.MAX_SYNC_LANGUAGES || 3;
      const languageOrder = store.TRANSLATION_LANGUAGE_ORDER || Object.keys(store.TRANSLATION_LANGUAGE_LABELS || {});

      elements.syncLanguageChips.innerHTML = languageOrder
        .map((language) => buildSyncLanguageChipMarkup(language, selectedLanguages, maxSelected))
        .join("");
      elements.syncLanguageCount.textContent = `${selectedLanguages.length} of ${maxSelected} selected`;
      elements.syncLanguageCapacity.classList.toggle("sync-language-capacity", true);
      renderSyncCapacity();
    }

    async function toggleSyncLanguage(language) {
      if (!language || state.syncLanguagesSaving) return;

      const selectedLanguages = [...state.syncLanguages];
      const maxSelected = store.MAX_SYNC_LANGUAGES || 3;
      const isSelected = selectedLanguages.includes(language);

      if (isSelected && selectedLanguages.length <= 1) return;
      if (!isSelected && selectedLanguages.length >= maxSelected) return;

      const nextLanguages = isSelected
        ? selectedLanguages.filter((value) => value !== language)
        : [...selectedLanguages, language];
      const previousLanguages = [...selectedLanguages];

      state.syncLanguagesSaving = true;
      state.syncLanguages = nextLanguages;
      renderSyncLanguages();

      try {
        state.syncLanguages = Array.from(await store.setSyncLanguages(nextLanguages));
      } catch {
        state.syncLanguages = previousLanguages;
        elements.searchStatus.textContent = "Could not update sync languages.";
      } finally {
        state.syncLanguagesSaving = false;
        renderSyncLanguages();
      }
    }

    function onSyncLanguageChipClick(event) {
      const button = event.target.closest("button[data-language]");
      if (!button) return;
      if (button.getAttribute("aria-disabled") === "true") return;
      toggleSyncLanguage(button.dataset.language);
    }

    function renderAutoMode() {
      const historyCount = state.savedEntries.filter((entry) => entry.history).length;

      elements.autoModeMeta.textContent = state.autoMode
        ? `Saving visited words to Study & History · ${historyCount} in history`
        : "Saves every visited word to Study and History.";
      elements.autoModeToggle.textContent = state.autoMode ? "Turn off" : "Turn on";
      elements.autoModeToggle.classList.toggle("is-active", state.autoMode);
      elements.autoModeTitle.textContent = state.autoMode ? "On" : "Off";
      elements.autoModeBadge.classList.toggle("is-hidden", !state.autoMode);
      elements.autoModeCard.classList.toggle("is-auto-on", state.autoMode);
    }

    function renderCurrentPageCard(savedEntry) {
      if (!state.currentEntry) {
        elements.currentWord.textContent = "—";
        elements.currentMeta.textContent = state.autoMode
          ? "Words are saved automatically while you browse."
          : "Open a word on lod.lu to save it.";
        elements.currentFavorite.disabled = true;
        elements.currentStudy.disabled = true;
        setCurrentButtonState(elements.currentFavorite, false, "favorite");
        setCurrentButtonState(elements.currentStudy, false, "study");
        syncCurrentNoteInput(null);
        return;
      }

      const entry = savedEntry || state.currentEntry;
      const metaParts = [entry.pos, store.buildMeaningText(entry)].filter(Boolean);

      elements.currentWord.textContent = state.currentEntry.word;
      elements.currentMeta.textContent = metaParts.join(" · ") || (state.autoMode
        ? "Auto mode is recording this word."
        : "Save this word for later.");
      elements.currentFavorite.disabled = false;
      elements.currentStudy.disabled = false;
      setCurrentButtonState(elements.currentFavorite, Boolean(savedEntry?.favorite), "favorite");
      setCurrentButtonState(elements.currentStudy, Boolean(savedEntry?.study), "study");
      syncCurrentNoteInput(savedEntry || null);
    }

    async function refreshCurrentPage() {
      const requestId = ++state.currentPageRequestId;
      const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });

      if (requestId !== state.currentPageRequestId) return;

      state.currentTabId = tab?.id || null;

      if (!tab?.id || !/https:\/\/(www\.)?lod\.lu\/artikel\//i.test(tab.url || "")) {
        state.currentEntry = null;
        renderCurrentPageCard(null);
        return;
      }

      try {
        const response = await chromeApi.tabs.sendMessage(tab.id, { type: "lod-wrapper:get-current-entry" });
        if (requestId !== state.currentPageRequestId) return;
        state.currentEntry = response?.entry || null;
      } catch {
        if (requestId !== state.currentPageRequestId) return;
        state.currentEntry = null;
      }

      if (!state.currentEntry) {
        renderCurrentPageCard(null);
        return;
      }

      const savedEntry = await store.getEntry(state.currentEntry.id);
      if (requestId !== state.currentPageRequestId) return;
      renderCurrentPageCard(savedEntry);
    }

    async function notifyCurrentTabAboutAutoModeChange(options = {}) {
      if (!state.currentTabId) return;

      try {
        await chromeApi.tabs.sendMessage(state.currentTabId, {
          type: "lod-wrapper:refresh-ui",
          ...options
        });
      } catch {
        // Ignore if there is no content script on the current tab.
      }
    }

    async function toggleAutoMode() {
      elements.autoModeToggle.disabled = true;

      try {
        state.autoMode = await store.setAutoMode(!state.autoMode);
        renderAutoMode();

        if (state.autoMode && state.currentEntry?.id && state.currentEntry?.word) {
          await store.recordAutoVisit(state.currentEntry);
          await notifyCurrentTabAboutAutoModeChange({
            autoRecordKey: `${state.currentEntry.id}|${state.currentEntry.url}`
          });
        } else {
          await notifyCurrentTabAboutAutoModeChange({ resetAutoCapture: true });
        }

        await refreshCurrentPage();
        await renderSavedList();
      } finally {
        elements.autoModeToggle.disabled = false;
      }
    }

    async function toggleCurrentPage(listName) {
      if (!state.currentTabId || !state.currentEntry) return;

      const button = listName === "favorite" ? elements.currentFavorite : elements.currentStudy;
      button.disabled = true;

      try {
        const response = await chromeApi.tabs.sendMessage(state.currentTabId, {
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
      const historyCount = entries.filter((entry) => entry.history).length;

      elements.favoriteCount.textContent = String(favoriteCount);
      elements.studyCount.textContent = String(studyCount);
      elements.historyCount.textContent = String(historyCount);
      elements.totalCount.textContent = String(entries.length);
    }

    const LIST_LIMIT = 10;

    function formatSearchStatus(filteredCount, totalCount) {
      if (!state.searchQuery) {
        if (!totalCount) return "0 saved words";
        const visibleCount = Math.min(totalCount, LIST_LIMIT);
        return `${totalCount} saved word${totalCount === 1 ? "" : "s"} · showing ${visibleCount} recent`;
      }
      return `${filteredCount} match${filteredCount === 1 ? "" : "es"} · ${totalCount} total`;
    }

    function entrySubline(entry) {
      const parts = [];
      if (entry.pos) parts.push(entry.pos);
      if (entry.history) {
        const count = entry.visitCount || 1;
        parts.push(`Visited ${count} time${count === 1 ? "" : "s"}`);
      }
      return parts.length ? store.escapeHtml(parts.join(" · ")) : "";
    }

    function filteredEntries(entries) {
      const query = state.searchQuery.trim().toLowerCase();
      if (!query) return entries;
      return entries.filter((entry) => store.buildSearchText(entry).includes(query));
    }

    function buildSavedItemMarkup(entry) {
      const lastVisitedText = entry.history && entry.lastVisitedAt
        ? `<p class="item-meta">Last visited ${store.escapeHtml(store.formatWhen(entry.lastVisitedAt))}</p>`
        : "";

      return `
        <article class="saved-item" data-id="${store.escapeHtml(entry.id)}">
          <div class="saved-item-top">
            <a href="${store.escapeHtml(entry.url)}" target="_blank" rel="noreferrer" class="word-link">${store.escapeHtml(entry.word)}</a>
            <div class="badges">
              ${entry.favorite ? '<span class="badge badge-favorite">Favorite</span>' : ""}
              ${entry.study ? '<span class="badge badge-study">Study</span>' : ""}
              ${entry.history ? '<span class="badge badge-history">History</span>' : ""}
            </div>
          </div>
          ${entrySubline(entry) ? `<p class="item-meta">${entrySubline(entry)}</p>` : ""}
          ${lastVisitedText}
          ${store.buildMeaningChipsMarkup(entry) ? `<div class="item-meanings">${store.buildMeaningChipsMarkup(entry)}</div>` : ""}
          ${entry.example ? `<p class="item-example">${store.escapeHtml(entry.example)}</p>` : ""}
          <div class="note-section">
            <label class="note-label" for="note-${store.escapeHtml(entry.id)}">Note</label>
            <textarea id="note-${store.escapeHtml(entry.id)}" class="note-input" data-note-id="${store.escapeHtml(entry.id)}" data-saved-value="${store.escapeHtml(entry.note || "")}" placeholder="Add a note for this word...">${store.escapeHtml(entry.note || "")}</textarea>
          </div>
          <div class="item-actions">
            <button data-action="toggle-favorite" data-id="${store.escapeHtml(entry.id)}" class="mini-button ${entry.favorite ? "is-active" : ""}" aria-label="${entry.favorite ? "Remove from favorites" : "Add to favorites"}" title="${entry.favorite ? "Remove from favorites" : "Add to favorites"}">★</button>
            <button data-action="toggle-study" data-id="${store.escapeHtml(entry.id)}" class="mini-button ${entry.study ? "is-active" : ""}" aria-label="${entry.study ? "Remove from study list" : "Add to study list"}" title="${entry.study ? "Remove from study list" : "Add to study list"}">📚</button>
            <button data-action="remove" data-id="${store.escapeHtml(entry.id)}" class="mini-button mini-button-danger" aria-label="Delete saved word" title="Delete saved word">Delete</button>
          </div>
        </article>
      `;
    }

    async function renderSavedList() {
      const entries = await store.getEntries();
      state.savedEntries = entries;
      renderSummary(entries);
      renderAutoMode();
      renderSyncLanguages();
      renderList();
      await syncCurrentCardState();
    }

    function renderList() {
      const entries = state.savedEntries;
      const visibleEntries = filteredEntries(entries);
      const hasQuery = state.searchQuery.trim().length > 0;
      const displayEntries = hasQuery ? visibleEntries : entries;

      elements.searchStatus.textContent = formatSearchStatus(visibleEntries.length, entries.length);

      if (!entries.length) {
        elements.savedList.innerHTML = "";
        elements.emptyState.classList.remove("is-hidden");
        elements.noResults.classList.add("is-hidden");
        return;
      }

      if (hasQuery && !visibleEntries.length) {
        elements.savedList.innerHTML = "";
        elements.emptyState.classList.add("is-hidden");
        elements.noResults.classList.remove("is-hidden");
        return;
      }

      elements.emptyState.classList.add("is-hidden");
      elements.noResults.classList.add("is-hidden");
      const capped = displayEntries.slice(0, LIST_LIMIT);
      elements.savedList.innerHTML = capped.map(buildSavedItemMarkup).join("");

      if (displayEntries.length > LIST_LIMIT) {
        elements.savedList.innerHTML += hasQuery
          ? `<p class="list-overflow">Showing ${LIST_LIMIT} of ${displayEntries.length} matches. Refine your search to narrow down.</p>`
          : `<p class="list-overflow">Showing ${LIST_LIMIT} recent words. Type to search or open Preview to browse everything.</p>`;
      }
    }

    async function syncCurrentCardState() {
      if (!state.currentEntry) return;
      const savedEntry = await store.getEntry(state.currentEntry.id);
      renderCurrentPageCard(savedEntry);

      if (state.currentTabId) {
        try {
          await chromeApi.tabs.sendMessage(state.currentTabId, {
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
          await store.removeEntry(entry.id);
        } else if (button.dataset.action === "toggle-favorite") {
          await store.toggleList(entry, "favorite");
        } else if (button.dataset.action === "toggle-study") {
          await store.toggleList(entry, "study");
        }

        await renderSavedList();
      } finally {
        button.disabled = false;
      }
    }

    function onSavedListInput(event) {
      const textarea = event.target.closest("textarea[data-note-id]");
      if (!textarea) return;
      noteAutosave.markDirty(textarea);
    }

    function onSavedListChange(event) {
      const textarea = event.target.closest("textarea[data-note-id]");
      if (!textarea) return;
      noteAutosave.commit(textarea);
    }

    function onSavedListFocusOut(event) {
      const textarea = event.target.closest("textarea[data-note-id]");
      if (!textarea) return;
      noteAutosave.commit(textarea);
    }

    function onSearchInput(event) {
      state.searchQuery = event.target.value || "";
      renderList();
    }

    function openFlashcards() {
      chromeApi.tabs.create({ url: chromeApi.runtime.getURL("pages/flashcards.html") });
    }

    function openPreview() {
      chromeApi.tabs.create({ url: chromeApi.runtime.getURL("pages/preview.html") });
    }

    async function exportHtml() {
      const entries = await store.getEntries();
      const html = store.buildExportHtml(entries);
      const date = new Date().toISOString().slice(0, 10);
      store.downloadTextFile(`lodvault-export-${date}.html`, html, "text/html");
    }

    async function exportJson() {
      const [entries, settings] = await Promise.all([
        store.getEntries(),
        store.getSettings()
      ]);
      const json = store.buildJsonExport(entries, { settings });
      const date = new Date().toISOString().slice(0, 10);
      store.downloadTextFile(`lodvault-export-${date}.json`, json, "application/json");
    }

    async function importJsonFile(event) {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        await store.importJson(text);
        await refreshSettingsState();
        renderAutoMode();
        renderSyncLanguages();
        await renderSavedList();
        await refreshCurrentPage();
      } catch {
        elements.searchStatus.textContent = "Could not import that JSON file.";
      } finally {
        event.target.value = "";
      }
    }

    async function init() {
      if (initialized) return;
      initialized = true;

      elements.currentPageCard = document.getElementById("current-page-card");
      elements.currentWord = document.getElementById("current-word");
      elements.currentMeta = document.getElementById("current-meta");
      elements.currentFavorite = document.getElementById("current-favorite");
      elements.currentStudy = document.getElementById("current-study");
      elements.currentNoteInput = document.getElementById("current-note");
      elements.currentNoteStatus = document.getElementById("current-note-status");
      elements.autoModeBadge = document.getElementById("auto-mode-badge");
      elements.autoModeCard = document.querySelector(".auto-mode-card");
      elements.autoModeTitle = document.getElementById("auto-mode-title");
      elements.autoModeMeta = document.getElementById("auto-mode-meta");
      elements.autoModeToggle = document.getElementById("toggle-auto-mode");
      elements.syncLanguageChips = document.getElementById("sync-language-chips");
      elements.syncLanguageCount = document.getElementById("sync-language-count");
      elements.syncLanguageCapacity = document.getElementById("sync-language-capacity");
      elements.syncCapacityBar = document.getElementById("sync-capacity-bar");
      elements.syncCapacityFill = document.getElementById("sync-capacity-fill");
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
      elements.historyCount = document.getElementById("history-count");
      elements.totalCount = document.getElementById("total-count");

      elements.currentFavorite.addEventListener("click", () => toggleCurrentPage("favorite"));
      elements.currentStudy.addEventListener("click", () => toggleCurrentPage("study"));
      elements.autoModeToggle.addEventListener("click", toggleAutoMode);
      elements.syncLanguageChips.addEventListener("click", onSyncLanguageChipClick);
      elements.openFlashcards.addEventListener("click", openFlashcards);
      elements.openPreview.addEventListener("click", openPreview);
      elements.exportHtml.addEventListener("click", exportHtml);
      elements.exportJson.addEventListener("click", exportJson);
      elements.importJson.addEventListener("click", () => elements.importJsonFile.click());
      elements.importJsonFile.addEventListener("change", importJsonFile);
      elements.searchInput.addEventListener("input", onSearchInput);
      elements.currentNoteInput.addEventListener("input", onCurrentNoteInput);
      elements.currentNoteInput.addEventListener("change", onCurrentNoteCommit);
      elements.currentNoteInput.addEventListener("blur", onCurrentNoteCommit);
      elements.savedList.addEventListener("click", onSavedListClick);
      elements.savedList.addEventListener("input", onSavedListInput);
      elements.savedList.addEventListener("change", onSavedListChange);
      elements.savedList.addEventListener("focusout", onSavedListFocusOut);

      chromeApi.tabs.onActivated.addListener(handleActiveTabChange);
      chromeApi.tabs.onUpdated.addListener(handleTabUpdated);
      chromeApi.runtime.onMessage.addListener(handlePageStateMessage);

      await refreshSettingsState();
      renderAutoMode();
      renderSyncLanguages();
      await refreshCurrentPage();
      await renderSavedList();
    }

    function destroy() {
      if (!initialized) return;
      chromeApi.tabs.onActivated.removeListener(handleActiveTabChange);
      chromeApi.tabs.onUpdated.removeListener(handleTabUpdated);
      chromeApi.runtime.onMessage.removeListener(handlePageStateMessage);
      noteAutosave.destroy();
      initialized = false;
    }

    return {
      state,
      elements,
      init,
      destroy,
      renderList,
      renderSavedList,
      refreshCurrentPage,
      formatSearchStatus
    };
  }

  globalThis.LodWrapperPopupApp = {
    createApp
  };
})();
