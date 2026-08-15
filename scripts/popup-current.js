// popup-current.js — Current-word feature module for the popup page.
//
// Owns the "Current word" card (word, audio, meanings, Favorite/Study/Delete
// actions), the current-word note textarea (via the shared note autosave
// controller), auto mode, and keeping the active lod.lu tab in sync with the
// saved state. Renders into the popup DOM through the shared ctx object.
//
// Cross-module calls (resolved lazily at runtime):
//   ctx.list.renderSavedList()      — after actions that change the vault
//   ctx.list.renderList()           — after a note save rerenders the list
//   ctx.showActionFeedback()        — transient action feedback toast
//   ctx.deleteUndo.deleteEntry()    — delete-with-undo for the current word
(() => {
  function createCurrentModule(ctx) {
    const { store, chromeApi, state, elements } = ctx;

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
          type: "lodvault:sync-state",
          entry: savedEntry
        });
      } catch {
        // Ignore if the tab no longer has the content script.
      }
    }

    function showNoteBody(noteBody) {
      noteBody.classList.remove("is-hidden");
      noteBody.closest(".note-section")?.querySelector(".note-toggle")?.classList.add("is-hidden");
    }

    function rerenderListPreservingNoteFocus(noteId) {
      const active = document.activeElement;
      const hadFocus = active?.matches?.('textarea[data-note-id]') && active.dataset.noteId === noteId;
      const selectionStart = hadFocus ? active.selectionStart : null;
      const selectionEnd = hadFocus ? active.selectionEnd : null;
      const selectionDirection = hadFocus ? active.selectionDirection : "none";

      ctx.list.renderList();

      if (!hadFocus) return;

      const next = Array.from(elements.savedList.querySelectorAll('textarea[data-note-id]'))
        .find((textarea) => textarea.dataset.noteId === noteId);
      if (!next) return;

      const noteBody = next.closest(".note-body");
      if (noteBody?.classList.contains("is-hidden")) {
        showNoteBody(noteBody);
      }

      next.focus();
      if (typeof selectionStart === "number" && typeof selectionEnd === "number") {
        next.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
      }
    }

    function syncCurrentNoteInput(savedEntry) {
      const textarea = elements.currentNoteInput;
      if (!textarea) return;

      if (!state.currentEntry) {
        ctx.noteAutosave.clear(textarea);
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
        ctx.noteAutosave.clear(textarea);
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
      ctx.noteAutosave.markDirty(event.target);
    }

    function onCurrentNoteCommit() {
      return ctx.noteAutosave.commit(elements.currentNoteInput);
    }

    function renderAutoMode() {
      const historyCount = state.savedEntries.filter((entry) => entry.history).length;

      elements.autoModeMeta.textContent = state.autoMode
        ? `${historyCount} word${historyCount === 1 ? "" : "s"} recorded automatically`
        : "Save visited words to Study & History.";
      elements.autoModeToggle.textContent = state.autoMode ? "Turn off" : "Turn on";
      elements.autoModeToggle.classList.toggle("is-active", state.autoMode);
      elements.autoModeTitle.textContent = state.autoMode ? "On" : "Off";
      elements.autoModeCard.classList.toggle("is-auto-on", state.autoMode);
    }

    function renderCurrentPageCard(savedEntry) {
      elements.currentPageCard.classList.toggle("is-empty", !state.currentEntry);

      if (!state.currentEntry) {
        elements.currentWord.textContent = "—";
        elements.currentAudio.style.display = "none";
        elements.currentMeta.textContent = state.autoMode
          ? "Words are saved automatically while you browse."
          : "Open a word on lod.lu to save it.";
        elements.currentMeanings.innerHTML = "";
        elements.currentFavorite.disabled = true;
        elements.currentStudy.disabled = true;
        elements.currentDelete.disabled = true;
        setCurrentButtonState(elements.currentFavorite, false, "favorite");
        setCurrentButtonState(elements.currentStudy, false, "study");
        syncCurrentNoteInput(null);
        return;
      }

      const entry = savedEntry || state.currentEntry;
      const posText = entry.pos || "";
      const meaningMarkup = store.buildMeaningCollapsibleMarkup(entry);

      elements.currentWord.textContent = state.currentEntry.word;
      const audioUrl = typeof store.getAudioUrl === "function" ? store.getAudioUrl(entry) : null;
      elements.currentAudio.style.display = audioUrl ? "" : "none";
      elements.currentAudio.dataset.audioId = entry.id || "";
      elements.currentMeta.textContent = posText || (state.autoMode
        ? "Auto mode is recording this word."
        : "Save this word for later.");
      LodVaultStore.setHtml(elements.currentMeanings, meaningMarkup || "");
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
        const response = await chromeApi.tabs.sendMessage(tab.id, { type: "lodvault:get-current-entry" });
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
          type: "lodvault:refresh-ui",
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
        await ctx.list.renderSavedList();
        ctx.showActionFeedback(`Auto mode ${state.autoMode ? "enabled" : "disabled"}.`);
      } finally {
        elements.autoModeToggle.disabled = false;
      }
    }

    async function toggleCurrentPage(listName) {
      if (!state.currentTabId || !state.currentEntry) return;

      const button = listName === "favorite" ? elements.currentFavorite : elements.currentStudy;
      button.disabled = true;

      try {
        const sourceEntry = state.currentEntry;
        const response = await chromeApi.tabs.sendMessage(state.currentTabId, {
          type: "lodvault:toggle-list",
          listName
        });

        ctx.showActionFeedback(typeof store.describeListAction === "function"
          ? store.describeListAction(sourceEntry, listName, response?.entry)
          : `Updated ${sourceEntry.word}.`);

        if (response?.sourceEntry) {
          state.currentEntry = response.sourceEntry;
        }

        renderCurrentPageCard(response?.entry || null);
        await ctx.list.renderSavedList();
      } catch {
        ctx.showActionFeedback("Could not update your vault.", "error");
      } finally {
        button.disabled = false;
      }
    }

    async function deleteCurrentPage() {
      if (!state.currentEntry) return;

      elements.currentDelete.disabled = true;

      try {
        const savedEntry = await store.getEntry(state.currentEntry.id);
        if (!savedEntry) return;
        await ctx.deleteUndo.deleteEntry(savedEntry);
        await ctx.list.renderSavedList();
      } finally {
        elements.currentDelete.disabled = false;
      }
    }

    async function syncCurrentCardState() {
      if (!state.currentEntry) return;
      const savedEntry = await store.getEntry(state.currentEntry.id);
      renderCurrentPageCard(savedEntry);

      if (state.currentTabId) {
        try {
          await chromeApi.tabs.sendMessage(state.currentTabId, {
            type: "lodvault:sync-state",
            entry: savedEntry
          });
        } catch {
          // Ignore if the tab no longer has the content script.
        }
      }
    }

    return {
      setCurrentNoteStatus,
      updateSavedEntryState,
      syncCurrentTabSavedEntry,
      showNoteBody,
      rerenderListPreservingNoteFocus,
      onCurrentNoteInput,
      onCurrentNoteCommit,
      renderAutoMode,
      renderCurrentPageCard,
      refreshCurrentPage,
      toggleAutoMode,
      toggleCurrentPage,
      deleteCurrentPage,
      syncCurrentCardState
    };
  }

  globalThis.LodVaultPopupCurrent = {
    create: createCurrentModule
  };
})();
