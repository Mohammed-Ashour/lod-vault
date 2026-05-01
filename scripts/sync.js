(() => {
  const STORAGE_KEY = globalThis.LodWrapperStore?.STORAGE_KEY || "lodVault.entries";
  const LOCAL_SETTINGS_KEY = globalThis.LodWrapperStore?.SETTINGS_KEY || "lodVault.settings";
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

  const SYNC_FORMAT_VERSION = 3;
  const SYNC_MANIFEST_KEY = "lodVault.m";
  const SYNC_SETTINGS_KEY = "lodVault.s";
  const SYNC_ENTRY_PREFIX = "lodVault.e.";
  const SYNC_SHARD_SOFT_LIMIT = 7000;
  const SYNC_ITEM_HARD_LIMIT = 8192;
  const SYNC_TOTAL_HARD_LIMIT = 100 * 1024;
  const DEFAULT_REPUSH_DELAY_MS = Math.max(0, Number(globalThis.__LOD_SYNC_REPUSH_DELAY_MS__ ?? 2000) || 0);

  let initPromise = null;

  function cleanText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeVisitCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

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

  function normalizeEntry(entry = {}) {
    if (typeof globalThis.LodWrapperStore?.normalizeEntry === "function") {
      return globalThis.LodWrapperStore.normalizeEntry(entry);
    }

    const id = cleanText(entry.id);
    const translations = Object.entries(entry.translations || {}).reduce((result, [language, translation]) => {
      const cleaned = cleanText(translation);
      if (cleaned) result[language] = cleaned;
      return result;
    }, {});

    return {
      id,
      word: cleanText(entry.word),
      url: cleanText(entry.url),
      pos: cleanText(entry.pos),
      inflection: cleanText(entry.inflection),
      example: cleanText(entry.example),
      note: cleanText(entry.note),
      translations,
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

  function normalizeSyncLanguages(value) {
    if (typeof globalThis.LodWrapperStore?.normalizeSyncLanguages === "function") {
      return globalThis.LodWrapperStore.normalizeSyncLanguages(value);
    }

    const requested = Array.isArray(value) ? value : DEFAULT_SETTINGS.syncLanguages;
    const deduped = [];

    for (const language of requested) {
      const normalized = cleanText(language).toLowerCase();
      if (!SYNC_LANGUAGE_TO_KEY[normalized]) continue;
      if (deduped.includes(normalized)) continue;
      deduped.push(normalized);
      if (deduped.length >= MAX_SYNC_LANGUAGES) break;
    }

    return deduped.length ? deduped : [...DEFAULT_SETTINGS.syncLanguages];
  }

  function normalizeSettings(settings = {}) {
    if (typeof globalThis.LodWrapperStore?.normalizeSettings === "function") {
      return globalThis.LodWrapperStore.normalizeSettings(settings);
    }

    return {
      ...DEFAULT_SETTINGS,
      autoMode: Boolean(settings?.autoMode),
      syncLanguages: normalizeSyncLanguages(settings?.syncLanguages)
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

  function getEntryTimestamp(entry = {}) {
    const updated = Date.parse(cleanText(entry.updatedAt));
    if (Number.isFinite(updated)) return updated;

    const visited = Date.parse(cleanText(entry.lastVisitedAt));
    if (Number.isFinite(visited)) return visited;

    const created = Date.parse(cleanText(entry.createdAt));
    if (Number.isFinite(created)) return created;

    return 0;
  }

  function compactUrl(url) {
    const directId = typeof globalThis.LodWrapperStore?.getIdFromUrl === "function"
      ? globalThis.LodWrapperStore.getIdFromUrl(url)
      : "";
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

  function mergeEntryMaps(localEntryMap = {}, remoteEntryMap = {}) {
    const local = normalizeEntryMap(localEntryMap);
    const remote = normalizeEntryMap(remoteEntryMap);
    const merged = {};
    const entryIds = new Set([...Object.keys(local), ...Object.keys(remote)]);

    for (const entryId of entryIds) {
      const localEntry = local[entryId];
      const remoteEntry = remote[entryId];

      if (!localEntry) {
        merged[entryId] = remoteEntry;
        continue;
      }

      if (!remoteEntry) {
        merged[entryId] = localEntry;
        continue;
      }

      const localTime = getEntryTimestamp(localEntry);
      const remoteTime = getEntryTimestamp(remoteEntry);
      const winner = remoteTime > localTime ? remoteEntry : localEntry;
      const loser = winner === remoteEntry ? localEntry : remoteEntry;
      const nextEntry = {
        ...loser,
        ...winner,
        id: winner.id || loser.id,
        word: winner.word || loser.word,
        url: winner.url || loser.url,
        translations: {
          ...(loser.translations || {}),
          ...(winner.translations || {})
        },
        favorite: Boolean(winner.favorite),
        study: Boolean(winner.study),
        history: Boolean(winner.history),
        visitCount: winner.history
          ? Math.max(normalizeVisitCount(winner.visitCount), 1)
          : normalizeVisitCount(winner.visitCount),
        lastVisitedAt: cleanText(winner.lastVisitedAt),
        createdAt: cleanText(winner.createdAt || loser.createdAt),
        updatedAt: cleanText(winner.updatedAt || loser.updatedAt)
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

    return merged;
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
    return {
      v: SYNC_FORMAT_VERSION,
      n: Math.max(0, Number(shardCount) || 0),
      a: Boolean(normalized.autoMode),
      l: normalized.syncLanguages.map((language) => SYNC_LANGUAGE_TO_KEY[language]).filter(Boolean),
      t: timestamp
    };
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
      t: Number(rawManifest.t) || 0
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

  function detectSyncMigrationNeed({ rawManifest, rawSettings, shardEntries, hasSyncData }) {
    if (!hasSyncData) return false;
    if (!rawManifest || Number(rawManifest.v) !== SYNC_FORMAT_VERSION) return true;

    if (Array.isArray(rawSettings?.l) && rawSettings.l.some((value) => cleanText(value).length === 1)) {
      return true;
    }

    if (Array.isArray(rawManifest?.l) && rawManifest.l.some((value) => cleanText(value).length > 1)) {
      return true;
    }

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
        a: packFlags(syncEntry),
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
    const data = await chrome.storage.local.get([STORAGE_KEY, LOCAL_SETTINGS_KEY]);
    const rawEntries = data[STORAGE_KEY] && typeof data[STORAGE_KEY] === "object" ? data[STORAGE_KEY] : {};
    const rawSettings = data[LOCAL_SETTINGS_KEY] && typeof data[LOCAL_SETTINGS_KEY] === "object" ? data[LOCAL_SETTINGS_KEY] : {};

    return {
      entries: normalizeEntryMap(rawEntries),
      rawSettings,
      settings: normalizeSettings(rawSettings)
    };
  }

  async function getSyncState() {
    const data = await chrome.storage.sync.get(null);
    const rawManifest = data[SYNC_MANIFEST_KEY] && typeof data[SYNC_MANIFEST_KEY] === "object"
      ? data[SYNC_MANIFEST_KEY]
      : null;
    const rawSettings = data[SYNC_SETTINGS_KEY] && typeof data[SYNC_SETTINGS_KEY] === "object"
      ? data[SYNC_SETTINGS_KEY]
      : null;
    const presentShardKeys = Object.keys(data)
      .filter((key) => key.startsWith(SYNC_ENTRY_PREFIX))
      .sort((left, right) => Number(left.slice(SYNC_ENTRY_PREFIX.length)) - Number(right.slice(SYNC_ENTRY_PREFIX.length)));
    const manifest = normalizeManifest(rawManifest, presentShardKeys.length);
    const expectedShardKeys = manifest?.n
      ? Array.from({ length: manifest.n }, (_value, index) => `${SYNC_ENTRY_PREFIX}${index}`)
      : presentShardKeys;
    const missingShardKeys = expectedShardKeys.filter((key) => !(key in data));
    const malformedShardKeys = expectedShardKeys.filter((key) => key in data && !Array.isArray(data[key]));
    const extraShardKeys = presentShardKeys.filter((key) => !expectedShardKeys.includes(key));
    const shardKeys = expectedShardKeys.filter((key) => Array.isArray(data[key]));
    const shards = shardKeys.map((key) => data[key]);
    const rawShardEntries = flattenShardEntries(shards);
    const settings = normalizeSyncSettings(rawSettings, manifest);
    const compactShards = shards.map((shard) => shard
      .map((entry) => coerceSyncEntry(entry, settings.l))
      .filter(Boolean));
    const entries = flattenShardEntries(compactShards);
    const entryShardMap = buildEntryShardMap(compactShards);
    const hasSyncData = Boolean(rawManifest || rawSettings || presentShardKeys.length);
    const partialRead = missingShardKeys.length > 0 || malformedShardKeys.length > 0;
    const needsMigration = detectSyncMigrationNeed({
      rawManifest,
      rawSettings,
      shardEntries: rawShardEntries,
      hasSyncData
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
    return getByteLength({ [key]: value });
  }

  function estimateSyncWriteSize(values = {}) {
    return Object.entries(values).reduce((total, [key, value]) => total + getSyncItemSize(key, value), 0);
  }

  function classifyRecoverableSyncError(error) {
    const message = String(error?.message || error || "");
    if (message.includes("QUOTA") || message.includes("MAX_WRITE_OPERATIONS")) {
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

  function validateSyncPayload(payload = {}) {
    const oversizeKeys = Object.entries(payload)
      .filter(([key, value]) => getSyncItemSize(key, value) > SYNC_ITEM_HARD_LIMIT)
      .map(([key]) => key);
    const estimatedBytes = estimateSyncWriteSize(payload);

    if (oversizeKeys.length || estimatedBytes > SYNC_TOTAL_HARD_LIMIT) {
      return {
        ok: false,
        reason: "quota-exceeded",
        oversizeKeys,
        estimatedBytes
      };
    }

    return {
      ok: true,
      estimatedBytes,
      oversizeKeys: []
    };
  }

  async function writeSyncPayload(payload, options = {}) {
    const validation = validateSyncPayload(payload);
    if (!validation.ok) {
      console.warn("[LODVault] Sync push skipped: payload exceeds sync quota.", {
        oversizeKeys: validation.oversizeKeys,
        estimatedBytes: validation.estimatedBytes
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
          oversizeKeys: validation.oversizeKeys
        };
      }
      throw error;
    }

    return validation;
  }

  async function pushAll() {
    const localState = await getLocalState();
    const syncState = await getSyncState();
    const shards = shardEntries(localState.entries, localState.settings.syncLanguages);
    const nextSyncData = {};

    shards.forEach((shard, index) => {
      nextSyncData[`${SYNC_ENTRY_PREFIX}${index}`] = shard;
    });

    Object.assign(nextSyncData, buildMetadataPayload(localState.settings, shards.length));

    const writeResult = await writeSyncPayload(nextSyncData, {
      removeKeys: syncState.presentShardKeys.filter((key) => !(key in nextSyncData))
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
    const mergedEntries = Object.keys(remoteEntries).length
      ? mergeEntryMaps(localState.entries, remoteEntries)
      : localState.entries;
    const mergedSettings = buildPulledSettings(localState, syncState);
    const entriesChanged = stableStringify(localState.entries) !== stableStringify(mergedEntries);
    const settingsChanged = stableStringify(localState.settings) !== stableStringify(mergedSettings);

    if (entriesChanged || settingsChanged) {
      await chrome.storage.local.set({
        [STORAGE_KEY]: mergedEntries,
        [LOCAL_SETTINGS_KEY]: mergedSettings
      });
    }

    const shouldRepush = !syncState.partialRead && (entriesChanged || settingsChanged || syncState.needsMigration);
    if (shouldRepush && options.repush !== false) {
      const repushDelayMs = Math.max(0, Number(options.repushDelayMs ?? DEFAULT_REPUSH_DELAY_MS) || 0);
      if (repushDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, repushDelayMs));
      }
      await pushAll();
    }

    return {
      ok: true,
      changed: entriesChanged || settingsChanged,
      entryCount: Object.keys(mergedEntries).length,
      partialRead: syncState.partialRead,
      missingShardKeys: syncState.missingShardKeys,
      malformedShardKeys: syncState.malformedShardKeys,
      needsMigration: syncState.needsMigration
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
      payload[shardRef.key] = compactShards[shardRef.shardIndex];
    }

    const writeResult = await writeSyncPayload(payload, { removeKeys });

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
    const writeResult = await writeSyncPayload(payload);

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

  globalThis.LodWrapperSync = {
    SYNC_FORMAT_VERSION,
    SYNC_MANIFEST_KEY,
    SYNC_SETTINGS_KEY,
    SYNC_ENTRY_PREFIX,
    SYNC_SHARD_SOFT_LIMIT,
    SYNC_ITEM_HARD_LIMIT,
    SYNC_TOTAL_HARD_LIMIT,
    compactEntry,
    expandEntry,
    compactTranslations,
    expandTranslations,
    shardEntries,
    mergeEntryMaps,
    packFlags,
    unpackFlags,
    compactUrl,
    expandUrl,
    isoToUnix,
    unixToIso,
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
