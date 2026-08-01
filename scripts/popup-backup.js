// popup-backup.js — Backup & import feature module for the popup page.
//
// Owns the portable backup status card, JSON/HTML/Anki exports, JSON restore,
// and browser-history import (range select, permission request, progress
// report). Renders into the popup DOM through the shared ctx object.
//
// Cross-module calls (resolved lazily at runtime):
//   ctx.list.renderSavedList()             — after import/restore changed vault
//   ctx.current.refreshCurrentPage()       — after import/restore changed words
//   ctx.current.renderAutoMode()           — after settings changes
//   ctx.sync.refreshSettingsState()        — after import restored settings
//   ctx.sync.renderSyncLanguages()         — chips/capacity after import
//   ctx.sync.renderSyncNowAction()         — busy state of sync buttons
//   ctx.sync.scheduleSyncCapacityRefresh() — capacity after import changes
//   ctx.showActionFeedback()               — transient action feedback toast
(() => {
  function createBackupModule(ctx) {
    const { store, chromeApi, state, elements } = ctx;

    let backupAttentionState = null;

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
      backupAttentionState = nextState;
      setPortableBackupStatus(nextState.message, nextState);
      renderBackupWarning();
    }

    // Compact backup-needs-attention strip shown outside the Data & settings
    // disclosure, so a missing or stale portable backup stays visible and
    // actionable without opening the disclosure.
    function renderBackupWarning() {
      if (!elements.backupWarning || !elements.backupWarningMessage) return;

      const needsAttention = backupAttentionState?.showAction === true;
      elements.backupWarning.classList.toggle("is-hidden", !needsAttention);
      if (needsAttention) {
        elements.backupWarningMessage.textContent = backupAttentionState.message;
      }
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

      ctx.sync.renderSyncNowAction();
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
        await ctx.list.renderSavedList();
        await ctx.current.refreshCurrentPage();

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
        ctx.sync.scheduleSyncCapacityRefresh();

        if (imported > 0) {
          const hydrationQueued = Number(result?.hydrationQueued) || 0;
          const message = hydrationQueued > 0
            ? `Imported ${imported} new word${imported === 1 ? "" : "s"} from browser history · enriching recent entries in the background.`
            : `Imported ${imported} new word${imported === 1 ? "" : "s"} from browser history.`;
          setSearchStatusFeedback(message, "success");
          ctx.showActionFeedback(message);
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
      ctx.showActionFeedback("HTML export downloaded.");
    }

    async function exportAnki() {
      const entries = await store.getEntries();
      const text = store.buildAnkiExport(entries);
      const date = new Date().toISOString().slice(0, 10);
      store.downloadTextFile(`lodvault-anki-${date}.txt`, text, "text/tab-separated-values");
      ctx.showActionFeedback("Anki export downloaded.");
    }

    async function exportJson() {
      const [entries, settings, flashcardMeta] = await Promise.all([
        store.getEntries(),
        store.getSettings(),
        typeof store.getFlashcardMeta === "function" ? store.getFlashcardMeta() : Promise.resolve({})
      ]);
      const json = store.buildJsonExport(entries, { settings, flashcardMeta });
      const date = new Date().toISOString().slice(0, 10);
      store.downloadTextFile(`lodvault-export-${date}.json`, json, "application/json");

      if (typeof store.markPortableBackupExported === "function") {
        try {
          state.portableBackupMeta = normalizePortableBackupMeta(
            await store.markPortableBackupExported({ entryCount: entries.length })
          );
          renderPortableBackupStatus();
          ctx.showActionFeedback("JSON backup downloaded.");
        } catch {
          // Ignore backup-status persistence failures so the download still works.
        }
      }
    }

    let pendingRestoreText = "";
    let pendingRestorePreview = null;
    let restoreCompleted = false;

    function clearRestorePreview() {
      pendingRestoreText = "";
      pendingRestorePreview = null;
      restoreCompleted = false;
      if (elements.restorePreview) {
        elements.restorePreview.classList.add("is-hidden");
        elements.restorePreview.classList.remove("is-success");
      }
    }

    function buildRestoreDetailLines(preview) {
      const lines = [];

      if (preview.newIds.length) {
        lines.push(`${preview.newIds.length} new word${preview.newIds.length === 1 ? "" : "s"} will be added.`);
      }
      if (preview.mergeIds.length) {
        lines.push(`${preview.mergeIds.length} existing word${preview.mergeIds.length === 1 ? "" : "s"} will be merged (notes and list flags combine).`);
      }
      if (preview.restoreIds.length) {
        lines.push(`${preview.restoreIds.length} previously deleted word${preview.restoreIds.length === 1 ? "" : "s"} will be restored.`);
      }
      if (preview.skippedCount > 0) {
        lines.push(`${preview.skippedCount} invalid record${preview.skippedCount === 1 ? "" : "s"} will be skipped.`);
      }
      if (preview.settings) {
        const parts = [];
        if ("autoMode" in preview.settings) {
          parts.push(`auto mode ${preview.settings.autoMode ? "on" : "off"}`);
        }
        if ("syncLanguages" in preview.settings) {
          parts.push(`sync languages: ${preview.settings.syncLanguages.join(", ")}`);
        }
        lines.push(`Will restore settings: ${parts.join(" · ")}.`);
      } else {
        lines.push("No settings in this backup.");
      }
      if (preview.hasFlashcardMeta) {
        lines.push(`Includes flashcard review progress (${preview.flashcardCount} word${preview.flashcardCount === 1 ? "" : "s"}).`);
      } else {
        lines.push("No flashcard review progress in this backup.");
      }

      return lines;
    }

    function renderRestorePreview(preview) {
      if (!elements.restorePreview) return;

      elements.restorePreview.classList.remove("is-hidden", "is-success");

      const dateLabel = preview.exportedAt && typeof store.formatWhen === "function"
        ? store.formatWhen(preview.exportedAt)
        : preview.exportedAt || "";
      if (elements.restorePreviewTitle) {
        elements.restorePreviewTitle.textContent = dateLabel ? `Backup from ${dateLabel}` : "Backup file";
      }

      if (elements.restorePreviewChip) {
        elements.restorePreviewChip.textContent = "Review";
        elements.restorePreviewChip.classList.remove("is-success", "is-warning", "is-error");
      }

      if (elements.restorePreviewSummary) {
        elements.restorePreviewSummary.textContent = `${preview.entryCount} valid word${preview.entryCount === 1 ? "" : "s"} in this backup. Merging never removes words from your vault.`;
      }

      if (elements.restorePreviewDetails) {
        elements.restorePreviewDetails.innerHTML = buildRestoreDetailLines(preview)
          .map((line) => `<li>${store.escapeHtml(line)}</li>`)
          .join("");
      }

      if (elements.restoreConfirm) {
        elements.restoreConfirm.classList.remove("is-hidden");
        elements.restoreConfirm.disabled = false;
      }
      if (elements.restoreCancel) {
        elements.restoreCancel.textContent = "Cancel";
        elements.restoreCancel.classList.remove("is-hidden");
      }
    }

    function renderRestoreCompleted(preview, result) {
      if (!elements.restorePreview) return;

      restoreCompleted = true;
      elements.restorePreview.classList.remove("is-hidden");
      elements.restorePreview.classList.add("is-success");

      if (elements.restorePreviewChip) {
        elements.restorePreviewChip.textContent = "Merged";
        elements.restorePreviewChip.classList.add("is-success");
      }

      const newCount = Number(result?.newCount);
      const mergeCount = Number(result?.mergeCount);
      const restoreCount = Number(result?.restoreCount);
      const hasResultCounts = [newCount, mergeCount, restoreCount].every(Number.isFinite);
      const newTotal = hasResultCounts ? newCount : preview.newIds.length;
      const mergeTotal = hasResultCounts ? mergeCount : preview.mergeIds.length;
      const restoreTotal = hasResultCounts ? restoreCount : preview.restoreIds.length;
      const breakdown = [
        ...(newTotal > 0 ? [`${newTotal} new`] : []),
        ...(mergeTotal > 0 ? [`${mergeTotal} merged`] : []),
        ...(restoreTotal > 0 ? [`${restoreTotal} restored`] : [])
      ].join(", ");
      const importedCount = Number(result?.imported) || 0;

      if (elements.restorePreviewSummary) {
        elements.restorePreviewSummary.textContent = breakdown
          ? `Imported ${importedCount} word${importedCount === 1 ? "" : "s"} (${breakdown}).`
          : "Nothing to import.";
      }

      if (elements.restorePreviewDetails) {
        const lines = [];
        if (preview.settings) {
          lines.push("Settings restored from this backup.");
        }
        if (preview.hasFlashcardMeta) {
          lines.push("Flashcard review progress merged.");
        }
        lines.push("Nothing in your vault was removed.");
        elements.restorePreviewDetails.innerHTML = lines
          .map((line) => `<li>${store.escapeHtml(line)}</li>`)
          .join("");
      }

      if (elements.restoreConfirm) {
        elements.restoreConfirm.classList.add("is-hidden");
      }
      if (elements.restoreCancel) {
        elements.restoreCancel.textContent = "Close";
      }
    }

    function describeRestoreReadError(error) {
      const message = String(error?.message || "");
      if (/LODVault export|export version|JSON import format/i.test(message)) {
        return message;
      }
      return "Could not read that file as a LODVault backup.";
    }

    async function refreshAfterRestore() {
      await ctx.sync.refreshSettingsState();
      ctx.current.renderAutoMode();
      ctx.sync.renderSyncLanguages();
      await ctx.list.renderSavedList();
      await ctx.current.refreshCurrentPage();
      ctx.sync.scheduleSyncCapacityRefresh();
    }

    async function importJsonFile(event) {
      const file = event.target.files?.[0];
      if (!file) return;

      clearRestorePreview();

      try {
        const text = await file.text();
        const preview = await store.previewJsonImport(text);
        if (!preview) {
          throw new Error("Could not read that file as a LODVault backup.");
        }

        pendingRestoreText = text;
        pendingRestorePreview = preview;
        renderRestorePreview(preview);
        // The preview lives inside the Data & settings disclosure: open it so
        // the user can review the changes before choosing Merge backup.
        if (elements.dataSettings) {
          elements.dataSettings.open = true;
        }
        setSearchStatusFeedback("Review the backup below, then choose Merge backup.", "success");
      } catch (error) {
        clearRestorePreview();
        setSearchStatusFeedback(describeRestoreReadError(error), "error");
      } finally {
        event.target.value = "";
        clearSearchStatusToneAfter();
      }
    }

    async function confirmRestoreJson() {
      if (!pendingRestoreText || !pendingRestorePreview) return;

      const preview = pendingRestorePreview;
      if (elements.restoreConfirm) elements.restoreConfirm.disabled = true;

      try {
        const result = await store.importJson(pendingRestoreText);
        // The commit succeeded from here on; only refresh is still pending.
        pendingRestoreText = "";
        pendingRestorePreview = null;

        try {
          await refreshAfterRestore();
        } catch {
          // Post-commit refresh is best-effort: the vault is already merged and
          // storage listeners will re-render the affected sections.
        }

        renderRestoreCompleted(preview, result);

        const importedCount = Number(result?.imported) || 0;
        const extras = [];
        if (preview.settings) extras.push("Settings restored.");
        if (preview.hasFlashcardMeta) extras.push("Review progress merged.");
        const message = `Imported ${importedCount} word${importedCount === 1 ? "" : "s"}.${extras.length ? ` ${extras.join(" ")}` : ""}`;
        setSearchStatusFeedback(message, "success");
        ctx.showActionFeedback(message);
      } catch {
        // The commit itself failed; keep the review panel so the user can retry.
        if (elements.restoreConfirm) elements.restoreConfirm.disabled = false;
        setSearchStatusFeedback("Could not import that JSON file.", "error");
      }
    }

    function cancelRestoreJson() {
      const wasCompleted = restoreCompleted;
      clearRestorePreview();
      ctx.showActionFeedback(wasCompleted ? "Restore summary closed." : "Restore cancelled.");
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

    return {
      refreshPortableBackupMeta,
      renderPortableBackupStatus,
      renderBackupWarning,
      renderBrowserHistoryImportAction,
      onHistoryImportRangeChange,
      refreshHistoryImportState,
      renderHistoryImportReport,
      exportHtml,
      exportAnki,
      exportJson,
      importJsonFile,
      confirmRestoreJson,
      cancelRestoreJson,
      importFromBrowserHistory
    };
  }

  globalThis.LodVaultPopupBackup = {
    create: createBackupModule
  };
})();
