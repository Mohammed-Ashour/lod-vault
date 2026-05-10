(() => {
  function createApp(options = {}) {
    const store = options.store || globalThis.LodWrapperStore;
    const chromeApi = options.chrome || chrome;
    const HISTORY_IMPORT_RANGE_DAYS = Object.freeze({
      "7d": 7,
      "30d": 30,
      "90d": 90,
      "365d": 365,
      all: 0
    });
    const HISTORY_IMPORT_RANGE_LABELS = Object.freeze({
      "7d": "the last 7 days",
      "30d": "the last 30 days",
      "90d": "the last 90 days",
      "365d": "the last year",
      all: "all time"
    });

    const state = {
      currentTabId: null,
      currentEntry: null,
      savedEntries: [],
      searchQuery: "",
      autoMode: false,
      syncLanguages: [...(store.DEFAULT_SETTINGS?.syncLanguages || ["en", "fr", "de"])],
      syncLanguagesSaving: false,
      backups: [],
      backupsLoading: false,
      restoringBackupId: "",
      browserHistoryImporting: false,
      syncNowInProgress: false,
      historyImportRange: "all",
      historyImportReport: null,
      currentPageRequestId: 0
    };

    const elements = {};
    let initialized = false;
    const pendingSyncCapacityRefreshTimers = new Set();

    const noteAutosave = store.createNoteAutosaveController({
      getTimerKey: (textarea) => textarea === elements.currentNoteInput
        ? "current-note"
        : `saved-note:${textarea?.dataset?.noteId || ""}`,
      setStatus: (textarea, message) => {
        if (textarea === elements.currentNoteInput) {
          setCurrentNoteStatus(message);
        }
      },
      saveNote: async (noteId, requestValue) => {
        try {
          return await store.saveNote(noteId, requestValue);
        } catch (error) {
          const message = String(error || "");
          const isMissingEntry = message.includes("Entry not found");
          if (!isMissingEntry || !state.currentEntry || state.currentEntry.id !== noteId) {
            throw error;
          }

          const savedEntry = await store.toggleList(state.currentEntry, "study");
          if (!savedEntry) {
            throw error;
          }

          return store.saveNote(noteId, requestValue);
        }
      },
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

    async function handleStorageChange(changes, areaName) {
      if (areaName !== "local") return;

      const keys = [store.STORAGE_KEY, store.SETTINGS_KEY, store.BACKUP_KEY].filter(Boolean);
      if (!keys.some((key) => Object.prototype.hasOwnProperty.call(changes || {}, key))) {
        return;
      }

      await refreshSettingsState();
      renderAutoMode();
      renderSyncLanguages();
      renderBrowserHistoryImportAction();
      await renderSavedList();
      await refreshCurrentPage();
    }

    function setCurrentButtonState(button, active, kind) {
      const icon = button.querySelector(".toggle-pill-icon");
      if (kind === "favorite") {
        icon.textContent = active ? "★" : "☆";
        button.setAttribute("aria-pressed", active ? "true" : "false");
        button.title = active ? "Remove from favorites" : "Add to favorites";
      } else {
        icon.textContent = active ? "●" : "○";
        button.setAttribute("aria-pressed", active ? "true" : "false");
        button.title = active ? "Remove from study list" : "Add to study list";
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
      textarea.disabled = false;
      textarea.placeholder = savedEntry
        ? "Add a note for this word..."
        : "Add a note — saving will add this word to Study...";

      if (!isDirty && (!isFocused || !isSameEntry)) {
        textarea.value = savedValue;
      }

      if (!savedEntry) {
        noteAutosave.clear(textarea);
        if (!isDirty) {
          setCurrentNoteStatus("Add a note to save this word to Study.");
        }
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

    function getSyncNamespace() {
      return globalThis.LodWrapperSync;
    }

    function supportsManualSyncNow() {
      const sync = getSyncNamespace();
      return Boolean(sync?.SyncAdapter?.pushAll);
    }

    function setSyncNowStatus(message, tone = "") {
      if (!elements.syncNowStatus) return;
      elements.syncNowStatus.textContent = message;
      elements.syncNowStatus.classList.remove("is-success", "is-error");
      if (tone === "success") {
        elements.syncNowStatus.classList.add("is-success");
      } else if (tone === "error") {
        elements.syncNowStatus.classList.add("is-error");
      }
    }

    function renderSyncNowAction() {
      if (!elements.syncNowButton) return;

      if (!supportsManualSyncNow()) {
        elements.syncNowButton.classList.add("is-hidden");
        setSyncNowStatus("");
        return;
      }

      elements.syncNowButton.classList.remove("is-hidden");
      elements.syncNowButton.disabled = Boolean(
        state.syncNowInProgress
        || state.browserHistoryImporting
        || state.syncLanguagesSaving
      );
      elements.syncNowButton.textContent = state.syncNowInProgress ? "Syncing…" : "Sync now";
    }

    function clearScheduledSyncCapacityRefresh() {
      for (const timer of pendingSyncCapacityRefreshTimers) {
        clearTimeout(timer);
      }
      pendingSyncCapacityRefreshTimers.clear();
    }

    function scheduleSyncCapacityRefresh() {
      clearScheduledSyncCapacityRefresh();
      const delays = [1000, 3000];

      for (const delay of delays) {
        const timer = setTimeout(() => {
          pendingSyncCapacityRefreshTimers.delete(timer);
          renderSyncCapacity();
        }, delay);
        pendingSyncCapacityRefreshTimers.add(timer);
      }
    }

    function describeSyncFailure(result = {}) {
      if (result?.reason === "quota-exceeded") {
        return "Sync failed: storage quota exceeded. Try fewer sync languages.";
      }
      return "Sync failed. Try again.";
    }

    async function syncNow() {
      if (state.syncNowInProgress || !supportsManualSyncNow()) return;

      const sync = getSyncNamespace();
      state.syncNowInProgress = true;
      renderSyncNowAction();
      setSyncNowStatus("Syncing now…");

      try {
        if (typeof sync?.SyncAdapter?.init === "function") {
          await sync.SyncAdapter.init();
        }

        const result = await sync.SyncAdapter.pushAll();
        await renderSyncCapacity();
        scheduleSyncCapacityRefresh();

        if (result?.ok === false) {
          setSyncNowStatus(describeSyncFailure(result), "error");
        } else {
          const entryCount = Number(result?.entryCount);
          setSyncNowStatus(
            Number.isFinite(entryCount)
              ? `Sync complete · ${entryCount} words pushed.`
              : "Sync complete.",
            "success"
          );
        }
      } catch {
        setSyncNowStatus("Sync failed. Try again.", "error");
      } finally {
        state.syncNowInProgress = false;
        renderSyncNowAction();
      }
    }

    async function renderSyncCapacity() {
      const sync = getSyncNamespace();
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
      renderSyncNowAction();
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
        elements.currentAudio.style.display = "none";
        elements.currentMeta.textContent = state.autoMode
          ? "Words are saved automatically while you browse."
          : "Open a word on lod.lu to save it.";
        elements.currentFavorite.disabled = true;
        elements.currentStudy.disabled = true;
        elements.currentDelete.disabled = true;
        setCurrentButtonState(elements.currentFavorite, false, "favorite");
        setCurrentButtonState(elements.currentStudy, false, "study");
        syncCurrentNoteInput(null);
        return;
      }

      const entry = savedEntry || state.currentEntry;
      const metaParts = [entry.pos, store.buildMeaningText(entry)].filter(Boolean);

      elements.currentWord.textContent = state.currentEntry.word;
      const audioUrl = typeof store.getAudioUrl === "function" ? store.getAudioUrl(entry) : null;
      elements.currentAudio.style.display = audioUrl ? "" : "none";
      elements.currentAudio.dataset.audioId = entry.id || "";
      elements.currentMeta.textContent = metaParts.join(" · ") || (state.autoMode
        ? "Auto mode is recording this word."
        : "Save this word for later.");
      elements.currentFavorite.disabled = false;
      elements.currentStudy.disabled = false;
      elements.currentDelete.disabled = !savedEntry;
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

    async function deleteCurrentPage() {
      if (!state.currentEntry) return;

      elements.currentDelete.disabled = true;

      try {
        await store.removeEntry(state.currentEntry.id);
        await renderSavedList();
        const savedEntry = state.currentEntry ? await store.getEntry(state.currentEntry.id) : null;
        renderCurrentPageCard(savedEntry);
      } finally {
        elements.currentDelete.disabled = false;
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
            <span class="word-row">${typeof store.buildAudioBtnMarkup === "function" ? store.buildAudioBtnMarkup(entry) : ""}<a href="${store.escapeHtml(entry.url)}" target="_blank" rel="noreferrer" class="word-link">${store.escapeHtml(entry.word)}</a></span>
            <div class="item-controls">
              <button type="button" class="toggle-pill toggle-fav ${entry.favorite ? "is-active" : ""}" data-action="toggle-favorite" data-id="${store.escapeHtml(entry.id)}" aria-pressed="${entry.favorite ? "true" : "false"}" title="${entry.favorite ? "Remove from favorites" : "Add to favorites"}"><span class="toggle-pill-icon">${entry.favorite ? "★" : "☆"}</span><span class="toggle-pill-label">Fav</span></button>
              <button type="button" class="toggle-pill toggle-study ${entry.study ? "is-active" : ""}" data-action="toggle-study" data-id="${store.escapeHtml(entry.id)}" aria-pressed="${entry.study ? "true" : "false"}" title="${entry.study ? "Remove from study list" : "Add to study list"}"><span class="toggle-pill-icon">${entry.study ? "●" : "○"}</span><span class="toggle-pill-label">Study</span></button>
              <button type="button" class="control-btn control-delete" data-action="remove" data-id="${store.escapeHtml(entry.id)}" aria-label="Delete saved word" title="Delete saved word">×</button>
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
      await refreshBackups();
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
          : `<p class="list-overflow">Showing ${LIST_LIMIT} recent words. Type to search or open Vault to browse everything.</p>`;
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
      const audioBtn = event.target.closest(".audio-btn");
      if (audioBtn) {
        event.preventDefault();
        event.stopPropagation();
        const entry = findEntry(audioBtn.closest("[data-id]")?.dataset.id);
        if (entry && typeof store.playLodAudio === "function") {
          store.playLodAudio(entry);
        }
        return;
      }

      const button = event.target.closest("button[data-action]");
      if (!button || button.disabled) return;

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

    function supportsBackups() {
      return typeof store.getVaultBackups === "function"
        && typeof store.restoreVaultBackup === "function";
    }

    function setBackupStatus(message, tone = "") {
      if (!elements.backupStatus) return;
      elements.backupStatus.textContent = message;
      elements.backupStatus.classList.remove("is-success", "is-error");
      if (tone === "success") {
        elements.backupStatus.classList.add("is-success");
      } else if (tone === "error") {
        elements.backupStatus.classList.add("is-error");
      }
    }

    function buildBackupItemMarkup(backup) {
      const backupId = store.escapeHtml(backup.id || "");
      const count = Number(backup.entryCount) || 0;
      const countLabel = `${count} word${count === 1 ? "" : "s"}`;
      const reason = store.escapeHtml((backup.reason || "auto").replace(/-/g, " "));
      const when = store.escapeHtml(
        typeof store.formatWhen === "function"
          ? store.formatWhen(backup.createdAt)
          : (backup.createdAt || "")
      );
      const restoring = state.restoringBackupId && state.restoringBackupId === backup.id;
      const disabled = restoring || state.backupsLoading;

      return `
        <article class="backup-item" data-backup-id="${backupId}">
          <p class="backup-meta">${countLabel} · ${reason}<br>${when}</p>
          <button type="button" class="backup-restore" data-action="restore-backup" data-backup-id="${backupId}" ${disabled ? "disabled" : ""}>${restoring ? "Restoring…" : "Restore"}</button>
        </article>
      `;
    }

    function renderBackups(statusMessage = "", tone = "") {
      if (!elements.backupSection || !elements.backupList || !elements.backupStatus) return;

      if (!supportsBackups()) {
        elements.backupSection.classList.add("is-hidden");
        return;
      }

      elements.backupSection.classList.remove("is-hidden");
      elements.backupList.innerHTML = state.backups.map(buildBackupItemMarkup).join("");

      if (statusMessage) {
        setBackupStatus(statusMessage, tone);
        return;
      }

      if (state.backupsLoading) {
        setBackupStatus("Loading backups…");
        return;
      }

      if (!state.backups.length) {
        setBackupStatus("No local backups yet.");
        return;
      }

      setBackupStatus(`${state.backups.length} local backup snapshot${state.backups.length === 1 ? "" : "s"}.`);
    }

    async function refreshBackups() {
      if (!supportsBackups()) {
        renderBackups();
        return;
      }

      state.backupsLoading = true;
      renderBackups();

      try {
        const backups = await store.getVaultBackups(8);
        state.backups = Array.isArray(backups) ? backups : [];
        state.backupsLoading = false;
        renderBackups();
      } catch {
        state.backups = [];
        state.backupsLoading = false;
        renderBackups("Could not load local backups.", "error");
      }
    }

    async function onRefreshBackups() {
      await refreshBackups();
    }

    async function onBackupListClick(event) {
      const button = event.target.closest('button[data-action="restore-backup"]');
      if (!button || button.disabled) return;

      const backupId = button.dataset.backupId || "";
      const backup = state.backups.find((item) => item.id === backupId);
      if (!backup) return;

      const count = Number(backup.entryCount) || 0;
      const confirmed = typeof window?.confirm === "function"
        ? window.confirm(`Restore this local backup (${count} word${count === 1 ? "" : "s"})?\n\nThis merges into your current vault and keeps existing words.`)
        : true;
      if (!confirmed) return;

      state.restoringBackupId = backupId;
      renderBackups("Restoring backup…");

      let message = "";
      let tone = "";

      try {
        const result = await store.restoreVaultBackup(backupId);
        await refreshSettingsState();
        await renderSavedList();
        await refreshCurrentPage();
        await refreshBackups();
        message = `Backup restored · ${result?.entryCount || 0} words in vault.`;
        tone = "success";
      } catch {
        message = "Could not restore that backup.";
        tone = "error";
      } finally {
        state.restoringBackupId = "";
        renderBackups(message, tone);
      }
    }

    function openFlashcards() {
      chromeApi.tabs.create({ url: chromeApi.runtime.getURL("pages/flashcards.html") });
    }

    function openPreview() {
      chromeApi.tabs.create({ url: chromeApi.runtime.getURL("pages/preview.html") });
    }

    function setSearchStatusFeedback(message, tone = "") {
      elements.searchStatus.textContent = message;
      elements.searchStatus.classList.remove("is-success", "is-error");

      if (tone === "success") {
        elements.searchStatus.classList.add("is-success");
      } else if (tone === "error") {
        elements.searchStatus.classList.add("is-error");
      }
    }

    function clearSearchStatusToneAfter(delayMs = 4000) {
      setTimeout(() => {
        elements.searchStatus.classList.remove("is-success", "is-error");
      }, delayMs);
    }

    function normalizeHistoryImportRange(value) {
      const key = String(value || "");
      return Object.prototype.hasOwnProperty.call(HISTORY_IMPORT_RANGE_DAYS, key)
        ? key
        : "all";
    }

    function getHistoryImportStartTime(rangeKey) {
      const normalizedRange = normalizeHistoryImportRange(rangeKey);
      const days = Number(HISTORY_IMPORT_RANGE_DAYS[normalizedRange]) || 0;
      if (!days) return 0;

      const DAY_MS = 24 * 60 * 60 * 1000;
      return Math.max(0, Date.now() - (days * DAY_MS));
    }

    function getHistoryImportRangeLabel(rangeKey) {
      const normalizedRange = normalizeHistoryImportRange(rangeKey);
      return HISTORY_IMPORT_RANGE_LABELS[normalizedRange] || HISTORY_IMPORT_RANGE_LABELS.all;
    }

    function supportsBrowserHistoryImport() {
      return typeof store.importBrowserHistory === "function";
    }

    function renderBrowserHistoryImportAction() {
      if (!elements.importBrowserHistory) return;

      if (!supportsBrowserHistoryImport()) {
        elements.importBrowserHistory.classList.add("is-hidden");
        elements.importHistoryRangeRow?.classList.add("is-hidden");
        return;
      }

      elements.importBrowserHistory.classList.remove("is-hidden");
      elements.importHistoryRangeRow?.classList.remove("is-hidden");
      elements.importBrowserHistory.disabled = state.browserHistoryImporting;
      elements.importBrowserHistory.textContent = state.browserHistoryImporting
        ? "Importing…"
        : "Import history";

      if (elements.importHistoryRange) {
        elements.importHistoryRange.value = normalizeHistoryImportRange(state.historyImportRange);
        elements.importHistoryRange.disabled = state.browserHistoryImporting;
      }

      renderSyncNowAction();
    }

    function onHistoryImportRangeChange(event) {
      state.historyImportRange = normalizeHistoryImportRange(event?.target?.value);
      renderBrowserHistoryImportAction();
    }

    function renderHistoryImportReport() {
      if (!elements.importHistoryReport || !elements.importHistoryReportSummary || !elements.importHistoryReportList) {
        return;
      }

      const report = state.historyImportReport;
      if (!report) {
        elements.importHistoryReport.classList.add("is-hidden");
        elements.importHistoryReportSummary.textContent = "";
        elements.importHistoryReportList.innerHTML = "";
        return;
      }

      const scanned = Number(report.scanned) || 0;
      const imported = Number(report.imported) || 0;
      const skippedExisting = Number(report.skippedExisting) || 0;
      const ignored = Number(report.ignored) || 0;

      elements.importHistoryReportSummary.textContent = `Import report (${report.rangeLabel}): scanned ${scanned}, imported ${imported}, already saved ${skippedExisting}, ignored ${ignored}.`;

      const addedEntries = Array.isArray(report.addedEntries) ? report.addedEntries : [];
      if (!addedEntries.length) {
        elements.importHistoryReportList.innerHTML = "";
      } else {
        const chips = addedEntries
          .map((entry) => {
            const label = String(entry?.word || entry?.id || "").trim();
            return label
              ? `<span class="history-import-report-item">${store.escapeHtml(label)}</span>`
              : "";
          })
          .filter(Boolean);

        if (imported > addedEntries.length) {
          chips.push(`<span class="history-import-report-item">+${store.escapeHtml(String(imported - addedEntries.length))} more</span>`);
        }

        elements.importHistoryReportList.innerHTML = chips.join("");
      }

      elements.importHistoryReport.classList.remove("is-hidden");
    }

    async function requestBrowserHistoryPermission() {
      const permissionsApi = chromeApi.permissions;
      if (!permissionsApi || typeof permissionsApi.request !== "function") {
        return true;
      }

      try {
        const granted = await permissionsApi.request({ permissions: ["history"] });
        if (granted) return true;
      } catch {
        // Ignore and fallback to contains checks below.
      }

      if (typeof permissionsApi.contains === "function") {
        try {
          return Boolean(await permissionsApi.contains({ permissions: ["history"] }));
        } catch {
          return false;
        }
      }

      return false;
    }

    async function importFromBrowserHistory() {
      if (state.browserHistoryImporting || !supportsBrowserHistoryImport()) return;

      const selectedRange = normalizeHistoryImportRange(elements.importHistoryRange?.value || state.historyImportRange);
      const rangeLabel = getHistoryImportRangeLabel(selectedRange);
      const startTime = getHistoryImportStartTime(selectedRange);

      const confirmed = typeof window?.confirm === "function"
        ? window.confirm(`Import words from browser history on lod.lu (${rangeLabel})?\n\nThis only adds missing words to your vault and never removes existing words.`)
        : true;
      if (!confirmed) return;

      state.browserHistoryImporting = true;
      state.historyImportRange = selectedRange;
      renderBrowserHistoryImportAction();

      try {
        const permissionGranted = await requestBrowserHistoryPermission();
        if (!permissionGranted) {
          setSearchStatusFeedback("Browser history permission not granted.", "error");
          return;
        }

        const result = await store.importBrowserHistory({ maxResults: 20000, startTime });
        await renderSavedList();
        await refreshCurrentPage();

        const imported = Number(result?.imported) || 0;
        const scanned = Number(result?.scanned) || 0;
        const skippedExisting = Number(result?.skippedExisting) || 0;
        state.historyImportReport = {
          rangeLabel,
          imported,
          scanned,
          skippedExisting,
          ignored: Number(result?.ignored) || 0,
          addedEntries: Array.isArray(result?.addedEntries) ? result.addedEntries : []
        };
        renderHistoryImportReport();
        scheduleSyncCapacityRefresh();

        if (imported > 0) {
          setSearchStatusFeedback(
            `Imported ${imported} new word${imported === 1 ? "" : "s"} from browser history.`,
            "success"
          );
        } else {
          setSearchStatusFeedback(
            `No new words found (${scanned} scanned, ${skippedExisting} already saved).`
          );
        }
      } catch {
        setSearchStatusFeedback("Could not import from browser history.", "error");
      } finally {
        state.browserHistoryImporting = false;
        renderBrowserHistoryImportAction();
        clearSearchStatusToneAfter();
      }
    }

    async function exportHtml() {
      const entries = await store.getEntries();
      const html = store.buildExportHtml(entries);
      const date = new Date().toISOString().slice(0, 10);
      store.downloadTextFile(`lodvault-export-${date}.html`, html, "text/html");
    }

    async function exportAnki() {
      const entries = await store.getEntries();
      const text = store.buildAnkiExport(entries);
      const date = new Date().toISOString().slice(0, 10);
      store.downloadTextFile(`lodvault-anki-${date}.txt`, text, "text/tab-separated-values");
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
        const result = await store.importJson(text);
        await refreshSettingsState();
        renderAutoMode();
        renderSyncLanguages();
        await renderSavedList();
        await refreshCurrentPage();
        scheduleSyncCapacityRefresh();
        setSearchStatusFeedback(`Imported ${result.imported} word${result.imported === 1 ? "" : "s"}.`, "success");
      } catch {
        setSearchStatusFeedback("Could not import that JSON file.", "error");
      } finally {
        event.target.value = "";
        clearSearchStatusToneAfter();
      }
    }

    async function init() {
      if (initialized) return;
      initialized = true;

      elements.currentPageCard = document.getElementById("current-page-card");
      elements.currentWord = document.getElementById("current-word");
      elements.currentAudio = document.getElementById("current-audio");
      elements.currentMeta = document.getElementById("current-meta");
      elements.currentFavorite = document.getElementById("current-favorite");
      elements.currentStudy = document.getElementById("current-study");
      elements.currentDelete = document.getElementById("current-delete");
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
      elements.syncNowButton = document.getElementById("sync-now");
      elements.syncNowStatus = document.getElementById("sync-now-status");
      elements.openFlashcards = document.getElementById("open-flashcards");
      elements.openPreview = document.getElementById("open-preview");
      elements.exportHtml = document.getElementById("export-html");
      elements.exportAnki = document.getElementById("export-anki");
      elements.exportJson = document.getElementById("export-json");
      elements.importJson = document.getElementById("import-json");
      elements.importBrowserHistory = document.getElementById("import-browser-history");
      elements.importHistoryRangeRow = document.getElementById("import-history-range-row");
      elements.importHistoryRange = document.getElementById("import-history-range");
      elements.importHistoryReport = document.getElementById("import-history-report");
      elements.importHistoryReportSummary = document.getElementById("import-history-report-summary");
      elements.importHistoryReportList = document.getElementById("import-history-report-list");
      elements.importJsonFile = document.getElementById("import-json-file");
      elements.backupSection = document.getElementById("backup-section");
      elements.backupStatus = document.getElementById("backup-status");
      elements.backupList = document.getElementById("backup-list");
      elements.refreshBackups = document.getElementById("refresh-backups");
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
      elements.currentDelete.addEventListener("click", deleteCurrentPage);
      elements.currentAudio.addEventListener("click", () => {
        if (state.currentEntry && typeof store.playLodAudio === "function") {
          store.playLodAudio(state.currentEntry);
        }
      });
      elements.autoModeToggle.addEventListener("click", toggleAutoMode);
      elements.syncLanguageChips.addEventListener("click", onSyncLanguageChipClick);
      elements.syncNowButton?.addEventListener("click", syncNow);
      elements.openFlashcards.addEventListener("click", openFlashcards);
      elements.openPreview.addEventListener("click", openPreview);
      elements.exportHtml.addEventListener("click", exportHtml);
      elements.exportAnki.addEventListener("click", exportAnki);
      elements.exportJson.addEventListener("click", exportJson);
      elements.importJson.addEventListener("click", () => elements.importJsonFile.click());
      elements.importBrowserHistory?.addEventListener("click", importFromBrowserHistory);
      elements.importHistoryRange?.addEventListener("change", onHistoryImportRangeChange);
      elements.importJsonFile.addEventListener("change", importJsonFile);
      elements.searchInput.addEventListener("input", onSearchInput);
      elements.currentNoteInput.addEventListener("input", onCurrentNoteInput);
      elements.currentNoteInput.addEventListener("change", onCurrentNoteCommit);
      elements.currentNoteInput.addEventListener("blur", onCurrentNoteCommit);
      elements.savedList.addEventListener("click", onSavedListClick);
      elements.savedList.addEventListener("input", onSavedListInput);
      elements.savedList.addEventListener("change", onSavedListChange);
      elements.savedList.addEventListener("focusout", onSavedListFocusOut);
      elements.refreshBackups?.addEventListener("click", onRefreshBackups);
      elements.backupList?.addEventListener("click", onBackupListClick);

      chromeApi.tabs.onActivated.addListener(handleActiveTabChange);
      chromeApi.tabs.onUpdated.addListener(handleTabUpdated);
      chromeApi.runtime.onMessage.addListener(handlePageStateMessage);
      chromeApi.storage?.onChanged?.addListener(handleStorageChange);

      await refreshSettingsState();
      renderAutoMode();
      renderSyncLanguages();
      renderBrowserHistoryImportAction();
      renderHistoryImportReport();
      await refreshCurrentPage();
      await renderSavedList();
    }

    function destroy() {
      if (!initialized) return;
      chromeApi.tabs.onActivated.removeListener(handleActiveTabChange);
      chromeApi.tabs.onUpdated.removeListener(handleTabUpdated);
      chromeApi.runtime.onMessage.removeListener(handlePageStateMessage);
      chromeApi.storage?.onChanged?.removeListener?.(handleStorageChange);
      clearScheduledSyncCapacityRefresh();
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
