const test = require("node:test");
const assert = require("node:assert/strict");

const { loadPopupScript } = require("./helpers/loaders");

function makeEntries(count) {
  return Array.from({ length: count }, (_value, index) => ({
    id: `WORD${index + 1}`,
    word: `Word ${index + 1}`,
    url: `https://lod.lu/artikel/WORD${index + 1}`,
    note: index === 10 ? "tree note" : "",
    translations: index === 10 ? { en: "tree" } : { en: `meaning ${index + 1}` },
    study: true,
    updatedAt: `2025-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
  }));
}

test("popup shows recent saved words by default without requiring a search", async () => {
  const entries = makeEntries(12);
  const { dom } = await loadPopupScript({ entries });

  const items = Array.from(dom.window.document.querySelectorAll(".saved-item"));
  const overflow = dom.window.document.querySelector(".list-overflow");
  const searchStatus = dom.window.document.getElementById("search-status");
  const emptyState = dom.window.document.getElementById("empty-state");
  const noResults = dom.window.document.getElementById("no-results");

  assert.equal(items.length, 10);
  assert.equal(items[0].querySelector(".word-link").textContent, "Word 1");
  assert.match(searchStatus.textContent, /12 saved words · showing 10 recent/);
  assert.match(overflow.textContent, /Showing 10 recent words/);
  assert.equal(emptyState.classList.contains("is-hidden"), true);
  assert.equal(noResults.classList.contains("is-hidden"), true);
});

test("popup search filters the saved list and shows the no-results state when needed", async () => {
  const entries = makeEntries(12);
  const { dom } = await loadPopupScript({ entries });
  const searchInput = dom.window.document.getElementById("search-input");
  const searchStatus = dom.window.document.getElementById("search-status");
  const noResults = dom.window.document.getElementById("no-results");

  searchInput.value = "tree";
  searchInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

  let items = Array.from(dom.window.document.querySelectorAll(".saved-item"));
  assert.equal(items.length, 1);
  assert.equal(items[0].querySelector(".word-link").textContent, "Word 11");
  assert.match(searchStatus.textContent, /1 match · 12 total/);
  assert.equal(noResults.classList.contains("is-hidden"), true);

  searchInput.value = "missing";
  searchInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

  items = Array.from(dom.window.document.querySelectorAll(".saved-item"));
  assert.equal(items.length, 0);
  assert.equal(noResults.classList.contains("is-hidden"), false);
});

test("popup announces Favorite and Study membership changes", async () => {
  const entries = makeEntries(1);
  entries[0].favorite = false;
  entries[0].study = false;
  const { dom } = await loadPopupScript({
    entries,
    storeOverrides: {
      async toggleList(entry, listName) {
        return { ...entry, [listName]: !entry[listName] };
      }
    }
  });

  dom.window.document.querySelector('[data-action="toggle-favorite"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const feedback = dom.window.document.getElementById("action-feedback");
  assert.equal(feedback.classList.contains("is-hidden"), false);
  assert.match(feedback.textContent, /Added Word 1 to Favorites/);
});

test("popup deletion offers Undo and restores the complete entry", async () => {
  const entries = makeEntries(1);
  entries[0].note = "keep this";
  entries[0].favorite = true;
  const removed = [];
  const restored = [];
  const { dom } = await loadPopupScript({
    entries,
    storeOverrides: {
      async removeEntry(id) {
        const index = entries.findIndex((entry) => entry.id === id);
        removed.push(entries[index]);
        entries.splice(index, 1);
      },
      async restoreEntry(entry) {
        restored.push(entry);
        entries.push(entry);
        return entry;
      }
    }
  });

  dom.window.document.querySelector('[data-action="remove"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const undoToast = dom.window.document.getElementById("delete-undo");
  assert.equal(entries.length, 0);
  assert.equal(undoToast.classList.contains("is-hidden"), false);
  assert.match(dom.window.document.getElementById("delete-undo-message").textContent, /Removed Word 1/);

  dom.window.document.getElementById("delete-undo-button").click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(restored.length, 1);
  assert.equal(restored[0].note, "keep this");
  assert.equal(restored[0].favorite, true);
  assert.equal(entries.length, 1);
  assert.equal(undoToast.classList.contains("is-hidden"), true);
  assert.equal(removed.length, 1);
});

test("popup highlights portable backup state, shows the Never chip, and removes local snapshot UI", async () => {
  const { dom } = await loadPopupScript({ entries: makeEntries(2) });
  const exportButton = dom.window.document.getElementById("export-json");
  const importButton = dom.window.document.getElementById("import-json");
  const portableCard = dom.window.document.getElementById("portable-backup-card");
  const portableChip = dom.window.document.getElementById("portable-backup-chip");
  const portableStatus = dom.window.document.getElementById("portable-backup-status");
  const backupNowButton = dom.window.document.getElementById("portable-backup-now");

  assert.equal(exportButton.textContent.trim(), "Backup JSON");
  assert.equal(importButton.textContent.trim(), "Restore JSON");
  assert.equal(dom.window.document.getElementById("backup-section"), null);
  assert.equal(dom.window.document.getElementById("create-backup"), null);
  assert.match(portableStatus.textContent, /No backup created yet/i);
  assert.equal(portableCard.classList.contains("is-warning"), true);
  assert.equal(portableChip.textContent.trim(), "Never");
  assert.equal(portableChip.classList.contains("is-warning"), true);
  assert.equal(backupNowButton.classList.contains("is-hidden"), false);
});

test("popup updates portable backup status after Backup JSON runs", async () => {
  const downloadCalls = [];
  const markCalls = [];
  const fixedMeta = {
    lastExportedAt: "2026-05-14T19:30:00.000Z",
    entryCount: 2
  };
  const { dom } = await loadPopupScript({
    entries: makeEntries(2),
    storeOverrides: {
      downloadTextFile(filename, content, mimeType) {
        downloadCalls.push({ filename, content, mimeType });
      },
      async getPortableBackupMeta() {
        return { lastExportedAt: "", entryCount: 0 };
      },
      async markPortableBackupExported(summary) {
        markCalls.push(summary);
        return fixedMeta;
      }
    }
  });

  dom.window.document.getElementById("export-json").click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const portableCard = dom.window.document.getElementById("portable-backup-card");
  const portableChip = dom.window.document.getElementById("portable-backup-chip");
  const portableStatus = dom.window.document.getElementById("portable-backup-status");
  const backupNowButton = dom.window.document.getElementById("portable-backup-now");
  assert.equal(downloadCalls.length, 1);
  assert.match(downloadCalls[0].filename, /lodvault-export-\d{4}-\d{2}-\d{2}\.json/);
  assert.equal(downloadCalls[0].mimeType, "application/json");
  assert.equal(markCalls.length, 1);
  assert.equal(markCalls[0].entryCount, 2);
  assert.match(portableStatus.textContent, /Last portable backup: 2026-05-14T19:30:00.000Z · 2 words/i);
  assert.match(portableStatus.textContent, /This backup survives uninstall/i);
  assert.equal(portableCard.classList.contains("is-success"), true);
  assert.equal(portableChip.textContent.trim(), "Up to date");
  assert.equal(portableChip.classList.contains("is-success"), true);
  assert.equal(backupNowButton.classList.contains("is-hidden"), true);
});

test("popup JSON backup includes flashcard review metadata", async () => {
  const downloadCalls = [];
  const flashcardMeta = {
    WORD1: {
      reviews: [{ date: "2026-07-01T10:00:00.000Z", rating: 3, direction: "fwd" }],
      totalReviews: 4,
      hardCount: 0,
      goodCount: 1,
      easyCount: 3,
      lastReviewedAt: "2026-07-01T10:00:00.000Z",
      dueAt: "2026-07-09T10:00:00.000Z",
      interval: 8
    }
  };
  const { dom } = await loadPopupScript({
    entries: makeEntries(2),
    storeOverrides: {
      downloadTextFile(filename, content) {
        downloadCalls.push({ filename, content });
      },
      async getFlashcardMeta() {
        return structuredClone(flashcardMeta);
      }
    }
  });

  dom.window.document.getElementById("export-json").click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(downloadCalls.length, 1);
  const parsed = JSON.parse(downloadCalls[0].content);
  assert.equal(parsed.flashcardMeta.WORD1.totalReviews, 4);
  assert.equal(parsed.flashcardMeta.WORD1.interval, 8);
  assert.equal(parsed.flashcardMeta.WORD1.dueAt, "2026-07-09T10:00:00.000Z");
});

function selectRestoreFile(dom, content) {
  const fileInput = dom.window.document.getElementById("import-json-file");
  const file = { name: "lodvault-export.json", text: async () => content };
  Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
  fileInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("popup previews a JSON restore and only merges on confirm", async () => {
  const importCalls = [];
  const { dom } = await loadPopupScript({
    entries: makeEntries(1),
    storeOverrides: {
      async previewJsonImport() {
        return {
          exportedAt: "2026-07-01T10:00:00.000Z",
          entryCount: 1,
          skippedCount: 0,
          newIds: ["WORD2"],
          mergeIds: [],
          restoreIds: [],
          settings: { autoMode: true, syncLanguages: ["en", "fr", "de"] },
          hasFlashcardMeta: true,
          flashcardCount: 1
        };
      },
      async importJson(text) {
        importCalls.push(text);
        return { imported: 1, total: 2, newCount: 1, mergeCount: 0, restoreCount: 0 };
      }
    }
  });

  const preview = dom.window.document.getElementById("restore-preview");
  const summary = dom.window.document.getElementById("restore-preview-summary");
  const details = dom.window.document.getElementById("restore-preview-details");
  const chip = dom.window.document.getElementById("restore-preview-chip");

  selectRestoreFile(dom, "{}");
  await flush();

  // Selecting a file must never merge on its own.
  assert.equal(importCalls.length, 0);
  assert.equal(preview.classList.contains("is-hidden"), false);
  assert.equal(dom.window.document.getElementById("restore-preview-title").textContent, "Backup from 2026-07-01T10:00:00.000Z");
  assert.match(summary.textContent, /1 valid word in this backup/);
  assert.match(summary.textContent, /never removes words/);
  const lines = Array.from(details.querySelectorAll("li")).map((li) => li.textContent);
  assert.ok(lines.some((line) => line.includes("1 new word will be added")));
  assert.ok(lines.some((line) => line.includes("Will restore settings: auto mode on · sync languages: en, fr, de")));
  assert.ok(lines.some((line) => line.includes("Includes flashcard review progress (1 word)")));
  assert.equal(chip.textContent.trim(), "Review");

  dom.window.document.getElementById("restore-confirm").click();
  await flush();

  assert.equal(importCalls.length, 1);
  assert.equal(importCalls[0], "{}");
  assert.equal(chip.textContent.trim(), "Merged");
  assert.equal(chip.classList.contains("is-success"), true);
  assert.match(summary.textContent, /Imported 1 word \(1 new\)/);
  assert.equal(dom.window.document.getElementById("restore-confirm").classList.contains("is-hidden"), true);
  assert.equal(dom.window.document.getElementById("restore-cancel").textContent, "Close");
  assert.match(dom.window.document.getElementById("search-status").textContent, /Imported 1 word\. Settings restored\. Review progress merged/);
});

test("popup completed summary uses the actual merge counts when they differ from the preview", async () => {
  const { dom } = await loadPopupScript({
    entries: makeEntries(1),
    storeOverrides: {
      async previewJsonImport() {
        return {
          exportedAt: "",
          entryCount: 1,
          skippedCount: 0,
          newIds: ["WORD2"],
          mergeIds: [],
          restoreIds: [],
          settings: null,
          hasFlashcardMeta: false,
          flashcardCount: 0
        };
      },
      async importJson() {
        // The vault changed between preview and merge: the word already exists.
        return { imported: 1, total: 2, newCount: 0, mergeCount: 1, restoreCount: 0 };
      }
    }
  });

  const summary = dom.window.document.getElementById("restore-preview-summary");
  selectRestoreFile(dom, "{}");
  await flush();

  dom.window.document.getElementById("restore-confirm").click();
  await flush();

  assert.match(summary.textContent, /Imported 1 word \(1 merged\)/);
  const lines = Array.from(dom.window.document.getElementById("restore-preview-details").querySelectorAll("li")).map((li) => li.textContent);
  assert.ok(lines.some((line) => /nothing in your vault was removed/i.test(line)));
});

test("popup reports a successful merge even when the post-commit refresh fails", async () => {
  let failRefreshes = false;
  const importCalls = [];
  const { dom } = await loadPopupScript({
    entries: makeEntries(1),
    storeOverrides: {
      async previewJsonImport() {
        return {
          exportedAt: "",
          entryCount: 1,
          skippedCount: 0,
          newIds: ["WORD2"],
          mergeIds: [],
          restoreIds: [],
          settings: null,
          hasFlashcardMeta: false,
          flashcardCount: 0
        };
      },
      async importJson(text) {
        importCalls.push(text);
        return { imported: 1, total: 2, newCount: 1, mergeCount: 0, restoreCount: 0 };
      },
      async getEntries() {
        if (failRefreshes) {
          throw new Error("storage unavailable");
        }
        return makeEntries(1);
      }
    }
  });

  const preview = dom.window.document.getElementById("restore-preview");
  const summary = dom.window.document.getElementById("restore-preview-summary");
  const chip = dom.window.document.getElementById("restore-preview-chip");
  const searchStatus = dom.window.document.getElementById("search-status");

  selectRestoreFile(dom, "{}");
  await flush();
  assert.equal(preview.classList.contains("is-hidden"), false);

  // The vault merge succeeds, but the follow-up list refresh fails.
  failRefreshes = true;
  dom.window.document.getElementById("restore-confirm").click();
  await flush();

  assert.equal(importCalls.length, 1);
  assert.equal(chip.textContent.trim(), "Merged");
  assert.match(summary.textContent, /Imported 1 word \(1 new\)/);
  assert.match(searchStatus.textContent, /Imported 1 word\./);
  assert.doesNotMatch(searchStatus.textContent, /Could not import/);
  assert.equal(dom.window.document.getElementById("restore-confirm").classList.contains("is-hidden"), true);
});

test("popup restore preview can be cancelled without merging", async () => {
  const importCalls = [];
  const { dom } = await loadPopupScript({
    entries: makeEntries(1),
    storeOverrides: {
      async previewJsonImport() {
        return { exportedAt: "", entryCount: 0, skippedCount: 0, newIds: [], mergeIds: [], restoreIds: [], settings: null, hasFlashcardMeta: false, flashcardCount: 0 };
      },
      async importJson() {
        importCalls.push(1);
        return { imported: 0, total: 1 };
      }
    }
  });

  const preview = dom.window.document.getElementById("restore-preview");
  selectRestoreFile(dom, "{}");
  await flush();
  assert.equal(preview.classList.contains("is-hidden"), false);

  dom.window.document.getElementById("restore-cancel").click();

  assert.equal(importCalls.length, 0);
  assert.equal(preview.classList.contains("is-hidden"), true);
  assert.match(dom.window.document.getElementById("action-feedback").textContent, /Restore cancelled/);
});

test("popup shows an error for an invalid backup file and leaves the vault untouched", async () => {
  const importCalls = [];
  const { dom } = await loadPopupScript({
    entries: makeEntries(1),
    storeOverrides: {
      async previewJsonImport() {
        throw new Error("This JSON file is not a LODVault export.");
      },
      async importJson() {
        importCalls.push(1);
        return { imported: 1, total: 2 };
      }
    }
  });

  const preview = dom.window.document.getElementById("restore-preview");
  const searchStatus = dom.window.document.getElementById("search-status");
  selectRestoreFile(dom, "{}");
  await flush();

  assert.equal(importCalls.length, 0);
  assert.equal(preview.classList.contains("is-hidden"), true);
  assert.match(searchStatus.textContent, /not a LODVault export/);
  assert.equal(searchStatus.classList.contains("is-error"), true);
});

test("popup shows the Needs backup chip and one-click Backup now action when the vault changed after the last backup", async () => {
  const downloadCalls = [];
  const { dom } = await loadPopupScript({
    entries: makeEntries(2),
    portableBackupMeta: {
      lastExportedAt: "2025-01-01T00:00:00.000Z",
      entryCount: 2
    },
    storeOverrides: {
      downloadTextFile(filename, content, mimeType) {
        downloadCalls.push({ filename, content, mimeType });
      },
      async markPortableBackupExported(summary) {
        return {
          lastExportedAt: "2026-05-14T20:00:00.000Z",
          entryCount: summary?.entryCount || 0
        };
      }
    }
  });

  const portableCard = dom.window.document.getElementById("portable-backup-card");
  const portableChip = dom.window.document.getElementById("portable-backup-chip");
  const portableStatus = dom.window.document.getElementById("portable-backup-status");
  const backupNowButton = dom.window.document.getElementById("portable-backup-now");

  assert.equal(portableCard.classList.contains("is-warning"), true);
  assert.equal(portableChip.textContent.trim(), "Needs backup");
  assert.equal(portableChip.classList.contains("is-warning"), true);
  assert.equal(backupNowButton.classList.contains("is-hidden"), false);
  assert.match(portableStatus.textContent, /Newer local changes are not included yet/i);

  backupNowButton.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(downloadCalls.length, 1);
});

test("popup renders sync language chips with count and estimated capacity hints", async () => {
  const { dom } = await loadPopupScript({ syncLanguages: ["en", "fr", "de"] });

  const chips = Array.from(dom.window.document.querySelectorAll("#sync-language-chips .sync-language-chip"));
  const count = dom.window.document.getElementById("sync-language-count");
  const capacity = dom.window.document.getElementById("sync-language-capacity");

  assert.equal(chips.length, 5);
  assert.equal(chips.filter((chip) => chip.getAttribute("aria-checked") === "true").length, 3);
  assert.match(count.textContent, /3 of 3 selected/);
  assert.match(capacity.textContent, /Sync: Est\. ~700 words/);
  assert.equal(chips.find((chip) => chip.dataset.language === "pt").getAttribute("aria-disabled"), "true");
});

test("popup sync language selector saves immediately and enforces min/max selection", async () => {
  const calls = [];
  const { dom } = await loadPopupScript({
    syncLanguages: ["en", "fr"],
    storeOverrides: {
      async setSyncLanguages(nextLanguages) {
        calls.push([...nextLanguages]);
        return nextLanguages;
      }
    }
  });

  const ptChip = dom.window.document.querySelector('#sync-language-chips [data-language="pt"]');
  ptChip.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  let chips = Array.from(dom.window.document.querySelectorAll("#sync-language-chips .sync-language-chip"));
  assert.deepEqual(calls[0], ["en", "fr", "pt"]);
  assert.match(dom.window.document.getElementById("sync-language-count").textContent, /3 of 3 selected/);
  assert.equal(chips.find((chip) => chip.dataset.language === "de").getAttribute("aria-disabled"), "true");

  const frChip = dom.window.document.querySelector('#sync-language-chips [data-language="fr"]');
  frChip.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const enChip = dom.window.document.querySelector('#sync-language-chips [data-language="en"]');
  enChip.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const lastSelectedChip = dom.window.document.querySelector('#sync-language-chips [data-language="pt"]');
  lastSelectedChip.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  chips = Array.from(dom.window.document.querySelectorAll("#sync-language-chips .sync-language-chip"));
  assert.deepEqual(calls, [["en", "fr", "pt"], ["en", "pt"], ["pt"]]);
  assert.equal(chips.find((chip) => chip.dataset.language === "pt").getAttribute("aria-disabled"), "true");
  assert.match(dom.window.document.getElementById("sync-language-count").textContent, /1 of 3 selected/);
  assert.match(dom.window.document.getElementById("sync-language-capacity").textContent, /Sync: Est\. ~990 words/);
});

test("popup sync capacity surfaces non-vault sync usage separately", async () => {
  const { dom } = await loadPopupScript({
    entries: makeEntries(2),
    syncOverrides: {
      SYNC_TOTAL_HARD_LIMIT: 102400,
      async inspectSyncStorage() {
        return {
          ok: true,
          hasSyncData: true,
          hasSyncWords: true,
          bytesUsed: 4096,
          bytesUsedTotal: 4096,
          bytesUsedVault: 3072,
          bytesUsedOther: 1024,
          bytesTotal: 102400,
          bytesRemaining: 98304,
          percentUsed: 4,
          entryCount: 2,
          shardCount: 1,
          estimatedRemaining: 580,
          itemCountTotal: 6,
          itemCountVault: 4,
          itemCountOther: 2,
          itemCountRemaining: 506,
          maxItemsTotal: 512
        };
      }
    }
  });

  const capacity = dom.window.document.getElementById("sync-language-capacity");
  assert.match(capacity.textContent, /4\.0 KB \/ 100\.0 KB used/);
  assert.match(capacity.textContent, /~580 words fit/);
  assert.match(capacity.textContent, /1\.0 KB used by other sync data/);
});

test("popup sync-now verifies the remote copy after pushing without calling sync init", async () => {
  let initCalls = 0;
  let pushAllCalls = 0;
  let remoteState = {
    ok: true,
    hasSyncData: false,
    hasSyncWords: false,
    bytesUsed: 0,
    bytesTotal: 102400,
    bytesRemaining: 102400,
    percentUsed: 0,
    entryCount: 0,
    shardCount: 0,
    estimatedRemaining: 700
  };

  const { dom } = await loadPopupScript({
    entries: makeEntries(2),
    syncOverrides: {
      SYNC_TOTAL_HARD_LIMIT: 102400,
      async inspectSyncStorage() {
        return { ...remoteState };
      },
      SyncAdapter: {
        async init() {
          initCalls += 1;
          return { ok: true };
        },
        async pushAll() {
          pushAllCalls += 1;
          remoteState = {
            ok: true,
            hasSyncData: true,
            hasSyncWords: true,
            bytesUsed: 2048,
            bytesTotal: 102400,
            bytesRemaining: 100352,
            percentUsed: 2,
            entryCount: 2,
            shardCount: 1,
            estimatedRemaining: 600
          };
          return { ok: true, entryCount: 2 };
        }
      }
    }
  });

  const button = dom.window.document.getElementById("sync-now");
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(initCalls, 0);
  assert.equal(pushAllCalls, 1);
  assert.match(dom.window.document.getElementById("sync-now-status").textContent, /2 words verified in sync/);
});

test("popup records and shows the last verified manual sync", async () => {
  let remoteState = {
    ok: true,
    hasSyncData: false,
    hasSyncWords: false,
    bytesUsed: 0,
    bytesTotal: 102400,
    bytesRemaining: 102400,
    percentUsed: 0,
    entryCount: 0,
    shardCount: 0,
    estimatedRemaining: 700
  };
  const verificationCalls = [];
  const { dom } = await loadPopupScript({
    entries: makeEntries(1),
    storeOverrides: {
      async markSyncVerified() {
        const timestamp = "2026-07-30T12:34:56.000Z";
        verificationCalls.push(timestamp);
        return timestamp;
      }
    },
    syncOverrides: {
      SYNC_TOTAL_HARD_LIMIT: 102400,
      async inspectSyncStorage() {
        return { ...remoteState };
      },
      SyncAdapter: {
        async pushAll() {
          remoteState = { ...remoteState, hasSyncData: true, hasSyncWords: true, entryCount: 1 };
          return { ok: true };
        }
      }
    }
  });

  dom.window.document.getElementById("sync-now").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(verificationCalls, ["2026-07-30T12:34:56.000Z"]);
  assert.match(dom.window.document.getElementById("sync-verified-status").textContent, /Last verified sync: 2026-07-30T12:34:56.000Z/);
});

test("popup sync-now surfaces a retry action after failure", async () => {
  let pushAllCalls = 0;
  const { dom } = await loadPopupScript({
    entries: makeEntries(1),
    syncOverrides: {
      async inspectSyncStorage() {
        return { ok: false, hasSyncData: false, hasSyncWords: false, bytesTotal: 102400 };
      },
      SyncAdapter: {
        async pushAll() {
          pushAllCalls += 1;
          return { ok: false, reason: "sync-unavailable" };
        }
      }
    }
  });

  dom.window.document.getElementById("sync-now").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const retry = dom.window.document.getElementById("sync-retry");
  assert.equal(retry.classList.contains("is-hidden"), false);
  retry.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(pushAllCalls, 2);
});

test("popup sync-now surfaces verification failure when sync stores only metadata", async () => {
  let pushAllCalls = 0;
  let remoteState = {
    ok: true,
    hasSyncData: false,
    hasSyncWords: false,
    bytesUsed: 0,
    bytesTotal: 102400,
    bytesRemaining: 102400,
    percentUsed: 0,
    entryCount: 0,
    shardCount: 0,
    estimatedRemaining: 700
  };

  const { dom } = await loadPopupScript({
    entries: makeEntries(2),
    syncOverrides: {
      SYNC_TOTAL_HARD_LIMIT: 102400,
      async inspectSyncStorage() {
        return { ...remoteState };
      },
      SyncAdapter: {
        async pushAll() {
          pushAllCalls += 1;
          remoteState = {
            ok: true,
            hasSyncData: true,
            hasSyncWords: false,
            bytesUsed: 128,
            bytesTotal: 102400,
            bytesRemaining: 102272,
            percentUsed: 0,
            entryCount: 0,
            shardCount: 0,
            estimatedRemaining: 700
          };
          return { ok: true, entryCount: 2 };
        }
      }
    }
  });

  const button = dom.window.document.getElementById("sync-now");
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(pushAllCalls, 1);
  const syncStatus = dom.window.document.getElementById("sync-now-status");
  assert.match(syncStatus.textContent, /failed verification/i);
  assert.equal(syncStatus.classList.contains("is-error"), true);
  assert.doesNotMatch(dom.window.document.getElementById("sync-language-capacity").textContent, /^Sync: 0 \/ 100\.0 KB used/);
});

test("popup pull-synced-data button pulls without triggering sync init side effects", async () => {
  let initCalls = 0;
  let pullAllCalls = 0;

  const { dom } = await loadPopupScript({
    entries: [],
    syncOverrides: {
      SYNC_TOTAL_HARD_LIMIT: 102400,
      async getSyncUsageStats() {
        return {
          bytesUsed: 2048,
          bytesTotal: 102400,
          bytesRemaining: 100352,
          percentUsed: 2,
          entryCount: 4,
          shardCount: 1,
          estimatedRemaining: 600
        };
      },
      SyncAdapter: {
        async init() {
          initCalls += 1;
          return { ok: true };
        },
        async pullAll() {
          pullAllCalls += 1;
          return { ok: true, changed: true, entryCount: 4 };
        }
      }
    }
  });

  const button = dom.window.document.getElementById("sync-pull");
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(initCalls, 0);
  assert.equal(pullAllCalls, 1);
  const syncStatus = dom.window.document.getElementById("sync-now-status");
  assert.match(syncStatus.textContent, /Pull complete/);
  assert.equal(syncStatus.classList.contains("is-success"), true);
});

test("popup imports browser history on user action after requesting permission", async () => {
  const importCalls = [];

  const { dom, chrome } = await loadPopupScript({
    entries: makeEntries(2),
    storeOverrides: {
      async importBrowserHistory(options) {
        importCalls.push(options);
        return {
          imported: 2,
          scanned: 7,
          skippedExisting: 5,
          ignored: 0,
          total: 4,
          addedEntries: [
            { id: "BEEM1", word: "Beem" },
            { id: "MANN1", word: "Mann" }
          ]
        };
      }
    }
  });

  let permissionRequests = 0;
  chrome.permissions = {
    async request() {
      permissionRequests += 1;
      return true;
    },
    async contains() {
      return permissionRequests > 0;
    }
  };

  dom.window.confirm = () => true;

  const rangeSelect = dom.window.document.getElementById("import-history-range");
  assert.ok(rangeSelect.querySelector('option[value="7d"]'));

  const importButton = dom.window.document.getElementById("import-browser-history");
  importButton.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(permissionRequests, 1);
  assert.equal(importCalls.length, 1);
  assert.equal(importCalls[0].startTime, 0);
  assert.match(dom.window.document.getElementById("search-status").textContent, /Imported 2 new words from browser history/);

  const reportSummary = dom.window.document.getElementById("import-history-report-summary").textContent;
  assert.match(reportSummary, /scanned 7, imported 2, already saved 5, ignored 0/);

  const reportItems = Array.from(dom.window.document.querySelectorAll(".history-import-report-item"));
  assert.equal(reportItems.length, 2);
  assert.match(reportItems[0].textContent, /Beem|Mann/);
});

test("popup browser-history import passes startTime for 7-day range", async () => {
  const importCalls = [];

  const { dom, chrome } = await loadPopupScript({
    entries: makeEntries(1),
    storeOverrides: {
      async importBrowserHistory(options) {
        importCalls.push(options);
        return { imported: 0, scanned: 0, skippedExisting: 0, ignored: 0, total: 1 };
      }
    }
  });

  chrome.permissions = {
    async request() {
      return true;
    },
    async contains() {
      return true;
    }
  };

  dom.window.confirm = () => true;

  const rangeSelect = dom.window.document.getElementById("import-history-range");
  rangeSelect.value = "7d";
  rangeSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

  dom.window.document.getElementById("import-browser-history").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(importCalls.length, 1);
  assert.ok(importCalls[0].startTime > 0);
  assert.ok(importCalls[0].startTime <= Date.now());
});

test("popup current-note input can auto-save an unsaved current word", async () => {
  const currentEntry = {
    id: "HAUS1",
    word: "Haus",
    url: "https://lod.lu/artikel/HAUS1",
    pos: "SUBST"
  };

  let saveCalls = 0;
  const toggleCalls = [];

  const { dom } = await loadPopupScript({
    entries: [],
    currentEntry,
    storeOverrides: {
      async saveNote(id, note) {
        saveCalls += 1;
        if (saveCalls === 1) {
          throw new Error("Entry not found.");
        }
        return { id, note };
      },
      async toggleList(entry, listName) {
        toggleCalls.push({ id: entry.id, listName });
        return { ...entry, study: true };
      }
    }
  });

  const textarea = dom.window.document.getElementById("current-note");
  assert.equal(textarea.disabled, false);

  textarea.value = "Remember this";
  textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  textarea.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(saveCalls, 2);
  assert.deepEqual(toggleCalls, [{ id: "HAUS1", listName: "study" }]);
});

