(() => {
  function createSyncCoordinator(options = {}) {
    const store = options.store || globalThis.LodVaultStore;
    const syncNamespace = options.syncNamespace || globalThis.LodVaultSync;
    const syncAdapter = options.syncAdapter || syncNamespace.SyncAdapter;
    const logger = options.logger || console;
    const pushDebounceMs = Math.max(0, Number(options.pushDebounceMs ?? globalThis.__LOD_SYNC_PUSH_DEBOUNCE_MS__ ?? 2000) || 0);
    const suppressWindowMs = Math.max(pushDebounceMs * 2, 50);
    const localSyncKeys = new Set([
      store.STORAGE_KEY,
      store.SETTINGS_KEY,
      store.DELETED_KEY
    ]);
    const syncManifestKey = syncNamespace.SYNC_MANIFEST_KEY;
    const syncSettingsKey = syncNamespace.SYNC_SETTINGS_KEY;
    const syncDeletedKey = syncNamespace.SYNC_DELETED_KEY;
    const syncEntryPrefix = syncNamespace.SYNC_ENTRY_PREFIX;

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
        || key === syncDeletedKey
        || key.startsWith(syncEntryPrefix)
      ));
    }

    const stableStringify = (value) => syncNamespace.stableStringify(value);

    const normalizeSettingsForComparison = (settings = {}) => store.normalizeSettings(settings);

    function describeEntryChange(change) {
      const oldMap = change?.oldValue && typeof change.oldValue === "object" ? change.oldValue : {};
      const newMap = change?.newValue && typeof change.newValue === "object" ? change.newValue : {};
      const entryIds = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
      const changedEntryIds = [];
      const addedEntryIds = [];
      const removedEntryIds = [];

      for (const entryId of entryIds) {
        if (stableStringify(oldMap[entryId]) === stableStringify(newMap[entryId])) continue;
        changedEntryIds.push(entryId);
        if (!(entryId in oldMap) && (entryId in newMap)) {
          addedEntryIds.push(entryId);
        } else if ((entryId in oldMap) && !(entryId in newMap)) {
          removedEntryIds.push(entryId);
        }
      }

      return {
        changedEntryIds,
        addedEntryIds,
        removedEntryIds
      };
    }

    function getSettingsChangeKind(change) {
      if (!change) return null;

      const previous = normalizeSettingsForComparison(change.oldValue || {});
      const next = normalizeSettingsForComparison(change.newValue || {});
      const autoModeChanged = previous.autoMode !== next.autoMode;
      const syncLanguagesChanged = stableStringify(previous.syncLanguages) !== stableStringify(next.syncLanguages);

      if (syncLanguagesChanged) return "all";
      if (autoModeChanged) return "settings";
      return "none";
    }

    function describeLocalPushPlan(changes) {
      const entryChange = changes?.[store.STORAGE_KEY];
      const settingsChange = changes?.[store.SETTINGS_KEY];
      const deletedChange = changes?.[store.DELETED_KEY];
      const settingsKind = getSettingsChangeKind(settingsChange);

      if (!entryChange && !deletedChange && settingsKind === "none") {
        return null;
      }

      if (deletedChange) {
        return { type: "all", immediate: true };
      }

      // If both entries and settings changed, or sync-languages changed,
      // we must do a full push because the shard layout may change.
      if (entryChange && settingsKind) {
        return { type: "all" };
      }

      // If only the autoMode toggle changed, a settings-only push suffices.
      if (settingsKind === "settings") {
        return { type: "settings" };
      }

      // If sync-languages changed without entries, the shard layout still
      // needs re-splitting because translations may be added/removed.
      if (settingsKind === "all") {
        return { type: "all" };
      }

      // If only entries changed, check whether a single-entry push is sufficient.
      if (entryChange) {
        const entryChangeInfo = describeEntryChange(entryChange);
        const hasNewWord = entryChangeInfo.addedEntryIds.length > 0;

        if (entryChangeInfo.changedEntryIds.length === 1) {
          return {
            type: "entry",
            id: entryChangeInfo.changedEntryIds[0],
            immediate: hasNewWord
          };
        }
        // Multiple entries changed at once — full push is safer.
        if (entryChangeInfo.changedEntryIds.length > 1) {
          return { type: "all", immediate: hasNewWord };
        }
        // No net change in entry data (e.g. a timestamp-only update that
        // stableStringify considers equal). Fall through to full push.
      }

      // Default: full push covers any edge case.
      return { type: "all" };
    }

    function mergeLocalPushPlans(previousPlan, nextPlan) {
      // No previous plan — use the new one directly.
      if (!previousPlan) return nextPlan;

      // No new plan — keep the previous one.
      if (!nextPlan) return previousPlan;

      const immediate = Boolean(previousPlan.immediate || nextPlan.immediate);

      // If either plan requires a full push, the merged plan must also be
      // a full push (it's the broadest possible scope).
      if (previousPlan.type === "all" || nextPlan.type === "all") {
        return { type: "all", immediate };
      }

      // Two different plan types (e.g. "entry" + "settings") can't be
      // satisfied by a single targeted push — escalate to full.
      if (previousPlan.type !== nextPlan.type) {
        return { type: "all", immediate };
      }

      // Two entry pushes targeting different entries can't be merged
      // into a single pushEntry call — escalate to full.
      if (previousPlan.type === "entry" && previousPlan.id !== nextPlan.id) {
        return { type: "all", immediate };
      }

      // Same type targeting the same entry — keep the latest plan and
      // preserve the immediate signal if any caller requested it.
      return {
        ...nextPlan,
        immediate
      };
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
      if (!plan) return;

      // Merge this plan with any pending plan so rapid successive
      // changes are coalesced into a single push after the debounce.
      pendingLocalPushPlan = mergeLocalPushPlans(pendingLocalPushPlan, plan);

      // Reset the debounce timer — the push fires only after this
      // quiet period elapses without another change.
      if (pendingLocalPushTimer) {
        clearTimeout(pendingLocalPushTimer);
      }

      const delayMs = pendingLocalPushPlan?.immediate ? 0 : pushDebounceMs;

      pendingLocalPushTimer = setTimeout(() => {
        pendingLocalPushTimer = null;
        const planToRun = pendingLocalPushPlan || { type: "all" };
        pendingLocalPushPlan = null;

        enqueueSyncTask(async () => {
          // If sync hasn't been initialized yet, do that first and suppress
          // a redundant pull that would immediately follow.
          if (!syncInitialized) {
            suppressSyncPull();
            await initializeSync("local-change");
            return;
          }

          // Prevent a pull from immediately running after the push —
          // our own push just wrote the latest data.
          suppressSyncPull();

          // Dispatch to the appropriate targeted push method.
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
      }, delayMs);
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
      handleInstalled,
      handleStartup,
      handleStorageChanged
    };
  }

  globalThis.LodVaultSyncCoordinator = {
    createSyncCoordinator
  };
})();
