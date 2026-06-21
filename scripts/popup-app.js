(() => {
  function createApp(options = {}) {
    const store = options.store || globalThis.LodVaultStore;
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
      portableBackupMeta: {
        lastExportedAt: "",
        entryCount: 0
      },
      browserHistoryImporting: false,
      syncNowInProgress: false,
      syncPullInProgress: false,
      historyImportRange: "all",
      historyImportReport: null,
      currentPageRequestId: 0
    };

    const elements = {};
    let initialized = false;
    const pendingSyncCapacityRefreshTimers = new Set();

    function normalizePortableBackupMeta(meta = {}) {
      if (typeof store.normalizePortableBackupMeta === "function") {
        return store.normalizePortableBackupMeta(meta);
      }

      const lastExportedAt = typeof meta?.lastExportedAt === "string" ? meta.lastExportedAt : "";
      const timestamp = Date.parse(lastExportedAt);

      return {
        lastExportedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "",
        entryCount: Math.max(0, Number(meta?.entryCount) || 0)
      };
    }

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
      if (message?.type !== "lodvault:page-state-changed") return;
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
      if (areaName === "sync") {
        const hasSyncVaultChange = Object.keys(changes || {}).some((key) => (
          key === "lodVault.m"
          || key === "lodVault.s"
          || key === "lodVault.d"
          || key.startsWith("lodVault.e.")
        ));
        if (hasSyncVaultChange) {
          await refreshSyncHealth();
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

      if (!hasEntriesChange && !hasSettingsChange && !hasPortableBackupChange && !hasHistoryImportStateChange) {
        return;
      }

      if (hasSettingsChange) {
        await refreshSettingsState();
        renderAutoMode();
        renderSyncLanguages();
      }

      if (hasHistoryImportStateChange) {
        await refreshHistoryImportState();
      }

      if (hasPortableBackupChange) {
        await refreshPortableBackupMeta();
      }

      if (hasEntriesChange || hasSettingsChange) {
        await renderSavedList();
      }
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

      renderList();

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
      return globalThis.LodVaultSync;
    }

    function supportsManualSyncNow() {
      const sync = getSyncNamespace();
      return Boolean(sync?.SyncAdapter?.pushAll);
    }

    function supportsManualSyncPull() {
      const sync = getSyncNamespace();
      return Boolean(sync?.SyncAdapter?.pullAll);
    }

    function supportsSyncHealthInspection() {
      return typeof chromeApi?.storage?.sync?.get === "function";
    }

    function getSyncKeySummary(syncStorage = {}) {
      const keys = Object.keys(syncStorage || {}).filter((key) => (
        key === "lodVault.m"
        || key === "lodVault.s"
        || key === "lodVault.d"
        || key.startsWith("lodVault.e.")
      ));
      const shardKeyCount = keys.filter((key) => key.startsWith("lodVault.e.")).length;

      return {
        keyCount: keys.length,
        shardKeyCount
      };
    }

    function toFiniteNumber(value) {
      const number = Number(value);
      return Number.isFinite(number) ? number : Number.NaN;
    }

    async function inspectSyncRemoteState() {
      const sync = getSyncNamespace();
      if (typeof sync?.inspectSyncStorage === "function") {
        try {
          const snapshot = await sync.inspectSyncStorage();
          if (snapshot && typeof snapshot === "object") {
            return {
              ok: snapshot.ok !== false,
              hasSyncData: Boolean(snapshot.hasSyncData),
              hasSyncWords: Boolean(snapshot.hasSyncWords),
              partialRead: Boolean(snapshot.partialRead),
              bytesUsed: toFiniteNumber(snapshot.bytesUsed),
              bytesUsedTotal: toFiniteNumber(snapshot.bytesUsedTotal),
              bytesUsedVault: toFiniteNumber(snapshot.bytesUsedVault),
              bytesUsedOther: toFiniteNumber(snapshot.bytesUsedOther),
              bytesTotal: toFiniteNumber(snapshot.bytesTotal) || toFiniteNumber(sync.SYNC_TOTAL_HARD_LIMIT) || 102400,
              bytesRemaining: toFiniteNumber(snapshot.bytesRemaining),
              percentUsed: toFiniteNumber(snapshot.percentUsed),
              entryCount: toFiniteNumber(snapshot.entryCount),
              shardCount: toFiniteNumber(snapshot.shardCount),
              estimatedRemaining: toFiniteNumber(snapshot.estimatedRemaining),
              itemCountTotal: toFiniteNumber(snapshot.itemCountTotal),
              itemCountVault: toFiniteNumber(snapshot.itemCountVault),
              itemCountOther: toFiniteNumber(snapshot.itemCountOther),
              itemCountRemaining: toFiniteNumber(snapshot.itemCountRemaining),
              maxItemsTotal: toFiniteNumber(snapshot.maxItemsTotal)
            };
          }
        } catch {
          // Fall through to the legacy inspection path below.
        }
      }

      let summary = { keyCount: 0, shardKeyCount: 0 };
      let canReadRawSync = false;
      if (supportsSyncHealthInspection()) {
        try {
          summary = getSyncKeySummary(await chromeApi.storage.sync.get(null));
          canReadRawSync = true;
        } catch {
          canReadRawSync = false;
        }
      }

      let stats = null;
      if (typeof sync?.getSyncUsageStats === "function") {
        try {
          stats = await sync.getSyncUsageStats();
        } catch {
          stats = null;
        }
      }

      const statsOk = Boolean(stats && stats.ok !== false);
      const entryCount = toFiniteNumber(stats?.entryCount);
      const bytesUsed = toFiniteNumber(stats?.bytesUsed);
      const bytesTotal = toFiniteNumber(stats?.bytesTotal) || toFiniteNumber(sync?.SYNC_TOTAL_HARD_LIMIT) || 102400;
      const hasSyncWords = statsOk
        ? entryCount > 0
        : summary.shardKeyCount > 0;
      const hasSyncData = canReadRawSync
        ? summary.keyCount > 0
        : (statsOk && (hasSyncWords || bytesUsed > 0));

      return {
        ok: statsOk || canReadRawSync,
        hasSyncData,
        hasSyncWords,
        partialRead: Boolean(stats?.partialRead),
        bytesUsed,
        bytesUsedTotal: bytesUsed,
        bytesUsedVault: toFiniteNumber(stats?.bytesUsedVault),
        bytesUsedOther: toFiniteNumber(stats?.bytesUsedOther),
        bytesTotal,
        bytesRemaining: toFiniteNumber(stats?.bytesRemaining),
        percentUsed: toFiniteNumber(stats?.percentUsed),
        entryCount,
        shardCount: toFiniteNumber(stats?.shardCount),
        estimatedRemaining: toFiniteNumber(stats?.estimatedRemaining),
        itemCountTotal: toFiniteNumber(stats?.itemCountTotal),
        itemCountVault: toFiniteNumber(stats?.itemCountVault),
        itemCountOther: toFiniteNumber(stats?.itemCountOther),
        itemCountRemaining: toFiniteNumber(stats?.itemCountRemaining),
        maxItemsTotal: toFiniteNumber(stats?.maxItemsTotal)
      };
    }

    function setSyncNowStatus(message, tone = "") {
      if (!elements.syncNowStatus) return;
      elements.syncNowStatus.textContent = message;
      elements.syncNowStatus.classList.remove("is-success", "is-error", "is-warning");
      if (tone === "success") {
        elements.syncNowStatus.classList.add("is-success");
      } else if (tone === "error") {
        elements.syncNowStatus.classList.add("is-error");
      } else if (tone === "warning") {
        elements.syncNowStatus.classList.add("is-warning");
      }
    }

    function setSyncHealthStatus(message, tone = "") {
      if (!elements.syncHealthStatus) return;
      elements.syncHealthStatus.textContent = message;
      elements.syncHealthStatus.classList.remove("is-success", "is-error", "is-warning");
      if (!message) {
        elements.syncHealthStatus.classList.add("is-hidden");
        return;
      }

      elements.syncHealthStatus.classList.remove("is-hidden");
      if (tone === "success") {
        elements.syncHealthStatus.classList.add("is-success");
      } else if (tone === "error") {
        elements.syncHealthStatus.classList.add("is-error");
      } else if (tone === "warning") {
        elements.syncHealthStatus.classList.add("is-warning");
      }
    }

    async function refreshSyncHealth(snapshot = null) {
      if (!elements.syncHealthStatus) return;
      if (state.syncNowInProgress || state.syncPullInProgress) return;

      try {
        const remoteState = snapshot || await inspectSyncRemoteState();
        const localCount = Number(state.savedEntries?.length || 0);

        if (remoteState?.ok === false && remoteState?.hasSyncData) {
          setSyncHealthStatus("Sync is connected, but its remote state could not be verified right now.", "warning");
          return;
        }

        if (remoteState?.partialRead) {
          setSyncHealthStatus("Sync data looks partial. Pull synced data to reconcile safely.", "warning");
          return;
        }

        if (remoteState?.hasSyncWords && localCount === 0) {
          const countLabel = Number.isFinite(remoteState.entryCount) ? `${remoteState.entryCount} ` : "";
          setSyncHealthStatus(`Synced words found (${countLabel}remote). Click Pull synced data.`, "warning");
          return;
        }

        if (remoteState?.hasSyncData && !remoteState?.hasSyncWords && localCount === 0) {
          setSyncHealthStatus("Sync is connected, but no words are stored in sync yet.", "warning");
          return;
        }

        if (!remoteState?.hasSyncData && localCount > 0) {
          setSyncHealthStatus("No synced vault backup found yet. Click Sync now to upload this vault.", "warning");
          return;
        }

        if (remoteState?.hasSyncData && !remoteState?.hasSyncWords && localCount > 0) {
          setSyncHealthStatus("Sync has no words yet. Click Sync now to upload this vault.", "warning");
          return;
        }

        setSyncHealthStatus("");
      } catch {
        setSyncHealthStatus("Could not read sync status.", "error");
      }
    }

    function renderSyncNowAction() {
      if (!elements.syncNowButton) return;

      const canSyncNow = supportsManualSyncNow();
      const canSyncPull = supportsManualSyncPull();

      if (!canSyncNow) {
        elements.syncNowButton.classList.add("is-hidden");
      } else {
        elements.syncNowButton.classList.remove("is-hidden");
      }

      if (elements.syncPullButton) {
        if (!canSyncPull) {
          elements.syncPullButton.classList.add("is-hidden");
        } else {
          elements.syncPullButton.classList.remove("is-hidden");
        }
      }

      if (!canSyncNow && !canSyncPull) {
        setSyncNowStatus("");
        return;
      }

      const controlsBusy = Boolean(
        state.syncNowInProgress
        || state.syncPullInProgress
        || state.browserHistoryImporting
        || state.syncLanguagesSaving
      );

      if (canSyncNow) {
        elements.syncNowButton.disabled = controlsBusy;
        elements.syncNowButton.textContent = state.syncNowInProgress ? "Syncing…" : "Sync now";
      }

      if (canSyncPull && elements.syncPullButton) {
        elements.syncPullButton.disabled = controlsBusy;
        elements.syncPullButton.textContent = state.syncPullInProgress ? "Pulling…" : "Pull synced data";
      }
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
      if (result?.maxItemsExceeded) {
        return "Sync failed: sync item limit reached. Try syncing fewer words.";
      }
      if (result?.reason === "quota-exceeded") {
        return "Sync failed: storage quota exceeded. Try fewer sync languages or fewer words.";
      }
      return "Sync failed. Try again.";
    }

    async function syncNow() {
      if (state.syncNowInProgress || !supportsManualSyncNow()) return;

      const sync = getSyncNamespace();
      state.syncNowInProgress = true;
      renderSyncNowAction();
      setSyncNowStatus("Syncing now…");

      let remoteState = null;
      try {
        remoteState = await inspectSyncRemoteState();
        if (remoteState?.hasSyncData && typeof sync?.SyncAdapter?.pullAll === "function") {
          const pullResult = await sync.SyncAdapter.pullAll({ repush: false });
          if (pullResult?.ok === false) {
            setSyncNowStatus("Sync failed while reconciling remote data.", "error");
            return;
          }
          await refreshSettingsState();
          await renderSavedList();
          await refreshCurrentPage();
        }

        const expectedEntryCount = Number(state.savedEntries?.length || 0);
        const result = await sync.SyncAdapter.pushAll();
        remoteState = await inspectSyncRemoteState();
        await renderSyncCapacity(remoteState);
        scheduleSyncCapacityRefresh();

        if (result?.ok === false) {
          setSyncNowStatus(describeSyncFailure(result), "error");
        } else if (expectedEntryCount === 0) {
          setSyncNowStatus("Sync complete · vault is empty.", "success");
        } else if (remoteState?.ok !== false && Number.isFinite(remoteState?.entryCount) && remoteState.entryCount === expectedEntryCount) {
          setSyncNowStatus(`Sync complete · ${expectedEntryCount} words verified in sync.`, "success");
        } else if (remoteState?.hasSyncData && !remoteState?.hasSyncWords) {
          setSyncNowStatus("Sync failed verification: sync storage has metadata, but no words were stored.", "error");
        } else if (remoteState?.ok === false) {
          setSyncNowStatus("Sync completed, but the remote copy could not be verified yet.", "warning");
        } else {
          const remoteCount = Number.isFinite(remoteState?.entryCount) ? remoteState.entryCount : "unknown";
          setSyncNowStatus(`Sync completed, but remote count (${remoteCount}) did not match the local vault (${expectedEntryCount}).`, "warning");
        }
      } catch {
        setSyncNowStatus("Sync failed. Try again.", "error");
      } finally {
        state.syncNowInProgress = false;
        renderSyncNowAction();
        await refreshSyncHealth(remoteState);
      }
    }

    async function pullSyncedData() {
      if (state.syncPullInProgress || !supportsManualSyncPull()) return;

      const sync = getSyncNamespace();
      const beforeCount = Number(state.savedEntries?.length || 0);
      state.syncPullInProgress = true;
      renderSyncNowAction();
      setSyncNowStatus("Pulling synced data…");

      try {
        const result = await sync.SyncAdapter.pullAll({ repush: false });
        await refreshSettingsState();
        await renderSavedList();
        await refreshCurrentPage();
        await renderSyncCapacity();
        scheduleSyncCapacityRefresh();

        const afterCount = Number(state.savedEntries?.length || 0);
        const pulledCount = Math.max(0, afterCount - beforeCount);

        if (result?.ok === false) {
          setSyncNowStatus("Pull failed. Could not load synced data.", "error");
        } else if (result?.partialRead) {
          setSyncNowStatus(
            `Pull completed with warnings · ${afterCount} words loaded (sync data was partial).`,
            "warning"
          );
        } else if (pulledCount > 0) {
          setSyncNowStatus(
            `Pull complete · +${pulledCount} word${pulledCount === 1 ? "" : "s"} from sync (${afterCount} total).`,
            "success"
          );
        } else if (result?.changed === false) {
          setSyncNowStatus(
            `Pull complete · no changes (${afterCount} words in vault).`,
            "success"
          );
        } else {
          setSyncNowStatus(
            `Pull complete · synced updates applied (${afterCount} words in vault).`,
            "success"
          );
        }
      } catch {
        setSyncNowStatus("Pull failed. Could not load synced data.", "error");
      } finally {
        state.syncPullInProgress = false;
        renderSyncNowAction();
        await refreshSyncHealth();
      }
    }

    async function renderSyncCapacity(snapshot = null) {
      const sync = getSyncNamespace();
      const fallbackText = `Sync: Est. ~${getSyncCapacityHint(state.syncLanguages.length)} words`;

      elements.syncCapacityFill.style.width = "0%";
      elements.syncCapacityFill.classList.remove("is-warning", "is-danger");

      if (!sync || (!sync.getSyncUsageStats && !sync.inspectSyncStorage)) {
        elements.syncLanguageCapacity.textContent = fallbackText;
        return;
      }

      try {
        const remoteState = snapshot || await inspectSyncRemoteState();
        const totalLabel = formatBytes(remoteState?.bytesTotal || sync.SYNC_TOTAL_HARD_LIMIT || 102400);

        if (remoteState?.ok === false) {
          elements.syncLanguageCapacity.textContent = remoteState?.hasSyncData
            ? `Sync: connected · size unavailable`
            : fallbackText;
          return;
        }

        const totalBytesUsed = Number.isFinite(remoteState?.bytesUsedTotal)
          ? remoteState.bytesUsedTotal
          : (remoteState?.bytesUsed || 0);
        const vaultBytesUsed = Number.isFinite(remoteState?.bytesUsedVault)
          ? remoteState.bytesUsedVault
          : totalBytesUsed;
        const otherBytesUsed = Number.isFinite(remoteState?.bytesUsedOther)
          ? remoteState.bytesUsedOther
          : Math.max(0, totalBytesUsed - vaultBytesUsed);
        const usedLabel = formatBytes(totalBytesUsed);
        const otherUsageSuffix = otherBytesUsed > 0
          ? ` · ${formatBytes(otherBytesUsed)} used by other sync data`
          : "";
        const percentUsed = Math.min(100, Math.max(0, remoteState?.percentUsed || 0));
        elements.syncCapacityFill.style.width = `${percentUsed}%`;
        elements.syncCapacityFill.classList.toggle("is-warning", percentUsed >= 70 && percentUsed < 90);
        elements.syncCapacityFill.classList.toggle("is-danger", percentUsed >= 90);

        if (remoteState?.entryCount > 0) {
          const remaining = Number.isFinite(remoteState?.estimatedRemaining)
            ? remoteState.estimatedRemaining
            : getSyncCapacityHint(state.syncLanguages.length);
          elements.syncLanguageCapacity.textContent = `Sync: ${usedLabel} / ${totalLabel} used · ~${remaining} words fit${otherUsageSuffix}`;
        } else if (remoteState?.hasSyncData) {
          elements.syncLanguageCapacity.textContent = `Sync: ${usedLabel} / ${totalLabel} used · no words stored yet${otherUsageSuffix}`;
        } else if (totalBytesUsed > 0) {
          elements.syncLanguageCapacity.textContent = `Sync: ${usedLabel} / ${totalLabel} used · vault data not stored yet${otherUsageSuffix}`;
        } else {
          elements.syncLanguageCapacity.textContent = `Sync: 0 / ${totalLabel} used · ~${getSyncCapacityHint(state.syncLanguages.length)} words fit`;
        }
      } catch (_error) {
        elements.syncLanguageCapacity.textContent = fallbackText;
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
      elements.currentMeanings.innerHTML = meaningMarkup || "";
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
          type: "lodvault:toggle-list",
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

    function getEntryChangeTimestamp(entry = {}) {
      return Math.max(
        Date.parse(entry?.updatedAt || "") || 0,
        Date.parse(entry?.lastVisitedAt || "") || 0,
        Date.parse(entry?.createdAt || "") || 0
      );
    }

    function getLatestVaultChangeTimestamp(entries = []) {
      return entries.reduce((latest, entry) => Math.max(latest, getEntryChangeTimestamp(entry)), 0);
    }

    function setPortableBackupStatus(message, options = {}) {
      if (!elements.portableBackupStatus) return;

      const tone = options.tone || "";
      const chipLabel = options.chipLabel || "";
      const showAction = Boolean(options.showAction);
      const visualTone = tone || "neutral";

      elements.portableBackupStatus.textContent = message;
      elements.portableBackupStatus.classList.remove("is-success", "is-error", "is-warning");
      if (tone === "success") {
        elements.portableBackupStatus.classList.add("is-success");
      } else if (tone === "error") {
        elements.portableBackupStatus.classList.add("is-error");
      } else if (tone === "warning") {
        elements.portableBackupStatus.classList.add("is-warning");
      }

      if (elements.portableBackupCard) {
        elements.portableBackupCard.classList.remove("is-success", "is-warning", "is-error", "is-neutral");
        elements.portableBackupCard.classList.add(`is-${visualTone}`);
      }

      if (elements.portableBackupChip) {
        elements.portableBackupChip.textContent = chipLabel;
        elements.portableBackupChip.classList.remove("is-success", "is-warning", "is-error", "is-neutral");
        elements.portableBackupChip.classList.add(`is-${visualTone}`);
      }

      if (elements.portableBackupNowButton) {
        elements.portableBackupNowButton.classList.toggle("is-hidden", !showAction);
      }
    }

    function describePortableBackupStatus() {
      const meta = normalizePortableBackupMeta(state.portableBackupMeta);
      const exportedAt = meta.lastExportedAt;
      const backupCount = Math.max(0, Number(meta.entryCount) || 0);
      const currentCount = Math.max(0, Number(state.savedEntries?.length) || 0);
      const hasEntries = currentCount > 0;

      if (!exportedAt) {
        return hasEntries
          ? {
              message: "No backup created yet. Click Backup JSON before uninstalling or switching versions.",
              tone: "warning",
              chipLabel: "Never",
              showAction: true
            }
          : {
              message: "Create a JSON backup when you want a file you can restore later.",
              tone: "",
              chipLabel: "Never",
              showAction: false
            };
      }

      const when = typeof store.formatWhen === "function"
        ? store.formatWhen(exportedAt)
        : exportedAt;
      const latestVaultChange = getLatestVaultChangeTimestamp(state.savedEntries);
      const exportTimestamp = Date.parse(exportedAt) || 0;
      const hasUnsavedChanges = latestVaultChange > exportTimestamp || backupCount !== currentCount;
      const countLabel = `${backupCount} word${backupCount === 1 ? "" : "s"}`;

      if (hasUnsavedChanges) {
        return {
          message: `Last portable backup: ${when} · ${countLabel}. Newer local changes are not included yet.`,
          tone: "warning",
          chipLabel: "Needs backup",
          showAction: true
        };
      }

      return {
        message: `Last portable backup: ${when} · ${countLabel}. This backup survives uninstall.`,
        tone: "success",
        chipLabel: "Up to date",
        showAction: false
      };
    }

    function renderPortableBackupStatus() {
      const nextState = describePortableBackupStatus();
      setPortableBackupStatus(nextState.message, nextState);
    }

    async function refreshPortableBackupMeta() {
      if (typeof store.getPortableBackupMeta !== "function") {
        state.portableBackupMeta = normalizePortableBackupMeta({});
        renderPortableBackupStatus();
        return;
      }

      try {
        state.portableBackupMeta = normalizePortableBackupMeta(await store.getPortableBackupMeta());
        renderPortableBackupStatus();
      } catch {
        state.portableBackupMeta = normalizePortableBackupMeta({});
        setPortableBackupStatus("Portable backup status unavailable.", {
          tone: "error",
          chipLabel: "Error",
          showAction: false
        });
      }
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
      const hasNote = Boolean(entry.note);

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
          ${(() => { const mk = store.buildMeaningCollapsibleMarkup(entry); return mk ? `<div class="item-meanings">${mk}</div>` : ""; })()}
          ${entry.example ? `<p class="item-example">${store.escapeHtml(entry.example)}</p>` : ""}
          <div class="note-section">
            <button type="button" class="note-toggle${hasNote ? " is-hidden" : ""}" data-action="toggle-note" data-id="${store.escapeHtml(entry.id)}" aria-label="Add a note">+ Note</button>
            <div class="note-body${hasNote ? "" : " is-hidden"}">
              <label class="note-label" for="note-${store.escapeHtml(entry.id)}">Note</label>
              <textarea id="note-${store.escapeHtml(entry.id)}" class="note-input" data-note-id="${store.escapeHtml(entry.id)}" data-saved-value="${store.escapeHtml(entry.note || "")}" placeholder="Add a note for this word...">${store.escapeHtml(entry.note || "")}</textarea>
            </div>
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
      await refreshSyncHealth();
      renderList();
      renderPortableBackupStatus();
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
            type: "lodvault:sync-state",
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

    function onMeaningToggleClick(event) {
      const toggleBtn = event.target.closest(".meaning-toggle");
      if (!toggleBtn) return;
      event.preventDefault();
      event.stopPropagation();
      const isOpen = toggleBtn.getAttribute("aria-expanded") === "true";
      toggleBtn.setAttribute("aria-expanded", isOpen ? "false" : "true");
      const panel = toggleBtn.nextElementSibling;
      if (panel && panel.classList.contains("meaning-expand")) {
        panel.classList.toggle("is-open", !isOpen);
      }
    }

    async function onSavedListClick(event) {
      const toggleBtn = event.target.closest(".meaning-toggle");
      if (toggleBtn) {
        onMeaningToggleClick(event);
        return;
      }

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

      if (button.dataset.action === "toggle-note") {
        const noteBody = button.closest(".note-section")?.querySelector(".note-body");
        if (noteBody) {
          showNoteBody(noteBody);
          noteBody.querySelector(".note-input")?.focus();
        }
        return;
      }

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

    async function refreshHistoryImportState() {
      if (typeof store.getHistoryImportState !== "function") return;

      try {
        const importState = await store.getHistoryImportState();
        if (importState && (importState.scanned || importState.imported || importState.queue?.length || importState.hydrated || importState.failed)) {
          state.historyImportReport = {
            ...state.historyImportReport,
            ...importState,
            addedEntries: Array.isArray(importState.addedEntries) ? importState.addedEntries : (state.historyImportReport?.addedEntries || []),
            rangeLabel: state.historyImportReport?.rangeLabel || getHistoryImportRangeLabel(state.historyImportRange)
          };
        }
        renderHistoryImportReport();
      } catch {
        // Ignore import progress read failures.
      }
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
      const queued = Math.max(0, Number(report.queued) || 0);
      const hydrated = Math.max(0, Number(report.hydrated) || 0);
      const failed = Math.max(0, Number(report.failed) || 0);
      const pending = Array.isArray(report.queue) ? report.queue.length : 0;
      const progressSummary = queued
        ? ` Hydration: ${hydrated}/${queued} ready${failed ? `, ${failed} failed` : ""}${pending ? `, ${pending} pending` : ""}.`
        : "";

      elements.importHistoryReportSummary.textContent = `Import report (${report.rangeLabel}): scanned ${scanned}, imported ${imported}, already saved ${skippedExisting}, ignored ${ignored}.${progressSummary}`;

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
        await refreshHistoryImportState();
        renderHistoryImportReport();
        scheduleSyncCapacityRefresh();

        if (imported > 0) {
          const hydrationQueued = Number(result?.hydrationQueued) || 0;
          setSearchStatusFeedback(
            hydrationQueued > 0
              ? `Imported ${imported} new word${imported === 1 ? "" : "s"} from browser history · enriching recent entries in the background.`
              : `Imported ${imported} new word${imported === 1 ? "" : "s"} from browser history.`,
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

      if (typeof store.markPortableBackupExported === "function") {
        try {
          state.portableBackupMeta = normalizePortableBackupMeta(
            await store.markPortableBackupExported({ entryCount: entries.length })
          );
          renderPortableBackupStatus();
        } catch {
          // Ignore backup-status persistence failures so the download still works.
        }
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
      elements.syncPullButton = document.getElementById("sync-pull");
      elements.syncNowStatus = document.getElementById("sync-now-status");
      elements.syncHealthStatus = document.getElementById("sync-health-status");
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
      elements.portableBackupCard = document.getElementById("portable-backup-card");
      elements.portableBackupChip = document.getElementById("portable-backup-chip");
      elements.portableBackupNowButton = document.getElementById("portable-backup-now");
      elements.portableBackupStatus = document.getElementById("portable-backup-status");
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
      elements.currentPageCard.addEventListener("click", onMeaningToggleClick);
      elements.currentAudio.addEventListener("click", () => {
        if (state.currentEntry && typeof store.playLodAudio === "function") {
          store.playLodAudio(state.currentEntry);
        }
      });
      elements.autoModeToggle.addEventListener("click", toggleAutoMode);
      elements.syncLanguageChips.addEventListener("click", onSyncLanguageChipClick);
      elements.syncNowButton?.addEventListener("click", syncNow);
      elements.syncPullButton?.addEventListener("click", pullSyncedData);
      elements.openFlashcards.addEventListener("click", openFlashcards);
      elements.openPreview.addEventListener("click", openPreview);
      elements.exportHtml.addEventListener("click", exportHtml);
      elements.exportAnki.addEventListener("click", exportAnki);
      elements.exportJson.addEventListener("click", exportJson);
      elements.portableBackupNowButton?.addEventListener("click", exportJson);
      elements.importJson.addEventListener("click", () => {
        // Open the import UI in a persistent tab. Firefox unloads the
        // browser-action popup when a native file picker takes focus, so a
        // file input inside the popup never fires its change event there.
        // A tab stays open across the picker, so the import works in both
        // Firefox and Chrome.
        chromeApi.tabs.create({ url: chromeApi.runtime.getURL("pages/import.html") });
      });
      elements.importBrowserHistory?.addEventListener("click", importFromBrowserHistory);
      elements.importHistoryRange?.addEventListener("change", onHistoryImportRangeChange);
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
      chromeApi.storage?.onChanged?.addListener(handleStorageChange);

      await refreshSettingsState();
      await refreshPortableBackupMeta();
      renderAutoMode();
      renderSyncLanguages();
      renderBrowserHistoryImportAction();
      await refreshHistoryImportState();
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

  globalThis.LodVaultPopupApp = {
    createApp
  };
})();
