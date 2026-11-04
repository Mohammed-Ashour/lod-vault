// Auto-generated bundle — DO NOT EDIT.
// Run: node scripts/build-background.mjs
// Policy: this file is a generated packaging artifact checked in for extension loading/release builds.
// Source of truth: scripts/build-background.mjs + scripts/background-impl.js + listed dependencies below.
// Source files (in order):
//   store-core.js
//   shared.js
//   lod-article.js
//   lens-lookup.js
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


// ── shared.js ──────────────────────────────────────────────
(() => {
  const core = globalThis.LodVaultStoreCore || {};
  const notes = globalThis.LodVaultNotes || {};
  const presenter = globalThis.LodVaultEntryPresenter || {};

  // Single HTML injection boundary. `markup` must have every dynamic value
  // escaped with LodVaultStore.escapeHtml first. Parsing via DOMParser means
  // script elements never execute and web-ext lint stays warning-free, but
  // event-handler attributes behave as with innerHTML once inserted. (Unlike
  // fragment parsing, leading whitespace text nodes are dropped — irrelevant
  // for the block containers used here.)
  function setHtml(el, markup) {
    const doc = el.ownerDocument;
    const parsed = new doc.defaultView.DOMParser().parseFromString(markup || "", "text/html");
    el.replaceChildren(...parsed.body.childNodes);
  }

  globalThis.LodVaultStore = {
    ...core,
    ...notes,
    ...presenter,
    setHtml
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
    infoText,
    infoTextFull
  };
})();


// ── lens-lookup.js ──────────────────────────────────────────────
(() => {
  const API_LOCALE = "lb";
  const API_ROOT = `https://lod.lu/api/${API_LOCALE}`;
  const SEARCH_LANGUAGES = Object.freeze(["lb", "en", "fr", "de", "pt", "nl"]);
  const DEFAULT_SENTENCE_LOOKUP_CONCURRENCY = 6;

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  const cleanDictionaryText = globalThis.LodVaultStoreCore?.cleanDictionaryText || cleanText;

  function normalizeSelection(value) {
    return cleanText(value)
      .replace(/^[\s'"„“”‚‘’«»()[\]{}<>.,;:!?/\\|]+/, "")
      .replace(/[\s'"„“”‚‘’«»()[\]{}<>.,;:!?/\\|]+$/, "")
      .trim();
  }

  function normalizeComparable(value) {
    return cleanText(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ß/g, "ss");
  }

  function buildSearchUrl(query, language = API_LOCALE) {
    if (!SEARCH_LANGUAGES.includes(language)) throw new Error("Unsupported search language.");
    const url = new URL(`${API_ROOT}/search`);
    url.searchParams.set("lang", language);
    url.searchParams.set("query", normalizeSelection(query));
    return url.toString();
  }

  function buildEntryUrl(id) {
    return `${API_ROOT}/entry/${encodeURIComponent(cleanText(id))}`;
  }

  function buildSuggestionUrl(query) {
    const url = new URL(`${API_ROOT}/suggest`);
    url.searchParams.set("query", normalizeSelection(query));
    return url.toString();
  }

  function buildSearchPageUrl(query, language = API_LOCALE) {
    if (!SEARCH_LANGUAGES.includes(language)) throw new Error("Unsupported search language.");
    return `https://lod.lu/search/${encodeURIComponent(normalizeSelection(query))}/${language}`;
  }

  function stripDiacritics(value) {
    return cleanText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  async function runtimeProxyFetch(url, options = {}) {
    const runtime = globalThis.chrome?.runtime;
    if (typeof runtime?.sendMessage !== "function") {
      throw new Error("Runtime proxy fetch is unavailable.");
    }

    const response = await runtime.sendMessage({
      type: "lodvault:lens-fetch",
      url: String(url || "")
    });

    if (!response?.ok) {
      throw new Error(response?.error || `LOD request failed (${response?.status || 0}).`);
    }

    return {
      ok: true,
      status: response.status,
      json: async () => response.json,
      text: async () => response.text || ""
    };
  }

  function getFetchImplementation(preferredFetch) {
    if (typeof preferredFetch === "function") {
      return preferredFetch;
    }

    if (typeof globalThis.chrome?.runtime?.sendMessage === "function") {
      return runtimeProxyFetch;
    }

    if (typeof globalThis.fetch === "function") {
      return globalThis.fetch.bind(globalThis);
    }

    return null;
  }

  async function fetchJson(url, fetchImpl) {
    const resolvedFetch = getFetchImplementation(fetchImpl);
    if (typeof resolvedFetch !== "function") {
      throw new Error("Fetch is unavailable.");
    }

    const response = await resolvedFetch(url, {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response?.ok) {
      const error = new Error(`LOD request failed (${response?.status || 0}).`);
      error.status = response?.status || 0;
      throw error;
    }

    return response.json();
  }

  function mapCandidate(result = {}, language = API_LOCALE) {
    const id = cleanText(result.article_id || result.id);
    return {
      id,
      articleId: id,
      word: cleanDictionaryText(result.word_lb || result.lemma),
      pos: cleanDictionaryText(result.pos),
      matches: Array.isArray(result.matches) ? result.matches.slice() : [],
      translations: language === "lb" ? {} : {
        [language]: [...new Set((result.meanings || []).map((meaning) => cleanDictionaryText(meaning.translation)).filter(Boolean))].join(" · ")
      },
      url: id ? `https://lod.lu/artikel/${encodeURIComponent(id)}` : ""
    };
  }

  function partsToText(parts) {
    if (!Array.isArray(parts)) return "";

    return parts.reduce((result, part) => {
      const nested = Array.isArray(part?.parts) ? partsToText(part.parts) : cleanText(part?.content);
      if (!nested) return result;
      if (!result) return nested;
      if (/^[,.;:!?)]/.test(nested) || result.endsWith("'") || result.endsWith("’")) {
        return `${result}${nested}`;
      }
      return `${result} ${nested}`;
    }, "");
  }

  function appendTranslationValue(translations, language, value) {
    const text = cleanText(value);
    if (!language || !text) return;

    const existing = translations[language] ? translations[language].split(" · ") : [];
    if (!existing.includes(text)) {
      existing.push(text);
      translations[language] = existing.join(" · ");
    }
  }

  function extractTranslations(apiEntry = {}) {
    const translations = {};

    for (const micro of apiEntry.microStructures || []) {
      for (const unit of micro.grammaticalUnits || []) {
        for (const meaning of unit.meanings || []) {
          for (const [language, definition] of Object.entries(meaning.targetLanguages || {})) {
            appendTranslationValue(translations, language, partsToText(definition?.parts));
          }
        }
      }
    }

    return translations;
  }

  function extractInflection(apiEntry = {}) {
    for (const micro of apiEntry.microStructures || []) {
      for (const unit of micro.grammaticalUnits || []) {
        for (const meaning of unit.meanings || []) {
          const forms = Array.isArray(meaning?.inflection?.forms)
            ? meaning.inflection.forms.map((form) => cleanText(form?.content)).filter(Boolean)
            : [];
          if (forms.length) return forms.join(" · ");
        }
      }
    }

    return "";
  }

  function extractExample(apiEntry = {}) {
    for (const micro of apiEntry.microStructures || []) {
      for (const unit of micro.grammaticalUnits || []) {
        for (const meaning of unit.meanings || []) {
          for (const example of meaning.examples || []) {
            const text = partsToText(example?.parts);
            if (text) return text;
          }
        }
      }
    }

    return "";
  }

  function normalizeEntryFromApi(apiEntry = {}) {
    const id = cleanText(apiEntry.lod_id);
    const word = cleanDictionaryText(apiEntry.lemma);

    if (!id || !word) {
      return null;
    }

    const entry = {
      id,
      word,
      url: `https://lod.lu/artikel/${encodeURIComponent(id)}`,
      pos: cleanText(apiEntry.partOfSpeechLabel || apiEntry.partOfSpeech),
      inflection: extractInflection(apiEntry),
      example: extractExample(apiEntry),
      translations: extractTranslations(apiEntry)
    };
    const normalizeEntry = globalThis.LodVaultStoreCore?.normalizeEntry;
    return typeof normalizeEntry === "function" ? normalizeEntry(entry) : entry;
  }

  async function search(query, options = {}) {
    const normalizedQuery = normalizeSelection(query);
    if (!normalizedQuery) {
      return { query: "", candidates: [] };
    }

    const languages = options.language === "all" ? SEARCH_LANGUAGES : [options.language || API_LOCALE];
    const responses = await Promise.all(languages.map(async (language) => {
      const data = await fetchJson(buildSearchUrl(normalizedQuery, language), options.fetch);
      if (!Array.isArray(data?.results)) throw new Error("Invalid LOD search response.");
      return data.results.map((result) => mapCandidate(result, language)).filter((candidate) => candidate.id && candidate.word);
    }));
    const merged = new Map();
    for (const candidates of responses) {
      for (const candidate of candidates) {
        const existing = merged.get(candidate.id);
        if (existing) {
          Object.assign(existing.translations, candidate.translations);
        } else {
          merged.set(candidate.id, candidate);
        }
      }
    }
    return { query: normalizedQuery, candidates: [...merged.values()] };
  }

  async function fetchEntry(id, options = {}) {
    const data = await fetchJson(buildEntryUrl(id), options.fetch);
    return normalizeEntryFromApi(data?.entry || {});
  }

  async function suggest(query, options = {}) {
    const normalizedQuery = normalizeSelection(query);
    if (!normalizedQuery) return [];

    const suggestionQueries = [...new Set([
      normalizedQuery,
      normalizedQuery.toLowerCase(),
      stripDiacritics(normalizedQuery).toLowerCase()
    ].filter(Boolean))];

    const suggestions = [];
    for (const suggestionQuery of suggestionQueries) {
      const data = await fetchJson(buildSuggestionUrl(suggestionQuery), options.fetch);
      const items = Array.isArray(data?.items) ? data.items : [];
      for (const item of items) {
        const word = normalizeSelection(cleanDictionaryText(item?.word || item?.lemma || item));
        if (!word || suggestions.some((suggestion) => suggestion.word === word)) {
          continue;
        }

        suggestions.push({
          word,
          type: cleanText(item?.type),
          url: buildSearchPageUrl(word)
        });

        if (suggestions.length >= 5) {
          return suggestions;
        }
      }
    }

    for (const suggestion of suggestions) {
      try {
        const result = await search(suggestion.word, options);
        const exactCandidate = result.candidates.find((candidate) => scoreCandidate(candidate, suggestion.word) >= 4);
        if (exactCandidate?.id) {
          suggestion.entryId = exactCandidate.id;
          suggestion.url = exactCandidate.url || suggestion.url;
        }
      } catch {
        // Leave this suggestion as a search-page fallback.
      }
    }

    return suggestions;
  }

  function scoreCandidate(candidate, query) {
    const word = normalizeComparable(candidate?.word);
    const normalizedQuery = normalizeComparable(query);
    const matches = Array.isArray(candidate?.matches)
      ? candidate.matches.map((value) => normalizeComparable(String(value).replace(/<[^>]+>/g, ""))).filter(Boolean)
      : [];
    if (!word || !normalizedQuery) return 0;
    if (word === normalizedQuery) return 5;
    if (matches.some((value) => value === normalizedQuery)) return 4;
    if (word.startsWith(normalizedQuery)) return 3;
    if (word.includes(normalizedQuery) || matches.some((value) => value.includes(normalizedQuery))) return 2;
    return 1;
  }

  async function lookup(query, options = {}) {
    const result = await search(query, options);
    const { candidates } = result;

    if (!candidates.length) {
      return {
        ...result,
        status: "not-found",
        entry: null,
        suggestions: await suggest(result.query, options)
      };
    }

    const exactCandidates = candidates.filter((candidate) => scoreCandidate(candidate, result.query) >= 4);

    if (candidates.length === 1 && exactCandidates.length === 1) {
      return {
        ...result,
        status: "resolved",
        entry: await fetchEntry(candidates[0].id, options)
      };
    }

    if (exactCandidates.length === 1) {
      return {
        ...result,
        status: "resolved",
        entry: await fetchEntry(exactCandidates[0].id, options)
      };
    }

    return {
      ...result,
      status: "ambiguous",
      entry: null,
      candidates: [...candidates].sort((left, right) => scoreCandidate(right, result.query) - scoreCandidate(left, result.query))
    };
  }

  async function mapWithConcurrency(items, limit, mapper) {
    const normalizedLimit = Math.max(1, Math.floor(Number(limit) || 1));
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(normalizedLimit, items.length) }, () => worker())
    );

    return results;
  }

  function cloneLookupWordResult(result = {}, tokenText = result.text || "") {
    return {
      text: tokenText,
      word: cleanText(result.word),
      status: cleanText(result.status) || "error",
      entry: result.entry
        ? {
            ...result.entry,
            translations: { ...(result.entry.translations || {}) }
          }
        : null,
      candidates: Array.isArray(result.candidates)
        ? result.candidates.map((candidate) => ({
            ...candidate,
            matches: Array.isArray(candidate.matches) ? candidate.matches.slice() : []
          }))
        : [],
      suggestions: Array.isArray(result.suggestions)
        ? result.suggestions.map((suggestion) => ({ ...suggestion }))
        : []
    };
  }

  function isSentence(text) {
    const normalized = normalizeSelection(text);
    if (!normalized) return false;
    const words = normalized.split(/\s+/).filter(Boolean);
    return words.length > 1;
  }

  function splitSentence(text) {
    const normalized = normalizeSelection(text);
    if (!normalized) return [];
    return normalized
      .split(/(\s+)/)
      .filter((chunk) => chunk.length > 0)
      .map((chunk) => ({
        text: chunk,
        isWord: Boolean(normalizeSelection(chunk))
      }));
  }

  async function lookupSentence(text, options = {}) {
    const normalizedQuery = normalizeSelection(text);
    if (!normalizedQuery) {
      return { words: [], query: "" };
    }

    const tokens = splitSentence(normalizedQuery);
    const wordTokens = tokens.filter((t) => t.isWord);
    const uniqueWords = [...new Set(wordTokens.map((token) => normalizeSelection(token.text)).filter(Boolean))];
    const lookupByWord = new Map();

    await mapWithConcurrency(
      uniqueWords,
      options.sentenceConcurrency || DEFAULT_SENTENCE_LOOKUP_CONCURRENCY,
      async (word) => {
        try {
          const result = await lookup(word, options);
          lookupByWord.set(word, {
            text: word,
            word: result.query,
            status: result.status,
            entry: result.entry || null,
            candidates: result.candidates || [],
            suggestions: result.suggestions || []
          });
        } catch {
          lookupByWord.set(word, {
            text: word,
            word,
            status: "error",
            entry: null,
            candidates: [],
            suggestions: []
          });
        }
      }
    );

    const wordResults = wordTokens.map((token) => {
      const word = normalizeSelection(token.text);
      if (!word) {
        return { text: token.text, word, status: "skipped", entry: null, candidates: [], suggestions: [] };
      }

      return cloneLookupWordResult(lookupByWord.get(word), token.text);
    });

    return {
      query: normalizedQuery,
      tokens,
      words: wordResults
    };
  }

  globalThis.LodVaultLensLookup = {
    API_ROOT,
    SEARCH_LANGUAGES,
    normalizeSelection,
    buildSearchUrl,
    buildEntryUrl,
    mapCandidate,
    extractTranslations,
    extractInflection,
    extractExample,
    normalizeEntryFromApi,
    search,
    fetchEntry,
    suggest,
    lookup,
    lookupSentence,
    isSentence,
    splitSentence,
    buildSuggestionUrl,
    buildSearchPageUrl,
    runtimeProxyFetch,
    getFetchImplementation,
    mapWithConcurrency
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
  const {
    STORAGE_KEY,
    SETTINGS_KEY: LOCAL_SETTINGS_KEY,
    DELETED_KEY: LOCAL_DELETED_KEY,
    DEFAULT_SETTINGS,
    MAX_SYNC_LANGUAGES,
    SYNC_LANGUAGE_TO_KEY,
    SYNC_KEY_TO_LANGUAGE
  } = globalThis.LodVaultStore;

  const SYNC_FORMAT_VERSION = 4;
  const COMPRESSION = globalThis.LodVaultCompress || null;
  const SYNC_MANIFEST_KEY = "lodVault.m";
  const SYNC_SETTINGS_KEY = "lodVault.s";
  const SYNC_DELETED_KEY = "lodVault.d";
  const SYNC_ENTRY_PREFIX = "lodVault.e.";
  // Review progress lives in its own keys, outside the manifest and format
  // version, so versions that don't know about it leave it alone. Each key is
  // self-describing and only ever adds to what a device knows.
  const SYNC_PROGRESS_PREFIX = "lodVault.p.";
  // Words always win the quota. Progress takes what they leave, up to a limit,
  // and keeps a margin so note edits don't immediately hit the ceiling.
  const SYNC_PROGRESS_MAX_BYTES = 24 * 1024;
  const SYNC_PROGRESS_RESERVE_BYTES = 8 * 1024;
  const SYNC_PROGRESS_BUCKET_BYTES = 5000;
  const SYNC_SHARD_SOFT_LIMIT = 7000;
  const SYNC_ITEM_HARD_LIMIT = 8192;
  const SYNC_TOTAL_HARD_LIMIT = 100 * 1024;
  const SYNC_MAX_ITEMS = 512;
  const DEFAULT_REPUSH_DELAY_MS = Math.max(0, Number(globalThis.__LOD_SYNC_REPUSH_DELAY_MS__ ?? 2000) || 0);

  let initPromise = null;

  // store-core.js always loads before sync.js (background bundle, pages, and tests),
  // so normalization/settings/merge helpers come from the single source of truth
  // rather than being re-implemented (and drifting) here.
  const store = globalThis.LodVaultStore;
  const {
    cleanText,
    normalizeVisitCount,
    shouldKeepEntry,
    normalizeEntry,
    normalizeSyncLanguages,
    normalizeSettings,
    normalizeDeletedMap,
    normalizeEntryMap,
    filterEntryMapTranslations
  } = store;

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



  async function persistFallbackLocalState(entries, settings, deletedMap) {
    const normalizedEntries = normalizeEntryMap(entries);
    const normalizedSettings = normalizeSettings(settings);
    const normalizedDeletedMap = store.pruneDeletedMapAgainstEntries(normalizedEntries, deletedMap);
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

  // Deletion records live in one sync item. Past the item limit, keep the newest
  // ones rather than failing every push: only a device offline long enough to
  // miss a dropped record could bring that old deletion back.
  function limitDeletedMapForSync(compact = {}) {
    if (getSyncItemSize(SYNC_DELETED_KEY, compact) <= SYNC_ITEM_HARD_LIMIT) return compact;

    const newestFirst = Object.entries(compact).sort((left, right) => right[1] - left[1]);
    let low = 0;
    let high = newestFirst.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const candidate = Object.fromEntries(newestFirst.slice(0, middle));
      if (getSyncItemSize(SYNC_DELETED_KEY, candidate) <= SYNC_ITEM_HARD_LIMIT) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return Object.fromEntries(newestFirst.slice(0, low));
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

  // Change timestamps keep milliseconds. Rounded to seconds, two edits in the
  // same second would look older than the local copy on both devices, so each
  // device would keep its own version.
  function isoToMillis(iso) {
    const timestamp = Date.parse(cleanText(iso));
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function millisToIso(millis) {
    const number = Number(millis);
    return Number.isFinite(number) && number > 0 ? new Date(number).toISOString() : "";
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
    const noteUpdatedAt = isoToMillis(entry.noteUpdatedAt);
    if (noteUpdatedAt) compact.m = noteUpdatedAt;
    const listsUpdatedAt = isoToMillis(entry.listsUpdatedAt);
    if (listsUpdatedAt) compact.g = listsUpdatedAt;

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
      noteUpdatedAt: millisToIso(syncEntry.m),
      listsUpdatedAt: millisToIso(syncEntry.g),
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

  function compactProgress(id, card) {
    const lastReview = card.reviews[card.reviews.length - 1];
    const compact = {
      i: id,
      n: card.totalReviews,
      l: isoToUnix(card.lastReviewedAt),
      d: isoToUnix(card.dueAt),
      v: card.interval
    };
    if (card.hardCount) compact.h = card.hardCount;
    if (card.goodCount) compact.g = card.goodCount;
    if (card.easyCount) compact.e = card.easyCount;
    // Only the latest review travels. That is enough for today's count and the
    // streak on other devices without spending quota on the whole log.
    if (lastReview) compact.r = [isoToUnix(lastReview.date), lastReview.rating, lastReview.direction === "rev" ? 1 : 0];
    return compact;
  }

  function expandProgress(compact = {}) {
    const lastReviewedAt = unixToIso(compact.l);
    const review = Array.isArray(compact.r) && unixToIso(compact.r[0])
      ? [{ date: unixToIso(compact.r[0]), rating: compact.r[1], direction: compact.r[2] ? "rev" : "fwd" }]
      : [];
    return store.normalizeFlashcardMeta({
      reviews: review,
      totalReviews: compact.n,
      hardCount: compact.h,
      goodCount: compact.g,
      easyCount: compact.e,
      lastReviewedAt,
      dueAt: unixToIso(compact.d),
      interval: compact.v
    });
  }

  function bucketForId(id, bucketCount) {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) {
      hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
    }
    return hash % bucketCount;
  }

  // Buckets are keyed by a hash of the word id, so a review rewrites one sync
  // item rather than shifting every item after it. Sync write limits are low.
  function bucketProgress(records) {
    const totalBytes = getByteLength(records);
    let bucketCount = Math.max(1, Math.ceil(totalBytes / SYNC_PROGRESS_BUCKET_BYTES));

    for (;;) {
      const buckets = Array.from({ length: bucketCount }, () => []);
      for (const record of records) {
        buckets[bucketForId(record.i, bucketCount)].push(record);
      }
      if (bucketCount >= records.length || buckets.every((bucket) => getByteLength(bucket) <= SYNC_SHARD_SOFT_LIMIT)) {
        return buckets.filter((bucket) => bucket.length);
      }
      bucketCount += 1;
    }
  }

  async function buildProgressPayload(flashcardMeta, entryMap, budgetBytes) {
    const budget = Math.min(SYNC_PROGRESS_MAX_BYTES, budgetBytes);
    if (budget <= 0) return {};

    let records = Object.entries(flashcardMeta || {})
      .filter(([id, card]) => entryMap?.[id] && card.totalReviews)
      .sort(([leftId, left], [rightId, right]) => (
        isoToUnix(right.lastReviewedAt) - isoToUnix(left.lastReviewedAt)
        || leftId.localeCompare(rightId)
      ))
      .map(([id, card]) => compactProgress(id, card));

    // Most recently studied words survive when progress doesn't all fit.
    while (records.length) {
      const sorted = [...records].sort((left, right) => left.i.localeCompare(right.i));
      const payload = {};
      const buckets = bucketProgress(sorted);
      for (let index = 0; index < buckets.length; index += 1) {
        payload[`${SYNC_PROGRESS_PREFIX}${index}`] = await compressShard(buckets[index]);
      }
      const bytes = estimateSyncWriteSize(payload);
      if (bytes <= budget) return payload;
      records = records.slice(0, Math.floor(records.length * (budget / bytes) * 0.9));
    }
    return {};
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
    const data = await chrome.storage.local.get([STORAGE_KEY, LOCAL_SETTINGS_KEY, LOCAL_DELETED_KEY, store.FLASHCARD_META_KEY]);
    const rawEntries = data[STORAGE_KEY] && typeof data[STORAGE_KEY] === "object" ? data[STORAGE_KEY] : {};
    const rawSettings = data[LOCAL_SETTINGS_KEY] && typeof data[LOCAL_SETTINGS_KEY] === "object" ? data[LOCAL_SETTINGS_KEY] : {};
    const settings = normalizeSettings(rawSettings);
    const deletedMap = normalizeDeletedMap(data[LOCAL_DELETED_KEY] || {});

    return {
      entries: filterEntryMapTranslations(rawEntries, settings.syncLanguages),
      rawEntries: normalizeEntryMap(rawEntries),
      rawSettings,
      settings,
      deletedMap,
      flashcardMeta: store.normalizeFlashcardMetaMap(data[store.FLASHCARD_META_KEY])
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

    const progressKeys = Object.keys(data).filter((key) => key.startsWith(SYNC_PROGRESS_PREFIX));
    const progress = {};
    for (const key of progressKeys) {
      for (const record of await decompressShard(data[key])) {
        const id = cleanText(record?.i);
        if (id) progress[id] = expandProgress(record);
      }
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
      progressKeys,
      progress,
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
      || key.startsWith(SYNC_PROGRESS_PREFIX)
    ));
  }

  function omitKeys(data = {}, keys = []) {
    const remaining = { ...data };
    for (const key of keys) delete remaining[key];
    return remaining;
  }

  // Whatever the rest of sync storage leaves over, minus the safety margin.
  function getProgressBudget(nonProgressData) {
    return SYNC_TOTAL_HARD_LIMIT - SYNC_PROGRESS_RESERVE_BYTES - estimateSyncWriteSize(nonProgressData);
  }

  // Writes are checked against old and new data together, so progress that has
  // to give way for words must be gone before the words are written.
  async function removeStaleProgress(syncState, payload) {
    const staleKeys = syncState.progressKeys.filter((key) => !(key in payload));
    if (!staleKeys.length) return syncState.data;
    try {
      await chrome.storage.sync.remove(staleKeys);
    } catch (error) {
      if (!isRecoverableSyncError(error)) throw error;
      console.warn("[LODVault] Could not clear old sync progress:", error);
      return syncState.data;
    }
    return omitKeys(syncState.data, staleKeys);
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

  function filterUnchangedSyncPayload(payload = {}, currentData = {}) {
    if (!currentData || typeof currentData !== "object") {
      return { changedPayload: payload, skippedKeys: [] };
    }

    const changedPayload = {};
    const skippedKeys = [];

    for (const [key, value] of Object.entries(payload || {})) {
      const currentValue = currentData[key];
      const unchanged = Object.prototype.hasOwnProperty.call(currentData, key) && (
        typeof value === "string" && typeof currentValue === "string"
          ? value === currentValue
          : stableStringify(value) === stableStringify(currentValue)
      );

      if (unchanged) {
        skippedKeys.push(key);
        continue;
      }

      changedPayload[key] = value;
    }

    return { changedPayload, skippedKeys };
  }

  async function writeSyncPayload(payload, options = {}) {
    // Drop keys whose stored value is already identical, so a routine push
    // only writes (and spends sync quota on) the keys that actually changed.
    // Compressed shards compare as strings; anything else compares by
    // stableStringify. A wrong "changed" verdict only costs a redundant write,
    // which is what happened for every key before this filter existed.
    const { changedPayload, skippedKeys } = filterUnchangedSyncPayload(payload, options.currentData);
    const validation = validateSyncPayload(changedPayload, options);
    if (!validation.ok) {
      console.warn("[LODVault] Sync push skipped: payload exceeds sync quota.", {
        oversizeKeys: validation.oversizeKeys,
        estimatedBytes: validation.estimatedBytes,
        finalEstimatedBytes: validation.finalEstimatedBytes,
        itemCount: validation.itemCount,
        finalItemCount: validation.finalItemCount,
        maxItemsExceeded: validation.maxItemsExceeded
      });
      return { ...validation, skippedKeys };
    }

    try {
      if (Object.keys(changedPayload).length) {
        await chrome.storage.sync.set(changedPayload);
      }

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
          skippedKeys,
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

    return { ...validation, skippedKeys };
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
      nextSyncData[SYNC_DELETED_KEY] = limitDeletedMapForSync(compactDeletedMap(localState.deletedMap));
    }

    Object.assign(nextSyncData, buildMetadataPayload(localState.settings, shards.length));

    const untouchedData = omitKeys(syncState.data, [
      ...syncState.progressKeys,
      ...syncState.presentShardKeys,
      ...Object.keys(nextSyncData)
    ]);
    const progressBudget = getProgressBudget({ ...untouchedData, ...nextSyncData });
    Object.assign(nextSyncData, await buildProgressPayload(localState.flashcardMeta, localState.rawEntries, progressBudget));

    const removeKeys = syncState.presentShardKeys.filter((key) => !(key in nextSyncData));
    if (!nextSyncData[SYNC_DELETED_KEY] && syncState.data?.[SYNC_DELETED_KEY]) {
      removeKeys.push(SYNC_DELETED_KEY);
    }

    const currentData = await removeStaleProgress(syncState, nextSyncData);
    const writeResult = await writeSyncPayload(nextSyncData, {
      currentData,
      removeKeys
    });

    return {
      ...writeResult,
      entryCount: Object.keys(localState.entries).length,
      shardCount: shards.length,
      mode: writeResult.ok ? "full" : "full-failed"
    };
  }

  // Touches only progress keys and leaves the manifest alone, so its writes
  // don't wake other devices' full pull when nothing they hold has changed.
  async function pushProgress() {
    const [localState, syncState] = await Promise.all([getLocalState(), getSyncState()]);

    if (!syncState.hasSyncData || syncState.partialRead || syncState.needsMigration) {
      return pushAll();
    }

    const budget = getProgressBudget(omitKeys(syncState.data, syncState.progressKeys));
    const payload = await buildProgressPayload(localState.flashcardMeta, localState.rawEntries, budget);
    const currentData = await removeStaleProgress(syncState, payload);
    const writeResult = await writeSyncPayload(payload, { currentData });

    return {
      ...writeResult,
      mode: writeResult.ok ? "progress" : "progress-failed"
    };
  }

  function hasProgressToPush(localMeta, remoteProgress, entryMap) {
    return Object.entries(localMeta || {}).some(([id, card]) => {
      if (!entryMap?.[id] || !card.totalReviews) return false;
      const remote = remoteProgress?.[id];
      return !remote
        || remote.totalReviews !== card.totalReviews
        || isoToUnix(remote.lastReviewedAt) !== isoToUnix(card.lastReviewedAt);
    });
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
          const mergedDeletedMap = store.mergeDeletedMaps(localState.deletedMap, syncState.deletedMap);
          const mergedEntries = store.applyDeletedMap(
            Object.keys(remoteEntries).length
              ? store.mergeVaultVersions(localState.rawEntries, remoteEntries)
              : localState.rawEntries,
            mergedDeletedMap
          );
          const nextDeletedMap = store.pruneDeletedMapAgainstEntries(mergedEntries, mergedDeletedMap);
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

    let pushResult = null;
    const progressResult = await store.applyRemoteFlashcardMeta(
      syncState.progress,
      store.mergeDeletedMaps(localState.deletedMap, syncState.deletedMap)
    );
    const needsProgressPush = hasProgressToPush(
      progressResult.meta,
      syncState.progress,
      applyResult.entries || localState.rawEntries
    );

    const shouldRepush = !syncState.partialRead && (applyResult.changed || syncState.needsMigration);
    if (options.repush !== false && (shouldRepush || (needsProgressPush && !syncState.partialRead))) {
      const repushDelayMs = Math.max(0, Number(options.repushDelayMs ?? DEFAULT_REPUSH_DELAY_MS) || 0);
      if (repushDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, repushDelayMs));
      }
      // Progress is best effort and retried on later pushes, so its outcome says
      // nothing about whether the vault itself is syncing.
      if (shouldRepush) {
        pushResult = await pushAll();
      } else {
        await pushProgress();
      }
    }

    return {
      ok: true,
      ...(pushResult ? { pushed: true } : {}),
      ...(pushResult?.ok === false ? pushResult : {}),
      changed: Boolean(applyResult.changed || progressResult.changed),
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
          pushed: true,
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

    if (writeResult.reason === "quota-exceeded" && syncState.progressKeys.length) {
      return pushAll();
    }

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

    if (writeResult.reason === "quota-exceeded" && syncState.progressKeys.length) {
      return pushAll();
    }

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
      const bytesUsedProgress = estimateSyncWriteSize(
        Object.fromEntries((syncState.progressKeys || []).map((key) => [key, syncState.data[key]]))
      );
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
      // Progress gives way to words, so its space still counts as free for them.
      const bytesUsedWords = bytesUsedVault - bytesUsedProgress;
      if (entryCount > 0 && bytesUsedWords > 0) {
        const avgBytesPerEntry = bytesUsedWords / entryCount;
        estimatedRemaining = Math.floor((bytesRemaining + bytesUsedProgress) / Math.max(1, avgBytesPerEntry));
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
    SYNC_PROGRESS_PREFIX,
    SYNC_SHARD_SOFT_LIMIT,
    SYNC_ITEM_HARD_LIMIT,
    SYNC_TOTAL_HARD_LIMIT,
    SYNC_MAX_ITEMS,
    stableStringify,
    compactEntry,
    expandEntry,
    expandTranslations,
    shardEntries,
    mergeEntryMaps: store.mergeVaultVersions,
    inspectSyncStorage,
    getSyncUsageStats,
    SyncAdapter: {
      init,
      pushAll,
      pullAll,
      pushEntry,
      pushSettings,
      pushProgress,
      destroy
    }
  };
})();


// ── sync-coordinator.js ──────────────────────────────────────────────
(() => {
  function createSyncCoordinator(options = {}) {
    const store = options.store || globalThis.LodVaultStore;
    const syncNamespace = options.syncNamespace || globalThis.LodVaultSync;
    const syncAdapter = options.syncAdapter || syncNamespace.SyncAdapter;
    const logger = options.logger || console;
    const pushDebounceMs = Math.max(0, Number(options.pushDebounceMs ?? globalThis.__LOD_SYNC_PUSH_DEBOUNCE_MS__ ?? 2000) || 0);
    // A review session rates a card every few seconds, and sync allows only so
    // many writes a minute. Short of the 30s after which a worker may be stopped.
    const progressDebounceMs = pushDebounceMs * 5;
    const suppressWindowMs = Math.max(pushDebounceMs * 2, 50);
    const localSyncKeys = new Set([
      store.STORAGE_KEY,
      store.SETTINGS_KEY,
      store.DELETED_KEY,
      store.FLASHCARD_META_KEY
    ]);
    const syncManifestKey = syncNamespace.SYNC_MANIFEST_KEY;
    const syncSettingsKey = syncNamespace.SYNC_SETTINGS_KEY;
    const syncDeletedKey = syncNamespace.SYNC_DELETED_KEY;
    const syncEntryPrefix = syncNamespace.SYNC_ENTRY_PREFIX;
    const syncProgressPrefix = syncNamespace.SYNC_PROGRESS_PREFIX;

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
        || (syncProgressPrefix && key.startsWith(syncProgressPrefix))
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

      if (changes?.[store.FLASHCARD_META_KEY] && !entryChange && !deletedChange && (!settingsKind || settingsKind === "none")) {
        return { type: "progress" };
      }

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

    // Automatic sync runs unattended, so a failure is stored for the popup and
    // the toolbar badge instead of only reaching the console.
    async function recordSyncOutcome(result) {
      try {
        if (result?.ok === false) {
          await store.setSyncIssue?.(result);
        } else {
          await store.clearSyncIssue?.();
        }
      } catch (error) {
        logSyncWarning("Could not record sync status", error);
      }
    }

    // A pull doesn't prove pushes work, so a clean pull that pushed nothing
    // only clears an earlier pull failure.
    async function recordPullOutcome(result) {
      if (result?.ok === false || result?.pushed) {
        await recordSyncOutcome(result);
        return;
      }
      try {
        const issue = await store.getSyncIssue?.();
        if (issue?.reason === "pull-failed") {
          await store.clearSyncIssue?.();
        }
      } catch (error) {
        logSyncWarning("Could not record sync status", error);
      }
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

      const delayMs = pendingLocalPushPlan?.immediate
        ? 0
        : pendingLocalPushPlan?.type === "progress" ? progressDebounceMs : pushDebounceMs;

      pendingLocalPushTimer = setTimeout(() => {
        pendingLocalPushTimer = null;
        const planToRun = pendingLocalPushPlan || { type: "all" };
        pendingLocalPushPlan = null;

        enqueueSyncTask(async () => {
          // If sync hasn't been initialized yet, do that first and suppress
          // a redundant pull that would immediately follow.
          if (!syncInitialized) {
            suppressSyncPull();
            // Init only re-pushes when the merge changed something, so it can't
            // be relied on to upload the edit that woke this worker.
            await initializeSync("local-change");
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

          if (planToRun.type === "progress" && syncAdapter.pushProgress) {
            return syncAdapter.pushProgress();
          }

          return syncAdapter.pushAll();
        }).then((result) => {
          // Progress is best effort: a push of it can't vouch for the words, so
          // it neither raises nor clears the "sync paused" state.
          if (String(result?.mode || "").startsWith("progress")) return undefined;
          return recordSyncOutcome(result);
        }).catch(async (error) => {
          logSyncWarning("Sync push failed", error);
          await recordSyncOutcome({ ok: false, reason: "sync-failed" });
        });
      }, delayMs);
    }

    function scheduleSyncPull() {
      clearPendingLocalPush();

      enqueueSyncTask(async () => {
        if (!syncInitialized) {
          suppressLocalPush();
          return initializeSync("sync-change");
        }

        suppressLocalPush();
        suppressSyncPull();
        return syncAdapter.pullAll({ repush: true });
      }).then(recordPullOutcome).catch(async (error) => {
        logSyncWarning("Sync pull failed", error);
        await recordSyncOutcome({ ok: false, reason: "pull-failed" });
      });
    }

    async function handleInstalled(reason = "onInstalled") {
      return enqueueSyncTask(() => initializeSync(reason)).then(recordPullOutcome).catch(async (error) => {
        logSyncWarning("Initial sync failed", error);
        await recordSyncOutcome({ ok: false, reason: "pull-failed" });
      });
    }

    async function handleStartup(reason = "onStartup") {
      return enqueueSyncTask(() => initializeSync(reason)).then(recordPullOutcome).catch(async (error) => {
        logSyncWarning("Startup sync failed", error);
        await recordSyncOutcome({ ok: false, reason: "pull-failed" });
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
const LENS_PROXY_SEARCH_LANGUAGES = new Set(["lb", ...LodVaultStore.TRANSLATION_LANGUAGE_ORDER]);
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
const SELECTION_TRIGGER_SCRIPT_ID = "lodvault-selection-trigger";
const SELECTION_TRIGGER_SCRIPT_FILES = ["scripts/selection-trigger.js"];
const SELECTION_TRIGGER_STYLE_FILES = ["styles/selection-trigger.css"];
const SELECTION_TRIGGER_CONTRACT = "1";
const STORE_MUTATION_MESSAGE_TYPE = LodVaultStore.STORE_MUTATION_MESSAGE_TYPE;
const DUE_BADGE_ALARM = "lodvault-due-badge";
const DUE_BADGE_COLOR = "#1f5f8b";
const SYNC_ISSUE_BADGE_COLOR = "#b3261e";
const STORE_MUTATION_METHODS = new Set([
  "setAutoMode",
  "setSyncLanguages",
  "markSyncVerified",
  "toggleList",
  "addToList",
  "recordAutoVisit",
  "removeFromHistory",
  "refreshEntryData",
  "saveNote",
  "removeEntry",
  "restoreEntry",
  "markPortableBackupExported",
  "importJson",
  "importBrowserHistory",
  "recordFlashcardReview",
  "applyRemoteFlashcardMeta",
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
    if (!LENS_PROXY_SEARCH_LANGUAGES.has(lang) || !query || parsed.searchParams.getAll("lang").length !== 1 || parsed.searchParams.getAll("query").length !== 1) {
      throw new Error("Blocked unauthorized LOD Lens request URL.");
    }

    parsed.search = `?lang=${encodeURIComponent(lang)}&query=${encodeURIComponent(query)}`;
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

function normalizeGrantedOriginPattern(value) {
  const candidate = String(value || "").trim();
  if (!candidate.endsWith("/*")) {
    return "";
  }

  let parsed = null;
  try {
    parsed = new URL(candidate.slice(0, -2));
  } catch {
    return "";
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || !parsed.hostname
    || parsed.hostname.includes("*")
    || parsed.hostname === "lod.lu"
    || parsed.hostname === "www.lod.lu"
  ) {
    return "";
  }

  return `${parsed.origin}/*`;
}

async function getGrantedOriginPatterns() {
  if (typeof chrome.permissions?.getAll !== "function") {
    return [];
  }

  try {
    const granted = await chrome.permissions.getAll();
    return [...new Set(
      (Array.isArray(granted?.origins) ? granted.origins : [])
        .map(normalizeGrantedOriginPattern)
        .filter(Boolean)
    )];
  } catch {
    return [];
  }
}

async function syncSelectionTriggerRegistration() {
  if (!chrome.scripting?.unregisterContentScripts || !chrome.scripting?.registerContentScripts) {
    return;
  }

  const matches = await getGrantedOriginPatterns();
  await chrome.scripting.unregisterContentScripts({ ids: [SELECTION_TRIGGER_SCRIPT_ID] }).catch(() => {});

  if (!matches.length) {
    return;
  }

  await chrome.scripting.registerContentScripts([{
    id: SELECTION_TRIGGER_SCRIPT_ID,
    matches,
    js: SELECTION_TRIGGER_SCRIPT_FILES,
    css: SELECTION_TRIGGER_STYLE_FILES,
    runAt: "document_idle"
  }]).catch(() => {});
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

async function isSelectionTriggerInjected(tabId) {
  if (!tabId || !chrome.scripting?.executeScript) {
    return false;
  }

  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (contract) => {
        const trigger = globalThis.LodVaultSelectionTrigger;
        return Boolean(trigger?.loaded && trigger.contract === contract);
      },
      args: [SELECTION_TRIGGER_CONTRACT]
    });
    return Boolean(result);
  } catch {
    return false;
  }
}

async function ensureSelectionTriggerInjected(tabId) {
  if (await isSelectionTriggerInjected(tabId)) {
    return;
  }

  await chrome.scripting.insertCSS?.({
    target: { tabId },
    files: SELECTION_TRIGGER_STYLE_FILES
  }).catch(() => {});

  await chrome.scripting.executeScript({
    target: { tabId },
    files: SELECTION_TRIGGER_SCRIPT_FILES
  });
}

async function openLensOverlay(tabId, selectionText = "", { tabUrl = "", requestSitePermission = false } = {}) {
  if (!tabId || !chrome.scripting?.executeScript) {
    throw new Error("Cannot open lens overlay without a tab id.");
  }

  const resolvedTabUrl = String(tabUrl || "");

  if (requestSitePermission) {
    if (!getTabOriginPattern(resolvedTabUrl)) {
      throw new Error("LODVault needs site access to open Lens on this page.");
    }

    // Must be the first async call: the caller's user gesture (context menu
    // click, trigger click, or command) is what allows the permission prompt
    // to appear. Awaiting anything before it loses the gesture and makes
    // chrome.permissions.request throw "must be called during a user gesture".
    // Already-granted origins resolve true without a prompt, so no contains()
    // pre-check is needed.
    const granted = await requestLensSitePermission(resolvedTabUrl);
    if (!granted) {
      throw new Error("LODVault needs site access to open Lens on this page.");
    }

    await syncSelectionTriggerRegistration();
    await ensureSelectionTriggerInjected(tabId);
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

function formatDueBadge(dueCount) {
  if (!dueCount) return "";
  return dueCount > 99 ? "99+" : String(dueCount);
}

let toolbarBadgeRefresh = Promise.resolve();

// A sync problem needs action, so it outranks the due count on the one badge.
function refreshToolbarBadge() {
  toolbarBadgeRefresh = toolbarBadgeRefresh.then(async () => {
    const issue = await LodVaultStore.getSyncIssue?.();
    if (issue) {
      await chrome.action?.setBadgeBackgroundColor?.({ color: SYNC_ISSUE_BADGE_COLOR });
      await chrome.action?.setBadgeText?.({ text: "!" });
      await chrome.action?.setTitle?.({ title: "LODVault: sync is paused. Open Stats for details." });
      return;
    }

    const [entries, meta] = await Promise.all([
      LodVaultStore.getEntries(),
      LodVaultStore.getFlashcardMeta()
    ]);
    const { dueCount } = LodVaultStore.buildTodayQueue(entries, meta);
    await chrome.action?.setBadgeBackgroundColor?.({ color: DUE_BADGE_COLOR });
    await chrome.action?.setBadgeText?.({ text: formatDueBadge(dueCount) });
    await chrome.action?.setTitle?.({
      title: dueCount ? `LODVault: ${dueCount} word${dueCount === 1 ? "" : "s"} due today` : "LODVault"
    });
  }).catch((error) => {
    console.warn("[LODVault] Could not update the toolbar badge:", error?.message || error);
  });
  return toolbarBadgeRefresh;
}

// Cards fall due at local midnight with no storage change to announce it.
function scheduleDueBadgeRefresh() {
  const nextMidnight = new Date();
  nextMidnight.setHours(24, 0, 0, 0);
  chrome.alarms?.create?.(DUE_BADGE_ALARM, { when: nextMidnight.getTime() });
}

chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm?.name !== DUE_BADGE_ALARM) return;
  scheduleDueBadgeRefresh();
  void refreshToolbarBadge();
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "update" || details.reason === "install") {
    registerContextMenus();
    reloadLodTabs();
    void syncSelectionTriggerRegistration();
    syncCoordinator.handleInstalled("onInstalled");
    repairDamagedHistoryEntries();
    scheduleHistoryHydrationResume(50);
  }
});

chrome.runtime.onStartup?.addListener(() => {
  registerContextMenus();
  void syncSelectionTriggerRegistration();
  syncCoordinator.handleStartup("onStartup");
  repairDamagedHistoryEntries();
  scheduleHistoryHydrationResume(50);
});

chrome.contextMenus?.onClicked?.addListener((info, tab) => {
  if (info.menuItemId !== LENS_CONTEXT_MENU_ID) return;
  if (!tab?.id) return;
  openLensOverlay(tab.id, info.selectionText || "", {
    tabUrl: tab.url || "",
    requestSitePermission: true
  }).catch((error) => {
    console.error("LOD Lens: could not open from context menu:", error?.message || error);
  });
});

chrome.commands?.onCommand?.addListener(async (command) => {
  if (command !== LENS_COMMAND_ID) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const selectionText = await getActiveSelectionText(tab.id);
    // No optional host permission is requested here: the keyboard shortcut
    // grants activeTab for the active tab, which is enough to inject the lens
    // runtime and open the overlay. Requesting persistent site access from the
    // command path would require the permission prompt to fire inside the
    // shortcut's gesture window, before the tabs.query/selection round-trips
    // above; the context-menu path remains the opt-in flow for persistent
    // access and the floating trigger.
    await openLensOverlay(tab.id, selectionText, {
      tabUrl: tab.url || ""
    });
  } catch (_error) {
    // Ignore lens overlay failures.
  }
});

function repairDamagedHistoryEntries() {
  LodVaultStore.queueDamagedHistoryEntries?.().catch(() => {});
}

chrome.storage.onChanged?.addListener((changes, areaName) => {
  syncCoordinator.handleStorageChanged(changes, areaName);
  if (areaName === "local" && (
    changes?.[LodVaultStore.STORAGE_KEY]
    || changes?.[LodVaultStore.FLASHCARD_META_KEY]
    || Object.prototype.hasOwnProperty.call(changes || {}, LodVaultStore.SYNC_ISSUE_KEY)
  )) {
    void refreshToolbarBadge();
  }
  if (areaName === "local" && Object.prototype.hasOwnProperty.call(changes || {}, LodVaultStore.HISTORY_IMPORT_STATE_KEY || "lodVault.historyImport")) {
    scheduleHistoryHydrationResume(25);
  }
});

scheduleHistoryHydrationResume(50);
registerContextMenus();
void syncSelectionTriggerRegistration();
scheduleDueBadgeRefresh();
void refreshToolbarBadge();
chrome.permissions?.onAdded?.addListener(() => {
  void syncSelectionTriggerRegistration();
});
chrome.permissions?.onRemoved?.addListener(() => {
  void syncSelectionTriggerRegistration();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === OPEN_LENS_OVERLAY_MESSAGE_TYPE) {
    const tabId = sender?.tab?.id;

    if (!tabId) {
      sendResponse({ ok: false, error: "Cannot open LOD Lens without a tab id." });
      return;
    }

    openLensOverlay(tabId, message.selectionText || "", {
      tabUrl: sender?.url || "",
      requestSitePermission: true
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("LOD Lens: could not open for the selection trigger:", error?.message || error);
        sendResponse({
          ok: false,
          error: error?.message || String(error)
        });
      });

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
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000)
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
