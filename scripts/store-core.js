(() => {
  const STORAGE_KEY = "lodVault.entries";
  const LEGACY_STORAGE_KEY = "lodWrapper.entries";
  const SETTINGS_KEY = "lodVault.settings";
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

  function normalizeEntryMap(entryMap = {}) {
    const result = {};

    for (const [entryId, value] of Object.entries(entryMap || {})) {
      const normalized = normalizeEntry({ id: entryId, ...value });
      if (!normalized.id || !normalized.word || !shouldKeepEntry(normalized)) continue;
      result[normalized.id] = normalized;
    }

    return result;
  }

  function shouldKeepEntry(entry) {
    return Boolean(entry?.favorite || entry?.study || entry?.history);
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
      const filtered = applyTranslationLanguageFilter({ id: entryId, ...value }, languages);
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
    return Object.values(entryMap || {})
      .map(normalizeEntry)
      .filter((entry) => entry.id && entry.word && shouldKeepEntry(entry)).length;
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

      if (legacy || stableEntryMapString(combined) !== stableEntryMapString(filtered)) {
        await chrome.storage.local.set({ [STORAGE_KEY]: filtered });
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

  async function saveEntryMap(entryMap) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: entryMap });
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
      await chrome.storage.local.set({
        [SETTINGS_KEY]: nextSettings,
        [STORAGE_KEY]: filteredEntryMap
      });
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
      await saveEntryMap(entryMap);
      return null;
    }

    entryMap[normalized.id] = merged;
    await saveEntryMap(entryMap);
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
    await saveEntryMap(entryMap);
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
      await saveEntryMap(entryMap);
      return null;
    }

    entryMap[id] = merged;
    await saveEntryMap(entryMap);
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
    await saveEntryMap(entryMap);
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
    await saveEntryMap(entryMap);
    return normalizeEntry(merged);
  }

  async function saveNote(id, note) {
    return runStoreMutation("saveNote", [id, note], saveNoteDirect);
  }

  async function removeEntryDirect(id) {
    if (!id) return;
    const entryMap = await getEntryMap();
    delete entryMap[id];
    await saveEntryMap(entryMap);
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

    if (importedSettings) {
      await chrome.storage.local.set({
        [STORAGE_KEY]: filteredEntryMap,
        [SETTINGS_KEY]: effectiveSettings
      });
    } else {
      await saveEntryMap(filteredEntryMap);
    }

    return { imported, total: countStoredEntries(filteredEntryMap) };
  }

  async function importJson(text) {
    return runStoreMutation("importJson", [text], importJsonDirect);
  }

  globalThis.LodWrapperStoreCore = {
    STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    SETTINGS_KEY,
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
    cleanWordLabel,
    cleanTranslations,
    filterTranslationsByLanguages,
    normalizeVisitCount,
    normalizeSyncLanguages,
    normalizeSettings,
    isExtensionContextInvalidated,
    createRefreshPageError,
    runStoreMutation,
    normalizeEntry,
    normalizeEntryMap,
    shouldKeepEntry,
    mergeEntry,
    entriesMatchForStorage,
    applyTranslationLanguageFilter,
    filterEntryMapTranslations,
    countStoredEntries,
    getEntryMap,
    saveEntryMap,
    getSettings,
    getAutoMode,
    getSyncLanguages,
    setAutoMode,
    setSyncLanguages,
    setAutoModeDirect,
    setSyncLanguagesDirect,
    getEntries,
    getEntry,
    toggleList,
    toggleListDirect,
    recordAutoVisit,
    recordAutoVisitDirect,
    removeFromHistory,
    removeFromHistoryDirect,
    refreshEntryData,
    refreshEntryDataDirect,
    saveNote,
    saveNoteDirect,
    removeEntry,
    removeEntryDirect,
    buildJsonExport,
    importJson,
    importJsonDirect
  };
})();
