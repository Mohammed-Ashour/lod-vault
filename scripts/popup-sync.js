// popup-sync.js — Sync panel feature module for the popup page.
//
// Owns the sync language chips, capacity bar, Sync now / Pull synced data /
// Retry actions, the last-verified-sync status and the sync health inspection.
// Renders into the popup DOM and coordinates with the other popup modules
// through the shared ctx object created by popup-app.js.
//
// Cross-module calls (resolved lazily at runtime, after popup-app.js wires ctx):
//   ctx.list.renderSavedList()        — after pull/push changed the vault
//   ctx.current.refreshCurrentPage()  — after pull/push changed the current word
(() => {
  function createSyncModule(ctx) {
    const { store, chromeApi, state, elements } = ctx;
    const pendingSyncCapacityRefreshTimers = new Set();
    let retrySyncAction = null;

    async function refreshSettingsState() {
      const settings = await store.getSettings();
      state.autoMode = Boolean(settings?.autoMode);
      state.syncLanguages = Array.isArray(settings?.syncLanguages) && settings.syncLanguages.length
        ? [...settings.syncLanguages]
        : [...(store.DEFAULT_SETTINGS?.syncLanguages || ["en", "fr", "de"])];
      state.lastVerifiedSyncAt = settings?.lastVerifiedSyncAt || "";
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

    function setSyncNowStatus(message, tone = "", retryAction = null) {
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

      retrySyncAction = retryAction;
      if (elements.syncRetryButton) {
        elements.syncRetryButton.classList.toggle("is-hidden", !retryAction);
      }
    }

    function renderVerifiedSyncStatus() {
      if (!elements.syncVerifiedStatus) return;
      elements.syncVerifiedStatus.textContent = state.lastVerifiedSyncAt
        ? `Last verified sync: ${typeof store.formatWhen === "function" ? store.formatWhen(state.lastVerifiedSyncAt) : state.lastVerifiedSyncAt}.`
        : "No verified sync yet.";
    }

    async function markSyncVerified() {
      if (typeof store.markSyncVerified !== "function") return;
      try {
        state.lastVerifiedSyncAt = await store.markSyncVerified();
        renderVerifiedSyncStatus();
      } catch {
        // The verified sync remains valid even if its local timestamp cannot be saved.
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

      if (elements.syncRetryButton) {
        elements.syncRetryButton.disabled = controlsBusy;
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
            setSyncNowStatus("Sync failed while reconciling remote data.", "error", "push");
            return;
          }
          await refreshSettingsState();
          await ctx.list.renderSavedList();
          await ctx.current.refreshCurrentPage();
        }

        const expectedEntryCount = Number(state.savedEntries?.length || 0);
        const result = await sync.SyncAdapter.pushAll();
        remoteState = await inspectSyncRemoteState();
        await renderSyncCapacity(remoteState);
        scheduleSyncCapacityRefresh();

        if (result?.ok === false) {
          setSyncNowStatus(describeSyncFailure(result), "error", "push");
        } else if (expectedEntryCount === 0 && remoteState?.ok !== false && remoteState?.hasSyncData) {
          await markSyncVerified();
          setSyncNowStatus("Sync complete · empty vault verified in sync.", "success");
        } else if (remoteState?.ok !== false && Number.isFinite(remoteState?.entryCount) && remoteState.entryCount === expectedEntryCount) {
          await markSyncVerified();
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
        setSyncNowStatus("Sync failed. Try again.", "error", "push");
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
        await ctx.list.renderSavedList();
        await ctx.current.refreshCurrentPage();
        await renderSyncCapacity();
        scheduleSyncCapacityRefresh();

        const afterCount = Number(state.savedEntries?.length || 0);
        const pulledCount = Math.max(0, afterCount - beforeCount);

        if (result?.ok === false) {
          setSyncNowStatus("Pull failed. Could not load synced data.", "error", "pull");
        } else if (result?.partialRead) {
          setSyncNowStatus(
            `Pull completed with warnings · ${afterCount} words loaded (sync data was partial).`,
            "warning"
          );
        } else if (pulledCount > 0) {
          await markSyncVerified();
          setSyncNowStatus(
            `Pull complete · +${pulledCount} word${pulledCount === 1 ? "" : "s"} from sync (${afterCount} total).`,
            "success"
          );
        } else if (result?.changed === false) {
          await markSyncVerified();
          setSyncNowStatus(
            `Pull complete · no changes (${afterCount} words in vault).`,
            "success"
          );
        } else {
          await markSyncVerified();
          setSyncNowStatus(
            `Pull complete · synced updates applied (${afterCount} words in vault).`,
            "success"
          );
        }
      } catch {
        setSyncNowStatus("Pull failed. Could not load synced data.", "error", "pull");
      } finally {
        state.syncPullInProgress = false;
        renderSyncNowAction();
        await refreshSyncHealth();
      }
    }

    async function retryManualSync() {
      if (retrySyncAction === "pull") {
        await pullSyncedData();
      } else if (retrySyncAction === "push") {
        await syncNow();
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

    return {
      refreshSettingsState,
      renderSyncLanguages,
      renderSyncNowAction,
      renderSyncCapacity,
      renderVerifiedSyncStatus,
      refreshSyncHealth,
      scheduleSyncCapacityRefresh,
      clearScheduledSyncCapacityRefresh,
      onSyncLanguageChipClick,
      syncNow,
      pullSyncedData,
      retryManualSync
    };
  }

  globalThis.LodVaultPopupSync = {
    create: createSyncModule
  };
})();
