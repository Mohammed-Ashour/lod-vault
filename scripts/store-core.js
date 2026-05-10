(() => {
  const STORAGE_KEY = "lodVault.entries";
  const LEGACY_STORAGE_KEY = "lodWrapper.entries";
  const SETTINGS_KEY = "lodVault.settings";
  const BACKUP_KEY = "lodVault.backups";
  const MAX_BACKUP_SNAPSHOTS = 12;
  const BACKUP_MIN_INTERVAL_MS = 5 * 60 * 1000;
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

  function isExtensionContextInvalidated(error) {
    return String(error || "").includes("Extension context invalidated");
  }

  function createRefreshPageError() {
    return new Error("Extension updated — refresh the page.");
  }

  const STORE_MUTATION_MESSAGE_TYPE = "lod-wrapper:store-mutate";
  const STORE_MUTATIONS_RUN_DIRECTLY = Boolean(globalThis.__LOD_WRAPPER_DIRECT_STORE__);

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

  function entriesMatchForStorage(left, right) {
    const current = normalizeEntry(left);
    const next = normalizeEntry(right);

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

  function applyTranslationLanguageFilter(entry = {}, languages = DEFAULT_SETTINGS.syncLanguages) {
    const normalized = normalizeEntry(entry);
    normalized.translations = filterTranslationsByLanguages(normalized.translations, languages);

    if (!Object.keys(normalized.translations).length) {
      delete normalized.translations;
    }

    return normalized;
  }

  function filterEntryMapTranslations(entryMap = {}, languages = DEFAULT_SETTINGS.syncLanguages) {
    const result = {};

    for (const [entryId, value] of Object.entries(entryMap || {})) {
      const rawEntry = { id: entryId, ...(value && typeof value === "object" ? value : {}) };
      const recovered = recoverLegacyMembership(rawEntry, normalizeEntry(rawEntry));
      const filtered = applyTranslationLanguageFilter(recovered, languages);
      if (!filtered.id || !filtered.word || !shouldKeepEntry(filtered)) continue;
      result[filtered.id] = filtered;
    }

    return result;
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

  function countStoredEntries(entryMap) {
    return Object.keys(normalizeEntryMap(entryMap)).length;
  }

  function normalizeBackupSnapshots(value = []) {
    const snapshots = Array.isArray(value) ? value : [];
    return snapshots
      .filter((snapshot) => snapshot && typeof snapshot === "object" && snapshot.entries && typeof snapshot.entries === "object")
      .map((snapshot) => {
        const normalizedEntries = normalizeEntryMap(snapshot.entries);
        const createdAt = cleanText(snapshot.createdAt) || nowIso();
        const reason = cleanText(snapshot.reason) || "auto";
        const entryCount = countStoredEntries(normalizedEntries);
        const id = cleanText(snapshot.id) || `${createdAt}:${entryCount}`;

        return {
          id,
          createdAt,
          reason,
          entryCount,
          entries: normalizedEntries
        };
      })
      .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0));
  }

  function buildBackupSnapshot(entryMap, reason = "auto") {
    const normalizedEntries = normalizeEntryMap(entryMap);
    const createdAt = nowIso();
    const entryCount = countStoredEntries(normalizedEntries);
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt,
      reason: cleanText(reason) || "auto",
      entryCount,
      entries: normalizedEntries
    };
  }

  function shouldCreateBackupSnapshot(previousMap, nextMap, existingBackups = [], reason = "") {
    const normalizedReason = cleanText(reason).toLowerCase();
    const previousCount = countStoredEntries(previousMap);
    const nextCount = countStoredEntries(nextMap);

    if (!nextCount) return false;
    if (previousCount !== nextCount) return true;

    if (normalizedReason.startsWith("manual") || normalizedReason.includes("import") || normalizedReason.includes("restore")) {
      return true;
    }

    if (stableEntryMapString(previousMap) === stableEntryMapString(nextMap)) {
      return false;
    }

    const latestBackup = normalizeBackupSnapshots(existingBackups)[0];
    if (!latestBackup) return true;

    const latestTimestamp = Date.parse(latestBackup.createdAt || "");
    if (!Number.isFinite(latestTimestamp)) return true;

    return (Date.now() - latestTimestamp) >= BACKUP_MIN_INTERVAL_MS;
  }

  async function getEntryMap() {
    try {
      const data = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY, SETTINGS_KEY]);
      const current = data[STORAGE_KEY] && typeof data[STORAGE_KEY] === "object" ? data[STORAGE_KEY] : {};
      const legacy = data[LEGACY_STORAGE_KEY] && typeof data[LEGACY_STORAGE_KEY] === "object" ? data[LEGACY_STORAGE_KEY] : null;
      const settings = normalizeSettings(data[SETTINGS_KEY] || {});

      const combined = legacy
        ? {
            ...legacy,
            ...current
          }
        : current;
      const filtered = filterEntryMapTranslations(combined, settings.syncLanguages);
      const needsLegacyRecovery = Object.entries(combined || {}).some(([entryId, value]) => {
        const rawEntry = { id: entryId, ...(value && typeof value === "object" ? value : {}) };
        return shouldRecoverLegacyMembership(rawEntry, normalizeEntry(rawEntry));
      });

      if (legacy || needsLegacyRecovery || stableEntryMapString(combined) !== stableEntryMapString(filtered)) {
        await saveEntryMap(filtered, { reason: legacy ? "migration-legacy" : "migration-normalize" });
        if (legacy) {
          await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
        }
      }

      return filtered;
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        return {};
      }
      throw error;
    }
  }

  async function saveEntryMap(entryMap, options = {}) {
    const reason = cleanText(options.reason) || "mutation";

    try {
      const nextEntryMap = normalizeEntryMap(entryMap);
      const data = await chrome.storage.local.get([STORAGE_KEY, BACKUP_KEY]);
      const previousEntryMap = data[STORAGE_KEY] && typeof data[STORAGE_KEY] === "object" ? data[STORAGE_KEY] : {};
      const previousBackups = normalizeBackupSnapshots(data[BACKUP_KEY]);
      const changed = stableEntryMapString(previousEntryMap) !== stableEntryMapString(nextEntryMap);
      const payload = { [STORAGE_KEY]: nextEntryMap };

      if (changed && shouldCreateBackupSnapshot(previousEntryMap, nextEntryMap, previousBackups, reason)) {
        const nextBackups = [buildBackupSnapshot(nextEntryMap, reason), ...previousBackups]
          .slice(0, MAX_BACKUP_SNAPSHOTS);
        payload[BACKUP_KEY] = nextBackups;
      }

      await chrome.storage.local.set(payload);
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        throw createRefreshPageError();
      }
      throw error;
    }
  }

  async function getSettings() {
    try {
      const data = await chrome.storage.local.get([SETTINGS_KEY]);
      return normalizeSettings(data[SETTINGS_KEY] || {});
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        return { ...DEFAULT_SETTINGS };
      }
      throw error;
    }
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
    const nextSettings = {
      ...(await getSettings()),
      autoMode: Boolean(enabled)
    };

    try {
      await chrome.storage.local.set({ [SETTINGS_KEY]: nextSettings });
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        throw createRefreshPageError();
      }
      throw error;
    }

    return nextSettings.autoMode;
  }

  async function setAutoMode(enabled) {
    return runStoreMutation("setAutoMode", [enabled], setAutoModeDirect);
  }

  async function setSyncLanguagesDirect(languages) {
    const nextSettings = normalizeSettings({
      ...(await getSettings()),
      syncLanguages: languages
    });
    const entryMap = await getEntryMap();
    const filteredEntryMap = filterEntryMapTranslations(entryMap, nextSettings.syncLanguages);

    try {
      await saveEntryMap(filteredEntryMap, { reason: "settings-sync-languages" });
      await chrome.storage.local.set({ [SETTINGS_KEY]: nextSettings });
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        throw createRefreshPageError();
      }
      throw error;
    }

    return [...nextSettings.syncLanguages];
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
    if (!["favorite", "study"].includes(listName)) {
      throw new Error(`Unsupported list: ${listName}`);
    }

    const normalized = normalizeEntry(entry);
    if (!normalized.id || !normalized.word) {
      throw new Error("Cannot save an empty entry.");
    }

    const settings = await getSettings();
    const entryMap = await getEntryMap();
    const existing = entryMap[normalized.id];
    const merged = applyTranslationLanguageFilter(mergeEntry(existing, normalized), settings.syncLanguages);

    merged.favorite = Boolean(existing?.favorite);
    merged.study = Boolean(existing?.study);
    merged.history = Boolean(existing?.history);
    merged.visitCount = normalizeVisitCount(existing?.visitCount);
    merged.lastVisitedAt = cleanText(existing?.lastVisitedAt);
    merged[listName] = !merged[listName];

    if (!shouldKeepEntry(merged)) {
      delete entryMap[normalized.id];
      await saveEntryMap(entryMap, { reason: "toggle-list" });
      return null;
    }

    entryMap[normalized.id] = merged;
    await saveEntryMap(entryMap, { reason: "toggle-list" });
    return normalizeEntry(merged);
  }

  async function toggleList(entry, listName) {
    return runStoreMutation("toggleList", [entry, listName], toggleListDirect);
  }

  async function recordAutoVisitDirect(entry) {
    const normalized = normalizeEntry(entry);
    if (!normalized.id || !normalized.word) {
      throw new Error("Cannot save an empty entry.");
    }

    const settings = await getSettings();
    const entryMap = await getEntryMap();
    const existing = entryMap[normalized.id];
    const merged = applyTranslationLanguageFilter(mergeEntry(existing, normalized), settings.syncLanguages);
    const visitedAt = nowIso();

    merged.favorite = Boolean(existing?.favorite);
    merged.study = true;
    merged.history = true;
    merged.visitCount = normalizeVisitCount(existing?.visitCount) + 1;
    merged.lastVisitedAt = visitedAt;
    merged.updatedAt = visitedAt;
    merged.createdAt = merged.createdAt || visitedAt;

    entryMap[normalized.id] = merged;
    await saveEntryMap(entryMap, { reason: "auto-visit" });
    return normalizeEntry(merged);
  }

  async function recordAutoVisit(entry) {
    return runStoreMutation("recordAutoVisit", [entry], recordAutoVisitDirect);
  }

  async function removeFromHistoryDirect(id) {
    if (!id) return null;

    const entryMap = await getEntryMap();
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
      await saveEntryMap(entryMap, { reason: "remove-history" });
      return null;
    }

    entryMap[id] = merged;
    await saveEntryMap(entryMap, { reason: "remove-history" });
    return normalizeEntry(merged);
  }

  async function removeFromHistory(id) {
    return runStoreMutation("removeFromHistory", [id], removeFromHistoryDirect);
  }

  async function refreshEntryDataDirect(entry) {
    const normalized = normalizeEntry(entry);
    if (!normalized.id || !normalized.word) return null;

    const settings = await getSettings();
    const entryMap = await getEntryMap();
    const existing = entryMap[normalized.id];
    if (!existing) return null;

    const merged = applyTranslationLanguageFilter(mergeEntry(existing, normalized), settings.syncLanguages);
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
    await saveEntryMap(entryMap, { reason: "refresh-entry" });
    return normalizeEntry(merged);
  }

  async function refreshEntryData(entry) {
    return runStoreMutation("refreshEntryData", [entry], refreshEntryDataDirect);
  }

  async function saveNoteDirect(id, note) {
    if (!id) throw new Error("Missing entry id.");

    const entryMap = await getEntryMap();
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
    await saveEntryMap(entryMap, { reason: "save-note" });
    return normalizeEntry(merged);
  }

  async function saveNote(id, note) {
    return runStoreMutation("saveNote", [id, note], saveNoteDirect);
  }

  async function removeEntryDirect(id) {
    if (!id) return;
    const entryMap = await getEntryMap();
    delete entryMap[id];
    await saveEntryMap(entryMap, { reason: "manual-remove-entry" });
  }

  async function removeEntry(id) {
    return runStoreMutation("removeEntry", [id], removeEntryDirect);
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
    let imported = 0;

    for (const rawEntry of incomingEntries) {
      const incoming = normalizeEntry(rawEntry);
      if (!incoming.id || !incoming.word) continue;
      if (!shouldKeepEntry(incoming)) continue;

      const existing = entryMap[incoming.id];
      const merged = applyTranslationLanguageFilter(mergeEntry(existing, incoming), effectiveSettings.syncLanguages);
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
      imported += 1;
    }

    const filteredEntryMap = filterEntryMapTranslations(entryMap, effectiveSettings.syncLanguages);

    await saveEntryMap(filteredEntryMap, { reason: "import-json" });

    if (importedSettings) {
      await chrome.storage.local.set({
        [SETTINGS_KEY]: effectiveSettings
      });
    }

    return { imported, total: countStoredEntries(filteredEntryMap) };
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
    const entryMap = await getEntryMap();
    const settings = await getSettings();
    let imported = 0;
    let skippedExisting = 0;
    let ignored = 0;
    const addedEntries = [];

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

      entryMap[id] = applyTranslationLanguageFilter(normalized, settings.syncLanguages);
      imported += 1;
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
      await saveEntryMap(entryMap, { reason: "import-browser-history" });
    }

    return {
      imported,
      scanned: Array.isArray(historyItems) ? historyItems.length : 0,
      skippedExisting,
      ignored,
      total: countStoredEntries(entryMap),
      addedEntries
    };
  }

  async function importBrowserHistory(options) {
    return runStoreMutation("importBrowserHistory", [options], importBrowserHistoryDirect);
  }

  function mergeEntriesByCoverage(primaryEntry = {}, secondaryEntry = {}) {
    const primary = normalizeEntry(primaryEntry);
    const secondary = normalizeEntry(secondaryEntry);

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
      pos: primary.pos || secondary.pos,
      inflection: primary.inflection || secondary.inflection,
      example: primary.example || secondary.example,
      note: primary.note || secondary.note,
      translations: {
        ...(secondary.translations || {}),
        ...(primary.translations || {})
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

  async function getVaultBackups(limit = MAX_BACKUP_SNAPSHOTS) {
    const data = await chrome.storage.local.get([BACKUP_KEY]);
    const backups = normalizeBackupSnapshots(data[BACKUP_KEY]);
    const safeLimit = Math.max(1, Number(limit) || MAX_BACKUP_SNAPSHOTS);

    return backups.slice(0, safeLimit).map((snapshot) => ({
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      reason: snapshot.reason,
      entryCount: snapshot.entryCount
    }));
  }

  async function restoreVaultBackupDirect(backupId) {
    const targetId = cleanText(backupId);
    if (!targetId) {
      throw new Error("Missing backup id.");
    }

    const data = await chrome.storage.local.get([BACKUP_KEY]);
    const backups = normalizeBackupSnapshots(data[BACKUP_KEY]);
    const snapshot = backups.find((item) => item.id === targetId);

    if (!snapshot) {
      throw new Error("Backup not found.");
    }

    const current = await getEntryMap();
    const merged = mergeVaultVersions(current, snapshot.entries);
    await saveEntryMap(merged, { reason: "restore-backup" });

    return {
      restored: true,
      entryCount: Object.keys(merged).length,
      backupId: snapshot.id
    };
  }

  async function restoreVaultBackup(backupId) {
    return runStoreMutation("restoreVaultBackup", [backupId], restoreVaultBackupDirect);
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

  globalThis.LodWrapperStoreCore = {
    STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    SETTINGS_KEY,
    BACKUP_KEY,
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
    isExtensionContextInvalidated,
    normalizeEntry,
    normalizeEntryMap,
    shouldKeepEntry,
    filterEntryMapTranslations,
    getEntryMap,
    getSettings,
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
    buildJsonExport,
    importJson,
    importBrowserHistory,
    getVaultBackups,
    restoreVaultBackup,
    normalizeFlashcardMeta,
    getFlashcardMeta,
    saveFlashcardMeta,
    recordFlashcardReview,
    getFlashcardStats,
    computeFlashcardStreak
  };
})();
