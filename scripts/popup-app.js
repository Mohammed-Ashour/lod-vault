// popup-app.js — Composition root for the popup page.
//
// Creates the shared ctx object (store, chrome API, state, elements), the
// shared services (action feedback, note autosave, delete-with-undo), and the
// four feature modules that render the popup sections:
//
//   popup-sync.js    — sync panel (chips, capacity, sync now/pull/retry)
//   popup-current.js — current word card, note, auto mode
//   popup-list.js    — saved list, search, stats
//   popup-backup.js  — exports, imports, portable backup
//   popup-study.js   — study card (due/new counts, today progress, start review)
//
// This file only wires modules together: element lookup, event listeners,
// tab/storage/message routing and the init/destroy lifecycle. Feature logic
// lives in the modules above; cross-module calls go through ctx.sync /
// ctx.current / ctx.list / ctx.backup (resolved lazily at runtime).
(() => {
  function createApp(options = {}) {
    const store = options.store || globalThis.LodVaultStore;
    const chromeApi = options.chrome || chrome;

    const state = {
      currentTabId: null,
      currentEntry: null,
      savedEntries: [],
      searchQuery: "",
      autoMode: false,
      syncLanguages: [...(store.DEFAULT_SETTINGS?.syncLanguages || ["en", "fr", "de"])],
      lastVerifiedSyncAt: "",
      syncLanguagesSaving: false,
      portableBackupMeta: {
        lastExportedAt: "",
        entryCount: 0
      },
      portableBackupReady: false,
      browserHistoryImporting: false,
      syncNowInProgress: false,
      syncPullInProgress: false,
      historyImportRange: "all",
      historyImportReport: null,
      currentPageRequestId: 0
    };

    const elements = {};
    let initialized = false;
    let actionFeedbackTimer = null;

    const ctx = {
      store,
      chromeApi,
      state,
      elements
    };

    function showActionFeedback(message, tone = "success") {
      if (!elements.actionFeedback) return;
      if (actionFeedbackTimer) clearTimeout(actionFeedbackTimer);
      elements.actionFeedback.textContent = message;
      elements.actionFeedback.classList.toggle("is-error", tone === "error");
      elements.actionFeedback.classList.remove("is-hidden");
      actionFeedbackTimer = setTimeout(() => {
        elements.actionFeedback?.classList.add("is-hidden");
      }, 5000);
    }
    ctx.showActionFeedback = showActionFeedback;

    // Feature modules. Each renders one popup section and coordinates with the
    // others through ctx. They must exist before createApp runs (see popup.html
    // and tests/helpers/loaders.js for the script load order).
    ctx.sync = globalThis.LodVaultPopupSync.create(ctx);
    ctx.current = globalThis.LodVaultPopupCurrent.create(ctx);
    ctx.list = globalThis.LodVaultPopupList.create(ctx);
    ctx.backup = globalThis.LodVaultPopupBackup.create(ctx);
    ctx.study = globalThis.LodVaultPopupStudy.create(ctx);

    // Note autosave coordinator. Shared by the current-word textarea and the
    // saved-list note textareas; routes saves through the store and refreshes
    // whichever section changed.
    const noteAutosave = store.createNoteAutosaveController({
      getTimerKey: (textarea) => textarea === elements.currentNoteInput
        ? "current-note"
        : `saved-note:${textarea?.dataset?.noteId || ""}`,
      setStatus: (textarea, message) => {
        if (textarea === elements.currentNoteInput) {
          ctx.current.setCurrentNoteStatus(message);
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
        ctx.current.updateSavedEntryState(savedEntry);

        if (savedEntry?.id === state.currentEntry?.id) {
          ctx.current.renderCurrentPageCard(savedEntry);
          await ctx.current.syncCurrentTabSavedEntry(savedEntry);
        }

        if (!changedSinceRequest && state.searchQuery.trim()) {
          if (textarea === elements.currentNoteInput) {
            ctx.list.renderList();
          } else {
            ctx.current.rerenderListPreservingNoteFocus(noteId);
          }
        }
      },
      shouldKeepScheduling: (textarea) => Boolean(textarea?.isConnected)
    });
    ctx.noteAutosave = noteAutosave;

    // Delete-with-undo service. Shared by the current-word card and the saved
    // list; the undo action restores the entry and refreshes both sections.
    let deleteUndoTimer = null;
    let pendingDeletedEntry = null;

    function hideDeleteUndo() {
      if (deleteUndoTimer) {
        clearTimeout(deleteUndoTimer);
        deleteUndoTimer = null;
      }
      pendingDeletedEntry = null;
      elements.deleteUndo?.classList.add("is-hidden");
    }

    function showDeleteUndo(entry) {
      if (!entry?.id) return;
      if (deleteUndoTimer) clearTimeout(deleteUndoTimer);
      pendingDeletedEntry = JSON.parse(JSON.stringify(entry));
      elements.deleteUndoMessage.textContent = `Removed ${entry.word}.`;
      elements.deleteUndo.classList.remove("is-hidden");
      deleteUndoTimer = setTimeout(hideDeleteUndo, 8000);
    }

    const deleteUndo = {
      hide: hideDeleteUndo,
      async deleteEntry(entry) {
        if (!entry?.id) return;
        await store.removeEntry(entry.id);
        showDeleteUndo(entry);
      },
      async onUndoClick() {
        if (!pendingDeletedEntry) return;
        const entry = pendingDeletedEntry;
        elements.deleteUndoButton.disabled = true;

        try {
          await store.restoreEntry(entry);
          hideDeleteUndo();
          await ctx.list.renderSavedList();
          const savedEntry = state.currentEntry ? await store.getEntry(state.currentEntry.id) : null;
          ctx.current.renderCurrentPageCard(savedEntry);
        } finally {
          elements.deleteUndoButton.disabled = false;
        }
      }
    };
    ctx.deleteUndo = deleteUndo;

    async function handleActiveTabChange() {
      await ctx.current.refreshCurrentPage();
    }

    async function handleTabUpdated(tabId, changeInfo, tab) {
      if (!changeInfo.url && changeInfo.status !== "complete") return;
      if (!tab?.active) return;
      if (state.currentTabId && tabId !== state.currentTabId && !changeInfo.url) return;

      await ctx.current.refreshCurrentPage();
    }

    async function handlePageStateMessage(message, sender) {
      if (message?.type !== "lodvault:page-state-changed") return;
      if (state.currentTabId && sender?.tab?.id && sender.tab.id !== state.currentTabId) return;

      state.currentEntry = message.entry || null;

      if (!state.currentEntry) {
        ctx.current.renderCurrentPageCard(null);
      } else {
        const savedEntry = message.savedEntry || (await store.getEntry(state.currentEntry.id));
        ctx.current.renderCurrentPageCard(savedEntry);
      }

      await ctx.list.renderSavedList();
    }

    async function handleStorageChange(changes, areaName) {
      if (areaName === "sync") {
        const hasSyncVaultChange = Object.keys(changes || {}).some((key) => (
          key === "lodVault.m"
          || key === "lodVault.s"
          || key === "lodVault.d"
          || key.startsWith("lodVault.e.")
        ));
        if (hasSyncVaultChange) {
          await ctx.sync.refreshDataStatus();
        }
        return;
      }

      if (areaName !== "local") return;

      const hasEntriesChange = Boolean(
        store.STORAGE_KEY && Object.prototype.hasOwnProperty.call(changes || {}, store.STORAGE_KEY)
      );
      const hasSettingsChange = Boolean(
        store.SETTINGS_KEY && Object.prototype.hasOwnProperty.call(changes || {}, store.SETTINGS_KEY)
      );
      const hasPortableBackupChange = Boolean(
        store.PORTABLE_BACKUP_KEY && Object.prototype.hasOwnProperty.call(changes || {}, store.PORTABLE_BACKUP_KEY)
      );
      const hasHistoryImportStateChange = Boolean(
        store.HISTORY_IMPORT_STATE_KEY && Object.prototype.hasOwnProperty.call(changes || {}, store.HISTORY_IMPORT_STATE_KEY)
      );
      const hasFlashcardMetaChange = Boolean(
        store.FLASHCARD_META_KEY && Object.prototype.hasOwnProperty.call(changes || {}, store.FLASHCARD_META_KEY)
      );

      if (!hasEntriesChange && !hasSettingsChange && !hasPortableBackupChange && !hasHistoryImportStateChange && !hasFlashcardMetaChange) {
        return;
      }

      if (hasSettingsChange) {
        await ctx.sync.refreshSettingsState();
        ctx.current.renderAutoMode();
        ctx.sync.renderSyncLanguages();
        ctx.sync.renderVerifiedSyncStatus();
      }

      if (hasHistoryImportStateChange) {
        await ctx.backup.refreshHistoryImportState();
      }

      if (hasPortableBackupChange) {
        await ctx.backup.refreshPortableBackupMeta();
      }

      if (hasFlashcardMetaChange) {
        await ctx.study.refreshStudyCard();
        // Reviews change the exported review progress: refresh the backup
        // status so a stale portable backup stays visible and actionable.
        await ctx.backup.refreshPortableBackupMeta();
      }

      if (hasEntriesChange || hasSettingsChange) {
        await ctx.list.renderSavedList();
        if (hasEntriesChange) void ctx.sync.refreshDataStatus();
      }
    }

    async function init() {
      if (initialized) return;
      initialized = true;

      elements.currentPageCard = document.getElementById("current-page-card");
      elements.currentWord = document.getElementById("current-word");
      elements.currentAudio = document.getElementById("current-audio");
      elements.currentMeta = document.getElementById("current-meta");
      elements.currentMeanings = document.getElementById("current-meanings");
      elements.currentFavorite = document.getElementById("current-favorite");
      elements.currentStudy = document.getElementById("current-study");
      elements.currentDelete = document.getElementById("current-delete");
      elements.currentNoteInput = document.getElementById("current-note");
      elements.currentNoteStatus = document.getElementById("current-note-status");
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
      elements.syncPullButton = document.getElementById("sync-pull");
      elements.syncNowStatus = document.getElementById("sync-now-status");
      elements.syncRetryButton = document.getElementById("sync-retry");
      elements.syncVerifiedStatus = document.getElementById("sync-verified-status");
      elements.syncHealthStatus = document.getElementById("sync-health-status");
      elements.openFlashcards = document.getElementById("open-flashcards");
      elements.openPreview = document.getElementById("open-preview");
      elements.exportHtml = document.getElementById("export-html");
      elements.exportAnki = document.getElementById("export-anki");
      elements.studySummary = document.getElementById("study-summary");
      elements.startDueReview = document.getElementById("start-due-review");
      elements.backupWarning = document.getElementById("backup-warning");
      elements.backupWarningMessage = document.getElementById("backup-warning-message");
      elements.backupWarningAction = document.getElementById("backup-warning-action");
      elements.dataSettings = document.getElementById("data-settings");
      elements.exportJson = document.getElementById("export-json");
      elements.importJson = document.getElementById("import-json");
      elements.importBrowserHistory = document.getElementById("import-browser-history");
      elements.importHistoryRangeRow = document.getElementById("import-history-range-row");
      elements.importHistoryRange = document.getElementById("import-history-range");
      elements.importHistoryReport = document.getElementById("import-history-report");
      elements.importHistoryReportSummary = document.getElementById("import-history-report-summary");
      elements.importHistoryReportList = document.getElementById("import-history-report-list");
      elements.importJsonFile = document.getElementById("import-json-file");
      elements.restorePreview = document.getElementById("restore-preview");
      elements.restorePreviewTitle = document.getElementById("restore-preview-title");
      elements.restorePreviewChip = document.getElementById("restore-preview-chip");
      elements.restorePreviewSummary = document.getElementById("restore-preview-summary");
      elements.restorePreviewDetails = document.getElementById("restore-preview-details");
      elements.restoreConfirm = document.getElementById("restore-confirm");
      elements.restoreCancel = document.getElementById("restore-cancel");
      elements.portableBackupCard = document.getElementById("portable-backup-card");
      elements.portableBackupChip = document.getElementById("portable-backup-chip");
      elements.portableBackupNowButton = document.getElementById("portable-backup-now");
      elements.portableBackupStatus = document.getElementById("portable-backup-status");
      elements.searchInput = document.getElementById("search-input");
      elements.searchStatus = document.getElementById("search-status");
      elements.actionFeedback = document.getElementById("action-feedback");
      elements.deleteUndo = document.getElementById("delete-undo");
      elements.deleteUndoMessage = document.getElementById("delete-undo-message");
      elements.deleteUndoButton = document.getElementById("delete-undo-button");
      elements.savedList = document.getElementById("saved-list");
      elements.emptyState = document.getElementById("empty-state");
      elements.noResults = document.getElementById("no-results");
      elements.favoriteCount = document.getElementById("favorite-count");
      elements.studyCount = document.getElementById("study-count");
      elements.historyCount = document.getElementById("history-count");
      elements.totalCount = document.getElementById("total-count");

      elements.currentFavorite.addEventListener("click", () => ctx.current.toggleCurrentPage("favorite"));
      elements.currentStudy.addEventListener("click", () => ctx.current.toggleCurrentPage("study"));
      elements.currentDelete.addEventListener("click", ctx.current.deleteCurrentPage);
      elements.currentPageCard.addEventListener("click", ctx.list.onMeaningToggleClick);
      elements.currentAudio.addEventListener("click", () => {
        if (state.currentEntry && typeof store.playLodAudio === "function") {
          store.playLodAudio(state.currentEntry);
        }
      });
      elements.autoModeToggle.addEventListener("click", ctx.current.toggleAutoMode);
      elements.syncLanguageChips.addEventListener("click", ctx.sync.onSyncLanguageChipClick);
      elements.syncNowButton?.addEventListener("click", ctx.sync.syncNow);
      elements.syncPullButton?.addEventListener("click", ctx.sync.pullSyncedData);
      elements.syncRetryButton?.addEventListener("click", ctx.sync.retryManualSync);
      elements.openFlashcards.addEventListener("click", ctx.list.openFlashcards);
      elements.openPreview.addEventListener("click", ctx.list.openPreview);
      elements.exportHtml.addEventListener("click", ctx.backup.exportHtml);
      elements.exportAnki.addEventListener("click", ctx.backup.exportAnki);
      elements.startDueReview?.addEventListener("click", ctx.study.startDueReview);
      elements.backupWarningAction?.addEventListener("click", ctx.backup.exportJson);
      elements.exportJson.addEventListener("click", ctx.backup.exportJson);
      elements.portableBackupNowButton?.addEventListener("click", ctx.backup.exportJson);
      elements.importJson.addEventListener("click", () => elements.importJsonFile.click());
      elements.importBrowserHistory?.addEventListener("click", ctx.backup.importFromBrowserHistory);
      elements.importHistoryRange?.addEventListener("change", ctx.backup.onHistoryImportRangeChange);
      elements.importJsonFile.addEventListener("change", ctx.backup.importJsonFile);
      elements.restoreConfirm?.addEventListener("click", ctx.backup.confirmRestoreJson);
      elements.restoreCancel?.addEventListener("click", ctx.backup.cancelRestoreJson);
      elements.searchInput.addEventListener("input", ctx.list.onSearchInput);
      elements.deleteUndoButton.addEventListener("click", () => deleteUndo.onUndoClick());
      elements.currentNoteInput.addEventListener("input", ctx.current.onCurrentNoteInput);
      elements.currentNoteInput.addEventListener("change", ctx.current.onCurrentNoteCommit);
      elements.currentNoteInput.addEventListener("blur", ctx.current.onCurrentNoteCommit);
      elements.savedList.addEventListener("click", ctx.list.onSavedListClick);
      elements.savedList.addEventListener("input", ctx.list.onSavedListInput);
      elements.savedList.addEventListener("change", ctx.list.onSavedListChange);
      elements.savedList.addEventListener("focusout", ctx.list.onSavedListFocusOut);

      chromeApi.tabs.onActivated.addListener(handleActiveTabChange);
      chromeApi.tabs.onUpdated.addListener(handleTabUpdated);
      chromeApi.runtime.onMessage.addListener(handlePageStateMessage);
      chromeApi.storage?.onChanged?.addListener(handleStorageChange);

      ctx.backup.renderBrowserHistoryImportAction();
      ctx.backup.renderHistoryImportReport();

      // Local words are the popup's primary content. Render them first; active
      // tab, backup, history and remote sync status can settle independently.
      const listReady = ctx.list.renderSavedList();
      const settingsReady = listReady.catch(() => {}).then(async () => {
        await ctx.sync.refreshSettingsState();
        ctx.current.renderAutoMode();
        ctx.sync.renderSyncLanguages();
        ctx.sync.renderVerifiedSyncStatus();
      });
      await Promise.allSettled([
        listReady,
        settingsReady,
        ctx.backup.refreshPortableBackupMeta(),
        ctx.backup.refreshHistoryImportState(),
        ctx.current.refreshCurrentPage()
      ]);
    }

    function destroy() {
      if (!initialized) return;
      chromeApi.tabs.onActivated.removeListener(handleActiveTabChange);
      chromeApi.tabs.onUpdated.removeListener(handleTabUpdated);
      chromeApi.runtime.onMessage.removeListener(handlePageStateMessage);
      chromeApi.storage?.onChanged?.removeListener?.(handleStorageChange);
      ctx.sync.clearScheduledSyncCapacityRefresh();
      deleteUndo.hide();
      if (actionFeedbackTimer) clearTimeout(actionFeedbackTimer);
      noteAutosave.destroy();
      initialized = false;
    }

    return {
      state,
      elements,
      init,
      destroy,
      renderList: ctx.list.renderList,
      renderSavedList: ctx.list.renderSavedList,
      refreshCurrentPage: ctx.current.refreshCurrentPage,
      refreshDataStatus: ctx.sync.refreshDataStatus,
      formatSearchStatus: ctx.list.formatSearchStatus
    };
  }

  globalThis.LodVaultPopupApp = {
    createApp
  };
})();
