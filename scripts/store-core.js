(() => {
  const STORAGE_KEY = "lodVault.entries";
  const LEGACY_STORAGE_KEY = "lodWrapper.entries";
  const SETTINGS_KEY = "lodVault.settings";
  const PORTABLE_BACKUP_KEY = "lodVault.portableBackup";
  const DELETED_KEY = "lodVault.deleted";
  const HISTORY_IMPORT_STATE_KEY = "lodVault.historyImport";
  const HISTORY_REPAIR_ATTEMPTS_KEY = "lodVault.historyRepairAttempts";
  const SYNC_ISSUE_KEY = "lodVault.syncIssue";
  const DEFAULT_SETTINGS = {
    autoMode: false,
    syncLanguages: ["en", "fr", "de"],
    lastVerifiedSyncAt: ""
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
  const HISTORY_REPAIR_MAX_ATTEMPTS = 5;
  const HISTORY_REPAIR_RETRY_MS = 24 * 60 * 60 * 1000;

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

  const HTML_NAMED_ENTITIES = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: "\u00a0", quot: '"' };

  // Renderers still escape this decoded dictionary text.
  function decodeHtmlEntities(value) {
    if (typeof value !== "string") return "";
    return value.replace(/&#x([0-9a-f]+);|&#(\d+);|&(amp|apos|gt|lt|nbsp|quot);/gi, (entity, hex, decimal, name) => {
      if (name) return HTML_NAMED_ENTITIES[name.toLowerCase()];
      const codePoint = Number.parseInt(hex || decimal, hex ? 16 : 10);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    });
  }

  function cleanDictionaryText(value) {
    return cleanText(decodeHtmlEntities(value));
  }

  function cleanWordLabel(value) {
    return cleanDictionaryText(value)
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
      const cleaned = cleanDictionaryText(value);
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

  function normalizeSyncVerificationTimestamp(value) {
    const timestamp = Date.parse(cleanText(value));
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
  }

  function normalizeSettings(settings = {}) {
    return {
      ...DEFAULT_SETTINGS,
      autoMode: Boolean(settings?.autoMode),
      syncLanguages: normalizeSyncLanguages(settings?.syncLanguages),
      lastVerifiedSyncAt: normalizeSyncVerificationTimestamp(settings?.lastVerifiedSyncAt)
    };
  }

  function normalizePortableBackupMeta(value = {}) {
    const lastExportedAt = cleanText(value?.lastExportedAt);
    const timestamp = Date.parse(lastExportedAt);

    return {
      lastExportedAt: Number.isFinite(timestamp)
        ? new Date(timestamp).toISOString()
        : "",
      entryCount: Math.max(0, Number(value?.entryCount) || 0),
      reviewCount: Math.max(0, Number(value?.reviewCount) || 0)
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
    const noteUpdatedAt = cleanText(entry.noteUpdatedAt);
    const listsUpdatedAt = cleanText(entry.listsUpdatedAt);
    return {
      id,
      word: cleanWordLabel(entry.word),
      url: cleanText(entry.url),
      pos: cleanDictionaryText(entry.pos),
      inflection: cleanDictionaryText(entry.inflection),
      example: cleanDictionaryText(entry.example),
      note: cleanText(entry.note),
      translations: cleanTranslations(entry.translations),
      favorite: Boolean(entry.favorite),
      study: Boolean(entry.study),
      history: Boolean(entry.history),
      visitCount: normalizeVisitCount(entry.visitCount),
      lastVisitedAt: cleanText(entry.lastVisitedAt),
      createdAt: cleanText(entry.createdAt),
      updatedAt: cleanText(entry.updatedAt),
      ...(noteUpdatedAt ? { noteUpdatedAt } : {}),
      ...(listsUpdatedAt ? { listsUpdatedAt } : {})
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
      // A caller's entry can predate a note edit or clear, so it only supplies
      // the note for a word the vault doesn't have yet.
      note: current.id ? current.note : next.note,
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

    const noteUpdatedAt = current.noteUpdatedAt || next.noteUpdatedAt;
    if (noteUpdatedAt) merged.noteUpdatedAt = noteUpdatedAt;
    const listsUpdatedAt = current.listsUpdatedAt || next.listsUpdatedAt;
    if (listsUpdatedAt) merged.listsUpdatedAt = listsUpdatedAt;

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

  async function markSyncVerifiedDirect(timestamp = nowIso()) {
    return runVaultIo(async () => {
      const nextSettings = normalizeSettings({
        ...(await getSettings()),
        lastVerifiedSyncAt: timestamp
      });

      await persistVaultState({ settings: nextSettings });
      return nextSettings.lastVerifiedSyncAt;
    });
  }

  async function markSyncVerified(timestamp) {
    return runStoreMutation("markSyncVerified", [timestamp], markSyncVerifiedDirect);
  }

  function describeListAction(entry, listName, savedEntry) {
    const word = cleanWordLabel(entry?.word) || "Word";
    const listLabel = listName === "study" ? "Study" : "Favorites";

    if (!entry?.[listName]) {
      return `Added ${word} to ${listLabel}.`;
    }

    return savedEntry ? `Removed ${word} from ${listLabel}.` : `Removed ${word} from your vault.`;
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

  async function changeListMembership(entry, listName, toggle) {
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
      merged[listName] = toggle ? !merged[listName] : true;
      merged.listsUpdatedAt = nowIso();

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
    return runStoreMutation("toggleList", [entry, listName], () => changeListMembership(entry, listName, true));
  }

  // An explicit Save must never toggle an existing membership off, including
  // when another popup or tab saves the same canonical article concurrently.
  async function addToList(entry, listName) {
    return runStoreMutation("addToList", [entry, listName], () => changeListMembership(entry, listName, false));
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
      // A repeat visit changes no list, so it must not outrank a removal made
      // on another device.
      if (!existing?.study || !existing?.history) {
        merged.listsUpdatedAt = nowIso();
      }
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
      merged.listsUpdatedAt = nowIso();
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
      merged.noteUpdatedAt = nowIso();
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

  async function restoreEntryDirect(entry) {
    return runVaultIo(async () => {
      const restored = normalizeEntry(entry);
      if (!restored.id || !restored.word || !shouldKeepEntry(restored)) {
        throw new Error("Cannot restore an empty entry.");
      }

      const [entryMap, deletedMap] = await Promise.all([
        getEntryMap(),
        getDeletedMap()
      ]);
      restored.updatedAt = nowIso();
      restored.listsUpdatedAt = restored.updatedAt;
      restored.createdAt = restored.createdAt || restored.updatedAt;
      entryMap[restored.id] = restored;
      delete deletedMap[restored.id];
      await persistVaultState({ entryMap, deletedMap });
      return normalizeEntry(restored);
    });
  }

  async function restoreEntry(entry) {
    return runStoreMutation("restoreEntry", [entry], restoreEntryDirect);
  }

  async function markPortableBackupExportedDirect(summary = {}) {
    const nextMeta = normalizePortableBackupMeta({
      lastExportedAt: nowIso(),
      entryCount: summary?.entryCount,
      reviewCount: summary?.reviewCount
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

  function normalizeFlashcardMetaMap(rawMap) {
    const result = {};
    if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
      return result;
    }
    for (const [id, value] of Object.entries(rawMap)) {
      const cleanId = cleanText(id);
      if (!cleanId || !value || typeof value !== "object" || Array.isArray(value)) continue;
      result[cleanId] = normalizeFlashcardMeta(value);
    }
    return result;
  }

  function mergeFlashcardMetaRecord(existing, incoming) {
    if (!existing) return incoming;
    if (!incoming) return existing;
    if (incoming.totalReviews !== existing.totalReviews) {
      return incoming.totalReviews > existing.totalReviews ? incoming : existing;
    }
    const existingTime = Date.parse(existing.lastReviewedAt) || 0;
    const incomingTime = Date.parse(incoming.lastReviewedAt) || 0;
    return incomingTime > existingTime ? incoming : existing;
  }

  function mergeFlashcardMetaMaps(currentMap, incomingMap) {
    const merged = { ...currentMap };
    for (const [id, incoming] of Object.entries(incomingMap)) {
      merged[id] = mergeFlashcardMetaRecord(merged[id], incoming);
    }
    return merged;
  }

  function buildJsonExport(entries, options = {}) {
    const normalizedSettings = normalizeSettings(options.settings || DEFAULT_SETTINGS);
    const settings = {
      autoMode: normalizedSettings.autoMode,
      syncLanguages: normalizedSettings.syncLanguages
    };
    const flashcardMeta = normalizeFlashcardMetaMap(options.flashcardMeta);
    return JSON.stringify(
      {
        app: "lodvault",
        version: EXPORT_VERSION,
        exportedAt: nowIso(),
        settings,
        entries: entries.map(normalizeEntry),
        flashcardMeta
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
    if (!Array.isArray(parsed.entries)) {
      throw new Error("Invalid JSON import format.");
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
      let newCount = 0;
      let mergeCount = 0;
      let restoreCount = 0;

      for (const rawEntry of incomingEntries) {
        const incoming = normalizeEntry(rawEntry);
        if (!incoming.id || !incoming.word) continue;
        if (!shouldKeepEntry(incoming)) continue;

        const existing = entryMap[incoming.id];
        if (existing) {
          mergeCount += 1;
        } else if (deletedMap[incoming.id]) {
          restoreCount += 1;
        } else {
          newCount += 1;
        }
        const previous = normalizeEntry(existing || {});
        const merged = mergeEntry(existing, incoming);
        merged.favorite = Boolean(existing?.favorite) || Boolean(incoming.favorite);
        merged.study = Boolean(existing?.study) || Boolean(incoming.study);
        merged.history = Boolean(existing?.history) || Boolean(incoming.history);
        merged.visitCount = merged.history
          ? Math.max(normalizeVisitCount(existing?.visitCount), normalizeVisitCount(incoming.visitCount), 1)
          : 0;
        merged.lastVisitedAt = incoming.lastVisitedAt || cleanText(existing?.lastVisitedAt);
        merged.note = incoming.note || merged.note;

        // A restore is a new change, so it has to outrank older copies on
        // other devices when it next syncs.
        if (merged.note !== previous.note) {
          merged.noteUpdatedAt = nowIso();
        }
        if (["favorite", "study", "history"].some((flag) => merged[flag] !== Boolean(previous[flag]))) {
          merged.listsUpdatedAt = nowIso();
        }

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

      const incomingFlashcardMeta = normalizeFlashcardMetaMap(
        !Array.isArray(parsed) && parsed && typeof parsed === "object" ? parsed.flashcardMeta : null
      );

      try {
        await persistVaultState({
          entryMap,
          settings: importedSettings ? effectiveSettings : null,
          deletedMap
        });
        if (Object.keys(incomingFlashcardMeta).length) {
          const currentFlashcardMeta = await getFlashcardMeta();
          await saveFlashcardMeta(mergeFlashcardMetaMaps(currentFlashcardMeta, incomingFlashcardMeta));
        }
      } catch (error) {
        invalidateStoreCache({ entryMap: false, settings: true });
        if (isExtensionContextInvalidated(error)) {
          throw createRefreshPageError();
        }
        throw error;
      }

      return { imported, total: countStoredEntries(entryMap), newCount, mergeCount, restoreCount };
    });
  }

  async function importJson(text) {
    return runStoreMutation("importJson", [text], importJsonDirect);
  }

  // Non-mutating snapshot of the entry map and deleted map exactly as
  // importJson would see them, without running the migration/normalization
  // persistence that getEntryMap() performs. Used by the restore preview so
  // that selecting a file never writes to storage.
  async function readPreviewVaultSnapshot() {
    const data = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY, DELETED_KEY]);
    const current = data[STORAGE_KEY] && typeof data[STORAGE_KEY] === "object" ? data[STORAGE_KEY] : {};
    const legacy = data[LEGACY_STORAGE_KEY] && typeof data[LEGACY_STORAGE_KEY] === "object" ? data[LEGACY_STORAGE_KEY] : null;
    const combined = legacy ? { ...legacy, ...current } : current;
    const { entryMap: sanitized } = sanitizeEntryMapWithMeta(combined);
    const deletedMap = normalizeDeletedMap(data[DELETED_KEY] || {});

    return {
      entryMap: applyDeletedMap(sanitized, deletedMap),
      deletedMap
    };
  }

  // Read-only preview of what importJson would change. Parses and validates
  // the file, then categorizes the entries against the local vault without
  // writing anything to storage. Used by the popup restore flow to show the
  // user what a merge would do before they confirm it.
  async function previewJsonImportDirect(text) {
    const parsed = JSON.parse(text);
    validateImportPayload(parsed);

    const isObjectExport = !Array.isArray(parsed) && parsed && typeof parsed === "object";
    const incomingEntries = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.entries)
        ? parsed.entries
        : [];
    const importedSettings = getImportedSettings(parsed);
    const incomingFlashcardMeta = normalizeFlashcardMetaMap(
      isObjectExport ? parsed.flashcardMeta : null
    );
    const exportedAt = isObjectExport && typeof parsed.exportedAt === "string"
      && Number.isFinite(Date.parse(parsed.exportedAt))
      ? parsed.exportedAt
      : "";

    const { entryMap, deletedMap } = await readPreviewVaultSnapshot();

    const newIds = [];
    const mergeIds = [];
    const restoreIds = [];
    let skippedCount = 0;

    for (const rawEntry of incomingEntries) {
      const incoming = normalizeEntry(rawEntry);
      if (!incoming.id || !incoming.word || !shouldKeepEntry(incoming)) {
        skippedCount += 1;
        continue;
      }

      if (entryMap[incoming.id]) {
        mergeIds.push(incoming.id);
      } else if (deletedMap[incoming.id]) {
        restoreIds.push(incoming.id);
      } else {
        newIds.push(incoming.id);
      }

      // Mirror the import write in memory so duplicate ids in the same file
      // categorize the same way the real merge will.
      entryMap[incoming.id] = incoming;
      delete deletedMap[incoming.id];
    }

    return {
      exportedAt,
      entryCount: newIds.length + mergeIds.length + restoreIds.length,
      skippedCount,
      newIds,
      mergeIds,
      restoreIds,
      settings: importedSettings,
      hasFlashcardMeta: Object.keys(incomingFlashcardMeta).length > 0,
      flashcardCount: Object.keys(incomingFlashcardMeta).length
    };
  }

  async function previewJsonImport(text) {
    return previewJsonImportDirect(text);
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

  async function fetchForHydration(url, init = {}) {
    const controller = typeof AbortController !== "undefined"
      ? new AbortController()
      : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), HISTORY_HYDRATION_FETCH_TIMEOUT_MS)
      : null;

    try {
      return await fetch(url, {
        ...init,
        method: "GET",
        credentials: "omit",
        redirect: "follow",
        signal: controller?.signal
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }


  // Earlier versions hydrated history imports by regex-scraping article HTML,
  // which saved the article id as the word ("HAUS1") and mixed unrelated page
  // text, with its line breaks, into translations. Imports whose hydration
  // never ran keep the id-derived placeholder ("HAUS") with no part of speech.
  function isDamagedHistoryEntry(entry) {
    const normalized = normalizeEntry(entry);
    if (!normalized.id || !normalized.word) return false;

    const wordIsArticleId = normalized.word === normalized.id && /\d$/.test(normalized.id);
    const wordIsPlaceholder = !normalized.pos
      && normalized.word === normalized.id.replace(/\d+$/, "")
      && normalized.word === normalized.word.toUpperCase();
    const hasScrapedTranslations = Object.values(normalized.translations || {})
      .some((value) => /[\r\n]/.test(String(value)));

    return wordIsArticleId || wordIsPlaceholder || hasScrapedTranslations;
  }

  function shouldHydrateHistoryEntry(entry) {
    const normalized = normalizeEntry(entry);
    if (!normalized.id || !normalized.word || !shouldKeepEntry(normalized)) return false;
    if (!isLodArticleUrl(normalized.url)) return false;

    return isDamagedHistoryEntry(normalized)
      || !normalized.pos
      || !normalized.inflection
      || !normalized.example
      || Object.keys(normalized.translations || {}).length === 0;
  }

  function mergeHydratedHistoryEntry(existing, hydrated) {
    const merged = mergeEntry(existing, hydrated);
    if (isDamagedHistoryEntry(existing)) {
      // Merging would keep scraped text for any language the API doesn't return.
      merged.translations = normalizeEntry(hydrated).translations;
    }
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

  async function hydrateHistoryEntry(entry) {
    const normalized = normalizeEntry(entry);
    if (!shouldHydrateHistoryEntry(normalized)) return null;

    const lookup = globalThis.LodVaultLensLookup;
    if (typeof lookup?.fetchEntry !== "function") {
      throw new Error("LOD lookup is unavailable.");
    }

    const extracted = await lookup.fetchEntry(normalized.id, { fetch: fetchForHydration });
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

  async function getHistoryRepairAttempts() {
    const data = await chrome.storage.local.get([HISTORY_REPAIR_ATTEMPTS_KEY]);
    const attempts = data[HISTORY_REPAIR_ATTEMPTS_KEY];
    return attempts && typeof attempts === "object" ? attempts : {};
  }

  async function saveHistoryRepairAttempts(attempts) {
    if (Object.keys(attempts).length) {
      await chrome.storage.local.set({ [HISTORY_REPAIR_ATTEMPTS_KEY]: attempts });
    } else {
      await chrome.storage.local.remove(HISTORY_REPAIR_ATTEMPTS_KEY);
    }
  }

  function recordHistoryRepairOutcome(id, outcome) {
    return runVaultIo(async () => {
      const attempts = await getHistoryRepairAttempts();
      if (outcome === "repaired") {
        if (!attempts[id]) return;
        delete attempts[id];
      } else {
        attempts[id] = {
          attempts: outcome === "gave-up"
            ? HISTORY_REPAIR_MAX_ATTEMPTS
            : (Number(attempts[id]?.attempts) || 0) + 1,
          at: nowIso()
        };
      }
      await saveHistoryRepairAttempts(attempts);
    });
  }

  // A failure might be temporary, such as being offline at browser start, so
  // it gets a limited number of daily retries. A missing article, or a word
  // that still looks damaged after a good response, isn't worth asking about again.
  function canRetryHistoryRepair(record) {
    if (!record) return true;
    if ((Number(record.attempts) || 0) >= HISTORY_REPAIR_MAX_ATTEMPTS) return false;
    return !(Date.now() - Date.parse(record.at) < HISTORY_REPAIR_RETRY_MS);
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
        await runVaultIo(async () => {
          const latestState = await getHistoryImportState();
          await saveHistoryImportState({
            ...latestState,
            status: "running",
            currentId: nextId,
            updatedAt: nowIso()
          });
        });

        let hydrated = false;
        let repairOutcome = "";
        try {
          const [existingEntry, deletedMap] = await Promise.all([
            getEntry(nextId),
            getDeletedMap()
          ]);

          if (existingEntry && !deletedMap[nextId] && shouldHydrateHistoryEntry(existingEntry)) {
            const hydratedEntry = await hydrateHistoryEntry(existingEntry);
            hydrated = await runVaultIo(async () => {
              const [entryMap, latestDeletedMap] = await Promise.all([
                getEntryMap(),
                getDeletedMap()
              ]);
              const latestEntry = entryMap[nextId];
              if (!latestEntry || latestDeletedMap[nextId] || !shouldHydrateHistoryEntry(latestEntry)) {
                return false;
              }

              const repairedEntry = mergeHydratedHistoryEntry(latestEntry, hydratedEntry);
              entryMap[nextId] = repairedEntry;
              await persistVaultState({ entryMap, deletedMap: latestDeletedMap });
              repairOutcome = isDamagedHistoryEntry(repairedEntry) ? "gave-up" : "repaired";
              return true;
            });
          }
        } catch (error) {
          hydrated = false;
          repairOutcome = error?.status === 404 ? "gave-up" : "failed";
        }

        if (repairOutcome) {
          await recordHistoryRepairOutcome(nextId, repairOutcome);
        }

        const nextQueue = await runVaultIo(async () => {
          const latestState = await getHistoryImportState();
          let removed = false;
          const remainingQueue = latestState.queue.filter((id) => {
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
            status: remainingQueue.length ? "running" : "complete",
            currentId: "",
            updatedAt: nowIso(),
            hydrated: latestState.hydrated + (hydrated ? 1 : 0),
            failed: nextFailedIds.length,
            failedIds: nextFailedIds,
            queue: remainingQueue
          });
          return remainingQueue;
        });

        if (nextQueue.length) {
          await delay(HISTORY_HYDRATION_DELAY_MS);
        }
      }
    } finally {
      historyHydrationRunning = false;
    }
  }

  function queueDamagedHistoryEntries() {
    return runVaultIo(async () => {
      const [entryMap, deletedMap, state, attempts] = await Promise.all([
        getEntryMap(),
        getDeletedMap(),
        getHistoryImportState(),
        getHistoryRepairAttempts()
      ]);

      // Records only matter while a word is still damaged.
      const liveAttempts = Object.fromEntries(Object.entries(attempts).filter(
        ([id]) => entryMap[id] && !deletedMap[id] && isDamagedHistoryEntry(entryMap[id])
      ));
      if (Object.keys(liveAttempts).length !== Object.keys(attempts).length) {
        await saveHistoryRepairAttempts(liveAttempts);
      }

      const nextQueue = [...state.queue];
      for (const [id, entry] of Object.entries(entryMap)) {
        if (nextQueue.length >= HISTORY_HYDRATION_MAX_QUEUE) break;
        if (nextQueue.includes(id) || deletedMap[id]) continue;
        if (!canRetryHistoryRepair(liveAttempts[id])) continue;
        if (isDamagedHistoryEntry(entry) && shouldHydrateHistoryEntry(entry)) {
          nextQueue.push(id);
        }
      }

      const added = nextQueue.length - state.queue.length;
      if (!added) return 0;

      await saveHistoryImportState({
        ...state,
        status: historyHydrationRunning ? "running" : "queued",
        startedAt: state.startedAt || nowIso(),
        updatedAt: nowIso(),
        queued: state.queued + added,
        queue: nextQueue
      });
      return added;
    });
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

    // Lists and notes carry their own timestamps, so an unrelated update on a
    // device that missed a change can't undo it, while an explicit removal or
    // clear still sticks. When neither copy has a timestamp, as with data saved
    // before they existed, the union keeps everything. A timestamped copy beats
    // an untimestamped one: its updatedAt can't be used instead, because a page
    // visit bumps it too and would undo removals.
    const newerByField = (field) => {
      const primaryTime = Date.parse(primary[field]) || 0;
      const secondaryTime = Date.parse(secondary[field]) || 0;
      if (primaryTime === secondaryTime) return null;
      return secondaryTime > primaryTime ? secondary : primary;
    };
    const listsSource = newerByField("listsUpdatedAt");
    const noteSource = newerByField("noteUpdatedAt");
    // Both devices have to settle on the same note, whichever one is merging.
    const noteTied = !noteSource && primary.noteUpdatedAt && secondary.noteUpdatedAt;
    const flagFrom = (flag) => Boolean(listsSource ? listsSource[flag] : (primary[flag] || secondary[flag]));

    const hasHistory = flagFrom("history");
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
      note: noteSource
        ? noteSource.note
        : (noteTied
            ? [primary.note || "", secondary.note || ""].sort().pop()
            : (newest.note || primary.note || secondary.note)),
      translations: {
        ...(secondary.translations || {}),
        ...(primary.translations || {}),
        ...(newest.translations || {})
      },
      favorite: flagFrom("favorite"),
      study: flagFrom("study"),
      history: hasHistory,
      visitCount: hasHistory
        ? Math.max(normalizeVisitCount(primary.visitCount), normalizeVisitCount(secondary.visitCount), 1)
        : 0,
      lastVisitedAt: latestVisitedAt,
      createdAt: createdCandidates[0] || nowIso(),
      updatedAt: updatedCandidates[0] || nowIso()
    };

    if (noteSource) merged.noteUpdatedAt = noteSource.noteUpdatedAt;
    if (listsSource) merged.listsUpdatedAt = listsSource.listsUpdatedAt;

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
  const FLASHCARD_SETTINGS_KEY = "lodVault.flashcardSettings";
  const FLASHCARD_DAILY_TARGETS = [5, 10, 20];
  const FLASHCARD_DEFAULT_DAILY_TARGET = 10;
  const FLASHCARD_MAX_INTERVAL_DAYS = 365;

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

  function normalizeFlashcardDailyTarget(settings) {
    const target = settings?.dailyTarget;
    if (FLASHCARD_DAILY_TARGETS.includes(Number(target))) return Number(target);
    return target === null ? 0 : FLASHCARD_DEFAULT_DAILY_TARGET;
  }

  async function getFlashcardDailyTarget() {
    const data = await chrome.storage.local.get([FLASHCARD_SETTINGS_KEY]);
    return normalizeFlashcardDailyTarget(data[FLASHCARD_SETTINGS_KEY]);
  }

  function getLocalDayStart(value = new Date(), offsetDays = 0) {
    const day = new Date(value);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + offsetDays);
    return day;
  }

  // A card is due for the whole local day it falls on, including schedules
  // written with a time of day by older versions or in another time zone.
  function isFlashcardDue(card, now = new Date()) {
    const dueTime = Date.parse(card?.dueAt || "");
    return Number.isFinite(dueTime) && dueTime < getLocalDayStart(now, 1).getTime();
  }

  function computeFlashcardDueAt(existing, rating, now = new Date()) {
    const normalizedRating = [1, 2, 3].includes(Number(rating)) ? Number(rating) : 2;
    const previous = existing.interval || 0;
    const scheduled = previous > 0 && Number.isFinite(Date.parse(existing.dueAt || ""));

    // Practising ahead of schedule is not evidence the word can wait longer, so
    // only a Hard rating changes a card that isn't due yet.
    if (normalizedRating !== 1 && scheduled && !isFlashcardDue(existing, now)) {
      return { dueAt: existing.dueAt, interval: previous };
    }

    let interval = 1;
    if (normalizedRating === 2) {
      interval = previous ? Math.ceil(previous * 2) : 1;
    } else if (normalizedRating === 3) {
      interval = previous ? Math.ceil(previous * 2.5) : 2;
    }
    interval = Math.min(interval, FLASHCARD_MAX_INTERVAL_DAYS);

    return { dueAt: getLocalDayStart(now, interval).toISOString(), interval };
  }

  // Reviews are stored as UTC timestamps; days and streaks follow the learner's
  // own calendar. Bare YYYY-MM-DD values are already day keys.
  function toLocalDateKey(value = new Date()) {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  // Reviews are stored as UTC timestamps; days and streaks follow the learner's
  // own calendar. Bare YYYY-MM-DD values are already day keys.
  function toLocalDateKey(value = new Date()) {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function computeFlashcardStreak(sortedDescDates) {
    if (!sortedDescDates.length) return 0;
    const checkDate = new Date();
    checkDate.setHours(0, 0, 0, 0);

    // Today still counts as open: a streak only breaks once a whole day passes.
    const todayKey = toLocalDateKey(checkDate);
    if (!sortedDescDates.some((dateStr) => toLocalDateKey(dateStr) === todayKey)) {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    let streak = 0;

    for (const dateStr of sortedDescDates) {
      const dateKey = toLocalDateKey(dateStr);
      const checkKey = toLocalDateKey(checkDate);
      if (dateKey === checkKey) {
        streak += 1;
        checkDate.setDate(checkDate.getDate() - 1);
      } else if (dateKey > checkKey) {
        continue;
      } else {
        break;
      }
    }
    return streak;
  }

  // The one definition of "what should I study today", shared by the popup,
  // the flashcards page and the toolbar badge. Every due card comes first,
  // most overdue first. New Study-list words then fill what's left of the daily
  // target; a target of 0 means the learner turned it off.
  function buildTodayQueue(entries = [], meta = {}, options = {}) {
    const now = options.now || new Date();
    const dailyTarget = Math.max(0, Number(options.dailyTarget) || 0);
    const todayKey = toLocalDateKey(now);
    const due = [];
    const fresh = [];
    const reviewDays = new Set();
    let reviewedToday = 0;

    for (const card of Object.values(meta || {})) {
      for (const review of Array.isArray(card?.reviews) ? card.reviews : []) {
        const dateKey = toLocalDateKey(review?.date);
        if (!dateKey) continue;
        reviewDays.add(dateKey);
        if (dateKey === todayKey) reviewedToday += 1;
      }
    }

    for (const entry of entries) {
      const card = meta?.[entry?.id];
      if (card?.totalReviews) {
        if (isFlashcardDue(card, now)) due.push(entry);
      } else if (entry?.study) {
        fresh.push(entry);
      }
    }

    due.sort((left, right) => (
      (Date.parse(meta[left.id].dueAt) - Date.parse(meta[right.id].dueAt))
      || String(left.id).localeCompare(String(right.id))
    ));
    fresh.sort((left, right) => (
      (Date.parse(left.createdAt || "") || 0) - (Date.parse(right.createdAt || "") || 0)
      || String(left.id).localeCompare(String(right.id))
    ));

    const newSlots = dailyTarget
      ? Math.max(0, dailyTarget - reviewedToday - due.length)
      : fresh.length;
    const newEntries = fresh.slice(0, newSlots);

    return {
      dueEntries: due,
      newEntries,
      queue: [...due, ...newEntries],
      dueCount: due.length,
      newCount: newEntries.length,
      reviewedToday,
      streak: computeFlashcardStreak(Array.from(reviewDays).sort().reverse())
    };
  }

  async function recordFlashcardReviewDirect(entryId, rating, direction) {
    if (!entryId) throw new Error("Missing entry id.");
    return runVaultIo(async () => {
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
    });
  }

  function toWholeSeconds(iso) {
    const time = Date.parse(iso || "");
    return Number.isFinite(time) ? Math.floor(time / 1000) : 0;
  }

  // Sync carries timestamps in whole seconds, so records are compared at that
  // precision: the same review read back from sync must not look like news.
  function mergeSyncedFlashcardRecord(local, remote) {
    if (!local) return remote;
    const localTime = toWholeSeconds(local.lastReviewedAt);
    const remoteTime = toWholeSeconds(remote.lastReviewedAt);
    const remoteWins = remoteTime > localTime
      || (remoteTime === localTime && remote.totalReviews > local.totalReviews);
    const winner = remoteWins ? remote : local;

    const reviews = new Map();
    for (const review of [...remote.reviews, ...local.reviews]) {
      reviews.set(`${toWholeSeconds(review.date)}:${review.rating}`, review);
    }

    return {
      ...winner,
      reviews: Array.from(reviews.values())
        .sort((left, right) => toWholeSeconds(left.date) - toWholeSeconds(right.date))
        .slice(-100),
      totalReviews: Math.max(local.totalReviews, remote.totalReviews)
    };
  }

  async function applyRemoteFlashcardMetaDirect(remoteMap = {}, deletedMap = {}) {
    return runVaultIo(async () => {
      const local = await getFlashcardMeta();
      const remote = normalizeFlashcardMetaMap(remoteMap);
      const merged = { ...local };
      let changed = false;

      for (const [id, record] of Object.entries(remote)) {
        if (deletedMap?.[id]) continue;
        merged[id] = mergeSyncedFlashcardRecord(local[id], record);
        if (JSON.stringify(merged[id]) !== JSON.stringify(local[id])) changed = true;
      }

      if (changed) await saveFlashcardMeta(merged);
      return { changed, meta: merged };
    });
  }

  async function applyRemoteFlashcardMeta(remoteMap, deletedMap) {
    return runStoreMutation("applyRemoteFlashcardMeta", [remoteMap, deletedMap], applyRemoteFlashcardMetaDirect);
  }

  async function recordFlashcardReview(entryId, rating, direction) {
    return runStoreMutation("recordFlashcardReview", [entryId, rating, direction], recordFlashcardReviewDirect);
  }

  async function getSyncIssue() {
    const data = await chrome.storage.local.get([SYNC_ISSUE_KEY]);
    const issue = data[SYNC_ISSUE_KEY];
    return issue && typeof issue === "object" ? issue : null;
  }

  async function setSyncIssue(issue = {}) {
    await chrome.storage.local.set({
      [SYNC_ISSUE_KEY]: {
        reason: cleanText(issue.reason) || "sync-failed",
        maxItemsExceeded: Boolean(issue.maxItemsExceeded),
        at: nowIso()
      }
    });
  }

  async function clearSyncIssue() {
    await chrome.storage.local.remove(SYNC_ISSUE_KEY);
  }

  async function getFlashcardStatsDirect() {
    const meta = await getFlashcardMeta();
    const todayKey = toLocalDateKey();
    let todayCount = 0;
    let learningCount = 0;
    let masteredCount = 0;
    const reviewDates = new Set();

    for (const [id, data] of Object.entries(meta)) {
      const m = normalizeFlashcardMeta(data);
      if (!m.totalReviews) continue;

      const dateSet = new Set(m.reviews.map((r) => toLocalDateKey(r.date)));
      for (const d of dateSet) reviewDates.add(d);

      const last = m.reviews[m.reviews.length - 1];
      if (last && toLocalDateKey(last.date) === todayKey) {
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
    HISTORY_REPAIR_ATTEMPTS_KEY,
    SYNC_ISSUE_KEY,
    getSyncIssue,
    setSyncIssue,
    clearSyncIssue,
    toLocalDateKey,
    isDamagedHistoryEntry,
    queueDamagedHistoryEntries,
    FLASHCARD_META_KEY,
    FLASHCARD_SETTINGS_KEY,
    FLASHCARD_MAX_INTERVAL_DAYS,
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
    decodeHtmlEntities,
    cleanDictionaryText,
    normalizeVisitCount,
    normalizeSyncLanguages,
    normalizeSyncVerificationTimestamp,
    normalizeSettings,
    normalizePortableBackupMeta,
    normalizeDeletedMap,
    isExtensionContextInvalidated,
    normalizeEntry,
    normalizeEntryMap,
    shouldKeepEntry,
    filterEntryMapTranslations,
    mergeDeletedMaps,
    applyDeletedMap,
    pruneDeletedMapAgainstEntries,
    getEntryTimestampMs,
    mergeVaultVersions,
    getEntryMap,
    getSettings,
    getPortableBackupMeta,
    getDeletedMap,
    getHistoryImportState,
    getAutoMode,
    getSyncLanguages,
    setAutoMode,
    setSyncLanguages,
    markSyncVerified,
    describeListAction,
    getEntries,
    getEntry,
    toggleList,
    addToList,
    recordAutoVisit,
    removeFromHistory,
    refreshEntryData,
    saveNote,
    removeEntry,
    restoreEntry,
    markPortableBackupExported,
    buildJsonExport,
    importJson,
    previewJsonImport,
    importBrowserHistory,
    resumeHistoryImportHydration,
    applyRemoteVaultStateDirect,
    normalizeFlashcardMeta,
    normalizeFlashcardMetaMap,
    normalizeFlashcardDailyTarget,
    getFlashcardDailyTarget,
    getFlashcardMeta,
    saveFlashcardMeta,
    recordFlashcardReview,
    applyRemoteFlashcardMeta,
    getFlashcardStats,
    computeFlashcardDueAt,
    computeFlashcardStreak,
    isFlashcardDue,
    buildTodayQueue,
    toLocalDateKey
  };
})();
