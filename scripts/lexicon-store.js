// Local lexicon: the structured part of each saved word's LOD entry (gender,
// plurals, participles, senses with their own examples), parsed by
// LodVaultLensLookup.parseLexicon. Each word is one `lodVault.lx.<ID>` key in
// chrome.storage.local. It is a cache of public dictionary data: never synced,
// optional in JSON backups, and rebuilt from LOD when missing or stale.
(() => {
  const KEY_PREFIX = "lodVault.lx.";
  const INDEX_KEY = "lodVault.lxIndex";
  const MISS_KEY = "lodVault.lxMiss";
  const HYDRATE_MESSAGE_TYPE = "lodvault:lexicon-hydrate";
  const VERSION = 1;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const REFRESH_MS = 90 * DAY_MS;
  const MISS_RETRY_MS = 30 * DAY_MS;
  // A soft budget for all lexicon records together. Records are 1–7 KB, so this
  // covers a few thousand saved words; past it, favourites-only words give way to
  // words in Study (see pruneForBudget).
  const BUDGET_BYTES = 12 * 1024 * 1024;
  const RESPONSE_CACHE_TTL_MS = 10 * 60 * 1000;
  const RESPONSE_CACHE_LIMIT = 25;
  const BACKOFF_BASE_MS = 30 * 1000;
  const BACKOFF_MAX_MS = 30 * 60 * 1000;
  const MAX_CONCURRENCY = 2;

  function storageArea() {
    return globalThis.chrome?.storage?.local || null;
  }

  function cleanId(value) {
    return String(value ?? "").trim();
  }

  function lexiconKey(id) {
    return `${KEY_PREFIX}${cleanId(id)}`;
  }

  function isLexiconKey(key) {
    return typeof key === "string" && key.startsWith(KEY_PREFIX) && key.length > KEY_PREFIX.length;
  }

  function idFromKey(key) {
    return isLexiconKey(key) ? key.slice(KEY_PREFIX.length) : "";
  }

  function recordBytes(id, record) {
    return new TextEncoder().encode(lexiconKey(id)).length
      + new TextEncoder().encode(JSON.stringify(record)).length;
  }

  function normalizeLexiconRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (Number(value.v) !== VERSION) return null;
    const id = cleanId(value.id);
    if (!id || !/^[A-Za-z0-9_.-]+$/.test(id)) return null;
    if (typeof value.lemma !== "string" || !value.lemma.trim()) return null;
    if (!Array.isArray(value.senses)) return null;
    const fetchedAt = Number(value.fetchedAt);
    if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return null;
    return { ...value, id, fetchedAt };
  }

  function isStale(record, now = Date.now()) {
    const normalized = normalizeLexiconRecord(record);
    return !normalized || now - normalized.fetchedAt >= REFRESH_MS;
  }

  function normalizeIndex(value) {
    const index = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return index;
    for (const [id, item] of Object.entries(value)) {
      if (!Array.isArray(item)) continue;
      const fetchedAt = Number(item[0]);
      const bytes = Number(item[1]);
      if (!cleanId(id) || !Number.isFinite(fetchedAt) || !Number.isFinite(bytes)) continue;
      index[id] = [fetchedAt, Math.max(0, Math.round(bytes))];
    }
    return index;
  }

  // All writes go through one chain so the index never loses an update when
  // two hydrations finish together.
  let ioChain = Promise.resolve();
  function runLexiconIo(task) {
    const result = ioChain.then(task, task);
    ioChain = result.catch(() => {});
    return result;
  }

  async function readIndex(area = storageArea()) {
    if (!area) return {};
    const data = await area.get([INDEX_KEY]);
    if (data[INDEX_KEY]) return normalizeIndex(data[INDEX_KEY]);
    return rebuildIndex(area);
  }

  async function listStoredKeys(area) {
    if (typeof area.getKeys === "function") {
      try {
        return await area.getKeys();
      } catch {
        // Fall through to a full read.
      }
    }
    return Object.keys(await area.get(null));
  }

  // The index is derived data. If it is missing (first run, or an older build
  // removed it) it is rebuilt from the records themselves.
  async function rebuildIndex(area = storageArea()) {
    if (!area) return {};
    const keys = (await listStoredKeys(area)).filter(isLexiconKey);
    const index = {};
    if (keys.length) {
      const data = await area.get(keys);
      for (const key of keys) {
        const record = normalizeLexiconRecord(data[key]);
        const id = idFromKey(key);
        index[id] = [record ? record.fetchedAt : 0, recordBytes(id, data[key])];
      }
    }
    await area.set({ [INDEX_KEY]: index });
    return index;
  }

  async function getLexicon(id) {
    const area = storageArea();
    if (!area || !cleanId(id)) return null;
    const key = lexiconKey(id);
    const data = await area.get([key]);
    return normalizeLexiconRecord(data[key]);
  }

  async function getLexicons(ids = []) {
    const area = storageArea();
    const unique = [...new Set((Array.isArray(ids) ? ids : []).map(cleanId).filter(Boolean))];
    if (!area || !unique.length) return {};
    const data = await area.get(unique.map(lexiconKey));
    const result = {};
    for (const id of unique) {
      const record = normalizeLexiconRecord(data[lexiconKey(id)]);
      if (record) result[id] = record;
    }
    return result;
  }

  async function getAllLexicons() {
    const index = await readIndex();
    return getLexicons(Object.keys(index));
  }

  async function getUsage() {
    const index = await readIndex();
    const values = Object.values(index);
    return {
      count: values.length,
      bytes: values.reduce((total, [, bytes]) => total + bytes, 0),
      budgetBytes: BUDGET_BYTES
    };
  }

  function saveLexicon(record, canCommit = () => true) {
    return runLexiconIo(async () => {
      const area = storageArea();
      const normalized = normalizeLexiconRecord(record);
      if (!area || !normalized) return false;
      const index = await readIndex(area);
      if (!await canCommit()) return false;
      index[normalized.id] = [normalized.fetchedAt, recordBytes(normalized.id, normalized)];
      await area.set({ [lexiconKey(normalized.id)]: normalized, [INDEX_KEY]: index });
      return true;
    });
  }

  function removeLexicons(ids = []) {
    return runLexiconIo(async () => {
      const area = storageArea();
      const unique = [...new Set((Array.isArray(ids) ? ids : [ids]).map(cleanId).filter(Boolean))];
      if (!area || !unique.length) return 0;
      const index = await readIndex(area);
      const present = unique.filter((id) => index[id]);
      for (const id of unique) delete index[id];
      // Remove the record keys even when the index missed them.
      await area.remove(unique.map(lexiconKey));
      await area.set({ [INDEX_KEY]: index });
      return present.length;
    });
  }

  // Backups carry records verbatim. A restored record only replaces a local one
  // that is older, and only for words that are in the vault.
  function importLexicons(map, allowedIds = null) {
    return runLexiconIo(async () => {
      const area = storageArea();
      if (!area || !map || typeof map !== "object" || Array.isArray(map)) return 0;
      const allowed = allowedIds ? new Set([...allowedIds].map(cleanId)) : null;
      const index = await readIndex(area);
      const updates = {};
      let count = 0;
      for (const [id, value] of Object.entries(map)) {
        const record = normalizeLexiconRecord(value);
        if (!record || record.id !== cleanId(id)) continue;
        if (allowed && !allowed.has(record.id)) continue;
        if (index[record.id] && index[record.id][0] >= record.fetchedAt) continue;
        updates[lexiconKey(record.id)] = record;
        index[record.id] = [record.fetchedAt, recordBytes(record.id, record)];
        count += 1;
      }
      if (count) {
        await area.set({ ...updates, [INDEX_KEY]: index });
      }
      return count;
    });
  }

  async function readMisses(area) {
    const data = await area.get([MISS_KEY]);
    const value = data[MISS_KEY];
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function recordMiss(id, at) {
    return runLexiconIo(async () => {
      const area = storageArea();
      if (!area) return;
      const misses = await readMisses(area);
      misses[id] = at;
      await area.set({ [MISS_KEY]: misses });
    });
  }

  function clearMisses(ids) {
    return runLexiconIo(async () => {
      const area = storageArea();
      if (!area) return;
      const misses = await readMisses(area);
      let changed = false;
      for (const id of ids) {
        if (misses[id] !== undefined) {
          delete misses[id];
          changed = true;
        }
      }
      if (changed) {
        if (Object.keys(misses).length) await area.set({ [MISS_KEY]: misses });
        else await area.remove(MISS_KEY);
      }
    });
  }

  function isSavedEntry(entry) {
    return Boolean(entry && (entry.study || entry.favorite));
  }

  // Pages ask the background to hydrate words they are about to show, such
  // as the cards of a Today session.
  async function requestHydration(ids = []) {
    const runtime = globalThis.chrome?.runtime;
    const list = [...new Set((Array.isArray(ids) ? ids : [ids]).map(cleanId).filter(Boolean))];
    if (!list.length || typeof runtime?.sendMessage !== "function") return false;
    try {
      const response = await runtime.sendMessage({ type: HYDRATE_MESSAGE_TYPE, ids: list });
      return Boolean(response?.ok);
    } catch {
      return false;
    }
  }

  // Background hydration: fetches entries a word at a time, at most two at
  // once, and backs off on rate limits, server errors and network failures.
  function createHydrator(options = {}) {
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    const schedule = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
    const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Number(options.concurrency) || MAX_CONCURRENCY));
    const budgetBytes = Number(options.budgetBytes) > 0 ? Number(options.budgetBytes) : BUDGET_BYTES;
    const parse = options.parse || ((entry, parseOptions) => globalThis.LodVaultLensLookup?.parseLexicon?.(entry, parseOptions));
    const fetchEntryJson = options.fetchEntryJson;
    const getEntryMap = options.getEntryMap;
    const logger = options.logger || null;

    const queue = [];
    const queued = new Set();
    const running = new Set();
    const responses = new Map();
    const generations = new Map();
    const rerun = new Set();
    let failures = 0;
    let pausedUntil = 0;
    let wakeTimer = null;
    let idleWaiters = [];

    function rememberResponse(id, apiEntry) {
      const key = cleanId(id || apiEntry?.lod_id);
      if (!key || !apiEntry || typeof apiEntry !== "object") return;
      responses.delete(key);
      responses.set(key, { entry: apiEntry, at: now() });
      while (responses.size > RESPONSE_CACHE_LIMIT) {
        responses.delete(responses.keys().next().value);
      }
    }

    function takeResponse(id) {
      const cached = responses.get(id);
      if (!cached) return null;
      responses.delete(id);
      return now() - cached.at <= RESPONSE_CACHE_TTL_MS ? cached.entry : null;
    }

    function enqueue(ids, { front = false } = {}) {
      const list = (Array.isArray(ids) ? ids : [ids]).map(cleanId).filter(Boolean);
      for (const id of front ? [...list].reverse() : list) {
        if (running.has(id)) {
          rerun.add(id);
          continue;
        }
        if (queued.has(id)) {
          if (!front) continue;
          queue.splice(queue.indexOf(id), 1);
        }
        queued.add(id);
        if (front) queue.unshift(id);
        else queue.push(id);
      }
      pump();
    }

    function notifyIdle() {
      if (queue.length || running.size) return;
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const resolve of waiters) resolve();
    }

    function whenIdle() {
      if (!queue.length && !running.size) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    }

    function pump() {
      const waitMs = pausedUntil - now();
      if (waitMs > 0) {
        if (!wakeTimer) {
          wakeTimer = schedule(() => {
            wakeTimer = null;
            pump();
          }, waitMs);
          // Waiting out a backoff shouldn't keep a Node test process alive.
          wakeTimer?.unref?.();
        }
        return;
      }
      while (running.size < concurrency && queue.length) {
        const id = queue.shift();
        queued.delete(id);
        running.add(id);
        hydrateOne(id)
          .catch((error) => {
            logger?.warn?.("[LODVault] Lexicon hydration failed:", error?.message || error);
            return "failed";
          })
          .then((outcome) => {
            running.delete(id);
            const requestedAgain = rerun.delete(id);
            if (outcome === "deferred" || requestedAgain) enqueue([id]);
            else pump();
            notifyIdle();
          });
      }
      notifyIdle();
    }

    async function hydrateOne(id) {
      const generation = generations.get(id) || 0;
      const canCommit = async () => {
        const map = typeof getEntryMap === "function" ? await getEntryMap() : null;
        return generation === (generations.get(id) || 0) && (!map || isSavedEntry(map[id]));
      };
      const entryMap = typeof getEntryMap === "function" ? await getEntryMap() : null;
      const entry = entryMap ? entryMap[id] : null;
      if (entryMap && !isSavedEntry(entry)) return "skipped";

      const existing = await getLexicon(id);
      let apiEntry = takeResponse(id);
      if (!apiEntry && existing && !isStale(existing, now())) return "fresh";
      if (!apiEntry) {
        if (typeof fetchEntryJson !== "function") return "skipped";
        try {
          apiEntry = await fetchEntryJson(id);
          failures = 0;
        } catch (error) {
          const status = Number(error?.status) || 0;
          if (status === 429 || status >= 500 || status === 0) {
            failures += 1;
            pausedUntil = now() + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * (2 ** (failures - 1)));
            return "deferred";
          }
          await recordMiss(id, now());
          return "missing";
        }
      }

      const keepSenses = Array.isArray(options.keepSenses?.(id)) ? options.keepSenses(id) : [];
      const record = parse(apiEntry, { now: now(), keepSenses });
      if (!record || record.id !== id) {
        await recordMiss(id, now());
        return "missing";
      }

      const bytes = recordBytes(id, record);
      const fits = await pruneForBudget(bytes - (existing ? recordBytes(id, existing) : 0), {
        entryMap,
        protect: id
      });
      if (!fits && !entry?.study) return "over-budget";

      try {
        if (!await saveLexicon(record, canCommit)) return "skipped";
      } catch (error) {
        if (/quota/i.test(String(error?.message || error))) return "over-budget";
        throw error;
      }
      await clearMisses([id]);
      return "saved";
    }

    // Frees space for `extraBytes` more. Lexicons of words that left the vault
    // go first, then favourites-only words, oldest fetch first. Words in Study
    // are never pruned for budget.
    async function pruneForBudget(extraBytes, { entryMap = null, protect = "" } = {}) {
      const index = await readIndex();
      let total = Object.values(index).reduce((sum, [, bytes]) => sum + bytes, 0);
      if (total + extraBytes <= budgetBytes) return true;
      const rank = (id) => {
        const entry = entryMap?.[id];
        if (!entry) return 0;
        if (!entry.study) return 1;
        return 2;
      };
      const candidates = Object.entries(index)
        .filter(([id]) => id !== protect && rank(id) < 2)
        .sort(([leftId, left], [rightId, right]) => rank(leftId) - rank(rightId) || left[0] - right[0]);
      const removals = [];
      for (const [id, [, bytes]] of candidates) {
        if (total + extraBytes <= budgetBytes) break;
        removals.push(id);
        total -= bytes;
      }
      if (removals.length) await removeLexicons(removals);
      return total + extraBytes <= budgetBytes;
    }

    // Brings the lexicon in line with the vault: words that left are removed,
    // saved words without a record are queued first and stale records after.
    async function reconcile(entryMap) {
      const map = entryMap || (typeof getEntryMap === "function" ? await getEntryMap() : null);
      if (!map || typeof map !== "object") return { queued: 0, removed: 0 };
      const area = storageArea();
      if (!area) return { queued: 0, removed: 0 };
      const [index, misses] = await Promise.all([readIndex(area), readMisses(area)]);
      const at = now();
      const orphans = Object.keys(index).filter((id) => !map[id]);
      const missing = [];
      const stale = [];
      for (const [id, entry] of Object.entries(map)) {
        if (!isSavedEntry(entry)) continue;
        if (misses[id] && at - Number(misses[id]) < MISS_RETRY_MS) continue;
        if (!index[id]) missing.push(id);
        else if (at - index[id][0] >= REFRESH_MS) stale.push(id);
      }
      const removed = orphans.length ? await removeLexicons(orphans) : 0;
      enqueue([...missing, ...stale]);
      return { queued: missing.length + stale.length, removed };
    }

    // Called with the old and new entry maps from a storage change. Newly
    // saved words jump the queue (their LOD response is usually cached from the
    // lookup that saved them); deleted words lose their record at once.
    async function handleEntriesChanged(oldMap = {}, newMap = {}) {
      const before = oldMap && typeof oldMap === "object" ? oldMap : {};
      const after = newMap && typeof newMap === "object" ? newMap : {};
      const removed = Object.keys(before).filter((id) => !after[id]);
      const added = Object.keys(after).filter((id) => isSavedEntry(after[id]) && !isSavedEntry(before[id]));
      for (const id of removed) {
        generations.set(id, (generations.get(id) || 0) + 1);
        responses.delete(id);
        rerun.delete(id);
        queued.delete(id);
        const position = queue.indexOf(id);
        if (position !== -1) queue.splice(position, 1);
      }
      if (removed.length) await removeLexicons(removed);
      if (added.length) {
        const existing = await getLexicons(added);
        const fresh = added.filter((id) => !existing[id] || isStale(existing[id], now()));
        if (fresh.length) enqueue(fresh, { front: true });
      }
      return { added, removed };
    }

    return {
      rememberResponse,
      enqueue,
      reconcile,
      handleEntriesChanged,
      pruneForBudget,
      whenIdle,
      hydrateOne,
      get state() {
        return {
          queued: [...queue],
          running: [...running],
          failures,
          pausedUntil,
          cachedResponses: [...responses.keys()]
        };
      }
    };
  }

  globalThis.LodVaultStore?.registerBackupSection?.("lexicon", {
    exportData: getAllLexicons,
    async importData(value, context = {}) {
      const savedIds = context.savedIds || Object.values(await globalThis.LodVaultStore.getEntryMap())
        .filter((entry) => entry.favorite || entry.study).map((entry) => entry.id);
      context.lexiconCount = await importLexicons(value, savedIds);
    }
  });

  globalThis.LodVaultLexicon = {
    KEY_PREFIX,
    INDEX_KEY,
    MISS_KEY,
    HYDRATE_MESSAGE_TYPE,
    VERSION,
    REFRESH_MS,
    MISS_RETRY_MS,
    BUDGET_BYTES,
    RESPONSE_CACHE_TTL_MS,
    BACKOFF_BASE_MS,
    BACKOFF_MAX_MS,
    lexiconKey,
    isLexiconKey,
    idFromKey,
    normalizeLexiconRecord,
    isStale,
    getLexicon,
    getLexicons,
    getAllLexicons,
    getUsage,
    saveLexicon,
    removeLexicons,
    importLexicons,
    rebuildIndex,
    requestHydration,
    createHydrator
  };
})();
