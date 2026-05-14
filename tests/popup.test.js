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

test("popup sync-now button pushes local vault to sync and updates status", async () => {
  let initCalls = 0;
  let pushAllCalls = 0;

  const { dom } = await loadPopupScript({
    entries: makeEntries(2),
    syncOverrides: {
      SYNC_TOTAL_HARD_LIMIT: 102400,
      async getSyncUsageStats() {
        return {
          bytesUsed: 2048,
          bytesTotal: 102400,
          bytesRemaining: 100352,
          percentUsed: 2,
          entryCount: 2,
          shardCount: 1,
          estimatedRemaining: 600
        };
      },
      SyncAdapter: {
        async init() {
          initCalls += 1;
          return { ok: true };
        },
        async pushAll() {
          pushAllCalls += 1;
          return { ok: true, entryCount: 2 };
        }
      }
    }
  });

  const button = dom.window.document.getElementById("sync-now");
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(initCalls, 1);
  assert.equal(pushAllCalls, 1);
  assert.match(dom.window.document.getElementById("sync-now-status").textContent, /Sync complete/);
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

test("popup renders backup snapshots and restores selected backup", async () => {
  const backups = [
    { id: "b1", createdAt: "2025-01-01T10:00:00.000Z", reason: "auto-visit", entryCount: 20 },
    { id: "b2", createdAt: "2025-01-01T09:00:00.000Z", reason: "import-json", entryCount: 17 }
  ];
  const restored = [];

  const { dom } = await loadPopupScript({
    entries: makeEntries(3),
    storeOverrides: {
      async getVaultBackups() {
        return backups;
      },
      async restoreVaultBackup(backupId) {
        restored.push(backupId);
        return { restored: true, entryCount: 21 };
      }
    }
  });

  dom.window.confirm = () => true;

  const backupItems = Array.from(dom.window.document.querySelectorAll(".backup-item"));
  assert.equal(backupItems.length, 2);
  assert.match(dom.window.document.getElementById("backup-status").textContent, /2 local backup snapshots/);

  const restoreBtn = dom.window.document.querySelector('button[data-action="restore-backup"][data-backup-id="b1"]');
  restoreBtn.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(restored, ["b1"]);
  assert.match(dom.window.document.getElementById("backup-status").textContent, /Backup restored/);
});

test("popup can delete a selected backup snapshot", async () => {
  let backups = [
    { id: "b1", createdAt: "2025-01-01T10:00:00.000Z", reason: "auto-visit", entryCount: 20 },
    { id: "b2", createdAt: "2025-01-01T09:00:00.000Z", reason: "import-json", entryCount: 17 }
  ];
  const deleted = [];

  const { dom } = await loadPopupScript({
    entries: makeEntries(3),
    storeOverrides: {
      async getVaultBackups() {
        return backups;
      },
      async deleteVaultBackup(backupId) {
        deleted.push(backupId);
        backups = backups.filter((item) => item.id !== backupId);
        return { deleted: true, backupId, remaining: backups.length };
      }
    }
  });

  dom.window.confirm = () => true;

  const deleteBtn = dom.window.document.querySelector('button[data-action="delete-backup"][data-backup-id="b1"]');
  deleteBtn.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(deleted, ["b1"]);
  assert.equal(dom.window.document.querySelector('article.backup-item[data-backup-id="b1"]'), null);
  assert.match(dom.window.document.getElementById("backup-status").textContent, /Backup deleted/);
});

test("popup creates a manual backup from the backup header", async () => {
  let backups = [];
  const created = [];

  const { dom } = await loadPopupScript({
    entries: makeEntries(3),
    storeOverrides: {
      async getVaultBackups() {
        return backups;
      },
      async createVaultBackup(reason) {
        created.push(reason);
        backups = [
          { id: "manual-1", createdAt: "2026-05-11T21:36:00.000Z", reason: "manual-popup", entryCount: 3 }
        ];
        return { created: true, backupId: "manual-1", entryCount: 3, remaining: 1, reason: "manual-popup" };
      }
    }
  });

  const createBtn = dom.window.document.getElementById("create-backup");
  createBtn.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(created, ["manual-popup"]);
  assert.equal(dom.window.document.querySelectorAll(".backup-item").length, 1);
  assert.match(dom.window.document.getElementById("backup-status").textContent, /Backup created/);
});
