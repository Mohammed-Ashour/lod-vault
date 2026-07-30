// Auto-generated bundle — DO NOT EDIT.
// Run: node scripts/build-background.mjs
// Policy: this file is a generated packaging artifact checked in for extension loading/release builds.
// Source of truth: scripts/build-background.mjs + scripts/background-impl.js + listed dependencies below.
// Source files (in order):
//   store-core.js
//   note-autosave.js
//   entry-presenter.js
//   shared.js
//   lod-article.js
//   compress.js
//   sync.js
//   sync-coordinator.js
//   background-impl.js

globalThis.__LOD_VAULT_DIRECT_STORE__ = true;

// ── store-core.js ──────────────────────────────────────────────
(() => {
  const STORAGE_KEY = "lodVault.entries";
  const LEGACY_STORAGE_KEY = "lodWrapper.entries";
  const SETTINGS_KEY = "lodVault.settings";
  const PORTABLE_BACKUP_KEY = "lodVault.portableBackup";
  const DELETED_KEY = "lodVault.deleted";
  const HISTORY_IMPORT_STATE_KEY = "lodVault.historyImport";
  const DEFAULT_SETTINGS = {
    autoMode: false,
    syncLanguages: ["en", "fr", "de"]
  };
  const EXPORT_VERSION = 2;
  const MAX_SYNC_LANGUAGES = 3;
  const TRANSLATION_LANGUAGE_ORDER = Object.freeze(["en", "fr", "de", "pt", "nl"]);
  const TRANSLATION_LANGUAGE_LABELS = Object.freeze({
    en: "English",
    fr: "Français",
    de: "Deutsch",
    pt: "Português",
    nl: "Nederlands"
  });
  const TRANSLATION_LANGUAGE_CHIP_LABELS = Object.freeze({
    en: "EN",
    fr: "FR",
    de: "DE",
    pt: "PT",
    nl: "NL"
  });
  const SYNC_LANGUAGE_TO_KEY = Object.freeze({
    en: "e",
    fr: "f",
    de: "d",
    pt: "p",
    nl: "l"
  });
  const SYNC_KEY_TO_LANGUAGE = Object.freeze(
    Object.fromEntries(Object.entries(SYNC_LANGUAGE_TO_KEY).map(([language, key]) => [key, language]))
  );
  const BROWSER_HISTORY_IMPORT_QUERY = "lod.lu/artikel/";
  const BROWSER_HISTORY_IMPORT_MAX_RESULTS = 20000;
  const HISTORY_HYDRATION_MAX_QUEUE = 120;
  const HISTORY_HYDRATION_DELAY_MS = 250;
  const HISTORY_HYDRATION_FETCH_TIMEOUT_MS = 8000;

  let storeCacheListenerInstalled = false;
  let cachedEntryMap = null;
  let cachedSettings = null;
  let vaultIoQueue = Promise.resolve();
  let historyHydrationRunning = false;

  function invalidateStoreCache(options = {}) {
    const invalidateEntries = options.entryMap !== false;
    const invalidateSettings = options.settings !== false;

    if (invalidateEntries) {
      cachedEntryMap = null;
    }

    if (invalidateSettings) {
      cachedSettings = null;
    }
  }

  function cloneSettings(settings = DEFAULT_SETTINGS) {
    const normalized = normalizeSettings(settings);
    return {
      ...normalized,
      syncLanguages: [...normalized.syncLanguages]
    };
  }

  function ensureStoreCacheListener() {
    if (storeCacheListenerInstalled) return;
    if (!chrome?.storage?.onChanged?.addListener) return;

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;

      if (Object.prototype.hasOwnProperty.call(changes || {}, STORAGE_KEY)
        || Object.prototype.hasOwnProperty.call(changes || {}, LEGACY_STORAGE_KEY)
        || Object.prototype.hasOwnProperty.call(changes || {}, DELETED_KEY)) {
        invalidateStoreCache({ entryMap: true, settings: false });
      }

      if (Object.prototype.hasOwnProperty.call(changes || {}, SETTINGS_KEY)) {
        const settingsChange = changes?.[SETTINGS_KEY] || {};
        const previousSyncLanguages = normalizeSettings(settingsChange.oldValue || {}).syncLanguages;
        const nextSyncLanguages = normalizeSettings(settingsChange.newValue || {}).syncLanguages;
        const syncLanguagesChanged = JSON.stringify(previousSyncLanguages) !== JSON.stringify(nextSyncLanguages);

        invalidateStoreCache({
          entryMap: syncLanguagesChanged,
          settings: true
        });
      }
    });

    storeCacheListenerInstalled = true;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function getIdFromUrl(url) {
    if (!url) return "";
    const match = url.match(/\/artikel\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function cleanText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function cleanWordLabel(value) {
    return cleanText(value)
      .replace(/\s*kopéiert\b.*$/i, "")
      .replace(/\s*Artikel deelen\b.*$/i, "")
      .trim();
  }

  function isLodArticleUrl(url) {
    return /^https:\/\/(?:www\.)?lod\.lu\/artikel\//i.test(cleanText(url));
  }

  function wordFromArticleId(id) {
    return cleanText(id)
      .replace(/[0-9]+$/g, "")
      .replace(/[_-]+/g, " ")
      .trim();
  }

  function wordFromHistoryTitle(title) {
    const cleaned = cleanWordLabel(title)
      .replace(/[„“”"']/g, "")
      .replace(/\s*-\s*LOD\s*$/i, "")
      .trim();
    return cleaned;
  }

  function deriveWordFromHistoryItem(item, id) {
    const titleWord = wordFromHistoryTitle(item?.title);
    if (titleWord) return titleWord;

    const fallback = wordFromArticleId(id);
    if (fallback) return fallback;

    return cleanText(id);
  }

  function cleanTranslations(translations = {}) {
    const result = {};
    for (const [lang, value] of Object.entries(translations || {})) {
      const cleaned = cleanText(value);
      if (cleaned) result[lang] = cleaned;
    }
    return result;
  }

  function filterTranslationsByLanguages(translations = {}, languages = DEFAULT_SETTINGS.syncLanguages) {
    const allowed = new Set(normalizeSyncLanguages(languages));
    const filtered = {};

    for (const [lang, value] of Object.entries(cleanTranslations(translations))) {
      const normalized = cleanText(lang).toLowerCase();
      if (!allowed.has(normalized)) continue;
      filtered[normalized] = value;
    }

    return filtered;
  }

  function normalizeVisitCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

  function normalizeSyncLanguages(value) {
    const requested = Array.isArray(value) ? value : DEFAULT_SETTINGS.syncLanguages;
    const deduped = [];

    for (const language of requested) {
      const normalized = cleanText(language).toLowerCase();
      if (!TRANSLATION_LANGUAGE_ORDER.includes(normalized)) continue;
      if (deduped.includes(normalized)) continue;
      deduped.push(normalized);
      if (deduped.length >= MAX_SYNC_LANGUAGES) break;
    }

    return deduped.length ? deduped : [...DEFAULT_SETTINGS.syncLanguages];
  }

  function normalizeSettings(settings = {}) {
    return {
      ...DEFAULT_SETTINGS,
      autoMode: Boolean(settings?.autoMode),
      syncLanguages: normalizeSyncLanguages(settings?.syncLanguages)
    };
  }

  function normalizePortableBackupMeta(value = {}) {
    const lastExportedAt = cleanText(value?.lastExportedAt);
    const timestamp = Date.parse(lastExportedAt);

    return {
      lastExportedAt: Number.isFinite(timestamp)
        ? new Date(timestamp).toISOString()
        : "",
      entryCount: Math.max(0, Number(value?.entryCount) || 0)
    };
  }

  function normalizeDeletedMap(value = {}) {
    const result = {};

    for (const [rawId, rawDeletedAt] of Object.entries(value || {})) {
      const id = cleanText(rawId);
      const deletedAt = cleanText(rawDeletedAt);
      const timestamp = Date.parse(deletedAt);
      if (!id || !deletedAt || !Number.isFinite(timestamp)) continue;
      result[id] = new Date(timestamp).toISOString();
    }

    return result;
  }

  function mergeDeletedMaps(primary = {}, secondary = {}) {
    const left = normalizeDeletedMap(primary);
    const right = normalizeDeletedMap(secondary);
    const merged = { ...left };

    for (const [id, deletedAt] of Object.entries(right)) {
      const current = merged[id];
      if (!current || Date.parse(deletedAt) > Date.parse(current)) {
        merged[id] = deletedAt;
      }
    }

    return merged;
  }

  function getEntryTimestampMs(entry = {}) {
    const normalized = normalizeEntry(entry);
    return Math.max(
      Date.parse(normalized.updatedAt || "") || 0,
      Date.parse(normalized.lastVisitedAt || "") || 0,
      Date.parse(normalized.createdAt || "") || 0
    );
  }

  function applyDeletedMap(entryMap = {}, deletedMap = {}) {
    const normalizedEntries = normalizeEntryMap(entryMap);
    const normalizedDeleted = normalizeDeletedMap(deletedMap);
    const nextEntries = {};

    for (const [id, entry] of Object.entries(normalizedEntries)) {
      const deletedAt = normalizedDeleted[id];
      if (!deletedAt) {
        nextEntries[id] = entry;
        continue;
      }

      const deletedTimestamp = Date.parse(deletedAt) || 0;
      if (getEntryTimestampMs(entry) > deletedTimestamp) {
        nextEntries[id] = entry;
      }
    }

    return nextEntries;
  }

  function pruneDeletedMapAgainstEntries(entryMap = {}, deletedMap = {}) {
    const normalizedEntries = normalizeEntryMap(entryMap);
    const normalizedDeleted = normalizeDeletedMap(deletedMap);
    const nextDeleted = {};

    for (const [id, deletedAt] of Object.entries(normalizedDeleted)) {
      const entry = normalizedEntries[id];
      if (!entry) {
        nextDeleted[id] = deletedAt;
        continue;
      }

      const deletedTimestamp = Date.parse(deletedAt) || 0;
      if (getEntryTimestampMs(entry) <= deletedTimestamp) {
        nextDeleted[id] = deletedAt;
      }
    }

    return nextDeleted;
  }

  function normalizeHistoryImportState(value = {}) {
    const status = cleanText(value?.status) || "idle";
    const queue = Array.isArray(value?.queue)
      ? value.queue.map((id) => cleanText(id)).filter(Boolean)
      : [];
    const failedIds = Array.isArray(value?.failedIds)
      ? value.failedIds.map((id) => cleanText(id)).filter(Boolean)
      : [];

    return {
      status,
      startedAt: cleanText(value?.startedAt),
      updatedAt: cleanText(value?.updatedAt),
      scanned: Math.max(0, Number(value?.scanned) || 0),
      imported: Math.max(0, Number(value?.imported) || 0),
      skippedExisting: Math.max(0, Number(value?.skippedExisting) || 0),
      ignored: Math.max(0, Number(value?.ignored) || 0),
      queued: Math.max(0, Number(value?.queued) || queue.length),
      hydrated: Math.max(0, Number(value?.hydrated) || 0),
      failed: Math.max(0, Number(value?.failed) || failedIds.length),
      currentId: cleanText(value?.currentId),
      queue,
      failedIds,
      addedEntries: Array.isArray(value?.addedEntries) ? value.addedEntries.slice(0, 20) : []
    };
  }

  function isExtensionContextInvalidated(error) {
    return String(error || "").includes("Extension context invalidated");
  }

  function isStorageQuotaError(error) {
    const message = String(error?.message || error || "");
    const upper = message.toUpperCase();
    return upper.includes("QUOTA") || upper.includes("MAX_ITEMS") || upper.includes("MAX_WRITE_OPERATIONS");
  }

  function createRefreshPageError() {
    return new Error("Extension updated — refresh the page.");
  }

  const STORE_MUTATION_MESSAGE_TYPE = "lodvault:store-mutate";
  const STORE_MUTATIONS_RUN_DIRECTLY = Boolean(globalThis.__LOD_VAULT_DIRECT_STORE__);

  function canProxyStoreMutations() {
    return !STORE_MUTATIONS_RUN_DIRECTLY
      && typeof chrome !== "undefined"
      && Boolean(chrome?.runtime)
      && typeof chrome.runtime.sendMessage === "function";
  }

  function isMissingMutationReceiver(error) {
    const message = String(error || "");
    return message.includes("Could not establish connection")
      || message.includes("Receiving end does not exist")
      || message.includes("message port closed");
  }

  function runVaultIo(task) {
    const result = vaultIoQueue.then(task, task);
    vaultIoQueue = result.catch(() => {});
    return result;
  }

  async function runStoreMutation(method, args, directHandler) {
    if (!canProxyStoreMutations()) {
      return directHandler(...args);
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: STORE_MUTATION_MESSAGE_TYPE,
        method,
        args
      });

      if (!response?.ok) {
        const error = response?.error ? new Error(response.error) : new Error(`Store mutation failed: ${method}`);
        if (isExtensionContextInvalidated(error)) {
          throw createRefreshPageError();
        }
        throw error;
      }

      return response.result;
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        throw createRefreshPageError();
      }
      if (isMissingMutationReceiver(error)) {
        return directHandler(...args);
      }
      throw error;
    }
  }

  function normalizeEntry(entry = {}) {
    const id = cleanText(entry.id) || getIdFromUrl(entry.url);
    return {
      id,
      word: cleanWordLabel(entry.word),
      url: cleanText(entry.url),
      pos: cleanText(entry.pos),
      inflection: cleanText(entry.inflection),
      example: cleanText(entry.example),
      note: cleanText(entry.note),
      translations: cleanTranslations(entry.translations),
      favorite: Boolean(entry.favorite),
      study: Boolean(entry.study),
      history: Boolean(entry.history),
      visitCount: normalizeVisitCount(entry.visitCount),
      lastVisitedAt: cleanText(entry.lastVisitedAt),
      createdAt: cleanText(entry.createdAt),
      updatedAt: cleanText(entry.updatedAt)
    };
  }

  function shouldKeepEntry(entry) {
    return Boolean(entry?.favorite || entry?.study || entry?.history);
  }

  function hasOwnKey(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
  }

  function hasExplicitListFields(value = {}) {
    return hasOwnKey(value, "favorite")
      || hasOwnKey(value, "study")
      || hasOwnKey(value, "history");
  }

  function hasLegacySavedMarker(value = {}) {
    return Boolean(value?.saved || value?.isSaved || value?.savedWord || value?.bookmarked);
  }

  function shouldRecoverLegacyMembership(rawEntry = {}, normalized = normalizeEntry(rawEntry)) {
    if (!normalized.id || !normalized.word) return false;
    if (shouldKeepEntry(normalized)) return false;

    const explicitListFields = hasExplicitListFields(rawEntry);
    const legacySavedMarker = hasLegacySavedMarker(rawEntry);

    return !explicitListFields || legacySavedMarker;
  }

  function recoverLegacyMembership(rawEntry = {}, normalized = normalizeEntry(rawEntry)) {
    if (!shouldRecoverLegacyMembership(rawEntry, normalized)) {
      return normalized;
    }

    const recovered = {
      ...normalized,
      study: true
    };

    const historySignal = normalizeVisitCount(rawEntry.visitCount || recovered.visitCount) > 0
      || Boolean(cleanText(rawEntry.lastVisitedAt || recovered.lastVisitedAt));

    recovered.history = historySignal;

    if (historySignal) {
      recovered.visitCount = normalizeVisitCount(rawEntry.visitCount || recovered.visitCount) || 1;
      recovered.lastVisitedAt = cleanText(rawEntry.lastVisitedAt || recovered.lastVisitedAt) || nowIso();
    } else {
      delete recovered.visitCount;
      delete recovered.lastVisitedAt;
    }

    recovered.createdAt = recovered.createdAt || nowIso();
    recovered.updatedAt = recovered.updatedAt || nowIso();

    return recovered;
  }

  function normalizeEntryMap(entryMap = {}) {
    const result = {};

    for (const [entryId, value] of Object.entries(entryMap || {})) {
      const rawEntry = { id: entryId, ...(value && typeof value === "object" ? value : {}) };
      const normalized = normalizeEntry(rawEntry);
      const recovered = recoverLegacyMembership(rawEntry, normalized);
      if (!recovered.id || !recovered.word || !shouldKeepEntry(recovered)) continue;
      result[recovered.id] = recovered;
    }

    return result;
  }

  function mergeEntry(existing, incoming) {
    const current = normalizeEntry(existing);
    const next = normalizeEntry(incoming);
    const merged = {
      id: current.id || next.id,
      word: next.word || current.word,
      url: next.url || current.url,
      pos: next.pos || current.pos,
      inflection: next.inflection || current.inflection,
      example: next.example || current.example,
      note: next.note || current.note,
      translations: {
        ...current.translations,
        ...next.translations
      },
      favorite: Boolean(current.favorite),
      study: Boolean(current.study),
      history: Boolean(current.history),
      visitCount: normalizeVisitCount(current.visitCount || next.visitCount),
      lastVisitedAt: current.lastVisitedAt || next.lastVisitedAt,
      createdAt: current.createdAt || next.createdAt || nowIso(),
      updatedAt: nowIso()
    };

    if (!Object.keys(merged.translations).length) {
      delete merged.translations;
    }

    if (!merged.visitCount) {
      delete merged.visitCount;
    }

    if (!merged.lastVisitedAt) {
      delete merged.lastVisitedAt;
    }

    return merged;
  }

  function entriesMatchNormalized(current = {}, next = {}) {
    return current.id === next.id
      && current.word === next.word
      && current.url === next.url
      && current.pos === next.pos
      && current.inflection === next.inflection
      && current.example === next.example
      && current.note === next.note
      && current.favorite === next.favorite
      && current.study === next.study
      && current.history === next.history
      && current.visitCount === next.visitCount
      && current.lastVisitedAt === next.lastVisitedAt
      && current.createdAt === next.createdAt
      && JSON.stringify(current.translations || {}) === JSON.stringify(next.translations || {});
  }

  function entriesMatchForStorage(left, right) {
    const current = normalizeEntry(left);
    const next = normalizeEntry(right);
    return entriesMatchNormalized(current, next);
  }

  function applyTranslationLanguageFilter(entry = {}, languages = DEFAULT_SETTINGS.syncLanguages) {
    const normalized = normalizeEntry(entry);
    normalized.translations = filterTranslationsByLanguages(normalized.translations, languages);

    if (!Object.keys(normalized.translations).length) {
      delete normalized.translations;
    }

    return normalized;
  }

  function sanitizeEntryMapWithMeta(entryMap = {}, languages = null) {
    const source = entryMap && typeof entryMap === "object" ? entryMap : {};
    const result = {};
    let changed = false;
    let needsLegacyRecovery = false;

    for (const [entryId, value] of Object.entries(source)) {
      const rawEntry = { id: entryId, ...(value && typeof value === "object" ? value : {}) };
      const normalized = normalizeEntry(rawEntry);
      const recoveredFromLegacy = shouldRecoverLegacyMembership(rawEntry, normalized);
      const recovered = recoveredFromLegacy
        ? recoverLegacyMembership(rawEntry, normalized)
        : normalized;
      const filtered = Array.isArray(languages)
        ? applyTranslationLanguageFilter(recovered, languages)
        : recovered;

      if (recoveredFromLegacy) {
        needsLegacyRecovery = true;
      }

      if (!filtered.id || !filtered.word || !shouldKeepEntry(filtered)) {
        changed = true;
        continue;
      }

      result[filtered.id] = filtered;

      if (filtered.id !== entryId || !entriesMatchNormalized(recovered, filtered)) {
        changed = true;
      }
    }

    if (!changed) {
      const sourceKeys = Object.keys(source);
      const resultKeys = Object.keys(result);
      if (sourceKeys.length !== resultKeys.length) {
        changed = true;
      }
    }

    return {
      entryMap: result,
      changed,
      needsLegacyRecovery
    };
  }

  function filterEntryMapTranslationsWithMeta(entryMap = {}, languages = DEFAULT_SETTINGS.syncLanguages) {
    return sanitizeEntryMapWithMeta(entryMap, languages);
  }

  function filterEntryMapTranslations(entryMap = {}, languages = DEFAULT_SETTINGS.syncLanguages) {
    return filterEntryMapTranslationsWithMeta(entryMap, languages).entryMap;
  }

  function stableEntryMapString(entryMap = {}) {
    const normalized = normalizeEntryMap(entryMap);
    const sorted = Object.keys(normalized)
      .sort((left, right) => left.localeCompare(right))
      .reduce((result, id) => {
        result[id] = normalized[id];
        return result;
      }, {});

    return JSON.stringify(sorted);
  }

  function stableDeletedMapString(deletedMap = {}) {
    const normalized = normalizeDeletedMap(deletedMap);
    const sorted = Object.keys(normalized)
      .sort((left, right) => left.localeCompare(right))
      .reduce((result, id) => {
        result[id] = normalized[id];
        return result;
      }, {});

    return JSON.stringify(sorted);
  }

  function countStoredEntries(entryMap) {
    return Object.keys(normalizeEntryMap(entryMap)).length;
  }

  async function getEntryMap() {
    ensureStoreCacheListener();

    if (cachedEntryMap) {
      return cachedEntryMap;
    }

    try {
      const data = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY, SETTINGS_KEY, DELETED_KEY]);
      const current = data[STORAGE_KEY] && typeof data[STORAGE_KEY] === "object" ? data[STORAGE_KEY] : {};
      const legacy = data[LEGACY_STORAGE_KEY] && typeof data[LEGACY_STORAGE_KEY] === "object" ? data[LEGACY_STORAGE_KEY] : null;
      const settings = normalizeSettings(data[SETTINGS_KEY] || {});
      const deletedMap = normalizeDeletedMap(data[DELETED_KEY] || {});

      const combined = legacy
        ? {
            ...legacy,
            ...current
          }
        : current;
      const {
        entryMap: filtered,
        changed,
        needsLegacyRecovery
      } = sanitizeEntryMapWithMeta(combined);
      const filteredWithDeletes = applyDeletedMap(filtered, deletedMap);
      const deletedChanged = stableEntryMapString(filtered) !== stableEntryMapString(filteredWithDeletes);

      if (legacy || needsLegacyRecovery || changed || deletedChanged) {
        await saveEntryMap(filteredWithDeletes, { reason: legacy ? "migration-legacy" : (deletedChanged ? "apply-deletions" : "migration-normalize") });
        if (legacy) {
          await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
        }
      }

      cachedSettings = settings;
      cachedEntryMap = filteredWithDeletes;
      return cachedEntryMap;
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        invalidateStoreCache();
        return {};
      }
      throw error;
    }
  }

  async function saveEntryMap(entryMap) {
    ensureStoreCacheListener();

    try {
      const nextEntryMap = normalizeEntryMap(entryMap);
      await chrome.storage.local.set({ [STORAGE_KEY]: nextEntryMap });
      cachedEntryMap = nextEntryMap;
    } catch (error) {
      invalidateStoreCache({ entryMap: true, settings: false });
      if (isExtensionContextInvalidated(error)) {
        throw createRefreshPageError();
      }
      throw error;
    }
  }

  async function getSettings() {
    ensureStoreCacheListener();

    if (cachedSettings) {
      return cloneSettings(cachedSettings);
    }

    try {
      const data = await chrome.storage.local.get([SETTINGS_KEY]);
      cachedSettings = normalizeSettings(data[SETTINGS_KEY] || {});
      return cloneSettings(cachedSettings);
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        invalidateStoreCache({ entryMap: false, settings: true });
        return cloneSettings(DEFAULT_SETTINGS);
      }
      throw error;
    }
  }

  async function getPortableBackupMeta() {
    try {
      const data = await chrome.storage.local.get([PORTABLE_BACKUP_KEY]);
      return normalizePortableBackupMeta(data[PORTABLE_BACKUP_KEY] || {});
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        return normalizePortableBackupMeta({});
      }
      throw error;
    }
  }

  async function getDeletedMap() {
    try {
      const data = await chrome.storage.local.get([DELETED_KEY]);
      return normalizeDeletedMap(data[DELETED_KEY] || {});
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        return {};
      }
      throw error;
    }
  }

  async function saveDeletedMap(deletedMap) {
    const normalized = normalizeDeletedMap(deletedMap);

    try {
      if (Object.keys(normalized).length) {
        await chrome.storage.local.set({ [DELETED_KEY]: normalized });
      } else {
        await chrome.storage.local.remove(DELETED_KEY);
      }
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        throw createRefreshPageError();
      }
      throw error;
    }
  }

  async function getHistoryImportState() {
    try {
      const data = await chrome.storage.local.get([HISTORY_IMPORT_STATE_KEY]);
      return normalizeHistoryImportState(data[HISTORY_IMPORT_STATE_KEY] || {});
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        return normalizeHistoryImportState({});
      }
      throw error;
    }
  }

  async function saveHistoryImportState(state) {
    const normalized = normalizeHistoryImportState(state);

    try {
      if (normalized.status === "idle" && !normalized.startedAt && !normalized.imported && !normalized.scanned) {
        await chrome.storage.local.remove(HISTORY_IMPORT_STATE_KEY);
      } else {
        await chrome.storage.local.set({ [HISTORY_IMPORT_STATE_KEY]: normalized });
      }
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        throw createRefreshPageError();
      }
      throw error;
    }
  }

  async function persistVaultState({ entryMap = null, settings = null, deletedMap = null }) {
    const sourceEntryMap = entryMap ? normalizeEntryMap(entryMap) : await getEntryMap();
    const sourceDeletedMap = deletedMap ? normalizeDeletedMap(deletedMap) : await getDeletedMap();
    const nextEntryMap = normalizeEntryMap(sourceEntryMap);
    const nextDeletedMap = pruneDeletedMapAgainstEntries(nextEntryMap, sourceDeletedMap);
    const payload = {
      [STORAGE_KEY]: nextEntryMap
    };
    const removeKeys = [];

    if (settings) {
      const normalizedSettings = normalizeSettings(settings);
      payload[SETTINGS_KEY] = normalizedSettings;
      cachedSettings = normalizedSettings;
    }

    if (Object.keys(nextDeletedMap).length) {
      payload[DELETED_KEY] = nextDeletedMap;
    } else {
      removeKeys.push(DELETED_KEY);
    }

    await chrome.storage.local.set(payload);
    if (removeKeys.length) {
      await chrome.storage.local.remove(removeKeys);
    }

    cachedEntryMap = nextEntryMap;
    return {
      entryMap: nextEntryMap,
      deletedMap: nextDeletedMap,
      settings: settings ? normalizeSettings(settings) : null
    };
  }

  async function getAutoMode() {
    const settings = await getSettings();
    return Boolean(settings.autoMode);
  }

  async function getSyncLanguages() {
    const settings = await getSettings();
    return [...settings.syncLanguages];
  }

  async function setAutoModeDirect(enabled) {
    return runVaultIo(async () => {
      const nextSettings = normalizeSettings({
        ...(await getSettings()),
        autoMode: Boolean(enabled)
      });

      try {
        await persistVaultState({ settings: nextSettings });
      } catch (error) {
        invalidateStoreCache({ entryMap: false, settings: true });
        if (isExtensionContextInvalidated(error)) {
          throw createRefreshPageError();
        }
        throw error;
      }

      return nextSettings.autoMode;
    });
  }

  async function setAutoMode(enabled) {
    return runStoreMutation("setAutoMode", [enabled], setAutoModeDirect);
  }

  async function setSyncLanguagesDirect(languages) {
    return runVaultIo(async () => {
      const nextSettings = normalizeSettings({
        ...(await getSettings()),
        syncLanguages: languages
      });

      try {
        await persistVaultState({ settings: nextSettings });
      } catch (error) {
        invalidateStoreCache({ entryMap: false, settings: true });
        if (isExtensionContextInvalidated(error)) {
          throw createRefreshPageError();
        }
        throw error;
      }

      return [...nextSettings.syncLanguages];
    });
  }

  async function setSyncLanguages(languages) {
    return runStoreMutation("setSyncLanguages", [languages], setSyncLanguagesDirect);
  }

  async function getEntries() {
    const entryMap = await getEntryMap();
    return Object.values(entryMap)
      .map(normalizeEntry)
      .filter((entry) => entry.id && entry.word && shouldKeepEntry(entry))
      .sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.lastVisitedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.lastVisitedAt || b.createdAt || 0).getTime();
        return bTime - aTime;
      });
  }

  async function getEntry(id) {
    if (!id) return null;
    const entryMap = await getEntryMap();
    const entry = entryMap[id] ? normalizeEntry(entryMap[id]) : null;
    return entry && shouldKeepEntry(entry) ? entry : null;
  }

  async function toggleListDirect(entry, listName) {
    return runVaultIo(async () => {
      if (!["favorite", "study"].includes(listName)) {
        throw new Error(`Unsupported list: ${listName}`);
      }

      const normalized = normalizeEntry(entry);
      if (!normalized.id || !normalized.word) {
        throw new Error("Cannot save an empty entry.");
      }

      const [entryMap, deletedMap] = await Promise.all([
        getEntryMap(),
        getDeletedMap()
      ]);
      const existing = entryMap[normalized.id];
      const merged = mergeEntry(existing, normalized);

      merged.favorite = Boolean(existing?.favorite);
      merged.study = Boolean(existing?.study);
      merged.history = Boolean(existing?.history);
      merged.visitCount = normalizeVisitCount(existing?.visitCount);
      merged.lastVisitedAt = cleanText(existing?.lastVisitedAt);
      merged[listName] = !merged[listName];

      if (!shouldKeepEntry(merged)) {
        delete entryMap[normalized.id];
        deletedMap[normalized.id] = nowIso();
        await persistVaultState({
          entryMap,
          deletedMap
        });
        return null;
      }

      entryMap[normalized.id] = merged;
      delete deletedMap[normalized.id];
      await persistVaultState({ entryMap, deletedMap });
      return normalizeEntry(merged);
    });
  }

  async function toggleList(entry, listName) {
    return runStoreMutation("toggleList", [entry, listName], toggleListDirect);
  }

  async function recordAutoVisitDirect(entry) {
    return runVaultIo(async () => {
      const normalized = normalizeEntry(entry);
      if (!normalized.id || !normalized.word) {
        throw new Error("Cannot save an empty entry.");
      }

      const [entryMap, deletedMap] = await Promise.all([
        getEntryMap(),
        getDeletedMap()
      ]);
      const existing = entryMap[normalized.id];
      const merged = mergeEntry(existing, normalized);
      const visitedAt = nowIso();

      merged.favorite = Boolean(existing?.favorite);
      merged.study = true;
      merged.history = true;
      merged.visitCount = normalizeVisitCount(existing?.visitCount) + 1;
      merged.lastVisitedAt = visitedAt;
      merged.updatedAt = visitedAt;
      merged.createdAt = merged.createdAt || visitedAt;

      entryMap[normalized.id] = merged;
      delete deletedMap[normalized.id];
      await persistVaultState({ entryMap, deletedMap });
      return normalizeEntry(merged);
    });
  }

  async function recordAutoVisit(entry) {
    return runStoreMutation("recordAutoVisit", [entry], recordAutoVisitDirect);
  }

  async function removeFromHistoryDirect(id) {
    return runVaultIo(async () => {
      if (!id) return null;

      const [entryMap, deletedMap] = await Promise.all([
        getEntryMap(),
        getDeletedMap()
      ]);
      const existing = entryMap[id];
      if (!existing) return null;

      const merged = mergeEntry(existing, existing);
      merged.favorite = Boolean(existing.favorite);
      merged.study = Boolean(existing.study);
      merged.history = false;
      delete merged.visitCount;
      delete merged.lastVisitedAt;

      if (!shouldKeepEntry(merged)) {
        delete entryMap[id];
        deletedMap[id] = nowIso();
        await persistVaultState({
          entryMap,
          deletedMap
        });
        return null;
      }

      entryMap[id] = merged;
      await persistVaultState({ entryMap, deletedMap });
      return normalizeEntry(merged);
    });
  }

  async function removeFromHistory(id) {
    return runStoreMutation("removeFromHistory", [id], removeFromHistoryDirect);
  }

  async function refreshEntryDataDirect(entry) {
    return runVaultIo(async () => {
      const normalized = normalizeEntry(entry);
      if (!normalized.id || !normalized.word) return null;

      const [entryMap, deletedMap] = await Promise.all([
        getEntryMap(),
        getDeletedMap()
      ]);
      const existing = entryMap[normalized.id];
      if (!existing) return null;

      const merged = mergeEntry(existing, normalized);
      merged.favorite = Boolean(existing.favorite);
      merged.study = Boolean(existing.study);
      merged.history = Boolean(existing.history);
      merged.visitCount = normalizeVisitCount(existing.visitCount);
      merged.lastVisitedAt = cleanText(existing.lastVisitedAt);
      merged.createdAt = cleanText(existing.createdAt) || merged.createdAt;

      if (!shouldKeepEntry(merged)) {
        return null;
      }

      if (entriesMatchForStorage(existing, merged)) {
        return normalizeEntry(existing);
      }

      entryMap[normalized.id] = merged;
      delete deletedMap[normalized.id];
      await persistVaultState({ entryMap, deletedMap });
      return normalizeEntry(merged);
    });
  }

  async function refreshEntryData(entry) {
    return runStoreMutation("refreshEntryData", [entry], refreshEntryDataDirect);
  }

  async function saveNoteDirect(id, note) {
    return runVaultIo(async () => {
      if (!id) throw new Error("Missing entry id.");

      const [entryMap, deletedMap] = await Promise.all([
        getEntryMap(),
        getDeletedMap()
      ]);
      const existing = entryMap[id];
      if (!existing) throw new Error("Entry not found.");

      const merged = mergeEntry(existing, existing);

      merged.note = cleanText(note);
      merged.favorite = Boolean(existing.favorite);
      merged.study = Boolean(existing.study);
      merged.history = Boolean(existing.history);
      merged.visitCount = normalizeVisitCount(existing.visitCount);
      merged.lastVisitedAt = cleanText(existing.lastVisitedAt);
      entryMap[id] = merged;
      await persistVaultState({ entryMap, deletedMap });
      return normalizeEntry(merged);
    });
  }

  async function saveNote(id, note) {
    return runStoreMutation("saveNote", [id, note], saveNoteDirect);
  }

  async function removeEntryDirect(id) {
    return runVaultIo(async () => {
      if (!id) return;
      const [entryMap, deletedMap] = await Promise.all([
        getEntryMap(),
        getDeletedMap()
      ]);
      if (!entryMap[id]) return;
      delete entryMap[id];
      deletedMap[id] = nowIso();
      await persistVaultState({
        entryMap,
        deletedMap
      });
    });
  }

  async function removeEntry(id) {
    return runStoreMutation("removeEntry", [id], removeEntryDirect);
  }

  async function markPortableBackupExportedDirect(summary = {}) {
    const nextMeta = normalizePortableBackupMeta({
      lastExportedAt: nowIso(),
      entryCount: summary?.entryCount
    });

    try {
      await chrome.storage.local.set({ [PORTABLE_BACKUP_KEY]: nextMeta });
      return nextMeta;
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        throw createRefreshPageError();
      }
      throw error;
    }
  }

  async function markPortableBackupExported(summary) {
    return runStoreMutation("markPortableBackupExported", [summary], markPortableBackupExportedDirect);
  }

  function buildJsonExport(entries, options = {}) {
    const settings = normalizeSettings(options.settings || DEFAULT_SETTINGS);
    return JSON.stringify(
      {
        app: "lodvault",
        version: EXPORT_VERSION,
        exportedAt: nowIso(),
        settings,
        entries: entries.map(normalizeEntry)
      },
      null,
      2
    );
  }

  function validateImportPayload(parsed) {
    if (Array.isArray(parsed)) return;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid JSON import format.");
    }
    if (parsed.app && parsed.app !== "lodvault") {
      throw new Error("This JSON file is not a LODVault export.");
    }
    if (parsed.version && ![1, EXPORT_VERSION].includes(Number(parsed.version))) {
      throw new Error("Unsupported LODVault export version.");
    }
  }

  function getImportedSettings(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const rawSettings = parsed.settings;
    if (!rawSettings || typeof rawSettings !== "object" || Array.isArray(rawSettings)) {
      return null;
    }

    const nextSettings = {};
    if ("autoMode" in rawSettings) {
      nextSettings.autoMode = Boolean(rawSettings.autoMode);
    }
    if ("syncLanguages" in rawSettings) {
      nextSettings.syncLanguages = normalizeSyncLanguages(rawSettings.syncLanguages);
    }

    return Object.keys(nextSettings).length ? nextSettings : null;
  }

  async function importJsonDirect(text) {
    return runVaultIo(async () => {
      const parsed = JSON.parse(text);
      validateImportPayload(parsed);

      const incomingEntries = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entries) ? parsed.entries : [];
      const importedSettings = getImportedSettings(parsed);
      const currentSettings = await getSettings();
      const effectiveSettings = normalizeSettings({
        ...currentSettings,
        ...(importedSettings || {})
      });
      const entryMap = await getEntryMap();
      const deletedMap = await getDeletedMap();
      let imported = 0;

      for (const rawEntry of incomingEntries) {
        const incoming = normalizeEntry(rawEntry);
        if (!incoming.id || !incoming.word) continue;
        if (!shouldKeepEntry(incoming)) continue;

        const existing = entryMap[incoming.id];
        const merged = mergeEntry(existing, incoming);
        merged.favorite = Boolean(existing?.favorite) || Boolean(incoming.favorite);
        merged.study = Boolean(existing?.study) || Boolean(incoming.study);
        merged.history = Boolean(existing?.history) || Boolean(incoming.history);
        merged.visitCount = merged.history
          ? Math.max(normalizeVisitCount(existing?.visitCount), normalizeVisitCount(incoming.visitCount), 1)
          : 0;
        merged.lastVisitedAt = incoming.lastVisitedAt || cleanText(existing?.lastVisitedAt);
        merged.note = incoming.note || merged.note;

        if (!merged.visitCount) {
          delete merged.visitCount;
        }
        if (!merged.lastVisitedAt) {
          delete merged.lastVisitedAt;
        }

        entryMap[incoming.id] = merged;
        delete deletedMap[incoming.id];
        imported += 1;
      }

      try {
        await persistVaultState({
          entryMap,
          settings: importedSettings ? effectiveSettings : null,
          deletedMap
        });
      } catch (error) {
        invalidateStoreCache({ entryMap: false, settings: true });
        if (isExtensionContextInvalidated(error)) {
          throw createRefreshPageError();
        }
        throw error;
      }

      return { imported, total: countStoredEntries(entryMap) };
    });
  }

  async function importJson(text) {
    return runStoreMutation("importJson", [text], importJsonDirect);
  }

  function normalizeHistoryImportOptions(options = {}) {
    const rawStartTime = Number(options?.startTime);
    const startTime = Number.isFinite(rawStartTime) && rawStartTime >= 0
      ? Math.floor(rawStartTime)
      : 0;
    const rawMaxResults = Number(options?.maxResults);
    const maxResults = Number.isFinite(rawMaxResults) && rawMaxResults > 0
      ? Math.min(Math.floor(rawMaxResults), BROWSER_HISTORY_IMPORT_MAX_RESULTS)
      : BROWSER_HISTORY_IMPORT_MAX_RESULTS;
    const text = cleanText(options?.text) || BROWSER_HISTORY_IMPORT_QUERY;

    return {
      startTime,
      maxResults,
      text
    };
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  async function fetchArticleHtml(url) {
    const requestUrl = cleanText(url);
    if (!requestUrl) return "";

    const controller = typeof AbortController !== "undefined"
      ? new AbortController()
      : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), HISTORY_HYDRATION_FETCH_TIMEOUT_MS)
      : null;

    try {
      const response = await fetch(requestUrl, {
        method: "GET",
        credentials: "omit",
        redirect: "follow",
        signal: controller?.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml"
        }
      });

      if (!response?.ok) {
        throw new Error(`HTTP ${response?.status || 0}`);
      }

      return await response.text();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function extractEntryFromHtml(html, url) {
    const reader = globalThis.LodVaultArticleReader;
    if (typeof reader?.extractEntryFromHtml === "function") {
      return reader.extractEntryFromHtml(html, url);
    }
    return null;
  }

  function shouldHydrateHistoryEntry(entry) {
    const normalized = normalizeEntry(entry);
    if (!normalized.id || !normalized.word || !shouldKeepEntry(normalized)) return false;
    if (!isLodArticleUrl(normalized.url)) return false;

    return !normalized.pos
      || !normalized.inflection
      || !normalized.example
      || Object.keys(normalized.translations || {}).length === 0;
  }

  function mergeHydratedHistoryEntry(existing, hydrated) {
    const merged = mergeEntry(existing, hydrated);
    merged.favorite = Boolean(existing?.favorite);
    merged.study = Boolean(existing?.study);
    merged.history = Boolean(existing?.history);
    merged.note = cleanText(existing?.note) || cleanText(merged.note);
    merged.visitCount = normalizeVisitCount(existing?.visitCount || merged.visitCount);
    merged.lastVisitedAt = cleanText(existing?.lastVisitedAt || merged.lastVisitedAt);
    merged.createdAt = cleanText(existing?.createdAt) || merged.createdAt;
    merged.updatedAt = nowIso();

    if (!merged.visitCount) {
      delete merged.visitCount;
    }

    if (!merged.lastVisitedAt) {
      delete merged.lastVisitedAt;
    }

    return normalizeEntry(merged);
  }

  async function hydrateHistoryEntry(entry, settings) {
    const normalized = normalizeEntry(entry);
    if (!shouldHydrateHistoryEntry(normalized)) return null;

    const html = await fetchArticleHtml(normalized.url);
    const extracted = extractEntryFromHtml(html, normalized.url);
    if (!extracted?.id || extracted.id !== normalized.id) {
      throw new Error("Hydrated article did not match the expected entry.");
    }

    return normalizeEntry({
      ...normalized,
      ...extracted,
      favorite: normalized.favorite,
      study: normalized.study,
      history: normalized.history,
      note: normalized.note,
      visitCount: normalized.visitCount,
      lastVisitedAt: normalized.lastVisitedAt,
      createdAt: normalized.createdAt,
      updatedAt: nowIso()
    });
  }

  async function resumeHistoryImportHydration() {
    if (historyHydrationRunning) return false;
    historyHydrationRunning = true;

    try {
      while (true) {
        const state = await getHistoryImportState();
        if (!state.queue.length) {
          if (state.status === "running" || state.status === "queued") {
            await saveHistoryImportState({
              ...state,
              status: "complete",
              currentId: "",
              updatedAt: nowIso(),
              queue: []
            });
          }
          return true;
        }

        const nextId = state.queue[0];
        await saveHistoryImportState({
          ...state,
          status: "running",
          currentId: nextId,
          updatedAt: nowIso()
        });

        let hydrated = false;
        try {
          const [settings, existingEntry, deletedMap] = await Promise.all([
            getSettings(),
            getEntry(nextId),
            getDeletedMap()
          ]);

          if (existingEntry && !deletedMap[nextId] && shouldHydrateHistoryEntry(existingEntry)) {
            const hydratedEntry = await hydrateHistoryEntry(existingEntry, settings);
            hydrated = await runVaultIo(async () => {
              const [entryMap, latestDeletedMap] = await Promise.all([
                getEntryMap(),
                getDeletedMap()
              ]);
              const latestEntry = entryMap[nextId];
              if (!latestEntry || latestDeletedMap[nextId] || !shouldHydrateHistoryEntry(latestEntry)) {
                return false;
              }

              entryMap[nextId] = mergeHydratedHistoryEntry(latestEntry, hydratedEntry);
              await persistVaultState({ entryMap, deletedMap: latestDeletedMap });
              return true;
            });
          }
        } catch {
          hydrated = false;
        }

        const latestState = await getHistoryImportState();
        let removed = false;
        const nextQueue = latestState.queue.filter((id) => {
          if (!removed && id === nextId) {
            removed = true;
            return false;
          }
          return true;
        });
        const nextFailedIds = hydrated
          ? latestState.failedIds.filter((id) => id !== nextId)
          : [...latestState.failedIds.filter((id) => id !== nextId), nextId].slice(-20);

        await saveHistoryImportState({
          ...latestState,
          status: nextQueue.length ? "running" : "complete",
          currentId: nextQueue.length ? "" : "",
          updatedAt: nowIso(),
          hydrated: latestState.hydrated + (hydrated ? 1 : 0),
          failed: nextFailedIds.length,
          failedIds: nextFailedIds,
          queue: nextQueue
        });

        if (nextQueue.length) {
          await delay(HISTORY_HYDRATION_DELAY_MS);
        }
      }
    } finally {
      historyHydrationRunning = false;
    }
  }

  function assertBrowserHistoryApiAvailable() {
    if (typeof chrome?.history?.search !== "function") {
      throw new Error("Browser history access is unavailable.");
    }
  }

  function toVisitedIso(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return nowIso();
    }

    return new Date(timestamp).toISOString();
  }

  async function importBrowserHistoryDirect(options = {}) {
    assertBrowserHistoryApiAvailable();

    const searchOptions = normalizeHistoryImportOptions(options);
    const historyItems = await chrome.history.search(searchOptions);

    const result = await runVaultIo(async () => {
      const [entryMap, deletedMap, existingImportState] = await Promise.all([
        getEntryMap(),
        getDeletedMap(),
        getHistoryImportState()
      ]);
      let imported = 0;
      let skippedExisting = 0;
      let ignored = 0;
      const addedEntries = [];
      const hydrationCandidates = [];

      for (const item of Array.isArray(historyItems) ? historyItems : []) {
        const url = cleanText(item?.url);
        if (!isLodArticleUrl(url)) {
          ignored += 1;
          continue;
        }

        const id = getIdFromUrl(url);
        if (!id) {
          ignored += 1;
          continue;
        }

        if (entryMap[id]) {
          skippedExisting += 1;
          continue;
        }

        const lastVisitedAt = toVisitedIso(item?.lastVisitTime);
        const visitCount = Math.max(normalizeVisitCount(item?.visitCount), 1);
        const normalized = normalizeEntry({
          id,
          word: deriveWordFromHistoryItem(item, id),
          url,
          study: true,
          history: true,
          visitCount,
          lastVisitedAt,
          createdAt: lastVisitedAt,
          updatedAt: lastVisitedAt
        });

        if (!normalized.id || !normalized.word || !shouldKeepEntry(normalized)) {
          ignored += 1;
          continue;
        }

        const storedEntry = normalized;
        entryMap[id] = storedEntry;
        delete deletedMap[id];
        imported += 1;
        if (shouldHydrateHistoryEntry(storedEntry)) {
          hydrationCandidates.push(id);
        }
        if (addedEntries.length < 20) {
          addedEntries.push({
            id: normalized.id,
            word: normalized.word,
            url: normalized.url,
            lastVisitedAt: normalized.lastVisitedAt
          });
        }
      }

      if (imported > 0) {
        await persistVaultState({ entryMap, deletedMap });
      }

      const baseImportState = (existingImportState.queue.length || existingImportState.status === "running")
        ? existingImportState
        : normalizeHistoryImportState({});
      const nextQueue = [...baseImportState.queue];
      for (const id of hydrationCandidates) {
        if (nextQueue.includes(id)) continue;
        if (nextQueue.length >= HISTORY_HYDRATION_MAX_QUEUE) break;
        nextQueue.push(id);
      }

      const nextImportState = normalizeHistoryImportState({
        ...baseImportState,
        status: nextQueue.length ? (historyHydrationRunning ? "running" : "queued") : (imported > 0 ? "complete" : baseImportState.status),
        startedAt: baseImportState.startedAt || nowIso(),
        updatedAt: nowIso(),
        scanned: baseImportState.scanned + (Array.isArray(historyItems) ? historyItems.length : 0),
        imported: baseImportState.imported + imported,
        skippedExisting: baseImportState.skippedExisting + skippedExisting,
        ignored: baseImportState.ignored + ignored,
        queued: Math.max(baseImportState.queued, baseImportState.hydrated + baseImportState.failed + nextQueue.length),
        queue: nextQueue,
        addedEntries
      });
      await saveHistoryImportState(nextImportState);

      return {
        imported,
        scanned: Array.isArray(historyItems) ? historyItems.length : 0,
        skippedExisting,
        ignored,
        total: countStoredEntries(entryMap),
        addedEntries,
        hydrationQueued: nextQueue.length,
        hydrationStatus: nextImportState.status
      };
    });

    if (result.hydrationQueued > 0) {
      setTimeout(() => {
        resumeHistoryImportHydration().catch(() => {});
      }, 0);
    }

    return result;
  }

  async function importBrowserHistory(options) {
    return runStoreMutation("importBrowserHistory", [options], importBrowserHistoryDirect);
  }

  function mergeEntriesByCoverage(primaryEntry = {}, secondaryEntry = {}) {
    const primary = normalizeEntry(primaryEntry);
    const secondary = normalizeEntry(secondaryEntry);
    const newest = getEntryTimestampMs(secondary) > getEntryTimestampMs(primary)
      ? secondary
      : primary;

    const hasHistory = Boolean(primary.history || secondary.history);
    const latestVisitedAt = [primary.lastVisitedAt, secondary.lastVisitedAt]
      .map((value) => cleanText(value))
      .filter(Boolean)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || "";

    const createdCandidates = [primary.createdAt, secondary.createdAt]
      .map((value) => cleanText(value))
      .filter(Boolean)
      .sort((left, right) => Date.parse(left) - Date.parse(right));
    const updatedCandidates = [primary.updatedAt, secondary.updatedAt]
      .map((value) => cleanText(value))
      .filter(Boolean)
      .sort((left, right) => Date.parse(right) - Date.parse(left));

    const merged = {
      ...secondary,
      ...primary,
      id: primary.id || secondary.id,
      word: primary.word || secondary.word,
      url: primary.url || secondary.url,
      pos: newest.pos || primary.pos || secondary.pos,
      inflection: newest.inflection || primary.inflection || secondary.inflection,
      example: newest.example || primary.example || secondary.example,
      note: newest.note || primary.note || secondary.note,
      translations: {
        ...(secondary.translations || {}),
        ...(primary.translations || {}),
        ...(newest.translations || {})
      },
      favorite: Boolean(primary.favorite || secondary.favorite),
      study: Boolean(primary.study || secondary.study),
      history: hasHistory,
      visitCount: hasHistory
        ? Math.max(normalizeVisitCount(primary.visitCount), normalizeVisitCount(secondary.visitCount), 1)
        : 0,
      lastVisitedAt: latestVisitedAt,
      createdAt: createdCandidates[0] || nowIso(),
      updatedAt: updatedCandidates[0] || nowIso()
    };

    if (!Object.keys(merged.translations || {}).length) {
      delete merged.translations;
    }
    if (!merged.visitCount) {
      delete merged.visitCount;
    }
    if (!merged.lastVisitedAt) {
      delete merged.lastVisitedAt;
    }

    return normalizeEntry(merged);
  }

  function mergeVaultVersions(leftMap = {}, rightMap = {}) {
    const left = normalizeEntryMap(leftMap);
    const right = normalizeEntryMap(rightMap);
    const leftCount = Object.keys(left).length;
    const rightCount = Object.keys(right).length;
    const primary = leftCount >= rightCount ? left : right;
    const secondary = primary === left ? right : left;
    const merged = { ...primary };

    for (const [entryId, secondaryEntry] of Object.entries(secondary)) {
      if (!merged[entryId]) {
        merged[entryId] = secondaryEntry;
        continue;
      }

      merged[entryId] = mergeEntriesByCoverage(merged[entryId], secondaryEntry);
    }

    return normalizeEntryMap(merged);
  }

  async function applyRemoteVaultStateDirect(remoteState = {}) {
    return runVaultIo(async () => {
      const data = await chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY, DELETED_KEY]);
      const localEntries = normalizeEntryMap(data[STORAGE_KEY] || {});
      const rawLocalSettings = data[SETTINGS_KEY] && typeof data[SETTINGS_KEY] === "object" ? data[SETTINGS_KEY] : {};
      const localSettings = normalizeSettings(rawLocalSettings);
      const localDeletedMap = normalizeDeletedMap(data[DELETED_KEY] || {});
      const remoteEntries = normalizeEntryMap(remoteState?.entries || {});
      const remoteSettings = remoteState?.settings && typeof remoteState.settings === "object"
        ? remoteState.settings
        : {};
      const remoteDeletedMap = normalizeDeletedMap(remoteState?.deletedMap || {});

      const mergedSettings = normalizeSettings({
        ...localSettings,
        ...(!("autoMode" in rawLocalSettings) && "a" in remoteSettings ? { autoMode: Boolean(remoteSettings.a) } : {}),
        ...(!("syncLanguages" in rawLocalSettings) && Array.isArray(remoteSettings.l)
          ? { syncLanguages: normalizeSyncLanguages(remoteSettings.l) }
          : {})
      });
      const mergedDeletedMap = mergeDeletedMaps(localDeletedMap, remoteDeletedMap);
      const mergedEntries = applyDeletedMap(
        mergeVaultVersions(localEntries, remoteEntries),
        mergedDeletedMap
      );
      const nextDeletedMap = pruneDeletedMapAgainstEntries(mergedEntries, mergedDeletedMap);
      const entriesChanged = stableEntryMapString(localEntries) !== stableEntryMapString(mergedEntries);
      const settingsChanged = JSON.stringify(localSettings) !== JSON.stringify(mergedSettings);
      const deletedChanged = stableDeletedMapString(localDeletedMap) !== stableDeletedMapString(nextDeletedMap);
      const appliedDeletionCount = Object.keys(localEntries).filter((id) => !mergedEntries[id] && nextDeletedMap[id]).length;

      if (entriesChanged || settingsChanged || deletedChanged) {
        await persistVaultState({
          entryMap: mergedEntries,
          settings: mergedSettings,
          deletedMap: nextDeletedMap
        });
      }

      return {
        changed: entriesChanged || settingsChanged || deletedChanged,
        entriesChanged,
        settingsChanged,
        deletedChanged,
        appliedDeletionCount,
        entryCount: Object.keys(mergedEntries).length,
        deletedCount: Object.keys(nextDeletedMap).length,
        settings: mergedSettings,
        deletedMap: nextDeletedMap,
        entries: mergedEntries
      };
    });
  }

  async function applyRemoteVaultState(remoteState) {
    return applyRemoteVaultStateDirect(remoteState);
  }

  const FLASHCARD_META_KEY = "lodVault.flashcardMeta";

  function normalizeFlashcardMeta(meta = {}) {
    const reviews = Array.isArray(meta.reviews) ? meta.reviews.slice(-100) : [];
    const cleanReviews = reviews
      .filter((r) => r && typeof r === "object")
      .map((r) => ({
        date: cleanText(r.date) || nowIso(),
        rating: [1, 2, 3].includes(Number(r.rating)) ? Number(r.rating) : 2,
        direction: r.direction === "rev" ? "rev" : "fwd"
      }));

    return {
      reviews: cleanReviews,
      totalReviews: Math.max(0, Number(meta.totalReviews) || cleanReviews.length),
      hardCount: Math.max(0, Number(meta.hardCount) || 0),
      goodCount: Math.max(0, Number(meta.goodCount) || 0),
      easyCount: Math.max(0, Number(meta.easyCount) || 0),
      lastReviewedAt: cleanText(meta.lastReviewedAt),
      dueAt: cleanText(meta.dueAt),
      interval: Math.max(0, Number(meta.interval) || 0)
    };
  }

  async function getFlashcardMeta() {
    try {
      const data = await chrome.storage.local.get([FLASHCARD_META_KEY]);
      const raw = data[FLASHCARD_META_KEY] && typeof data[FLASHCARD_META_KEY] === "object"
        ? data[FLASHCARD_META_KEY]
        : {};
      const result = {};
      for (const [id, value] of Object.entries(raw)) {
        result[id] = normalizeFlashcardMeta(value);
      }
      return result;
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        return {};
      }
      throw error;
    }
  }

  async function saveFlashcardMeta(meta) {
    try {
      await chrome.storage.local.set({ [FLASHCARD_META_KEY]: meta });
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        throw createRefreshPageError();
      }
      throw error;
    }
  }

  function computeFlashcardDueAt(existing, rating) {
    const normalizedRating = [1, 2, 3].includes(Number(rating)) ? Number(rating) : 2;
    let interval = existing.interval || 0;

    if (normalizedRating === 1) {
      interval = 1;
    } else if (normalizedRating === 2) {
      interval = interval ? Math.ceil(interval * 2) : 1;
    } else {
      interval = interval ? Math.ceil(interval * 2.5) : 2;
    }

    const due = new Date();
    due.setDate(due.getDate() + interval);
    return { dueAt: due.toISOString(), interval };
  }

  function computeFlashcardStreak(sortedDescDates) {
    if (!sortedDescDates.length) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let streak = 0;
    let checkDate = new Date(today);

    for (const dateStr of sortedDescDates) {
      const d = new Date(dateStr);
      d.setHours(0, 0, 0, 0);
      if (d.getTime() === checkDate.getTime()) {
        streak += 1;
        checkDate.setDate(checkDate.getDate() - 1);
      } else if (d.getTime() === checkDate.getTime() + 86400000) {
        continue;
      } else {
        break;
      }
    }
    return streak;
  }

  async function recordFlashcardReviewDirect(entryId, rating, direction) {
    if (!entryId) throw new Error("Missing entry id.");
    const normalizedRating = [1, 2, 3].includes(Number(rating)) ? Number(rating) : 2;
    const normalizedDirection = direction === "rev" ? "rev" : "fwd";
    const meta = await getFlashcardMeta();
    const existing = meta[entryId] || {};

    const reviews = Array.isArray(existing.reviews) ? existing.reviews : [];
    reviews.push({
      date: nowIso(),
      rating: normalizedRating,
      direction: normalizedDirection
    });

    const trimmed = reviews.slice(-100);
    const hardCount = trimmed.filter((r) => r.rating === 1).length;
    const goodCount = trimmed.filter((r) => r.rating === 2).length;
    const easyCount = trimmed.filter((r) => r.rating === 3).length;
    const { dueAt, interval } = computeFlashcardDueAt(existing, normalizedRating);

    meta[entryId] = {
      reviews: trimmed,
      totalReviews: (existing.totalReviews || 0) + 1,
      hardCount,
      goodCount,
      easyCount,
      lastReviewedAt: nowIso(),
      dueAt,
      interval
    };

    await saveFlashcardMeta(meta);
    return meta[entryId];
  }

  async function recordFlashcardReview(entryId, rating, direction) {
    return runStoreMutation("recordFlashcardReview", [entryId, rating, direction], recordFlashcardReviewDirect);
  }

  async function getFlashcardStatsDirect() {
    const meta = await getFlashcardMeta();
    const todayIso = new Date().toISOString().slice(0, 10);
    let todayCount = 0;
    let learningCount = 0;
    let masteredCount = 0;
    const reviewDates = new Set();

    for (const [id, data] of Object.entries(meta)) {
      const m = normalizeFlashcardMeta(data);
      if (!m.totalReviews) continue;

      const dateSet = new Set(m.reviews.map((r) => r.date.slice(0, 10)));
      for (const d of dateSet) reviewDates.add(d);

      const last = m.reviews[m.reviews.length - 1];
      if (last && last.date.slice(0, 10) === todayIso) {
        todayCount += 1;
      }

      if (m.easyCount >= 3 && last && last.rating === 3) {
        masteredCount += 1;
      } else {
        learningCount += 1;
      }
    }

    const sortedDates = Array.from(reviewDates).sort().reverse();
    const streak = computeFlashcardStreak(sortedDates);

    return { streak, todayCount, newCount: 0, learningCount, masteredCount, reviewDates: sortedDates };
  }

  async function getFlashcardStats() {
    return runStoreMutation("getFlashcardStats", [], getFlashcardStatsDirect);
  }

  globalThis.LodVaultStoreCore = {
    STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    SETTINGS_KEY,
    PORTABLE_BACKUP_KEY,
    DELETED_KEY,
    HISTORY_IMPORT_STATE_KEY,
    FLASHCARD_META_KEY,
    DEFAULT_SETTINGS,
    EXPORT_VERSION,
    MAX_SYNC_LANGUAGES,
    TRANSLATION_LANGUAGE_ORDER,
    TRANSLATION_LANGUAGE_LABELS,
    TRANSLATION_LANGUAGE_CHIP_LABELS,
    SYNC_LANGUAGE_TO_KEY,
    SYNC_KEY_TO_LANGUAGE,
    STORE_MUTATION_MESSAGE_TYPE,
    getIdFromUrl,
    cleanText,
    normalizeVisitCount,
    normalizeSyncLanguages,
    normalizeSettings,
    normalizePortableBackupMeta,
    normalizeDeletedMap,
    isExtensionContextInvalidated,
    normalizeEntry,
    normalizeEntryMap,
    shouldKeepEntry,
    filterEntryMapTranslations,
    getEntryMap,
    getSettings,
    getPortableBackupMeta,
    getDeletedMap,
    getHistoryImportState,
    getAutoMode,
    getSyncLanguages,
    setAutoMode,
    setSyncLanguages,
    getEntries,
    getEntry,
    toggleList,
    recordAutoVisit,
    removeFromHistory,
    refreshEntryData,
    saveNote,
    removeEntry,
    markPortableBackupExported,
    buildJsonExport,
    importJson,
    importBrowserHistory,
    resumeHistoryImportHydration,
    applyRemoteVaultStateDirect,
    normalizeFlashcardMeta,
    getFlashcardMeta,
    saveFlashcardMeta,
    recordFlashcardReview,
    getFlashcardStats,
    computeFlashcardStreak
  };
})();


// ── note-autosave.js ──────────────────────────────────────────────
(() => {
  function normalizeNoteValue(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function createNoteAutosaveController(options = {}) {
    const timers = new Map();
    const getTimerKey = typeof options.getTimerKey === "function"
      ? options.getTimerKey
      : (textarea) => textarea?.dataset?.noteId || "default";
    const getActiveElement = typeof options.getActiveElement === "function"
      ? options.getActiveElement
      : () => typeof document !== "undefined" ? document.activeElement : null;
    const isBlocked = typeof options.isBlocked === "function"
      ? options.isBlocked
      : () => false;
    const saveNoteHandler = typeof options.saveNote === "function"
      ? options.saveNote
      : async (_noteId, value) => ({ note: normalizeNoteValue(value) });
    const setStatus = typeof options.setStatus === "function"
      ? options.setStatus
      : () => {};
    const onSaved = typeof options.onSaved === "function"
      ? options.onSaved
      : async () => {};
    const onError = typeof options.onError === "function"
      ? options.onError
      : async () => false;
    const shouldKeepScheduling = typeof options.shouldKeepScheduling === "function"
      ? options.shouldKeepScheduling
      : (textarea) => textarea?.isConnected ?? true;
    const getIdleMessage = typeof options.getIdleMessage === "function"
      ? options.getIdleMessage
      : ({ savedValue }) => savedValue ? "Saved with this word." : "Add a short note — it saves automatically.";
    const getSavingMessage = typeof options.getSavingMessage === "function"
      ? options.getSavingMessage
      : () => "Saving note…";
    const getSavedMessage = typeof options.getSavedMessage === "function"
      ? options.getSavedMessage
      : ({ savedEntry, changedSinceRequest }) => changedSinceRequest ? "Saving note…" : savedEntry?.note ? "Note saved." : "Note cleared.";
    const getErrorMessage = typeof options.getErrorMessage === "function"
      ? options.getErrorMessage
      : () => "Could not save note.";

    function getKey(textarea) {
      return String(getTimerKey(textarea) || "default");
    }

    function clear(textarea) {
      const timer = timers.get(getKey(textarea));
      if (!timer) return;
      clearTimeout(timer);
      timers.delete(getKey(textarea));
    }

    function clearAll() {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    }

    function schedule(textarea, delay = 500) {
      clear(textarea);
      const key = getKey(textarea);
      const timer = setTimeout(() => {
        timers.delete(key);
        commit(textarea);
      }, delay);
      timers.set(key, timer);
    }

    function markDirty(textarea, delay = 500) {
      if (!textarea || textarea.disabled || isBlocked(textarea)) return;
      textarea.dataset.dirty = "true";
      setStatus(textarea, getSavingMessage({ textarea }), "saving");
      schedule(textarea, delay);
    }

    async function commit(textarea) {
      if (!textarea || isBlocked(textarea)) return;

      clear(textarea);

      const noteId = textarea.dataset.noteId || "";
      if (!noteId || textarea.disabled) return;

      if (textarea.dataset.saving === "true") {
        textarea.dataset.resave = "true";
        return;
      }

      const requestValue = textarea.value;
      const requestNote = normalizeNoteValue(requestValue);
      const savedValue = textarea.dataset.savedValue || "";

      if (requestNote === savedValue) {
        if (getActiveElement() !== textarea) {
          textarea.value = savedValue;
        }
        textarea.dataset.dirty = "";
        setStatus(textarea, getIdleMessage({ textarea, savedValue }), "");
        return;
      }

      textarea.dataset.saving = "true";
      setStatus(textarea, getSavingMessage({ textarea }), "saving");

      try {
        const savedEntry = await saveNoteHandler(noteId, requestValue, textarea);
        const changedSinceRequest = normalizeNoteValue(textarea.value) !== requestNote;

        textarea.dataset.savedValue = savedEntry?.note || "";
        textarea.dataset.dirty = changedSinceRequest ? "true" : "";

        if (!changedSinceRequest && getActiveElement() !== textarea) {
          textarea.value = savedEntry?.note || "";
        }

        await onSaved({ textarea, savedEntry, noteId, requestValue, requestNote, changedSinceRequest });
        setStatus(
          textarea,
          getSavedMessage({ textarea, savedEntry, noteId, requestValue, requestNote, changedSinceRequest }),
          changedSinceRequest ? "saving" : "success"
        );
      } catch (error) {
        const handled = await onError({ error, textarea, noteId, requestValue, requestNote });
        if (!handled) {
          setStatus(textarea, getErrorMessage({ error, textarea, noteId, requestValue, requestNote }), "error");
        }
      } finally {
        textarea.dataset.saving = "";

        const needsResave = textarea.dataset.resave === "true"
          || (textarea.dataset.dirty === "true" && normalizeNoteValue(textarea.value) !== (textarea.dataset.savedValue || ""));

        textarea.dataset.resave = "";
        if (needsResave && shouldKeepScheduling(textarea)) {
          schedule(textarea, 0);
        }
      }
    }

    return {
      clear,
      clearAll,
      schedule,
      markDirty,
      commit,
      destroy: clearAll
    };
  }

  globalThis.LodVaultNotes = {
    normalizeNoteValue,
    createNoteAutosaveController
  };
})();


// ── entry-presenter.js ──────────────────────────────────────────────
(() => {
  const store = globalThis.LodVaultStoreCore || globalThis.LodVaultStore || {};
  const TRANSLATION_LANGUAGE_ORDER = store.TRANSLATION_LANGUAGE_ORDER || ["en", "fr", "de", "pt", "nl"];
  const TRANSLATION_LANGUAGE_LABELS = store.TRANSLATION_LANGUAGE_LABELS || {
    en: "English",
    fr: "Français",
    de: "Deutsch",
    pt: "Português",
    nl: "Nederlands"
  };
  const TRANSLATION_LANGUAGE_CHIP_LABELS = store.TRANSLATION_LANGUAGE_CHIP_LABELS || {
    en: "EN",
    fr: "FR",
    de: "DE",
    pt: "PT",
    nl: "NL"
  };
  const normalizeEntry = typeof store.normalizeEntry === "function"
    ? store.normalizeEntry
    : (entry) => entry || {};
  const normalizeVisitCount = typeof store.normalizeVisitCount === "function"
    ? store.normalizeVisitCount
    : (value) => Number(value) > 0 ? Math.floor(Number(value)) : 0;

  function getAudioUrl(entry) {
    const id = (entry && (entry.id || entry.lod_id) || "").toLowerCase();
    if (!id) return null;
    return `https://lod.lu/uploads/OGG/${id}.ogg`;
  }

  function createAudioController(doc) {
    doc = doc || globalThis.document;
    if (!doc) {
      return { play() {}, stopAll() {} };
    }
    const cache = new Map();

    function stopAll() {
      for (const [, audio] of cache) {
        audio.pause();
        audio.currentTime = 0;
      }
      doc.querySelectorAll(".audio-btn.is-playing").forEach((b) => b.classList.remove("is-playing"));
      cache.clear();
    }

    function play(url, buttonOrId) {
      let btn;
      if (typeof buttonOrId === "string") {
        btn = doc.querySelector(`[data-audio-id="${CSS.escape(buttonOrId)}"]`);
      } else if (buttonOrId instanceof Element) {
        btn = buttonOrId;
      }

      let audio = cache.get(url);
      if (audio && !audio.paused) {
        audio.pause();
        audio.currentTime = 0;
        cache.delete(url);
        if (btn) btn.classList.remove("is-playing");
        return;
      }

      stopAll();

      audio = new Audio(url);
      cache.set(url, audio);

      audio.addEventListener("play", () => { if (btn) btn.classList.add("is-playing"); });
      audio.addEventListener("ended", () => {
        if (btn) btn.classList.remove("is-playing");
        cache.delete(url);
      });
      audio.addEventListener("error", () => {
        if (btn) {
          btn.classList.remove("is-playing");
          btn.classList.add("is-error");
        }
        cache.delete(url);
      });

      audio.play().catch(() => {
        if (btn) btn.classList.remove("is-playing");
        cache.delete(url);
      });
    }

    return { play, stopAll };
  }

  const defaultAudioController = createAudioController();

  function playLodAudio(entry, options = {}) {
    const url = getAudioUrl(entry);
    if (!url) return;
    const ctrl = options.controller || defaultAudioController;
    ctrl.play(url, entry.id || entry.lod_id || "");
  }

  function buildAudioBtnMarkup(entry, options = {}) {
    const id = (entry && (entry.id || entry.lod_id) || "").trim();
    if (!id) return "";
    const cssClass = options.cssClass || "audio-btn";
    const label = options.label || "Play pronunciation";
    return `<button type="button" class="${escapeHtml(cssClass)}" data-audio-id="${escapeHtml(id)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></button>`;
  }

  function getAudioBtnCss(options = {}) {
    const selector = options.selector || ".audio-btn";
    return `
    ${selector} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      padding: 0;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.05);
      color: #5f8fa8;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.1s;
      flex-shrink: 0;
      line-height: 1;
    }
    ${selector}:hover {
      background: rgba(57, 167, 196, 0.15);
      border-color: rgba(57, 167, 196, 0.4);
      color: #a8dadc;
      transform: scale(1.08);
    }
    ${selector}:active {
      transform: scale(0.95);
    }
    ${selector} svg {
      width: 14px;
      height: 14px;
    }
    ${selector}.is-playing {
      background: rgba(57, 167, 196, 0.2);
      border-color: rgba(57, 167, 196, 0.5);
      color: #39a7c4;
      animation: audio-pulse 1s ease-in-out infinite;
    }
    ${selector}.is-error {
      background: rgba(230, 57, 70, 0.1);
      border-color: rgba(230, 57, 70, 0.3);
      color: #e63946;
    }
    @keyframes audio-pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.1); }
    }`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatWhen(value) {
    if (!value) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(value));
    } catch {
      return value;
    }
  }

  function buildSearchText(entry) {
    const normalized = normalizeEntry(entry);
    return [
      normalized.word,
      normalized.pos,
      normalized.inflection,
      normalized.example,
      normalized.note,
      ...Object.values(normalized.translations || {})
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function getMeaningItems(entry) {
    const normalized = normalizeEntry(entry);
    return TRANSLATION_LANGUAGE_ORDER
      .filter((lang) => normalized?.translations?.[lang])
      .map((lang) => ({
        lang,
        label: TRANSLATION_LANGUAGE_LABELS[lang] || lang.toUpperCase(),
        chipLabel: TRANSLATION_LANGUAGE_CHIP_LABELS[lang] || lang.toUpperCase(),
        value: normalized.translations[lang]
      }));
  }

  function buildMeaningText(entry) {
    return getMeaningItems(entry)
      .map((item) => `${item.label}: ${item.value}`)
      .join(" · ");
  }

  function buildMeaningChipsMarkup(entry, className = "meaning-chip") {
    return getMeaningItems(entry)
      .map((item) => `<span class="${escapeHtml(className)}">${escapeHtml(`${item.label}: ${item.value}`)}</span>`)
      .join("");
  }

  function buildMeaningRowsMarkup(entry, options = {}) {
    const rowClass = options.rowClass || "meaning-row";
    const labelClass = options.labelClass || "meaning-label";
    const valueClass = options.valueClass || "meaning-value";

    return getMeaningItems(entry)
      .map((item) => `
        <div class="${escapeHtml(rowClass)}">
          <span class="${escapeHtml(labelClass)}">${escapeHtml(item.label)}</span>
          <span class="${escapeHtml(valueClass)}">${escapeHtml(item.value)}</span>
        </div>
      `)
      .join("");
  }

  function buildMeaningCollapsibleMarkup(entry, options = {}) {
    const items = getMeaningItems(entry);
    if (!items.length) return "";

    const toggleClass = options.toggleClass || "meaning-toggle";
    const panelClass = options.panelClass || "meaning-expand";
    const rowClass = options.rowClass || "meaning-row";
    const labelClass = options.labelClass || "meaning-label";
    const valueClass = options.valueClass || "meaning-value";

    const count = items.length;
    const countLabel = `${count} translation${count === 1 ? "" : "s"}`;

    const primaryText = items[0] ? `${items[0].chipLabel}: ${items[0].value}` : "";

    const rows = items.map((item) =>
      `<div class="${escapeHtml(rowClass)}">`
      + `<span class="${escapeHtml(labelClass)}" data-lang="${escapeHtml(item.lang)}">${escapeHtml(item.chipLabel)}</span>`
      + `<span class="${escapeHtml(valueClass)}">${escapeHtml(item.value)}</span>`
      + `</div>`
    ).join("");

    return `<button type="button" class="${escapeHtml(toggleClass)}" aria-expanded="false">`
      + `<span class="meaning-toggle-arrow">&#x25B6;</span>`
      + `<span class="meaning-toggle-text">${escapeHtml(primaryText)}</span>`
      + `<span class="meaning-toggle-count">${escapeHtml(countLabel)}</span>`
      + `</button>`
      + `<div class="${escapeHtml(panelClass)}">${rows}</div>`;
  }

  function getPrimaryMeaning(entry, preferredLanguages = ["en", "fr", "de"]) {
    const normalized = normalizeEntry(entry);
    for (const lang of preferredLanguages) {
      if (normalized?.translations?.[lang]) {
        return {
          lang,
          label: TRANSLATION_LANGUAGE_LABELS[lang] || lang.toUpperCase(),
          value: normalized.translations[lang]
        };
      }
    }

    const [first] = getMeaningItems(normalized);
    return first || null;
  }

  function buildVisitMeta(entry) {
    const normalized = normalizeEntry(entry);
    if (!normalized.history) return "";

    const parts = [];
    const visitCount = normalizeVisitCount(normalized.visitCount) || 1;
    parts.push(`Visited ${visitCount} time${visitCount === 1 ? "" : "s"}`);
    if (normalized.lastVisitedAt) {
      parts.push(`Last visited ${formatWhen(normalized.lastVisitedAt)}`);
    }

    return parts.join(" · ");
  }

  function buildEntryMarkup(entry) {
    const normalized = normalizeEntry(entry);
    const chips = [];
    const activeLists = [];
    if (normalized.favorite) activeLists.push("favorite");
    if (normalized.study) activeLists.push("study");
    if (normalized.history) activeLists.push("history");

    if (normalized.pos) {
      chips.push(`<span class="chip chip-type">${escapeHtml(normalized.pos)}</span>`);
    }

    if (normalized.favorite) chips.push('<span class="chip chip-list-favorite">Favorite</span>');
    if (normalized.study) chips.push('<span class="chip chip-list-study">Study</span>');
    if (normalized.history) chips.push('<span class="chip chip-list-history">History</span>');

    const translationsMarkup = buildMeaningCollapsibleMarkup(normalized, {
      toggleClass: "meaning-toggle",
      panelClass: "meaning-expand",
      rowClass: "meaning-row",
      labelClass: "meaning-label",
      valueClass: "meaning-value"
    });

    const translationLanguages = getMeaningItems(normalized).map((item) => item.lang);

    const audioBtn = buildAudioBtnMarkup(normalized);

    return `
      <article class="entry" data-id="${escapeHtml(normalized.id)}" data-lists="${escapeHtml(activeLists.join(","))}" data-langs="${escapeHtml(translationLanguages.join(","))}" data-search="${escapeHtml(buildSearchText(normalized))}">
        <div class="entry-top">
          <h3>${audioBtn ? "<span class=\"entry-top-word\">" : ""}<a href="${escapeHtml(normalized.url)}" target="_blank" rel="noreferrer">${escapeHtml(normalized.word)}</a>${audioBtn ? "</span>" : ""}${audioBtn}</h3>
          <span class="timestamp">${escapeHtml(formatWhen(normalized.updatedAt || normalized.lastVisitedAt || normalized.createdAt))}</span>
        </div>
        ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}
        ${translationsMarkup}
        ${buildVisitMeta(normalized) ? `<p class="visit-meta">${escapeHtml(buildVisitMeta(normalized))}</p>` : ""}
        ${normalized.inflection ? `<p class="detail"><strong>Inflection:</strong> ${escapeHtml(normalized.inflection)}</p>` : ""}
        ${normalized.example ? `<blockquote>${escapeHtml(normalized.example)}</blockquote>` : ""}
        ${normalized.note ? `<p class="note"><strong>Note:</strong> ${escapeHtml(normalized.note)}</p>` : ""}
      </article>
    `;
  }

  function buildExportSearchScriptTag() {
    return `
  <script>
    const input = document.getElementById('search-input');
    const status = document.getElementById('search-status');
    const empty = document.getElementById('search-empty');
    const entries = Array.from(document.querySelectorAll('.entry'));
    function createAudioController(doc) {
      const cache = new Map();
      function stopAll() {
        for (const [, a] of cache) { a.pause(); a.currentTime = 0; }
        doc.querySelectorAll('.audio-btn.is-playing').forEach(b => b.classList.remove('is-playing'));
        cache.clear();
      }
      function play(url, btn) {
        let audio = cache.get(url);
        if (audio && !audio.paused) {
          audio.pause(); audio.currentTime = 0; cache.delete(url);
          btn.classList.remove('is-playing');
          return;
        }
        stopAll();
        audio = new Audio(url);
        cache.set(url, audio);
        audio.addEventListener('play', () => btn.classList.add('is-playing'));
        audio.addEventListener('ended', () => { btn.classList.remove('is-playing'); cache.delete(url); });
        audio.addEventListener('error', () => { btn.classList.remove('is-playing'); btn.classList.add('is-error'); cache.delete(url); });
        audio.play().catch(() => { btn.classList.remove('is-playing'); cache.delete(url); });
      }
      return { play, stopAll };
    }
    const audioController = createAudioController(document);

    function applySearch() {
      const query = (input.value || '').trim().toLowerCase();
      let visibleCount = 0;

      for (const entry of entries) {
        const match = !query || (entry.dataset.search || '').includes(query);
        entry.hidden = !match;
        if (match) visibleCount += 1;
      }

      status.textContent = query
        ? visibleCount + ' matching word' + (visibleCount === 1 ? '' : 's')
        : entries.length + ' saved word' + (entries.length === 1 ? '' : 's');
      empty.hidden = visibleCount !== 0 || !query;
    }

    function handleAudioClick(event) {
      const btn = event.target.closest('.audio-btn');
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      const id = btn.dataset.audioId;
      if (!id) return;
      const url = 'https://lod.lu/uploads/OGG/' + id.toLowerCase() + '.ogg';
      audioController.play(url, btn);
    }

    function handleToggleClick(event) {
      const toggle = event.target.closest('.meaning-toggle');
      if (!toggle) return;
      const isOpen = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      const panel = toggle.nextElementSibling;
      if (panel && panel.classList.contains('meaning-expand')) {
        panel.classList.toggle('is-open', !isOpen);
      }
    }

    input.addEventListener('input', applySearch);
    document.addEventListener('click', handleAudioClick);
    document.addEventListener('click', handleToggleClick);
    applySearch();
  <\/script>`;
  }

  function buildExportHtml(entries, options = {}) {
    const { includeInlineScript = true } = options;
    const exportedAt = formatWhen(new Date().toISOString());

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LODVault Export</title>
  <style>
    :root {
      color-scheme: dark;
      --bg:      #0d1c2e;
      --surface: #132333;
      --border:  #1e3348;
      --text:    #ddeef5;
      --muted:   #5f8fa8;
      --teal:    #39a7c4;
      --teal-lt: #a8dadc;
      --blue:    #457b9d;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg); color: var(--text);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.55; padding: 32px 20px 56px;
    }
    main { max-width: 760px; margin: 0 auto; }
    .page-header { margin-bottom: 24px; }
    h1 { font-size: 1.5rem; font-weight: 700; color: #fff; margin-bottom: 3px; }
    .meta { color: var(--muted); font-size: 13.5px; }
    .search-input {
      display: block; width: 100%; margin-top: 14px;
      padding: 10px 14px; background: var(--surface);
      border: 1px solid var(--border); border-radius: 7px;
      color: var(--text); font: inherit; font-size: 14px;
    }
    .search-input::placeholder { color: var(--muted); }
    .search-input:focus { outline: none; border-color: var(--teal); }
    .search-status { margin-top: 8px; color: var(--muted); font-size: 13px; }
    .section-label {
      font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--teal); margin: 24px 0 12px;
    }
    .entry {
      padding: 14px; background: var(--surface);
      border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px;
    }
    .entry[hidden] { display: none; }
    .entry-top {
      display: flex; justify-content: space-between;
      align-items: flex-start; gap: 12px; flex-wrap: wrap;
    }
    .entry-top h3 {
      font-size: 1rem; font-weight: 700; color: #fff;
      display: flex; align-items: center; gap: 8px;
    }
    .entry-top a { color: var(--teal-lt); text-decoration: none; }
    .entry-top a:hover { text-decoration: underline; }
    .entry-top .entry-top-word { display: inline-flex; align-items: center; gap: 8px; }
    .timestamp { color: var(--muted); font-size: 11.5px; white-space: nowrap; flex-shrink: 0; }
    .chips { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
    .chip {
      padding: 2px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 700;
      background: rgba(57,167,196,0.12); color: var(--teal-lt); border: 1px solid rgba(57,167,196,0.22);
    }
    .chip-type         { background: rgba(100,200,140,0.10); color: #7dd4a8;        border-color: rgba(100,200,140,0.20); }
    .chip-list-favorite{ background: rgba(253,215,120,0.10); color: #e6c560;        border-color: rgba(253,215,120,0.20); }
    .chip-list-study   { background: rgba(57,167,196,0.12);  color: var(--teal-lt); border-color: rgba(57,167,196,0.22); }
    .chip-list-history { background: rgba(121,134,203,0.10); color: #9ba8d8;        border-color: rgba(121,134,203,0.20); }
    .meaning-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      padding: 4px 10px;
      font-size: 11.5px;
      font-weight: 600;
      font-family: inherit;
      background: rgba(57,167,196,0.08);
      border: 1px solid rgba(57,167,196,0.18);
      border-radius: 999px;
      color: var(--teal-lt);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .meaning-toggle:hover { background: rgba(57,167,196,0.16); }
    .meaning-toggle-arrow {
      font-size: 9px;
      transition: transform 0.2s;
    }
    .meaning-toggle[aria-expanded="true"] .meaning-toggle-arrow { transform: rotate(90deg); }
    .meaning-toggle-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 200px;
    }
    .meaning-toggle-count {
      font-size: 10px;
      opacity: 0.7;
      margin-left: 2px;
    }
    .meaning-expand {
      display: none;
      margin-top: 6px;
      padding: 8px 12px;
      background: rgba(57,167,196,0.05);
      border: 1px solid rgba(57,167,196,0.12);
      border-radius: 6px;
    }
    .meaning-expand.is-open { display: block; }
    .meaning-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 3px 0;
    }
    .meaning-row + .meaning-row { border-top: 1px solid var(--border); padding-top: 5px; }
    .meaning-label {
      flex-shrink: 0;
      min-width: 26px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      text-align: left;
      line-height: 1.35;
      color: var(--teal-lt);
    }
    .meaning-label[data-lang="en"] { color: #7dd4a8; }
    .meaning-label[data-lang="fr"] { color: #f2a3aa; }
    .meaning-label[data-lang="de"] { color: #f0d56e; }
    .meaning-label[data-lang="pt"] { color: #c4a8f0; }
    .meaning-label[data-lang="nl"] { color: #f0a86e; }
    .meaning-value {
      font-size: 12.5px;
      color: var(--text);
      line-height: 1.35;
      min-width: 0;
    }
    .visit-meta, .detail { margin-top: 8px; color: var(--muted); font-size: 12.5px; }
    blockquote {
      margin-top: 10px; padding: 10px 14px;
      border-left: 3px solid var(--teal); background: rgba(57,167,196,0.07);
      border-radius: 6px; color: var(--teal-lt); font-size: 13.5px;
    }
    .note {
      margin-top: 10px; padding: 10px 14px;
      border-left: 3px solid #7986cb; background: rgba(121,134,203,0.07);
      border-radius: 6px; font-size: 13.5px;
    }
    .empty { color: var(--muted); font-size: 13.5px; padding: 16px 0; }
    .audio-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; padding: 0;
      border: 1px solid rgba(255,255,255,0.12); border-radius: 50%;
      background: rgba(255,255,255,0.05); color: var(--muted); cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.1s;
      flex-shrink: 0; line-height: 1;
    }
    .audio-btn:hover {
      background: rgba(57,167,196,0.15); border-color: rgba(57,167,196,0.4); color: var(--teal-lt); transform: scale(1.08);
    }
    .audio-btn:active { transform: scale(0.95); }
    .audio-btn svg { width: 14px; height: 14px; }
    .audio-btn.is-playing {
      background: rgba(57,167,196,0.2); border-color: rgba(57,167,196,0.5); color: var(--teal);
      animation: audio-pulse 1s ease-in-out infinite;
    }
    .audio-btn.is-error { background: rgba(230,57,70,0.1); border-color: rgba(230,57,70,0.3); color: #e63946; }
    @keyframes audio-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.1)} }
    #search-empty[hidden] { display: none; }
    @media (max-width: 640px) { body { padding: 20px 12px 40px; } }
  </style>
</head>
<body>
  <main>
    <div class="page-header">
      <h1>LODVault</h1>
      <p class="meta">Exported ${escapeHtml(exportedAt)} &middot; ${entries.length} saved word${entries.length === 1 ? "" : "s"}</p>
      <input id="search-input" class="search-input" type="search" placeholder="Search words, type, translation, note&hellip;" autocomplete="off">
      <p id="search-status" class="search-status">${entries.length} saved word${entries.length === 1 ? "" : "s"}</p>
    </div>

    <p id="search-empty" class="empty" hidden>No words match your search.</p>

    <p class="section-label">Saved words (${entries.length})</p>
    ${entries.length ? entries.map((entry) => buildEntryMarkup(entry)).join("") : '<p class="empty">No saved words yet.</p>'}
  </main>
  ${includeInlineScript ? buildExportSearchScriptTag() : ""}
</body>
</html>`;
  }

  function buildAnkiExport(entries) {
    const normalized = entries.map(normalizeEntry).filter((e) => e.word);
    const lines = [
      "#separator:Tab",
      "#html:true",
      "#deck:LODVault",
      "#columns:Word\tPOS\tTranslations\tInflection\tExample\tNote\tURL"
    ];

    for (const entry of normalized) {
      const items = getMeaningItems(entry);
      const translationsHtml = items.length
        ? items.map((i) => `<div><b>${escapeHtml(i.label)}</b>: ${escapeHtml(i.value)}</div>`).join("")
        : "";
      const inflection = entry.inflection ? escapeHtml(entry.inflection) : "";
      const example = entry.example ? escapeHtml(entry.example) : "";
      const note = entry.note ? escapeHtml(entry.note) : "";
      const url = entry.url ? escapeHtml(entry.url) : "";

      lines.push([
        escapeHtml(entry.word),
        escapeHtml(entry.pos),
        translationsHtml,
        inflection,
        example,
        note,
        url
      ].join("\t"));
    }

    return lines.join("\n");
  }

  function downloadTextFile(filename, content, mimeType = "text/plain") {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  globalThis.LodVaultEntryPresenter = {
    escapeHtml,
    formatWhen,
    buildSearchText,
    buildMeaningText,
    buildMeaningChipsMarkup,
    buildMeaningRowsMarkup,
    buildMeaningCollapsibleMarkup,
    getPrimaryMeaning,
    getAudioUrl,
    createAudioController,
    playLodAudio,
    buildAudioBtnMarkup,
    getAudioBtnCss,
    buildExportHtml,
    buildAnkiExport,
    downloadTextFile
  };
})();


// ── shared.js ──────────────────────────────────────────────
(() => {
  const core = globalThis.LodVaultStoreCore || {};
  const notes = globalThis.LodVaultNotes || {};
  const presenter = globalThis.LodVaultEntryPresenter || {};

  globalThis.LodVaultStore = {
    ...core,
    ...notes,
    ...presenter
  };
})();


// ── lod-article.js ──────────────────────────────────────────────
(() => {
  const store = globalThis.LodVaultStore || globalThis.LodVaultStoreCore || {};
  const getIdFromUrl = typeof store.getIdFromUrl === "function"
    ? store.getIdFromUrl
    : (value) => {
        const match = String(value || "").match(/\/artikel\/([^/?#]+)/i);
        return match ? decodeURIComponent(match[1]) : "";
      };
  const getPrimaryMeaning = globalThis.LodVaultEntryPresenter?.getPrimaryMeaning || ((entry) => {
    if (entry?.translations?.en) return { lang: "en", label: "English", value: entry.translations.en };
    if (entry?.translations?.fr) return { lang: "fr", label: "Français", value: entry.translations.fr };
    if (entry?.translations?.de) return { lang: "de", label: "Deutsch", value: entry.translations.de };
    if (entry?.translations?.pt) return { lang: "pt", label: "Português", value: entry.translations.pt };
    if (entry?.translations?.nl) return { lang: "nl", label: "Nederlands", value: entry.translations.nl };
    return null;
  });

  function cleanWord(value) {
    return (value || "")
      .replace(/^[\s"'„“”]+/, "")
      .replace(/[\s"'„“”]+$/, "")
      .trim();
  }

  function stitchTokens(tokens) {
    return tokens.reduce((result, token) => {
      const part = token.trim();
      if (!part) return result;
      if (!result) return part;

      if (/^[,.;:!?)]/.test(part) || result.endsWith("'") || result.endsWith("’") || part.startsWith("(")) {
        return `${result}${part}`;
      }

      return `${result} ${part}`;
    }, "");
  }

  function collectText(root) {
    if (!root) return "";
    const nodes = root.querySelectorAll(".content");
    if (!nodes.length) return root.textContent.trim();
    return stitchTokens(Array.from(nodes, (node) => node.textContent || ""));
  }

  function sanitizeHeading(value) {
    return cleanWord(
      (value || "")
        .replace(/\s+kopéiert\b.*$/i, "")
        .replace(/\s+Artikel deelen\b.*$/i, "")
    );
  }

  function sanitizePos(value) {
    const text = cleanWord(value);
    if (!text) return "";

    const lower = text.toLowerCase();
    const isGenericDictionaryDescription = text.length > 60
      || lower.includes("dictionnaire")
      || lower.includes("menej")
      || lower.includes("zenter fir d'lëtzebuerger sprooch")
      || lower.includes("zenter fir d’lëtzebuerger sprooch");

    return isGenericDictionaryDescription ? "" : text;
  }

  function getHeadingElement() {
    return document.querySelector("main h1") || document.querySelector("h1");
  }

  function wordFromUrl() {
    try {
      const params = new URLSearchParams(location.search);
      return cleanWord(params.get("lemma"));
    } catch {
      return "";
    }
  }

  function extractWord() {
    const lemma = wordFromUrl();
    if (lemma) return lemma;

    const ogTitle = cleanWord(document.querySelector('meta[property="og:title"], meta[name="og:title"]')?.content);
    if (ogTitle) {
      return cleanWord(ogTitle.replace(/[„”"]/g, "").replace(/\s*-\s*LOD$/i, ""));
    }

    const titleMatch = (document.title || "").match(/[„"]?(.+?)[”"]?\s*-\s*LOD/i);
    if (titleMatch?.[1]) {
      return cleanWord(titleMatch[1]);
    }

    const heading = sanitizeHeading(getHeadingElement()?.textContent);
    if (heading) return heading;

    return sanitizeHeading(collectText(getHeadingElement()));
  }

  function wordMatchesUrlId(word, id) {
    if (!word || !id) return false;
    const normalize = (value) => String(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\u00df/g, "ss");
    return normalize(id).startsWith(normalize(word));
  }

  function addTranslationValue(translations, lang, value) {
    const text = cleanWord(value);
    if (!lang || !text) return;

    const current = translations[lang] ? translations[lang].split(" · ") : [];
    if (!current.includes(text)) {
      current.push(text);
      translations[lang] = current.join(" · ");
    }
  }

  function normalizeLanguageKey(value) {
    const key = cleanWord(value).toLowerCase();
    const map = {
      de: "de",
      deutsch: "de",
      fr: "fr",
      français: "fr",
      francais: "fr",
      en: "en",
      english: "en",
      pt: "pt",
      português: "pt",
      portugues: "pt",
      nl: "nl",
      nederlands: "nl"
    };
    return map[key] || "";
  }

  function extractTranslationsFromStructuredBlocks() {
    const groups = Array.from(document.querySelectorAll(".microstructures .targetLanguages, .targetLanguages"));
    const translations = {};

    for (const group of groups) {
      for (const lang of ["de", "fr", "en", "pt", "nl"]) {
        for (const node of group.querySelectorAll(`.${lang}`)) {
          addTranslationValue(translations, lang, collectText(node));
        }
      }
    }

    return translations;
  }

  function extractTranslationsFromSplitSections() {
    const sections = Array.from(document.querySelectorAll(".entry-definition__section.entry-definition__section--split"));
    const translations = {};

    for (const section of sections) {
      const lines = (section.innerText || "")
        .split(/\n+/)
        .map((line) => cleanWord(line))
        .filter(Boolean);

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const directMatch = line.match(/^(de|fr|en|pt|nl)\s+(.+)$/i);
        if (directMatch) {
          addTranslationValue(translations, directMatch[1].toLowerCase(), directMatch[2]);
          continue;
        }

        const lang = normalizeLanguageKey(line);
        if (!lang) continue;

        const value = lines[index + 1];
        if (value) {
          addTranslationValue(translations, lang, value);
          index += 1;
        }
      }
    }

    return translations;
  }

  function extractTranslations() {
    const merged = { ...extractTranslationsFromStructuredBlocks() };
    for (const [lang, value] of Object.entries(extractTranslationsFromSplitSections())) {
      addTranslationValue(merged, lang, value);
    }
    return merged;
  }

  function extractCurrentEntry() {
    const id = getIdFromUrl(location.href);
    const word = extractWord();
    if (!id || !word) return null;

    const lemma = wordFromUrl();
    if (!lemma && !wordMatchesUrlId(word, id)) return null;

    return {
      id,
      word,
      url: location.href,
      pos: sanitizePos(document.querySelector('meta[name="description"]')?.content),
      inflection: collectText(document.querySelector(".microstructures .inflection .forms > div") || document.querySelector(".inflection .forms > div")),
      example: collectText(document.querySelector(".microstructures .examples > div") || document.querySelector(".examples > div") || document.querySelector(".examples")),
      translations: extractTranslations()
    };
  }

  function wordFromUrlValue(url) {
    try {
      const parsed = new URL(url || "", "https://lod.lu");
      return cleanWord(parsed.searchParams.get("lemma"));
    } catch {
      return "";
    }
  }

  function getHeadingElementFromDocument(doc) {
    return doc?.querySelector?.("main h1") || doc?.querySelector?.("h1") || null;
  }

  function extractTranslationsFromDocument(doc) {
    if (!doc?.querySelectorAll) return {};

    const groups = Array.from(doc.querySelectorAll(".microstructures .targetLanguages, .targetLanguages"));
    const merged = {};

    for (const group of groups) {
      for (const lang of ["de", "fr", "en", "pt", "nl"]) {
        for (const node of group.querySelectorAll(`.${lang}`)) {
          addTranslationValue(merged, lang, collectText(node));
        }
      }
    }

    const sections = Array.from(doc.querySelectorAll(".entry-definition__section.entry-definition__section--split"));
    for (const section of sections) {
      const lines = (section.innerText || "")
        .split(/\n+/)
        .map((line) => cleanWord(line))
        .filter(Boolean);

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const directMatch = line.match(/^(de|fr|en|pt|nl)\s+(.+)$/i);
        if (directMatch) {
          addTranslationValue(merged, directMatch[1].toLowerCase(), directMatch[2]);
          continue;
        }

        const lang = normalizeLanguageKey(line);
        if (!lang) continue;

        const value = lines[index + 1];
        if (value) {
          addTranslationValue(merged, lang, value);
          index += 1;
        }
      }
    }

    return merged;
  }

  function extractEntryFromDocument(doc, url) {
    if (!doc?.querySelector) return null;

    const pageUrl = String(url || "");
    const id = getIdFromUrl(pageUrl);
    const lemma = wordFromUrlValue(pageUrl);
    const ogTitle = cleanWord(doc.querySelector('meta[property="og:title"], meta[name="og:title"]')?.content);
    const titleMatch = (doc.title || "").match(/[„"]?(.+?)[”"]?\s*-\s*LOD/i);
    const heading = sanitizeHeading(getHeadingElementFromDocument(doc)?.textContent);
    const word = lemma
      || (ogTitle ? cleanWord(ogTitle.replace(/[„”"]/g, "").replace(/\s*-\s*LOD$/i, "")) : "")
      || (titleMatch?.[1] ? cleanWord(titleMatch[1]) : "")
      || heading
      || sanitizeHeading(collectText(getHeadingElementFromDocument(doc)));

    if (!id || !word) return null;
    if (!lemma && !wordMatchesUrlId(word, id)) return null;

    return {
      id,
      word,
      url: pageUrl,
      pos: sanitizePos(doc.querySelector('meta[name="description"]')?.content),
      inflection: collectText(doc.querySelector(".microstructures .inflection .forms > div") || doc.querySelector(".inflection .forms > div")),
      example: collectText(doc.querySelector(".microstructures .examples > div") || doc.querySelector(".examples > div") || doc.querySelector(".examples")),
      translations: extractTranslationsFromDocument(doc)
    };
  }

  function decodeHtmlText(value) {
    return cleanWord(String(value || "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">"));
  }

  function extractEntryFromHtmlWithRegex(html, url) {
    const source = String(html || "");
    const id = getIdFromUrl(url);
    if (!id) return null;

    const headingMatch = source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const headingText = decodeHtmlText((headingMatch?.[1] || "").replace(/<[^>]+>/g, " "));
    const word = sanitizeHeading(headingText) || cleanWord(id);
    if (!wordMatchesUrlId(word, id)) return null;

    const posMatch = source.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
    const translations = {};
    for (const lang of ["de", "fr", "en", "pt", "nl"]) {
      const pattern = new RegExp(`<div[^>]+class=["'][^"']*${lang}[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`, "ig");
      let match = null;
      while ((match = pattern.exec(source))) {
        const value = decodeHtmlText(String(match[1] || "").replace(/<[^>]+>/g, " "));
        addTranslationValue(translations, lang, value);
      }
    }

    return {
      id,
      word,
      url,
      pos: sanitizePos(decodeHtmlText(posMatch?.[1] || "")),
      inflection: "",
      example: "",
      translations
    };
  }

  function extractEntryFromHtml(html, url) {
    if (typeof DOMParser !== "undefined") {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(String(html || ""), "text/html");
        const parsed = extractEntryFromDocument(doc, url);
        if (parsed) return parsed;
      } catch {
        // Fall through to regex extraction.
      }
    }

    return extractEntryFromHtmlWithRegex(html, url);
  }

  /**
   * Full info text for title attribute (POS + all translations).
   */
  function infoTextFull(entry) {
    const parts = [];
    if (entry?.pos) parts.push(entry.pos);
    const translations = entry?.translations || {};
    if (translations.en) parts.push(`English: ${translations.en}`);
    if (translations.fr) parts.push(`Français: ${translations.fr}`);
    if (translations.de) parts.push(`Deutsch: ${translations.de}`);
    return parts.join(" · ");
  }

  /**
   * Compact info text for the banner display line.
   * Shows POS + primary translation (truncated if long) + "+N" for remaining languages.
   * The full text is available via infoTextFull() for the title attribute.
   */
  function infoText(entry) {
    const parts = [];
    if (entry?.pos) parts.push(entry.pos);

    const meaning = getPrimaryMeaning(entry);
    if (meaning?.label && meaning?.value) {
      let value = meaning.value;
      if (value.length > 30) value = value.slice(0, 28) + "…";
      parts.push(`${meaning.label}: ${value}`);
    }

    const labelToLang = {
      english: "en",
      français: "fr",
      francais: "fr",
      deutsch: "de",
      português: "pt",
      portugues: "pt",
      nederlands: "nl"
    };
    const primaryLang = cleanWord(meaning?.lang).toLowerCase()
      || labelToLang[cleanWord(meaning?.label).toLowerCase()]
      || "";
    const otherCount = Object.keys(entry?.translations || {}).filter(
      (lang) => cleanWord(lang).toLowerCase() !== primaryLang
    ).length;
    if (otherCount > 0) parts.push(`+${otherCount}`);

    return parts.join(" · ");
  }

  globalThis.LodVaultArticleReader = {
    cleanWord,
    stitchTokens,
    collectText,
    sanitizeHeading,
    sanitizePos,
    getHeadingElement,
    extractTranslations,
    extractCurrentEntry,
    extractEntryFromDocument,
    extractEntryFromHtml,
    infoText,
    infoTextFull
  };
})();


// ── compress.js ──────────────────────────────────────────────
/**
 * LODVault — Compression module (deflate-raw + custom base64)
 *
 * Uses the browser-native CompressionStream / DecompressionStream API when
 * available, with a transparent fallback that returns text unchanged.
 * Stores compressed output as base64 strings so they survive
 * chrome.storage.sync JSON serialisation.
 */
(() => {
  const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  /* ------------------------------------------------------------------ */
  /*  Feature detection                                                   */
  /* ------------------------------------------------------------------ */

  let compressionAvailable = false;

  try {
    compressionAvailable = Boolean(
      typeof CompressionStream !== "undefined"
      && typeof DecompressionStream !== "undefined"
      && typeof ReadableStream !== "undefined"
      && typeof WritableStream !== "undefined"
      && typeof TextEncoder !== "undefined"
      && typeof TextDecoder !== "undefined"
    );
  } catch (_error) {
    // Intentionally empty — fall back to no-op.
  }

  /* ------------------------------------------------------------------ */
  /*  Custom base64 (avoids btoa/atob which may be absent in workers)     */
  /* ------------------------------------------------------------------ */

  function bytesToBase64(bytes) {
    let result = "";
    const length = bytes.length;

    for (let index = 0; index < length; index += 3) {
      const byte1 = bytes[index];
      const byte2 = index + 1 < length ? bytes[index + 1] : 0;
      const byte3 = index + 2 < length ? bytes[index + 2] : 0;

      result += BASE64_ALPHABET[byte1 >> 2];
      result += BASE64_ALPHABET[((byte1 & 3) << 4) | (byte2 >> 4)];
      result += index + 1 < length ? BASE64_ALPHABET[((byte2 & 15) << 2) | (byte3 >> 6)] : "=";
      result += index + 2 < length ? BASE64_ALPHABET[byte3 & 63] : "=";
    }

    return result;
  }

  function base64ToBytes(value) {
    const cleaned = String(value || "").replace(/[^A-Za-z0-9+/=]/g, "");
    const length = cleaned.length;

    if (length === 0) {
      return new Uint8Array(0);
    }

    const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
    const outputLength = Math.floor(length * 0.75) - padding;
    const bytes = new Uint8Array(outputLength);
    let byteIndex = 0;

    for (let index = 0; index < length; index += 4) {
      const enc1 = BASE64_ALPHABET.indexOf(cleaned[index]);
      const enc2 = BASE64_ALPHABET.indexOf(cleaned[index + 1]);
      const enc3 = index + 2 < length && cleaned[index + 2] !== "="
        ? BASE64_ALPHABET.indexOf(cleaned[index + 2])
        : 0;
      const enc4 = index + 3 < length && cleaned[index + 3] !== "="
        ? BASE64_ALPHABET.indexOf(cleaned[index + 3])
        : 0;

      bytes[byteIndex++] = (enc1 << 2) | (enc2 >> 4);

      if (index + 2 < length && cleaned[index + 2] !== "=") {
        bytes[byteIndex++] = ((enc2 & 15) << 4) | (enc3 >> 2);
      }

      if (index + 3 < length && cleaned[index + 3] !== "=") {
        bytes[byteIndex++] = ((enc3 & 3) << 6) | enc4;
      }
    }

    return bytes;
  }

  /* ------------------------------------------------------------------ */
  /*  Stream helpers                                                     */
  /* ------------------------------------------------------------------ */

  async function readAllChunks(readableStream) {
    const reader = readableStream.getReader();
    const chunks = [];

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        if (value) {
          chunks.push(value);
        }
      }
      return buildResult(chunks);
    } catch (_error) {
      return null;
    } finally {
      try {
        reader.releaseLock();
      } catch (_error) {
        // Reader may already be released due to stream error.
      }
    }
  }

  function buildResult(chunks) {
    if (chunks.length === 0) {
      return new Uint8Array(0);
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Compress a UTF-8 string via deflate-raw and return a base64-encoded
   * result.  When compression is unavailable the function returns the
   * original text unchanged (identity fallback).
   */
  async function compress(text) {
    if (!compressionAvailable) {
      return text;
    }

    try {
      const encoder = new TextEncoder();
      const inputBytes = encoder.encode(text);

      if (inputBytes.length === 0) {
        return "";
      }

      const cs = new CompressionStream("deflate-raw");
      const writer = cs.writable.getWriter();
      const readerPromise = readAllChunks(cs.readable);

      await writer.write(inputBytes);
      await writer.close();

      const compressedBytes = await readerPromise;
      return bytesToBase64(compressedBytes);
    } catch (_error) {
      return text;
    }
  }

  /**
   * Decompress a base64-encoded deflate-raw payload back into the original
   * UTF-8 string.  When compression is unavailable, returns the argument
   * unchanged.
   */
  async function decompress(value) {
    if (!compressionAvailable) {
      return value;
    }

    try {
      const compressedBytes = base64ToBytes(value);

      if (compressedBytes.length === 0) {
        return "";
      }

      const ds = new DecompressionStream("deflate-raw");
      const writer = ds.writable.getWriter();
      const readerPromise = readAllChunks(ds.readable);

      try {
        await writer.write(compressedBytes);
        await writer.close();
      } catch (_error) {
        writer.releaseLock();
        return value;
      }

      const decompressedBytes = await readerPromise;

      if (!decompressedBytes) {
        return value;
      }

      const decoder = new TextDecoder();
      return decoder.decode(decompressedBytes);
    } catch (_error) {
      return value;
    }
  }

  /** Returns true when the native CompressionStream API is available. */
  function isAvailable() {
    return compressionAvailable;
  }

  /* ------------------------------------------------------------------ */
  /*  Export                                                             */
  /* ------------------------------------------------------------------ */

  globalThis.LodVaultCompress = Object.freeze({
    compress,
    decompress,
    isAvailable,
    // Exposed for tests that need to stub the availability flag.
    _setAvailableForTest(available) {
      compressionAvailable = Boolean(available);
    }
  });
})();


// ── sync.js ──────────────────────────────────────────────
(() => {
  const STORAGE_KEY = globalThis.LodVaultStore?.STORAGE_KEY || "lodVault.entries";
  const LOCAL_SETTINGS_KEY = globalThis.LodVaultStore?.SETTINGS_KEY || "lodVault.settings";
  const LOCAL_DELETED_KEY = globalThis.LodVaultStore?.DELETED_KEY || "lodVault.deleted";
  const DEFAULT_SETTINGS = globalThis.LodVaultStore?.DEFAULT_SETTINGS || {
    autoMode: false,
    syncLanguages: ["en", "fr", "de"]
  };
  const MAX_SYNC_LANGUAGES = globalThis.LodVaultStore?.MAX_SYNC_LANGUAGES || 3;
  const SYNC_LANGUAGE_TO_KEY = globalThis.LodVaultStore?.SYNC_LANGUAGE_TO_KEY || {
    en: "e",
    fr: "f",
    de: "d",
    pt: "p",
    nl: "l"
  };
  const SYNC_KEY_TO_LANGUAGE = globalThis.LodVaultStore?.SYNC_KEY_TO_LANGUAGE || Object.freeze(
    Object.fromEntries(Object.entries(SYNC_LANGUAGE_TO_KEY).map(([language, key]) => [key, language]))
  );

  const SYNC_FORMAT_VERSION = 4;
  const COMPRESSION = globalThis.LodVaultCompress || null;
  const SYNC_MANIFEST_KEY = "lodVault.m";
  const SYNC_SETTINGS_KEY = "lodVault.s";
  const SYNC_DELETED_KEY = "lodVault.d";
  const SYNC_ENTRY_PREFIX = "lodVault.e.";
  const SYNC_SHARD_SOFT_LIMIT = 7000;
  const SYNC_ITEM_HARD_LIMIT = 8192;
  const SYNC_TOTAL_HARD_LIMIT = 100 * 1024;
  const SYNC_MAX_ITEMS = 512;
  const DEFAULT_REPUSH_DELAY_MS = Math.max(0, Number(globalThis.__LOD_SYNC_REPUSH_DELAY_MS__ ?? 2000) || 0);

  let initPromise = null;

  const store = globalThis.LodVaultStore || {};
  const cleanText = typeof store.cleanText === "function" ? store.cleanText : (value) => (typeof value === "string" ? value.trim() : "");
  const normalizeVisitCount = typeof store.normalizeVisitCount === "function" ? store.normalizeVisitCount : (value) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0; };
  const shouldKeepEntry = typeof store.shouldKeepEntry === "function" ? store.shouldKeepEntry : (entry) => Boolean(entry?.favorite || entry?.study || entry?.history);
  const normalizeEntry = typeof store.normalizeEntry === "function" ? store.normalizeEntry : (entry = {}) => {
    const id = cleanText(entry.id);
    const translations = Object.entries(entry.translations || {}).reduce((result, [language, translation]) => { const cleaned = cleanText(translation); if (cleaned) result[language] = cleaned; return result; }, {});
    return { id, word: cleanText(entry.word), url: cleanText(entry.url), pos: cleanText(entry.pos), inflection: cleanText(entry.inflection), example: cleanText(entry.example), note: cleanText(entry.note), translations, favorite: Boolean(entry.favorite), study: Boolean(entry.study), history: Boolean(entry.history), visitCount: normalizeVisitCount(entry.visitCount), lastVisitedAt: cleanText(entry.lastVisitedAt), createdAt: cleanText(entry.createdAt), updatedAt: cleanText(entry.updatedAt) };
  };
  const normalizeSyncLanguages = typeof store.normalizeSyncLanguages === "function" ? store.normalizeSyncLanguages : (value) => {
    const requested = Array.isArray(value) ? value : DEFAULT_SETTINGS.syncLanguages;
    const deduped = [];
    for (const language of requested) { const normalized = cleanText(language).toLowerCase(); if (!SYNC_LANGUAGE_TO_KEY[normalized]) continue; if (deduped.includes(normalized)) continue; deduped.push(normalized); if (deduped.length >= MAX_SYNC_LANGUAGES) break; }
    return deduped.length ? deduped : [...DEFAULT_SETTINGS.syncLanguages];
  };
  const normalizeSettings = typeof store.normalizeSettings === "function" ? store.normalizeSettings : (settings = {}) => ({ ...DEFAULT_SETTINGS, autoMode: Boolean(settings?.autoMode), syncLanguages: normalizeSyncLanguages(settings?.syncLanguages) });
  const normalizeDeletedMap = typeof store.normalizeDeletedMap === "function" ? store.normalizeDeletedMap : (value = {}) => {
    const result = {};
    for (const [rawId, rawDeletedAt] of Object.entries(value || {})) {
      const id = cleanText(rawId);
      const deletedAt = cleanText(rawDeletedAt);
      const timestamp = Date.parse(deletedAt);
      if (!id || !deletedAt || !Number.isFinite(timestamp)) continue;
      result[id] = new Date(timestamp).toISOString();
    }
    return result;
  };
  const normalizeEntryMap = typeof store.normalizeEntryMap === "function" ? store.normalizeEntryMap : (entryMap = {}) => {
    const result = {};
    for (const [entryId, value] of Object.entries(entryMap || {})) { const normalized = normalizeEntry({ id: entryId, ...value }); if (!normalized.id || !normalized.word || !shouldKeepEntry(normalized)) continue; result[normalized.id] = normalized; }
    return result;
  };
  const filterEntryMapTranslations = typeof store.filterEntryMapTranslations === "function" ? store.filterEntryMapTranslations : (entryMap = {}, languages = DEFAULT_SETTINGS.syncLanguages) => {
    const allowed = new Set(normalizeSyncLanguages(languages)); const filtered = {};
    for (const [entryId, value] of Object.entries(normalizeEntryMap(entryMap))) { const entry = normalizeEntry({ id: entryId, ...value }); const translations = {}; for (const [language, translation] of Object.entries(entry.translations || {})) { const normalizedLanguage = cleanText(language).toLowerCase(); const cleanedTranslation = cleanText(translation); if (!allowed.has(normalizedLanguage) || !cleanedTranslation) continue; translations[normalizedLanguage] = cleanedTranslation; }
    if (Object.keys(translations).length) { entry.translations = translations; } else { delete entry.translations; }
    if (entry.id && entry.word && shouldKeepEntry(entry)) { filtered[entry.id] = entry; } }
    return filtered;
  };

  function nowUnix() {
    return Math.floor(Date.now() / 1000);
  }

  function getByteLength(value) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(text).length;
    }
    if (typeof Blob !== "undefined") {
      return new Blob([text]).size;
    }
    return text.length;
  }



  function getEntryTimestamp(entry = {}) {
    const updated = Date.parse(cleanText(entry.updatedAt));
    if (Number.isFinite(updated)) return updated;

    const visited = Date.parse(cleanText(entry.lastVisitedAt));
    if (Number.isFinite(visited)) return visited;

    const created = Date.parse(cleanText(entry.createdAt));
    if (Number.isFinite(created)) return created;

    return 0;
  }

  function mergeDeletedMaps(primary = {}, secondary = {}) {
    const left = normalizeDeletedMap(primary);
    const right = normalizeDeletedMap(secondary);
    const merged = { ...left };

    for (const [id, deletedAt] of Object.entries(right)) {
      const current = merged[id];
      if (!current || Date.parse(deletedAt) > Date.parse(current)) {
        merged[id] = deletedAt;
      }
    }

    return merged;
  }

  function applyDeletedMap(entryMap = {}, deletedMap = {}) {
    const normalizedEntries = normalizeEntryMap(entryMap);
    const normalizedDeleted = normalizeDeletedMap(deletedMap);
    const nextEntries = {};

    for (const [id, entry] of Object.entries(normalizedEntries)) {
      const deletedAt = normalizedDeleted[id];
      if (!deletedAt) {
        nextEntries[id] = entry;
        continue;
      }

      if (getEntryTimestamp(entry) > Date.parse(deletedAt)) {
        nextEntries[id] = entry;
      }
    }

    return nextEntries;
  }

  function pruneDeletedMapAgainstEntries(entryMap = {}, deletedMap = {}) {
    const normalizedEntries = normalizeEntryMap(entryMap);
    const normalizedDeleted = normalizeDeletedMap(deletedMap);
    const nextDeleted = {};

    for (const [id, deletedAt] of Object.entries(normalizedDeleted)) {
      const entry = normalizedEntries[id];
      if (!entry) {
        nextDeleted[id] = deletedAt;
        continue;
      }

      if (getEntryTimestamp(entry) <= Date.parse(deletedAt)) {
        nextDeleted[id] = deletedAt;
      }
    }

    return nextDeleted;
  }

  async function persistFallbackLocalState(entries, settings, deletedMap) {
    const normalizedEntries = normalizeEntryMap(entries);
    const normalizedSettings = normalizeSettings(settings);
    const normalizedDeletedMap = pruneDeletedMapAgainstEntries(normalizedEntries, deletedMap);
    const payload = {
      [STORAGE_KEY]: normalizedEntries,
      [LOCAL_SETTINGS_KEY]: normalizedSettings
    };

    if (Object.keys(normalizedDeletedMap).length) {
      payload[LOCAL_DELETED_KEY] = normalizedDeletedMap;
      await chrome.storage.local.set(payload);
    } else {
      await chrome.storage.local.set(payload);
      await chrome.storage.local.remove(LOCAL_DELETED_KEY);
    }

    return normalizedDeletedMap;
  }

  function compactDeletedMap(deletedMap = {}) {
    const compact = {};
    for (const [id, deletedAt] of Object.entries(normalizeDeletedMap(deletedMap))) {
      const unix = isoToUnix(deletedAt);
      if (id && unix) {
        compact[id] = unix;
      }
    }
    return compact;
  }

  function expandDeletedMap(value = {}) {
    const expanded = {};
    for (const [id, deletedAt] of Object.entries(value || {})) {
      const normalizedId = cleanText(id);
      const iso = typeof deletedAt === "number" ? unixToIso(deletedAt) : cleanText(deletedAt);
      if (!normalizedId || !iso) continue;
      const timestamp = Date.parse(iso);
      if (!Number.isFinite(timestamp)) continue;
      expanded[normalizedId] = new Date(timestamp).toISOString();
    }
    return expanded;
  }

  function pickLatestIso(...values) {
    const sorted = values
      .map((value) => cleanText(value))
      .filter(Boolean)
      .sort((left, right) => Date.parse(right) - Date.parse(left));
    return sorted[0] || "";
  }

  function pickEarliestIso(...values) {
    const sorted = values
      .map((value) => cleanText(value))
      .filter(Boolean)
      .sort((left, right) => Date.parse(left) - Date.parse(right));
    return sorted[0] || "";
  }

  function compactUrl(url) {
    const directId = typeof store.getIdFromUrl === "function" ? store.getIdFromUrl(url) : "";
    if (directId) return directId;

    const trimmed = cleanText(url);
    if (!trimmed) return "";
    return trimmed.replace(/^https?:\/\/(?:www\.)?lod\.lu\/artikel\//i, "");
  }

  function expandUrl(path) {
    const value = cleanText(path);
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    return `https://lod.lu/artikel/${encodeURIComponent(value)}`;
  }

  function isoToUnix(iso) {
    const timestamp = Date.parse(cleanText(iso));
    return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0;
  }

  function unixToIso(seconds) {
    const number = Number(seconds);
    return Number.isFinite(number) && number > 0
      ? new Date(Math.floor(number) * 1000).toISOString()
      : "";
  }

  function packFlags(flags = {}) {
    let value = 0;
    if (flags.favorite || flags.fav) value |= 1;
    if (flags.study) value |= 2;
    if (flags.history || flags.hist) value |= 4;
    return value;
  }

  function unpackFlags(value) {
    const number = Number(value) || 0;
    return {
      fav: Boolean(number & 1),
      study: Boolean(number & 2),
      hist: Boolean(number & 4)
    };
  }

  function compactTranslations(translations = {}, languages = DEFAULT_SETTINGS.syncLanguages) {
    const allowedLanguages = normalizeSyncLanguages(languages);
    const compact = {};

    for (const language of allowedLanguages) {
      const key = SYNC_LANGUAGE_TO_KEY[language];
      const translation = cleanText(translations?.[language]);
      if (key && translation) {
        compact[key] = translation;
      }
    }

    return compact;
  }

  function expandTranslations(compact = {}, existing = {}) {
    const merged = {};

    for (const [language, translation] of Object.entries(existing || {})) {
      const cleaned = cleanText(translation);
      if (cleaned) merged[language] = cleaned;
    }

    for (const [key, translation] of Object.entries(compact || {})) {
      const language = SYNC_KEY_TO_LANGUAGE[key];
      const cleaned = cleanText(translation);
      if (language && cleaned) {
        merged[language] = cleaned;
      }
    }

    return merged;
  }

  function compactEntry(localEntry, syncLanguages = DEFAULT_SETTINGS.syncLanguages) {
    const entry = normalizeEntry(localEntry);
    if (!entry.id || !entry.word || !shouldKeepEntry(entry)) return null;

    const compact = {
      i: entry.id,
      w: entry.word,
      u: compactUrl(entry.url) || entry.id
    };

    if (entry.pos) compact.p = entry.pos;
    if (entry.inflection) compact.f = entry.inflection;
    if (entry.example) compact.e = entry.example;
    if (entry.note) compact.n = entry.note;

    const translations = compactTranslations(entry.translations, syncLanguages);
    if (Object.keys(translations).length) {
      compact.t = translations;
    }

    const flags = packFlags({ favorite: entry.favorite, study: entry.study, history: entry.history });
    if (flags) compact.a = flags;

    if (normalizeVisitCount(entry.visitCount) > 1) {
      compact.c = normalizeVisitCount(entry.visitCount);
    }

    const lastVisitedAt = isoToUnix(entry.lastVisitedAt);
    if (lastVisitedAt) compact.l = lastVisitedAt;

    const createdAt = isoToUnix(entry.createdAt);
    if (createdAt) compact.r = createdAt;

    const updatedAt = isoToUnix(entry.updatedAt);
    if (updatedAt) compact.o = updatedAt;

    return compact;
  }

  function expandEntry(syncEntry = {}, localEntry = null) {
    const existing = localEntry ? normalizeEntry(localEntry) : normalizeEntry({});
    const flags = unpackFlags(syncEntry.a);
    const history = Boolean(flags.hist);
    const visitCount = normalizeVisitCount(syncEntry.c);

    const expanded = {
      id: cleanText(syncEntry.i) || existing.id,
      word: cleanText(syncEntry.w) || existing.word,
      url: expandUrl(syncEntry.u || syncEntry.i || compactUrl(existing.url) || existing.id),
      pos: cleanText(syncEntry.p),
      inflection: cleanText(syncEntry.f),
      example: cleanText(syncEntry.e),
      note: cleanText(syncEntry.n),
      translations: expandTranslations(syncEntry.t, existing.translations),
      favorite: Boolean(flags.fav),
      study: Boolean(flags.study),
      history,
      visitCount: history ? Math.max(visitCount, 1) : visitCount,
      lastVisitedAt: unixToIso(syncEntry.l),
      createdAt: unixToIso(syncEntry.r) || existing.createdAt,
      updatedAt: unixToIso(syncEntry.o) || existing.updatedAt
    };

    if (!Object.keys(expanded.translations).length) {
      delete expanded.translations;
    }

    if (!expanded.visitCount) {
      delete expanded.visitCount;
    }

    if (!expanded.lastVisitedAt) {
      delete expanded.lastVisitedAt;
    }

    return normalizeEntry(expanded);
  }

  function shardEntries(entryMap = {}, syncLanguages = DEFAULT_SETTINGS.syncLanguages) {
    const entries = Object.values(normalizeEntryMap(entryMap))
      .sort((left, right) => left.id.localeCompare(right.id));
    const shards = [];
    let currentShard = [];

    for (const entry of entries) {
      const compact = compactEntry(entry, syncLanguages);
      if (!compact) continue;

      if (!currentShard.length) {
        currentShard.push(compact);
        continue;
      }

      const candidateShard = currentShard.concat(compact);
      if (getByteLength(candidateShard) > SYNC_SHARD_SOFT_LIMIT) {
        shards.push(currentShard);
        currentShard = [compact];
      } else {
        currentShard = candidateShard;
      }
    }

    if (currentShard.length) {
      shards.push(currentShard);
    }

    return shards;
  }

  function mergeEntryMaps(primaryEntryMap = {}, secondaryEntryMap = {}) {
    const primary = normalizeEntryMap(primaryEntryMap);
    const secondary = normalizeEntryMap(secondaryEntryMap);
    const merged = { ...primary };

    for (const [entryId, secondaryEntry] of Object.entries(secondary)) {
      const primaryEntry = merged[entryId];

      if (!primaryEntry) {
        merged[entryId] = secondaryEntry;
        continue;
      }

      const newest = getEntryTimestamp(secondaryEntry) > getEntryTimestamp(primaryEntry)
        ? secondaryEntry
        : primaryEntry;
      const hasHistory = Boolean(primaryEntry.history || secondaryEntry.history);
      const nextEntry = {
        id: primaryEntry.id || secondaryEntry.id,
        word: primaryEntry.word || secondaryEntry.word,
        url: primaryEntry.url || secondaryEntry.url,
        pos: newest.pos || primaryEntry.pos || secondaryEntry.pos,
        inflection: newest.inflection || primaryEntry.inflection || secondaryEntry.inflection,
        example: newest.example || primaryEntry.example || secondaryEntry.example,
        note: newest.note || primaryEntry.note || secondaryEntry.note,
        translations: {
          ...(secondaryEntry.translations || {}),
          ...(primaryEntry.translations || {}),
          ...(newest.translations || {})
        },
        favorite: Boolean(primaryEntry.favorite || secondaryEntry.favorite),
        study: Boolean(primaryEntry.study || secondaryEntry.study),
        history: hasHistory,
        visitCount: hasHistory
          ? Math.max(normalizeVisitCount(primaryEntry.visitCount), normalizeVisitCount(secondaryEntry.visitCount), 1)
          : 0,
        lastVisitedAt: pickLatestIso(primaryEntry.lastVisitedAt, secondaryEntry.lastVisitedAt),
        createdAt: pickEarliestIso(primaryEntry.createdAt, secondaryEntry.createdAt),
        updatedAt: pickLatestIso(primaryEntry.updatedAt, secondaryEntry.updatedAt)
      };

      if (!Object.keys(nextEntry.translations).length) {
        delete nextEntry.translations;
      }

      if (!nextEntry.visitCount) {
        delete nextEntry.visitCount;
      }

      if (!nextEntry.lastVisitedAt) {
        delete nextEntry.lastVisitedAt;
      }

      if (shouldKeepEntry(nextEntry)) {
        merged[entryId] = normalizeEntry(nextEntry);
      }
    }

    return normalizeEntryMap(merged);
  }

  function mergeVaultVersionsPreferLarger(leftEntryMap = {}, rightEntryMap = {}) {
    const left = normalizeEntryMap(leftEntryMap);
    const right = normalizeEntryMap(rightEntryMap);
    const leftCount = Object.keys(left).length;
    const rightCount = Object.keys(right).length;

    if (!leftCount) return right;
    if (!rightCount) return left;

    const primary = leftCount >= rightCount ? left : right;
    const secondary = primary === left ? right : left;
    return mergeEntryMaps(primary, secondary);
  }

  function buildSyncSettings(settings = DEFAULT_SETTINGS) {
    const normalized = normalizeSettings(settings);
    return {
      a: Boolean(normalized.autoMode),
      l: [...normalized.syncLanguages]
    };
  }

  function buildManifest(settings = DEFAULT_SETTINGS, shardCount = 0, timestamp = nowUnix()) {
    const normalized = normalizeSettings(settings);
    const manifest = {
      v: SYNC_FORMAT_VERSION,
      n: Math.max(0, Number(shardCount) || 0),
      a: Boolean(normalized.autoMode),
      l: normalized.syncLanguages.map((language) => SYNC_LANGUAGE_TO_KEY[language]).filter(Boolean),
      t: timestamp
    };

    if (COMPRESSION && COMPRESSION.isAvailable && COMPRESSION.isAvailable()) {
      manifest.z = 1;
    }

    return manifest;
  }

  function normalizeSyncLanguageList(value, fallback = DEFAULT_SETTINGS.syncLanguages) {
    const normalized = [];

    for (const item of Array.isArray(value) ? value : []) {
      const cleaned = cleanText(item).toLowerCase();
      const language = SYNC_KEY_TO_LANGUAGE[cleaned] || cleaned;
      if (!SYNC_LANGUAGE_TO_KEY[language]) continue;
      if (normalized.includes(language)) continue;
      normalized.push(language);
      if (normalized.length >= MAX_SYNC_LANGUAGES) break;
    }

    return normalized.length ? normalized : normalizeSyncLanguages(fallback);
  }

  function normalizeSyncTranslationMap(translations = {}, fallbackLanguages = DEFAULT_SETTINGS.syncLanguages) {
    const result = {};

    for (const [key, value] of Object.entries(translations || {})) {
      const cleanedValue = cleanText(value);
      if (!cleanedValue) continue;

      const cleanedKey = cleanText(key).toLowerCase();
      const compactKey = SYNC_KEY_TO_LANGUAGE[cleanedKey]
        ? cleanedKey
        : SYNC_LANGUAGE_TO_KEY[cleanedKey];

      if (compactKey) {
        result[compactKey] = cleanedValue;
      }
    }

    if (Object.keys(result).length) {
      return result;
    }

    return compactTranslations(expandTranslations({}, translations), fallbackLanguages);
  }

  function normalizeSyncSettings(rawSettings = {}, manifest = null) {
    const manifestLanguages = normalizeSyncLanguageList(manifest?.l, DEFAULT_SETTINGS.syncLanguages);
    return {
      a: Boolean(rawSettings?.a),
      l: normalizeSyncLanguageList(rawSettings?.l, manifestLanguages)
    };
  }

  function isManifestCompressed(manifest) {
    return Boolean(manifest && (manifest.z === 1 || manifest.z === true || Number(manifest.v) >= 4));
  }

  function normalizeManifest(rawManifest = null, shardCount = 0) {
    if (!rawManifest || typeof rawManifest !== "object") {
      return null;
    }

    const normalizedLanguages = normalizeSyncLanguageList(rawManifest.l, DEFAULT_SETTINGS.syncLanguages)
      .map((language) => SYNC_LANGUAGE_TO_KEY[language])
      .filter(Boolean);

    return {
      v: Number(rawManifest.v) || 0,
      n: Math.max(0, Number(rawManifest.n) || shardCount),
      a: Boolean(rawManifest.a),
      l: normalizedLanguages,
      t: Number(rawManifest.t) || 0,
      z: Number(rawManifest.z) || 0
    };
  }

  function hasLegacySyncEntryShape(syncEntry = {}) {
    return Boolean(syncEntry && typeof syncEntry === "object" && (
      "id" in syncEntry
      || "word" in syncEntry
      || "url" in syncEntry
      || "translations" in syncEntry
      || "favorite" in syncEntry
      || "study" in syncEntry
      || "history" in syncEntry
    ));
  }

  function hasLegacySyncSavedMarker(syncEntry = {}) {
    return Boolean(syncEntry?.saved || syncEntry?.isSaved || syncEntry?.savedWord || syncEntry?.bookmarked);
  }

  function recoverLegacySyncFlags(syncEntry = {}, fallbackFlags = 0) {
    const baseFlags = Number(fallbackFlags) || 0;
    if (baseFlags) return baseFlags;

    const explicitBooleanFlags = packFlags(syncEntry);
    if (explicitBooleanFlags) return explicitBooleanFlags;

    const id = cleanText(syncEntry.i || syncEntry.id);
    const word = cleanText(syncEntry.w || syncEntry.word);
    if (!id || !word) return 0;

    const hasExplicitCompactFlags = Object.prototype.hasOwnProperty.call(syncEntry, "a");
    const hasLegacyBooleanFlags = ["favorite", "study", "history", "fav", "hist"].some((key) => Object.prototype.hasOwnProperty.call(syncEntry, key));
    const shouldRecover = hasLegacySyncSavedMarker(syncEntry)
      || (!hasExplicitCompactFlags && !hasLegacyBooleanFlags);

    if (!shouldRecover) {
      return 0;
    }

    const hasHistorySignal = normalizeVisitCount(syncEntry.c || syncEntry.visitCount) > 0
      || Number(syncEntry.l) > 0
      || Boolean(cleanText(syncEntry.lastVisitedAt));

    return packFlags({ study: true, history: hasHistorySignal });
  }

  function detectSyncMigrationNeed({ rawManifest, rawSettings, shardEntries, hasSyncData, hasRawCompressedShards }) {
    if (!hasSyncData) return false;
    if (!rawManifest || Number(rawManifest.v) !== SYNC_FORMAT_VERSION) return true;
    if (!isManifestCompressed(rawManifest) && COMPRESSION && COMPRESSION.isAvailable && COMPRESSION.isAvailable()) return true;

    if (Array.isArray(rawSettings?.l) && rawSettings.l.some((value) => cleanText(value).length === 1)) {
      return true;
    }

    if (Array.isArray(rawManifest?.l) && rawManifest.l.some((value) => cleanText(value).length > 1)) {
      return true;
    }

    if (hasRawCompressedShards && !isManifestCompressed(rawManifest)) return true;

    return shardEntries.some((entry) => {
      if (hasLegacySyncEntryShape(entry)) return true;
      if (!entry || typeof entry !== "object") return false;
      return Object.keys(entry.t || {}).some((key) => cleanText(key).length > 1);
    });
  }

  function coerceSyncEntry(syncEntry = {}, fallbackLanguages = DEFAULT_SETTINGS.syncLanguages) {
    if (!syncEntry || typeof syncEntry !== "object") {
      return null;
    }

    if (hasLegacySyncEntryShape(syncEntry)) {
      const legacyCompact = {
        i: cleanText(syncEntry.id),
        w: cleanText(syncEntry.word),
        u: compactUrl(syncEntry.url) || cleanText(syncEntry.id),
        p: cleanText(syncEntry.pos),
        f: cleanText(syncEntry.inflection),
        e: cleanText(syncEntry.example),
        n: cleanText(syncEntry.note),
        t: normalizeSyncTranslationMap(syncEntry.translations, fallbackLanguages),
        a: recoverLegacySyncFlags(syncEntry),
        c: normalizeVisitCount(syncEntry.visitCount),
        l: isoToUnix(syncEntry.lastVisitedAt),
        r: isoToUnix(syncEntry.createdAt),
        o: isoToUnix(syncEntry.updatedAt)
      };

      Object.keys(legacyCompact).forEach((key) => {
        const value = legacyCompact[key];
        if (value == null) {
          delete legacyCompact[key];
          return;
        }
        if (typeof value === "string" && !value) {
          delete legacyCompact[key];
          return;
        }
        if (typeof value === "object" && !Object.keys(value).length) {
          delete legacyCompact[key];
          return;
        }
        if (typeof value === "number" && !value) {
          delete legacyCompact[key];
        }
      });

      const recoveredFlags = recoverLegacySyncFlags(syncEntry, legacyCompact.a);
      if (recoveredFlags) {
        legacyCompact.a = recoveredFlags;
        if (Boolean(recoveredFlags & 4)) {
          legacyCompact.c = normalizeVisitCount(legacyCompact.c || syncEntry.visitCount) || 1;
          legacyCompact.l = Number(legacyCompact.l) || isoToUnix(syncEntry.lastVisitedAt) || nowUnix();
        }
      }

      return legacyCompact;
    }

    const compact = {
      ...syncEntry,
      i: cleanText(syncEntry.i),
      w: cleanText(syncEntry.w),
      u: cleanText(syncEntry.u),
      p: cleanText(syncEntry.p),
      f: cleanText(syncEntry.f),
      e: cleanText(syncEntry.e),
      n: cleanText(syncEntry.n),
      t: normalizeSyncTranslationMap(syncEntry.t, fallbackLanguages)
    };

    if (!Object.keys(compact.t).length) {
      delete compact.t;
    }

    const recoveredFlags = recoverLegacySyncFlags(syncEntry, compact.a);
    if (recoveredFlags) {
      compact.a = recoveredFlags;
      if (Boolean(recoveredFlags & 4)) {
        compact.c = normalizeVisitCount(compact.c || syncEntry.c || syncEntry.visitCount) || 1;
        compact.l = Number(compact.l) || Number(syncEntry.l) || isoToUnix(syncEntry.lastVisitedAt) || nowUnix();
      }
    }

    return compact;
  }

  function flattenShardEntries(shards = []) {
    return shards.flatMap((shard) => Array.isArray(shard) ? shard : []);
  }

  function cloneCompactEntry(entry = {}) {
    const cloned = { ...entry };
    if (entry.t && typeof entry.t === "object") {
      cloned.t = { ...entry.t };
    }
    return cloned;
  }

  function cloneCompactShards(shards = []) {
    return shards.map((shard) => shard.map((entry) => cloneCompactEntry(entry)));
  }

  function buildEntryShardMap(shards = []) {
    return shards.reduce((result, shard, shardIndex) => {
      shard.forEach((entry, entryIndex) => {
        if (!entry?.i) return;
        result[entry.i] = {
          shardIndex,
          entryIndex,
          key: `${SYNC_ENTRY_PREFIX}${shardIndex}`
        };
      });
      return result;
    }, {});
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

  async function getLocalState() {
    const data = await chrome.storage.local.get([STORAGE_KEY, LOCAL_SETTINGS_KEY, LOCAL_DELETED_KEY]);
    const rawEntries = data[STORAGE_KEY] && typeof data[STORAGE_KEY] === "object" ? data[STORAGE_KEY] : {};
    const rawSettings = data[LOCAL_SETTINGS_KEY] && typeof data[LOCAL_SETTINGS_KEY] === "object" ? data[LOCAL_SETTINGS_KEY] : {};
    const settings = normalizeSettings(rawSettings);
    const deletedMap = normalizeDeletedMap(data[LOCAL_DELETED_KEY] || {});

    return {
      entries: filterEntryMapTranslations(rawEntries, settings.syncLanguages),
      rawEntries: normalizeEntryMap(rawEntries),
      rawSettings,
      settings,
      deletedMap
    };
  }

  async function decompressShard(shardValue) {
    if (typeof shardValue === "string" && COMPRESSION && COMPRESSION.decompress) {
      try {
        const decompressed = await COMPRESSION.decompress(shardValue);
        if (decompressed && decompressed !== shardValue) {
          const parsed = JSON.parse(decompressed);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch (_error) {
        // If decompression fails, fall through.
      }
    }
    return Array.isArray(shardValue) ? shardValue : [];
  }

  function isCompressedShard(value) {
    return typeof value === "string" && !Array.isArray(value);
  }

  async function getSyncState() {
    const data = await chrome.storage.sync.get(null);
    const rawManifest = data[SYNC_MANIFEST_KEY] && typeof data[SYNC_MANIFEST_KEY] === "object"
      ? data[SYNC_MANIFEST_KEY]
      : null;
    const rawSettings = data[SYNC_SETTINGS_KEY] && typeof data[SYNC_SETTINGS_KEY] === "object"
      ? data[SYNC_SETTINGS_KEY]
      : null;
    const rawDeletedMap = data[SYNC_DELETED_KEY] && typeof data[SYNC_DELETED_KEY] === "object"
      ? data[SYNC_DELETED_KEY]
      : null;
    const presentShardKeys = Object.keys(data)
      .filter((key) => key.startsWith(SYNC_ENTRY_PREFIX))
      .sort((left, right) => Number(left.slice(SYNC_ENTRY_PREFIX.length)) - Number(right.slice(SYNC_ENTRY_PREFIX.length)));
    const manifest = normalizeManifest(rawManifest, presentShardKeys.length);
    const expectedShardKeys = manifest?.n
      ? Array.from({ length: manifest.n }, (_value, index) => `${SYNC_ENTRY_PREFIX}${index}`)
      : presentShardKeys;
    const missingShardKeys = expectedShardKeys.filter((key) => !(key in data));

    const hasRawCompressedShards = expectedShardKeys.some((key) => isCompressedShard(data[key]));

    const malformedShardKeys = expectedShardKeys.filter((key) => {
      if (!(key in data)) return false;
      const value = data[key];
      return !Array.isArray(value) && !isCompressedShard(value);
    });

    const shardKeys = expectedShardKeys.filter((key) => {
      if (!(key in data)) return false;
      const value = data[key];
      return Array.isArray(value) || isCompressedShard(value);
    });

    const shards = [];
    for (const key of shardKeys) {
      shards.push(await decompressShard(data[key]));
    }

    const extraShardKeys = presentShardKeys.filter((key) => !expectedShardKeys.includes(key));
    const rawShardEntries = flattenShardEntries(shards);
    const settings = normalizeSyncSettings(rawSettings, manifest);
    const compactShards = shards.map((shard) => shard
      .map((entry) => coerceSyncEntry(entry, settings.l))
      .filter(Boolean));
    const entries = flattenShardEntries(compactShards);
    const entryShardMap = buildEntryShardMap(compactShards);
    const hasSyncData = Boolean(rawManifest || rawSettings || rawDeletedMap || presentShardKeys.length);
    const partialRead = missingShardKeys.length > 0 || malformedShardKeys.length > 0;
    const needsMigration = detectSyncMigrationNeed({
      rawManifest,
      rawSettings,
      shardEntries: rawShardEntries,
      hasSyncData,
      hasRawCompressedShards
    });

    if (partialRead) {
      console.warn("[LODVault] Partial sync shard read.", {
        missingShardKeys,
        malformedShardKeys
      });
    }

    return {
      data,
      manifest,
      rawManifest,
      settings,
      rawSettings,
      deletedMap: expandDeletedMap(rawDeletedMap || {}),
      shardKeys,
      presentShardKeys,
      extraShardKeys,
      missingShardKeys,
      malformedShardKeys,
      partialRead,
      needsMigration,
      shards,
      compactShards,
      entryShardMap,
      entries,
      hasSyncData
    };
  }

  function buildRemoteEntryMap(syncEntries = [], localEntryMap = {}) {
    const remote = {};

    for (const syncEntry of syncEntries) {
      if (!syncEntry || typeof syncEntry !== "object") continue;
      const entryId = cleanText(syncEntry.i);
      if (!entryId) continue;
      const expanded = expandEntry(syncEntry, localEntryMap[entryId]);
      if (!expanded.id || !expanded.word || !shouldKeepEntry(expanded)) continue;
      remote[expanded.id] = expanded;
    }

    return remote;
  }

  function buildPulledSettings(localState, syncState) {
    const nextSettings = { ...localState.settings };
    const rawLocalSettings = localState.rawSettings || {};
    const syncSettings = syncState.settings || {};

    if (!("autoMode" in rawLocalSettings) && "a" in syncSettings) {
      nextSettings.autoMode = Boolean(syncSettings.a);
    }

    if (!("syncLanguages" in rawLocalSettings) && Array.isArray(syncSettings.l)) {
      nextSettings.syncLanguages = normalizeSyncLanguageList(syncSettings.l);
    }

    return normalizeSettings(nextSettings);
  }

  function getSyncItemSize(key, value) {
    return getByteLength(String(key ?? "")) + getByteLength(JSON.stringify(value));
  }

  function estimateSyncWriteSize(values = {}) {
    return Object.entries(values || {}).reduce((total, [key, value]) => total + getSyncItemSize(key, value), 0);
  }

  function countSyncItems(values = {}) {
    return Object.keys(values || {}).length;
  }

  function buildProjectedSyncData(currentData = {}, payload = {}, removeKeys = []) {
    const transientData = {
      ...(currentData && typeof currentData === "object" ? currentData : {}),
      ...(payload && typeof payload === "object" ? payload : {})
    };
    const finalData = { ...transientData };

    for (const key of Array.isArray(removeKeys) ? removeKeys : []) {
      delete finalData[key];
    }

    return {
      transientData,
      finalData
    };
  }

  function getLodVaultSyncKeys(data = {}) {
    return Object.keys(data || {}).filter((key) => (
      key === SYNC_MANIFEST_KEY
      || key === SYNC_SETTINGS_KEY
      || key === SYNC_DELETED_KEY
      || key.startsWith(SYNC_ENTRY_PREFIX)
    ));
  }

  async function getActualSyncBytesInUse(keys = null) {
    if (typeof chrome?.storage?.sync?.getBytesInUse !== "function") {
      return Number.NaN;
    }

    try {
      const bytes = await chrome.storage.sync.getBytesInUse(keys);
      return Number(bytes);
    } catch {
      return Number.NaN;
    }
  }

  function classifyRecoverableSyncError(error) {
    const message = String(error?.message || error || "");
    if (message.includes("QUOTA") || message.includes("MAX_ITEMS") || message.includes("MAX_WRITE_OPERATIONS")) {
      return "quota-exceeded";
    }
    if (message.includes("storage.sync") || message.includes("Sync storage") || message.includes("Extension context invalidated")) {
      return "sync-unavailable";
    }
    return "sync-unavailable";
  }

  function isRecoverableSyncError(error) {
    const message = String(error?.message || error || "");
    return message.includes("QUOTA")
      || message.includes("MAX_ITEMS")
      || message.includes("MAX_WRITE_OPERATIONS")
      || message.includes("storage.sync")
      || message.includes("Sync storage")
      || message.includes("Extension context invalidated");
  }

  function buildMetadataPayload(settings, shardCount, timestamp = nowUnix()) {
    return {
      [SYNC_MANIFEST_KEY]: buildManifest(settings, shardCount, timestamp),
      [SYNC_SETTINGS_KEY]: buildSyncSettings(settings)
    };
  }

  function validateSyncPayload(payload = {}, options = {}) {
    const oversizeKeys = Object.entries(payload || {})
      .filter(([key, value]) => getSyncItemSize(key, value) > SYNC_ITEM_HARD_LIMIT)
      .map(([key]) => key);
    const { transientData, finalData } = buildProjectedSyncData(options.currentData, payload, options.removeKeys);
    const estimatedBytes = estimateSyncWriteSize(transientData);
    const finalEstimatedBytes = estimateSyncWriteSize(finalData);
    const itemCount = countSyncItems(transientData);
    const finalItemCount = countSyncItems(finalData);
    const maxItemsExceeded = itemCount > SYNC_MAX_ITEMS;

    if (oversizeKeys.length || estimatedBytes > SYNC_TOTAL_HARD_LIMIT || maxItemsExceeded) {
      return {
        ok: false,
        reason: "quota-exceeded",
        oversizeKeys,
        estimatedBytes,
        finalEstimatedBytes,
        itemCount,
        finalItemCount,
        maxItemsExceeded
      };
    }

    return {
      ok: true,
      estimatedBytes,
      finalEstimatedBytes,
      itemCount,
      finalItemCount,
      maxItemsExceeded: false,
      oversizeKeys: []
    };
  }

  async function writeSyncPayload(payload, options = {}) {
    const validation = validateSyncPayload(payload, options);
    if (!validation.ok) {
      console.warn("[LODVault] Sync push skipped: payload exceeds sync quota.", {
        oversizeKeys: validation.oversizeKeys,
        estimatedBytes: validation.estimatedBytes,
        finalEstimatedBytes: validation.finalEstimatedBytes,
        itemCount: validation.itemCount,
        finalItemCount: validation.finalItemCount,
        maxItemsExceeded: validation.maxItemsExceeded
      });
      return validation;
    }

    try {
      await chrome.storage.sync.set(payload);

      if (options.removeKeys?.length) {
        await chrome.storage.sync.remove(options.removeKeys);
      }
    } catch (error) {
      if (isRecoverableSyncError(error)) {
        const reason = classifyRecoverableSyncError(error);
        console.warn("[LODVault] Sync push skipped:", error);
        return {
          ok: false,
          reason,
          estimatedBytes: validation.estimatedBytes,
          finalEstimatedBytes: validation.finalEstimatedBytes,
          itemCount: validation.itemCount,
          finalItemCount: validation.finalItemCount,
          maxItemsExceeded: validation.maxItemsExceeded,
          oversizeKeys: validation.oversizeKeys
        };
      }
      throw error;
    }

    return validation;
  }

  async function compressShard(shard) {
    if (!COMPRESSION || !COMPRESSION.compress) return shard;
    if (!COMPRESSION.isAvailable || !COMPRESSION.isAvailable()) return shard;
    try {
      const json = JSON.stringify(shard);
      const compressed = await COMPRESSION.compress(json);
      if (compressed && compressed !== json && getByteLength(compressed) < getByteLength(json)) {
        return compressed;
      }
    } catch (_error) {
      // Fall through — store uncompressed.
    }
    return shard;
  }

  async function pushAll() {
    const localState = await getLocalState();
    const syncState = await getSyncState();
    const shards = shardEntries(localState.entries, localState.settings.syncLanguages);
    const nextSyncData = {};

    for (let index = 0; index < shards.length; index += 1) {
      nextSyncData[`${SYNC_ENTRY_PREFIX}${index}`] = await compressShard(shards[index]);
    }

    if (Object.keys(localState.deletedMap || {}).length) {
      nextSyncData[SYNC_DELETED_KEY] = compactDeletedMap(localState.deletedMap);
    }

    Object.assign(nextSyncData, buildMetadataPayload(localState.settings, shards.length));

    const removeKeys = syncState.presentShardKeys.filter((key) => !(key in nextSyncData));
    if (!nextSyncData[SYNC_DELETED_KEY] && syncState.data?.[SYNC_DELETED_KEY]) {
      removeKeys.push(SYNC_DELETED_KEY);
    }

    const writeResult = await writeSyncPayload(nextSyncData, {
      currentData: syncState.data,
      removeKeys
    });

    return {
      ...writeResult,
      entryCount: Object.keys(localState.entries).length,
      shardCount: shards.length,
      mode: writeResult.ok ? "full" : "full-failed"
    };
  }

  async function pullAll(options = {}) {
    const [localState, syncState] = await Promise.all([getLocalState(), getSyncState()]);
    const remoteEntries = buildRemoteEntryMap(syncState.entries, localState.rawEntries);

    const applyResult = typeof store.applyRemoteVaultStateDirect === "function"
      ? await store.applyRemoteVaultStateDirect({
          entries: remoteEntries,
          settings: syncState.settings,
          deletedMap: syncState.deletedMap
        })
      : await (async () => {
          const mergedSettings = buildPulledSettings(localState, syncState);
          const mergedDeletedMap = mergeDeletedMaps(localState.deletedMap, syncState.deletedMap);
          const mergedEntries = applyDeletedMap(
            Object.keys(remoteEntries).length
              ? mergeVaultVersionsPreferLarger(localState.rawEntries, remoteEntries)
              : localState.rawEntries,
            mergedDeletedMap
          );
          const nextDeletedMap = pruneDeletedMapAgainstEntries(mergedEntries, mergedDeletedMap);
          const changed = stableStringify(localState.rawEntries) !== stableStringify(mergedEntries)
            || stableStringify(localState.settings) !== stableStringify(mergedSettings)
            || stableStringify(normalizeDeletedMap(localState.deletedMap)) !== stableStringify(nextDeletedMap);
          const appliedDeletionCount = Object.keys(localState.rawEntries).filter((id) => !mergedEntries[id] && nextDeletedMap[id]).length;

          if (changed) {
            await persistFallbackLocalState(mergedEntries, mergedSettings, nextDeletedMap);
          }

          return {
            changed,
            entryCount: Object.keys(mergedEntries).length,
            entries: mergedEntries,
            settings: mergedSettings,
            deletedMap: nextDeletedMap,
            appliedDeletionCount
          };
        })();

    const shouldRepush = !syncState.partialRead && (applyResult.changed || syncState.needsMigration);
    if (shouldRepush && options.repush !== false) {
      const repushDelayMs = Math.max(0, Number(options.repushDelayMs ?? DEFAULT_REPUSH_DELAY_MS) || 0);
      if (repushDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, repushDelayMs));
      }
      await pushAll();
    }

    return {
      ok: true,
      changed: Boolean(applyResult.changed),
      entryCount: Number(applyResult.entryCount) || 0,
      partialRead: syncState.partialRead,
      missingShardKeys: syncState.missingShardKeys,
      malformedShardKeys: syncState.malformedShardKeys,
      needsMigration: syncState.needsMigration,
      appliedDeletionCount: Number(applyResult.appliedDeletionCount) || 0
    };
  }

  async function init() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
      const [localState, syncState] = await Promise.all([getLocalState(), getSyncState()]);
      const hasLocalEntries = Object.keys(localState.entries).length > 0;
      const hasSyncData = syncState.hasSyncData;

      if (hasLocalEntries && !hasSyncData) {
        return {
          ...(await pushAll()),
          mode: "push"
        };
      }

      if (!hasLocalEntries && hasSyncData) {
        return {
          ...(await pullAll({ repush: false })),
          mode: "pull"
        };
      }

      if (hasLocalEntries && hasSyncData) {
        return {
          ...(await pullAll({ repush: true })),
          mode: "merge"
        };
      }

      return {
        mode: "noop",
        ok: true,
        changed: false,
        entryCount: 0
      };
    })();

    try {
      return await initPromise;
    } finally {
      initPromise = null;
    }
  }

  async function pushEntry(id) {
    const normalizedId = cleanText(id);
    if (!normalizedId) {
      return pushAll();
    }

    const [localState, syncState] = await Promise.all([getLocalState(), getSyncState()]);
    const syncLanguagesChanged = stableStringify(syncState.settings?.l || []) !== stableStringify(localState.settings.syncLanguages);

    if (!syncState.hasSyncData || syncState.partialRead || syncState.needsMigration || syncState.extraShardKeys?.length || syncLanguagesChanged) {
      return pushAll();
    }

    const shardRef = syncState.entryShardMap?.[normalizedId];
    if (!shardRef) {
      return pushAll();
    }

    const compactShards = cloneCompactShards(syncState.compactShards || []);
    const shard = compactShards[shardRef.shardIndex];
    if (!Array.isArray(shard) || !shard[shardRef.entryIndex] || shard[shardRef.entryIndex].i !== normalizedId) {
      return pushAll();
    }

    const nextCompactEntry = compactEntry(localState.entries[normalizedId], localState.settings.syncLanguages);
    const removeKeys = [];
    let nextShardCount = compactShards.length;

    if (nextCompactEntry) {
      shard[shardRef.entryIndex] = nextCompactEntry;
      if (getByteLength(shard) > SYNC_SHARD_SOFT_LIMIT || getSyncItemSize(shardRef.key, shard) > SYNC_ITEM_HARD_LIMIT) {
        return pushAll();
      }
    } else if (shard.length > 1) {
      shard.splice(shardRef.entryIndex, 1);
    } else if (shardRef.shardIndex === compactShards.length - 1) {
      compactShards.pop();
      nextShardCount -= 1;
      removeKeys.push(shardRef.key);
    } else {
      return pushAll();
    }

    const payload = {
      ...buildMetadataPayload(localState.settings, nextShardCount)
    };

    if (compactShards[shardRef.shardIndex]) {
      payload[shardRef.key] = await compressShard(compactShards[shardRef.shardIndex]);
    }

    const writeResult = await writeSyncPayload(payload, {
      currentData: syncState.data,
      removeKeys
    });

    return {
      ...writeResult,
      entryCount: Object.keys(localState.entries).length,
      shardCount: nextShardCount,
      mode: writeResult.ok ? "entry" : "entry-failed",
      entryId: normalizedId,
      shardIndex: shardRef.shardIndex
    };
  }

  async function pushSettings() {
    const [localState, syncState] = await Promise.all([getLocalState(), getSyncState()]);
    const syncLanguagesChanged = stableStringify(syncState.settings?.l || []) !== stableStringify(localState.settings.syncLanguages);

    if (!syncState.hasSyncData || syncState.partialRead || syncState.needsMigration || syncState.extraShardKeys?.length || syncLanguagesChanged) {
      return pushAll();
    }

    const shardCount = syncState.compactShards?.length || 0;
    const payload = buildMetadataPayload(localState.settings, shardCount);
    const writeResult = await writeSyncPayload(payload, {
      currentData: syncState.data
    });

    return {
      ...writeResult,
      entryCount: Object.keys(localState.entries).length,
      shardCount,
      mode: writeResult.ok ? "settings" : "settings-failed"
    };
  }

  function destroy() {
    initPromise = null;
  }

  /* ------------------------------------------------------------------ */
  /*  Sync usage statistics (for the popup capacity bar)                  */
  /* ------------------------------------------------------------------ */

  async function inspectSyncStorage() {
    try {
      const syncState = await getSyncState();
      const lodVaultKeys = getLodVaultSyncKeys(syncState.data || {});
      const lodVaultData = lodVaultKeys.reduce((result, key) => {
        result[key] = syncState.data[key];
        return result;
      }, {});
      const measuredTotalBytesUsed = await getActualSyncBytesInUse(null);
      const measuredVaultBytesUsed = lodVaultKeys.length
        ? await getActualSyncBytesInUse(lodVaultKeys)
        : 0;
      const bytesUsedTotal = Number.isFinite(measuredTotalBytesUsed)
        ? measuredTotalBytesUsed
        : estimateSyncWriteSize(syncState.data || {});
      const bytesUsedVault = Number.isFinite(measuredVaultBytesUsed)
        ? measuredVaultBytesUsed
        : estimateSyncWriteSize(lodVaultData);
      const bytesUsedOther = Math.max(0, bytesUsedTotal - bytesUsedVault);
      const itemCountTotal = Object.keys(syncState.data || {}).length;
      const itemCountVault = lodVaultKeys.length;
      const itemCountOther = Math.max(0, itemCountTotal - itemCountVault);
      const itemCountRemaining = Math.max(0, SYNC_MAX_ITEMS - itemCountTotal);
      const shardCount = syncState.shardKeys?.length || 0;
      const entryCount = Array.isArray(syncState.entries) ? syncState.entries.length : 0;
      const bytesRemaining = Math.max(0, SYNC_TOTAL_HARD_LIMIT - bytesUsedTotal);
      const percentUsed = Math.min(100, Math.round((bytesUsedTotal / SYNC_TOTAL_HARD_LIMIT) * 100));
      const capacityByCount = { 1: 990, 2: 830, 3: 700 };
      const langCount = Array.isArray(syncState.manifest?.l) ? syncState.manifest.l.length : 3;

      let estimatedRemaining = capacityByCount[Math.min(langCount, 3)] || 700;
      if (entryCount > 0 && bytesUsedVault > 0) {
        const avgBytesPerEntry = bytesUsedVault / entryCount;
        estimatedRemaining = Math.floor(bytesRemaining / Math.max(1, avgBytesPerEntry));
      }

      return {
        ok: true,
        hasSyncData: Boolean(syncState.hasSyncData),
        hasSyncWords: entryCount > 0 || shardCount > 0,
        partialRead: Boolean(syncState.partialRead),
        needsMigration: Boolean(syncState.needsMigration),
        bytesUsed: bytesUsedTotal,
        bytesUsedTotal,
        bytesUsedVault,
        bytesUsedOther,
        bytesTotal: SYNC_TOTAL_HARD_LIMIT,
        bytesRemaining,
        percentUsed,
        entryCount,
        shardCount,
        estimatedRemaining,
        itemCountTotal,
        itemCountVault,
        itemCountOther,
        itemCountRemaining,
        maxItemsTotal: SYNC_MAX_ITEMS
      };
    } catch (error) {
      console.warn("[LODVault] Could not inspect sync storage.", error);
      return {
        ok: false,
        reason: "inspect-failed",
        hasSyncData: false,
        hasSyncWords: false,
        partialRead: false,
        needsMigration: false,
        bytesUsed: Number.NaN,
        bytesUsedTotal: Number.NaN,
        bytesUsedVault: Number.NaN,
        bytesUsedOther: Number.NaN,
        bytesTotal: SYNC_TOTAL_HARD_LIMIT,
        bytesRemaining: Number.NaN,
        percentUsed: Number.NaN,
        entryCount: Number.NaN,
        shardCount: Number.NaN,
        estimatedRemaining: Number.NaN,
        itemCountTotal: Number.NaN,
        itemCountVault: Number.NaN,
        itemCountOther: Number.NaN,
        itemCountRemaining: Number.NaN,
        maxItemsTotal: SYNC_MAX_ITEMS
      };
    }
  }

  async function getSyncUsageStats() {
    return inspectSyncStorage();
  }

  globalThis.LodVaultSync = {
    SYNC_FORMAT_VERSION,
    SYNC_MANIFEST_KEY,
    SYNC_SETTINGS_KEY,
    SYNC_DELETED_KEY,
    SYNC_ENTRY_PREFIX,
    SYNC_SHARD_SOFT_LIMIT,
    SYNC_ITEM_HARD_LIMIT,
    SYNC_TOTAL_HARD_LIMIT,
    SYNC_MAX_ITEMS,
    stableStringify,
    compactEntry,
    expandEntry,
    expandTranslations,
    shardEntries,
    mergeEntryMaps,
    inspectSyncStorage,
    getSyncUsageStats,
    SyncAdapter: {
      init,
      pushAll,
      pullAll,
      pushEntry,
      pushSettings,
      destroy
    }
  };
})();


// ── sync-coordinator.js ──────────────────────────────────────────────
(() => {
  function createSyncCoordinator(options = {}) {
    const store = options.store || globalThis.LodVaultStore || {};
    const syncNamespace = options.syncNamespace || globalThis.LodVaultSync || {};
    const syncAdapter = options.syncAdapter || syncNamespace.SyncAdapter || {};
    const logger = options.logger || console;
    const pushDebounceMs = Math.max(0, Number(options.pushDebounceMs ?? globalThis.__LOD_SYNC_PUSH_DEBOUNCE_MS__ ?? 2000) || 0);
    const suppressWindowMs = Math.max(pushDebounceMs * 2, 50);
    const localSyncKeys = new Set([
      store.STORAGE_KEY || "lodVault.entries",
      store.SETTINGS_KEY || "lodVault.settings",
      store.DELETED_KEY || "lodVault.deleted"
    ]);
    const syncManifestKey = syncNamespace.SYNC_MANIFEST_KEY || "lodVault.m";
    const syncSettingsKey = syncNamespace.SYNC_SETTINGS_KEY || "lodVault.s";
    const syncDeletedKey = syncNamespace.SYNC_DELETED_KEY || "lodVault.d";
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
        || key === syncDeletedKey
        || key.startsWith(syncEntryPrefix)
      ));
    }

    function stableStringify(value) {
      if (typeof syncNamespace.stableStringify === "function") {
        try { return syncNamespace.stableStringify(value); } catch (_error) { /* fall through */ }
      }
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
      return null;
    }

    function describeLocalPushPlan(changes) {
      const entryChange = changes?.[store.STORAGE_KEY || "lodVault.entries"];
      const settingsChange = changes?.[store.SETTINGS_KEY || "lodVault.settings"];
      const deletedChange = changes?.[store.DELETED_KEY || "lodVault.deleted"];
      const settingsKind = getSettingsChangeKind(settingsChange);

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


// ── background-impl.js ───────────────────────────────────
const LOD_URL_PATTERNS = ["https://lod.lu/*", "https://www.lod.lu/*"];
const LENS_CONTEXT_MENU_ID = "lodvault-open-lens";
const LENS_COMMAND_ID = "open-lod-lens";
const OPEN_LENS_OVERLAY_MESSAGE_TYPE = "lodvault:open-lens-overlay";
const LENS_PROXY_MESSAGE_TYPE = "lodvault:lens-fetch";
const LENS_PROXY_ALLOWED_ORIGIN = "https://lod.lu";
const LENS_PROXY_ALLOWED_LOCALE = "lb";
const LENS_PROXY_SEARCH_PATH = `/api/${LENS_PROXY_ALLOWED_LOCALE}/search`;
const LENS_PROXY_SUGGEST_PATH = `/api/${LENS_PROXY_ALLOWED_LOCALE}/suggest`;
const LENS_PROXY_ENTRY_PREFIX = `/api/${LENS_PROXY_ALLOWED_LOCALE}/entry/`;
const LENS_SCRIPT_FILES = [
  "scripts/store-core.js",
  "scripts/entry-presenter.js",
  "scripts/shared.js",
  "scripts/lens-lookup.js",
  "scripts/lens-session.js",
  "scripts/lens-render.js",
  "scripts/lens-overlay-shell.js",
  "scripts/lens-sentence-mode.js",
  "scripts/lens-overlay-controller.js",
  "scripts/lens-runtime.js"
];
const STORE_MUTATION_MESSAGE_TYPE = LodVaultStore.STORE_MUTATION_MESSAGE_TYPE;
const STORE_MUTATION_METHODS = new Set([
  "setAutoMode",
  "setSyncLanguages",
  "toggleList",
  "recordAutoVisit",
  "removeFromHistory",
  "refreshEntryData",
  "saveNote",
  "removeEntry",
  "markPortableBackupExported",
  "importJson",
  "importBrowserHistory",
  "recordFlashcardReview",
  "getFlashcardStats"
]);

let storeMutationQueue = Promise.resolve();
let historyHydrationResumeTimer = null;

const syncCoordinator = LodVaultSyncCoordinator.createSyncCoordinator({
  store: LodVaultStore,
  syncNamespace: LodVaultSync,
  syncAdapter: LodVaultSync.SyncAdapter,
  logger: console,
  pushDebounceMs: globalThis.__LOD_SYNC_PUSH_DEBOUNCE_MS__
});

function enqueueStoreMutation(task) {
  const result = storeMutationQueue.then(task, task);
  storeMutationQueue = result.catch(() => {});
  return result;
}

function scheduleHistoryHydrationResume(delayMs = 0) {
  if (historyHydrationResumeTimer) {
    clearTimeout(historyHydrationResumeTimer);
  }

  historyHydrationResumeTimer = setTimeout(() => {
    historyHydrationResumeTimer = null;
    LodVaultStore.resumeHistoryImportHydration?.().catch?.(() => {});
  }, Math.max(0, Number(delayMs) || 0));
}

function sanitizeLensQuery(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasOnlyAllowedSearchParams(searchParams, allowedKeys) {
  return [...new Set(searchParams.keys())].every((key) => allowedKeys.has(key));
}

function isAllowedLensEntryPath(pathname) {
  if (!String(pathname || "").startsWith(LENS_PROXY_ENTRY_PREFIX)) {
    return false;
  }

  const rawEntryId = pathname.slice(LENS_PROXY_ENTRY_PREFIX.length);
  if (!rawEntryId || /%2f|%5c/i.test(rawEntryId)) {
    return false;
  }

  let decodedEntryId = "";
  try {
    decodedEntryId = decodeURIComponent(rawEntryId);
  } catch {
    return false;
  }

  return Boolean(decodedEntryId)
    && !decodedEntryId.includes("/")
    && !decodedEntryId.includes("\\");
}

function validateLensProxyUrl(value) {
  const candidate = String(value || "").trim();
  let parsed = null;

  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Invalid LOD Lens request URL.");
  }

  if (
    parsed.protocol !== "https:"
    || parsed.origin !== LENS_PROXY_ALLOWED_ORIGIN
    || parsed.username
    || parsed.password
    || parsed.hash
  ) {
    throw new Error("Blocked unauthorized LOD Lens request URL.");
  }

  if (parsed.pathname === LENS_PROXY_SEARCH_PATH) {
    if (!hasOnlyAllowedSearchParams(parsed.searchParams, new Set(["lang", "query"]))) {
      throw new Error("Blocked unauthorized LOD Lens request URL.");
    }

    const lang = sanitizeLensQuery(parsed.searchParams.get("lang"));
    const query = sanitizeLensQuery(parsed.searchParams.get("query"));
    if (lang !== LENS_PROXY_ALLOWED_LOCALE || !query) {
      throw new Error("Blocked unauthorized LOD Lens request URL.");
    }

    parsed.search = `?lang=${encodeURIComponent(LENS_PROXY_ALLOWED_LOCALE)}&query=${encodeURIComponent(query)}`;
    return parsed.toString();
  }

  if (parsed.pathname === LENS_PROXY_SUGGEST_PATH) {
    if (!hasOnlyAllowedSearchParams(parsed.searchParams, new Set(["query"]))) {
      throw new Error("Blocked unauthorized LOD Lens request URL.");
    }

    const query = sanitizeLensQuery(parsed.searchParams.get("query"));
    if (!query) {
      throw new Error("Blocked unauthorized LOD Lens request URL.");
    }

    parsed.search = `?query=${encodeURIComponent(query)}`;
    return parsed.toString();
  }

  if (isAllowedLensEntryPath(parsed.pathname)) {
    if ([...new Set(parsed.searchParams.keys())].length > 0) {
      throw new Error("Blocked unauthorized LOD Lens request URL.");
    }

    return parsed.toString();
  }

  throw new Error("Blocked unauthorized LOD Lens request URL.");
}

function getTabOriginPattern(tabUrl) {
  let parsed = null;

  try {
    parsed = new URL(String(tabUrl || ""));
  } catch {
    return "";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "";
  }

  return `${parsed.origin}/*`;
}

async function getTabUrl(tabId, fallbackUrl = "") {
  if (fallbackUrl) {
    return String(fallbackUrl);
  }

  if (!tabId || typeof chrome.tabs?.get !== "function") {
    return "";
  }

  try {
    return String((await chrome.tabs.get(tabId))?.url || "");
  } catch {
    return "";
  }
}

async function hasLensSitePermission(tabUrl) {
  const originPattern = getTabOriginPattern(tabUrl);
  if (!originPattern || typeof chrome.permissions?.contains !== "function") {
    return false;
  }

  try {
    return Boolean(await chrome.permissions.contains({ origins: [originPattern] }));
  } catch {
    return false;
  }
}

async function requestLensSitePermission(tabUrl) {
  const originPattern = getTabOriginPattern(tabUrl);
  if (!originPattern || typeof chrome.permissions?.request !== "function") {
    return false;
  }

  try {
    return Boolean(await chrome.permissions.request({ origins: [originPattern] }));
  } catch {
    return false;
  }
}

async function getActiveSelectionText(tabId) {
  const resolvedTabId = typeof tabId === "number"
    ? tabId
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;

  if (!resolvedTabId || !chrome.scripting?.executeScript) {
    return "";
  }

  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: resolvedTabId },
      func: () => window.getSelection?.()?.toString?.() || ""
    });
    return sanitizeLensQuery(result);
  } catch (_error) {
    return "";
  }
}

async function isLensOverlayInjected(tabId) {
  if (!tabId || !chrome.scripting?.executeScript) {
    return false;
  }

  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(globalThis.LodVaultLensRuntime?.openFromSelection)
    });
    return Boolean(result);
  } catch {
    return false;
  }
}

async function ensureLensOverlayInjected(tabId) {
  if (await isLensOverlayInjected(tabId)) {
    return;
  }

  await chrome.scripting.insertCSS?.({
    target: { tabId },
    files: ["styles/lens-overlay.css"]
  }).catch(() => {});

  await chrome.scripting.executeScript({
    target: { tabId },
    files: LENS_SCRIPT_FILES
  });
}

async function openLensOverlay(tabId, selectionText = "", { tabUrl = "", requestSitePermission = false } = {}) {
  if (!tabId || !chrome.scripting?.executeScript) {
    throw new Error("Cannot open lens overlay without a tab id.");
  }

  const resolvedTabUrl = requestSitePermission
    ? await getTabUrl(tabId, tabUrl)
    : String(tabUrl || "");

  if (requestSitePermission && resolvedTabUrl && !(await hasLensSitePermission(resolvedTabUrl))) {
    const granted = await requestLensSitePermission(resolvedTabUrl);
    if (!granted) {
      throw new Error("LODVault needs site access to open Lens on this page.");
    }
  }

  await ensureLensOverlayInjected(tabId);

  await chrome.scripting.executeScript({
    target: { tabId },
    func: (text) => {
      globalThis.LodVaultLensRuntime?.openFromSelection?.(text);
    },
    args: [sanitizeLensQuery(selectionText)]
  });
}

function registerContextMenus() {
  if (!chrome.contextMenus?.create) return;

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: LENS_CONTEXT_MENU_ID,
      title: "Translate with LODVault",
      contexts: ["selection"]
    }, () => {
      void chrome.runtime?.lastError;
    });
  });
}

async function reloadLodTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: LOD_URL_PATTERNS });
    await Promise.all(
      tabs
        .filter((tab) => typeof tab.id === "number")
        .map((tab) => chrome.tabs.reload(tab.id))
    );
  } catch (_error) {
    // Ignore tab reload failures.
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "update" || details.reason === "install") {
    registerContextMenus();
    reloadLodTabs();
    syncCoordinator.handleInstalled("onInstalled");
    scheduleHistoryHydrationResume(50);
  }
});

chrome.runtime.onStartup?.addListener(() => {
  registerContextMenus();
  syncCoordinator.handleStartup("onStartup");
  scheduleHistoryHydrationResume(50);
});

chrome.contextMenus?.onClicked?.addListener((info, tab) => {
  if (info.menuItemId !== LENS_CONTEXT_MENU_ID) return;
  if (!tab?.id) return;
  openLensOverlay(tab.id, info.selectionText || "", {
    tabUrl: tab.url || ""
  }).catch(() => {});
});

chrome.commands?.onCommand?.addListener(async (command) => {
  if (command !== LENS_COMMAND_ID) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const selectionText = await getActiveSelectionText(tab.id);
    await openLensOverlay(tab.id, selectionText, {
      tabUrl: tab.url || ""
    });
  } catch (_error) {
    // Ignore lens overlay failures.
  }
});

chrome.storage.onChanged?.addListener((changes, areaName) => {
  syncCoordinator.handleStorageChanged(changes, areaName);
  if (areaName === "local" && Object.prototype.hasOwnProperty.call(changes || {}, LodVaultStore.HISTORY_IMPORT_STATE_KEY || "lodVault.historyImport")) {
    scheduleHistoryHydrationResume(25);
  }
});

scheduleHistoryHydrationResume(50);
registerContextMenus();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === OPEN_LENS_OVERLAY_MESSAGE_TYPE) {
    const tabId = sender?.tab?.id;

    if (!tabId) {
      sendResponse({ ok: false, error: "Cannot open LOD Lens without a tab id." });
      return;
    }

    openLensOverlay(tabId, message.selectionText || "", {
      tabUrl: sender?.tab?.url || "",
      requestSitePermission: true
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({
        ok: false,
        error: error?.message || String(error)
      }));

    return true;
  }

  if (message?.type === LENS_PROXY_MESSAGE_TYPE) {
    let requestUrl = "";

    try {
      requestUrl = validateLensProxyUrl(message.url);
    } catch (error) {
      sendResponse({
        ok: false,
        status: 400,
        error: error?.message || String(error)
      });
      return;
    }

    fetch(requestUrl, {
      method: "GET",
      headers: { Accept: "application/json" }
    })
      .then(async (response) => {
        const text = await response.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }

        sendResponse({
          ok: response.ok,
          status: response.status,
          json,
          text
        });
      })
      .catch((error) => sendResponse({
        ok: false,
        status: 0,
        error: error?.message || String(error)
      }));

    return true;
  }

  if (message?.type !== STORE_MUTATION_MESSAGE_TYPE) return;

  const method = String(message.method || "");
  const args = Array.isArray(message.args) ? message.args : [];

  if (!STORE_MUTATION_METHODS.has(method) || typeof LodVaultStore?.[method] !== "function") {
    sendResponse({ ok: false, error: `Unsupported store mutation: ${method}` });
    return;
  }

  enqueueStoreMutation(() => LodVaultStore[method](...args))
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));

  return true;
});
