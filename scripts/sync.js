(() => {
  const STORAGE_KEY = globalThis.LodWrapperStore?.STORAGE_KEY || "lodVault.entries";
  const LOCAL_SETTINGS_KEY = globalThis.LodWrapperStore?.SETTINGS_KEY || "lodVault.settings";
  const LOCAL_DELETED_KEY = globalThis.LodWrapperStore?.DELETED_KEY || "lodVault.deleted";
  const DEFAULT_SETTINGS = globalThis.LodWrapperStore?.DEFAULT_SETTINGS || {
    autoMode: false,
    syncLanguages: ["en", "fr", "de"]
  };
  const MAX_SYNC_LANGUAGES = globalThis.LodWrapperStore?.MAX_SYNC_LANGUAGES || 3;
  const SYNC_LANGUAGE_TO_KEY = globalThis.LodWrapperStore?.SYNC_LANGUAGE_TO_KEY || {
    en: "e",
    fr: "f",
    de: "d",
    pt: "p",
    nl: "l"
  };
  const SYNC_KEY_TO_LANGUAGE = globalThis.LodWrapperStore?.SYNC_KEY_TO_LANGUAGE || Object.freeze(
    Object.fromEntries(Object.entries(SYNC_LANGUAGE_TO_KEY).map(([language, key]) => [key, language]))
  );

  const SYNC_FORMAT_VERSION = 4;
  const COMPRESSION = globalThis.LodWrapperCompress || null;
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

  const store = globalThis.LodWrapperStore || {};
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
    const remoteEntries = buildRemoteEntryMap(syncState.entries, localState.entries);

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
            filterEntryMapTranslations(
              Object.keys(remoteEntries).length
                ? mergeVaultVersionsPreferLarger(localState.entries, remoteEntries)
                : localState.entries,
              mergedSettings.syncLanguages
            ),
            mergedDeletedMap
          );
          const nextDeletedMap = pruneDeletedMapAgainstEntries(mergedEntries, mergedDeletedMap);
          const changed = stableStringify(localState.entries) !== stableStringify(mergedEntries)
            || stableStringify(localState.settings) !== stableStringify(mergedSettings)
            || stableStringify(normalizeDeletedMap(localState.deletedMap)) !== stableStringify(nextDeletedMap);
          const appliedDeletionCount = Object.keys(localState.entries).filter((id) => !mergedEntries[id] && nextDeletedMap[id]).length;

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

  globalThis.LodWrapperSync = {
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
