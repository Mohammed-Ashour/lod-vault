(() => {
  function createSyncCoordinator(options = {}) {
    const store = options.store || globalThis.LodWrapperStore || {};
    const syncNamespace = options.syncNamespace || globalThis.LodWrapperSync || {};
    const syncAdapter = options.syncAdapter || syncNamespace.SyncAdapter || {};
    const logger = options.logger || console;
    const pushDebounceMs = Math.max(0, Number(options.pushDebounceMs ?? globalThis.__LOD_SYNC_PUSH_DEBOUNCE_MS__ ?? 2000) || 0);
    const suppressWindowMs = Math.max(pushDebounceMs * 2, 50);
    const localSyncKeys = new Set([
      store.STORAGE_KEY || "lodVault.entries",
      store.SETTINGS_KEY || "lodVault.settings"
    ]);
    const syncManifestKey = syncNamespace.SYNC_MANIFEST_KEY || "lodVault.m";
    const syncSettingsKey = syncNamespace.SYNC_SETTINGS_KEY || "lodVault.s";
    const syncEntryPrefix = syncNamespace.SYNC_ENTRY_PREFIX || "lodVault.e.";

    let syncTaskQueue = Promise.resolve();
    let syncInitPromise = null;
    let syncInitialized = false;
    let pendingLocalPushTimer = null;
    let pendingLocalPushPlan = null;
    let suppressLocalPushUntil = 0;
    let suppressSyncPullUntil = 0;

    function enqueueSyncTask(task) {
      const result = syncTaskQueue.then(task, task);
      syncTaskQueue = result.catch(() => {});
      return result;
    }

    function isSuppressed(until) {
      return Date.now() < until;
    }

    function suppressLocalPush(windowMs = suppressWindowMs) {
      suppressLocalPushUntil = Date.now() + Math.max(0, windowMs);
    }

    function suppressSyncPull(windowMs = suppressWindowMs) {
      suppressSyncPullUntil = Date.now() + Math.max(0, windowMs);
    }

    function clearPendingLocalPush() {
      if (pendingLocalPushTimer) {
        clearTimeout(pendingLocalPushTimer);
        pendingLocalPushTimer = null;
      }
      pendingLocalPushPlan = null;
    }

    function isRelevantLocalStorageChange(changes) {
      return Object.keys(changes || {}).some((key) => localSyncKeys.has(key));
    }

    function isRelevantSyncStorageChange(changes) {
      return Object.keys(changes || {}).some((key) => (
        key === syncManifestKey
        || key === syncSettingsKey
        || key.startsWith(syncEntryPrefix)
      ));
    }

    function stableStringify(value) {
      if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
      }

      if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
      }

      return JSON.stringify(value);
    }

    function normalizeSettingsForComparison(settings = {}) {
      if (typeof store.normalizeSettings === "function") {
        return store.normalizeSettings(settings);
      }

      return {
        autoMode: Boolean(settings?.autoMode),
        syncLanguages: Array.isArray(settings?.syncLanguages) ? [...settings.syncLanguages] : []
      };
    }

    function getChangedEntryIds(change) {
      const oldMap = change?.oldValue && typeof change.oldValue === "object" ? change.oldValue : {};
      const newMap = change?.newValue && typeof change.newValue === "object" ? change.newValue : {};
      const entryIds = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);

      return [...entryIds].filter((entryId) => stableStringify(oldMap[entryId]) !== stableStringify(newMap[entryId]));
    }

    function getSettingsChangeKind(change) {
      if (!change) return null;

      const previous = normalizeSettingsForComparison(change.oldValue || {});
      const next = normalizeSettingsForComparison(change.newValue || {});
      const autoModeChanged = previous.autoMode !== next.autoMode;
      const syncLanguagesChanged = stableStringify(previous.syncLanguages) !== stableStringify(next.syncLanguages);

      if (syncLanguagesChanged) return "all";
      if (autoModeChanged) return "settings";
      return null;
    }

    function describeLocalPushPlan(changes) {
      const entryChange = changes?.[store.STORAGE_KEY || "lodVault.entries"];
      const settingsChange = changes?.[store.SETTINGS_KEY || "lodVault.settings"];
      const settingsKind = getSettingsChangeKind(settingsChange);

      if (entryChange && settingsKind) {
        return { type: "all" };
      }

      if (settingsKind === "settings") {
        return { type: "settings" };
      }

      if (settingsKind === "all") {
        return { type: "all" };
      }

      if (entryChange) {
        const changedEntryIds = getChangedEntryIds(entryChange);
        if (changedEntryIds.length === 1) {
          return { type: "entry", id: changedEntryIds[0] };
        }
        if (changedEntryIds.length > 1) {
          return { type: "all" };
        }
      }

      return { type: "all" };
    }

    function mergeLocalPushPlans(previousPlan, nextPlan) {
      if (!previousPlan) return nextPlan;
      if (!nextPlan) return previousPlan;
      if (previousPlan.type === "all" || nextPlan.type === "all") return { type: "all" };
      if (previousPlan.type !== nextPlan.type) return { type: "all" };
      if (previousPlan.type === "entry" && previousPlan.id !== nextPlan.id) return { type: "all" };
      return nextPlan;
    }

    async function initializeSync(reason = "startup") {
      if (syncInitialized) {
        return { ok: true, mode: "ready", reason };
      }

      if (syncInitPromise) {
        return syncInitPromise;
      }

      syncInitPromise = (async () => {
        const result = await syncAdapter?.init?.();
        syncInitialized = true;
        return result || { ok: true, mode: "noop", reason };
      })();

      try {
        return await syncInitPromise;
      } finally {
        syncInitPromise = null;
      }
    }

    function logSyncWarning(label, error) {
      logger.warn(`[LODVault] ${label}:`, error);
    }

    function scheduleLocalPush(plan = { type: "all" }) {
      pendingLocalPushPlan = mergeLocalPushPlans(pendingLocalPushPlan, plan);

      if (pendingLocalPushTimer) {
        clearTimeout(pendingLocalPushTimer);
      }

      pendingLocalPushTimer = setTimeout(() => {
        pendingLocalPushTimer = null;
        const planToRun = pendingLocalPushPlan || { type: "all" };
        pendingLocalPushPlan = null;

        enqueueSyncTask(async () => {
          if (!syncInitialized) {
            suppressSyncPull();
            await initializeSync("local-change");
            return;
          }

          suppressSyncPull();

          if (planToRun.type === "entry" && planToRun.id) {
            return syncAdapter.pushEntry(planToRun.id);
          }

          if (planToRun.type === "settings") {
            return syncAdapter.pushSettings();
          }

          return syncAdapter.pushAll();
        }).catch((error) => {
          logSyncWarning("Sync push failed", error);
        });
      }, pushDebounceMs);
    }

    function scheduleSyncPull() {
      clearPendingLocalPush();

      enqueueSyncTask(async () => {
        if (!syncInitialized) {
          suppressLocalPush();
          await initializeSync("sync-change");
          return;
        }

        suppressLocalPush();
        suppressSyncPull();
        await syncAdapter.pullAll({ repush: true });
      }).catch((error) => {
        logSyncWarning("Sync pull failed", error);
      });
    }

    async function handleInstalled(reason = "onInstalled") {
      return enqueueSyncTask(() => initializeSync(reason)).catch((error) => {
        logSyncWarning("Initial sync failed", error);
      });
    }

    async function handleStartup(reason = "onStartup") {
      return enqueueSyncTask(() => initializeSync(reason)).catch((error) => {
        logSyncWarning("Startup sync failed", error);
      });
    }

    function handleStorageChanged(changes, areaName) {
      if (areaName === "local") {
        if (!isRelevantLocalStorageChange(changes)) return;
        if (isSuppressed(suppressLocalPushUntil)) return;
        scheduleLocalPush(describeLocalPushPlan(changes));
        return;
      }

      if (areaName === "sync") {
        if (!isRelevantSyncStorageChange(changes)) return;
        if (isSuppressed(suppressSyncPullUntil)) return;
        scheduleSyncPull();
      }
    }

    return {
      enqueueSyncTask,
      initializeSync,
      handleInstalled,
      handleStartup,
      handleStorageChanged,
      clearPendingLocalPush,
      describeLocalPushPlan,
      mergeLocalPushPlans,
      isRelevantLocalStorageChange,
      isRelevantSyncStorageChange,
      scheduleLocalPush,
      scheduleSyncPull,
      stableStringify,
      getSettingsChangeKind,
      getChangedEntryIds,
      logSyncWarning
    };
  }

  globalThis.LodWrapperSyncCoordinator = {
    createSyncCoordinator
  };
})();
